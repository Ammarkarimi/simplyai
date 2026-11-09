import { chunkText, cosineSimilarity, estimateTokens, extractText, llmEmbed } from '@simplyai/ai';
import { getStorage, incrementUsage, newStorageKey, resolveCredential } from '@simplyai/core';
import { NodeOperationError, type KnowledgeMatch } from '@simplyai/sdk';
import { db, log } from './context';

async function embedder(workspaceId: string, kbId: string) {
  const kb = await db.knowledgeBase.findFirst({ where: { id: kbId, workspaceId }, include: { workspace: { select: { organizationId: true } } } });
  if (!kb) throw new NodeOperationError('Knowledge base not found in this workspace');
  if (!kb.credentialId) throw new NodeOperationError(`Knowledge base "${kb.name}" has no embedding credential`);
  const cred = await resolveCredential(db, workspaceId, kb.credentialId, []);
  return {
    kb,
    async embed(texts: string[]) {
      const r = await llmEmbed({ provider: kb.embeddingProvider as 'openai', model: kb.embeddingModel, input: texts, credentials: cred.data });
      await incrementUsage(db, kb.workspace.organizationId, workspaceId, 'AI_TOKENS', r.usage.inputTokens);
      return r.embeddings;
    },
  };
}

export async function searchKnowledge(workspaceId: string, kbId: string, query: string, topK: number): Promise<KnowledgeMatch[]> {
  const { embed } = await embedder(workspaceId, kbId);
  const [vector] = await embed([query]);
  const chunks = await db.knowledgeChunk.findMany({ where: { knowledgeBaseId: kbId }, select: { content: true, embedding: true, index: true, documentId: true, document: { select: { name: true } } } });
  return chunks
    .map((c) => ({ content: c.content, documentId: c.documentId, documentName: c.document.name, chunkIndex: c.index, score: Math.round(cosineSimilarity(vector ?? [], c.embedding) * 10_000) / 10_000 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** Extract, chunk, embed and store a knowledge document. */
export async function ingestDocument(documentId: string, inlineText?: string): Promise<number> {
  const doc = await db.knowledgeDocument.findUnique({ where: { id: documentId }, include: { file: true, knowledgeBase: true } });
  if (!doc) return 0;
  await db.knowledgeDocument.update({ where: { id: documentId }, data: { status: 'PROCESSING', error: null } });
  try {
    const text = inlineText ?? (doc.file ? await extractText(await getStorage().get(doc.file.storageKey), doc.mimeType, doc.name) : '');
    const chunks = chunkText(text, doc.knowledgeBase.chunkSize, doc.knowledgeBase.chunkOverlap);
    if (!chunks.length) throw new Error('The document does not contain extractable text');
    if (chunks.length > 5000) throw new Error('Documents are limited to 5,000 chunks');
    const { embed } = await embedder(doc.knowledgeBase.workspaceId, doc.knowledgeBaseId);
    const vectors = await embed(chunks);
    await db.$transaction([
      db.knowledgeChunk.deleteMany({ where: { documentId } }),
      db.knowledgeChunk.createMany({ data: chunks.map((content, index) => ({ documentId, knowledgeBaseId: doc.knowledgeBaseId, index, content, embedding: vectors[index] ?? [], tokenCount: estimateTokens(content) })) }),
      db.knowledgeDocument.update({ where: { id: documentId }, data: { status: 'READY', chunkCount: chunks.length } }),
    ]);
    log.info('document ingested', { documentId, chunks: chunks.length });
    return chunks.length;
  } catch (err) {
    await db.knowledgeDocument.update({ where: { id: documentId }, data: { status: 'FAILED', error: (err as Error).message.slice(0, 1000) } });
    throw err;
  }
}

export async function addTextDocument(workspaceId: string, kbId: string, name: string, text: string) {
  const kb = await db.knowledgeBase.findFirst({ where: { id: kbId, workspaceId } });
  if (!kb) throw new NodeOperationError('Knowledge base not found in this workspace');
  const storageKey = newStorageKey(workspaceId, `${name}.md`);
  await getStorage().put(storageKey, Buffer.from(text, 'utf8'), 'text/markdown');
  const file = await db.storedFile.create({ data: { workspaceId, storageKey, name, mimeType: 'text/markdown', size: Buffer.byteLength(text) } });
  const doc = await db.knowledgeDocument.create({ data: { knowledgeBaseId: kbId, fileId: file.id, name, mimeType: 'text/markdown', size: Buffer.byteLength(text) } });
  const chunks = await ingestDocument(doc.id, text);
  return { documentId: doc.id, chunks };
}
