import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { assertUsageQuota, getStorage, incrementUsage, newStorageKey, resolveCredential } from '@simplyai/core';
import { cosineSimilarity, llmEmbed } from '@simplyai/ai';
import { knowledgeBaseSchema } from '@simplyai/shared';
import { RequirePermission, Ws } from '../../common/decorators';
import type { WorkspaceContext } from '../../common/context';
import { zbody } from '../../common/zod.pipe';
import { PrismaService } from '../../infra/prisma.service';
import { QueuesService } from '../../infra/queues.service';

const textDocSchema = z.object({ name: z.string().min(1).max(200), text: z.string().min(1).max(2_000_000) });
const searchSchema = z.object({ query: z.string().min(1).max(5000), topK: z.number().int().min(1).max(20).default(5) });
const ALLOWED = /\.(txt|md|markdown|csv|json|html?|pdf)$/i;

@Controller('knowledge-bases')
export class KnowledgeController {
  constructor(private readonly prisma: PrismaService, private readonly q: QueuesService) {}

  private get db() {
    return this.prisma.db;
  }

  private async kb(ws: WorkspaceContext, id: string) {
    const kb = await this.db.knowledgeBase.findFirst({ where: { id, workspaceId: ws.workspaceId } });
    if (!kb) throw new NotFoundException('Knowledge base not found');
    return kb;
  }

  @RequirePermission('agent:read')
  @Get()
  async list(@Ws() ws: WorkspaceContext) {
    const rows = await this.db.knowledgeBase.findMany({ where: { workspaceId: ws.workspaceId }, orderBy: { updatedAt: 'desc' }, include: { _count: { select: { documents: true, chunks: true } }, credential: { select: { name: true, type: true } } } });
    return rows.map(({ _count, ...k }) => ({ ...k, documentCount: _count.documents, chunkCount: _count.chunks }));
  }

  @RequirePermission('agent:manage')
  @Post()
  async create(@Ws() ws: WorkspaceContext, @Body(zbody(knowledgeBaseSchema)) body: z.infer<typeof knowledgeBaseSchema>) {
    if (body.credentialId && !(await this.db.credential.findFirst({ where: { id: body.credentialId, workspaceId: ws.workspaceId } }))) throw new BadRequestException('Credential not found');
    return this.db.knowledgeBase.create({ data: { ...body, workspaceId: ws.workspaceId } });
  }

  @RequirePermission('agent:read')
  @Get(':id')
  async get(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    const kb = await this.kb(ws, id);
    const documents = await this.db.knowledgeDocument.findMany({ where: { knowledgeBaseId: id }, orderBy: { createdAt: 'desc' } });
    return { ...kb, documents };
  }

  @RequirePermission('agent:manage')
  @Patch(':id')
  async update(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body(zbody(knowledgeBaseSchema.partial())) body: Partial<z.infer<typeof knowledgeBaseSchema>>) {
    const kb = await this.kb(ws, id);
    if ((body.embeddingModel && body.embeddingModel !== kb.embeddingModel) || (body.embeddingProvider && body.embeddingProvider !== kb.embeddingProvider)) {
      if (await this.db.knowledgeChunk.count({ where: { knowledgeBaseId: id } })) throw new BadRequestException('Remove documents before changing the embedding model');
    }
    return this.db.knowledgeBase.update({ where: { id }, data: body });
  }

  @RequirePermission('agent:manage')
  @Delete(':id')
  async remove(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    await this.kb(ws, id);
    await this.db.knowledgeBase.delete({ where: { id } });
    return { ok: true };
  }

  private async addDocument(ws: WorkspaceContext, kbId: string, name: string, mimeType: string, buffer: Buffer) {
    const storageKey = newStorageKey(ws.workspaceId, name);
    await getStorage().put(storageKey, buffer, mimeType);
    const file = await this.db.storedFile.create({ data: { workspaceId: ws.workspaceId, storageKey, name, mimeType, size: buffer.length } });
    const doc = await this.db.knowledgeDocument.create({ data: { knowledgeBaseId: kbId, fileId: file.id, name, mimeType, size: buffer.length } });
    await this.q.queues.ingest.add('ingest', { documentId: doc.id }, { jobId: `ingest-${doc.id}` });
    return doc;
  }

  @RequirePermission('agent:manage')
  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async upload(@Ws() ws: WorkspaceContext, @Param('id') id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    await this.kb(ws, id);
    if (!file) throw new BadRequestException('Upload a file in the "file" field');
    if (!ALLOWED.test(file.originalname)) throw new BadRequestException('Supported files: .txt, .md, .csv, .json, .html, .pdf');
    return this.addDocument(ws, id, file.originalname, file.mimetype || 'application/octet-stream', file.buffer);
  }

  @RequirePermission('agent:manage')
  @Post(':id/documents/text')
  async addText(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body(zbody(textDocSchema)) body: z.infer<typeof textDocSchema>) {
    await this.kb(ws, id);
    return this.addDocument(ws, id, body.name.endsWith('.txt') || body.name.endsWith('.md') ? body.name : `${body.name}.md`, 'text/markdown', Buffer.from(body.text, 'utf8'));
  }

  @RequirePermission('agent:manage')
  @HttpCode(200)
  @Post(':id/documents/:docId/reindex')
  async reindex(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Param('docId') docId: string) {
    await this.kb(ws, id);
    const doc = await this.db.knowledgeDocument.findFirst({ where: { id: docId, knowledgeBaseId: id } });
    if (!doc) throw new NotFoundException('Document not found');
    await this.db.knowledgeDocument.update({ where: { id: docId }, data: { status: 'PENDING', error: null } });
    await this.q.queues.ingest.add('ingest', { documentId: docId }, { jobId: `ingest-${docId}-${Date.now()}` });
    return { ok: true };
  }

  @RequirePermission('agent:manage')
  @Delete(':id/documents/:docId')
  async removeDocument(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Param('docId') docId: string) {
    await this.kb(ws, id);
    const doc = await this.db.knowledgeDocument.findFirst({ where: { id: docId, knowledgeBaseId: id }, include: { file: true } });
    if (!doc) throw new NotFoundException('Document not found');
    await this.db.knowledgeDocument.delete({ where: { id: docId } });
    if (doc.file) {
      await getStorage().delete(doc.file.storageKey).catch(() => undefined);
      await this.db.storedFile.delete({ where: { id: doc.file.id } }).catch(() => undefined);
    }
    return { ok: true };
  }

  @RequirePermission('agent:read')
  @HttpCode(200)
  @Post(':id/search')
  async search(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body(zbody(searchSchema)) body: z.infer<typeof searchSchema>) {
    const kb = await this.kb(ws, id);
    if (!kb.credentialId) throw new BadRequestException('This knowledge base has no embedding credential');
    await assertUsageQuota(this.db, ws.organizationId, 'AI_TOKENS', 1);
    const cred = await resolveCredential(this.db, ws.workspaceId, kb.credentialId, []);
    const emb = await llmEmbed({ provider: kb.embeddingProvider as 'openai', model: kb.embeddingModel, input: [body.query], credentials: cred.data });
    await incrementUsage(this.db, ws.organizationId, ws.workspaceId, 'AI_TOKENS', emb.usage.inputTokens);
    const chunks = await this.db.knowledgeChunk.findMany({ where: { knowledgeBaseId: id }, select: { content: true, embedding: true, index: true, documentId: true, document: { select: { name: true } } } });
    return chunks
      .map((c) => ({ content: c.content, documentId: c.documentId, documentName: c.document.name, chunkIndex: c.index, score: cosineSimilarity(emb.embeddings[0] ?? [], c.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, body.topK);
  }
}
