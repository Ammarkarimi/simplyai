import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { Job } from 'bullmq';
import type { Prisma } from '@simplyai/db';
import { assertUsageQuota, audit } from '@simplyai/core';
import { agentChatSchema, agentSchema } from '@simplyai/shared';
import { RequirePermission, Ws } from '../../common/decorators';
import type { WorkspaceContext } from '../../common/context';
import { zbody } from '../../common/zod.pipe';
import { PrismaService } from '../../infra/prisma.service';
import { QueuesService } from '../../infra/queues.service';

const approvalSchema = z.object({ toolCallId: z.string(), approved: z.boolean() });

@Controller()
export class AgentsController {
  constructor(private readonly prisma: PrismaService, private readonly q: QueuesService) {}

  private get db() {
    return this.prisma.db;
  }

  private async agent(ws: WorkspaceContext, id: string) {
    const a = await this.db.agent.findFirst({ where: { id, workspaceId: ws.workspaceId }, include: { knowledgeBases: true, credential: { select: { id: true, name: true, type: true } } } });
    if (!a) throw new NotFoundException('Agent not found');
    return { ...a, knowledgeBaseIds: a.knowledgeBases.map((k) => k.knowledgeBaseId) };
  }

  private async checkRefs(ws: WorkspaceContext, body: Partial<z.infer<typeof agentSchema>>) {
    if (body.credentialId && !(await this.db.credential.findFirst({ where: { id: body.credentialId, workspaceId: ws.workspaceId } }))) throw new BadRequestException('Credential not found');
    if (body.knowledgeBaseIds?.length) {
      const n = await this.db.knowledgeBase.count({ where: { id: { in: body.knowledgeBaseIds }, workspaceId: ws.workspaceId } });
      if (n !== body.knowledgeBaseIds.length) throw new BadRequestException('Knowledge base not found');
    }
    for (const t of body.tools ?? []) {
      if (t.type === 'workflow' && !(await this.db.workflow.findFirst({ where: { id: String(t.config.workflowId ?? ''), workspaceId: ws.workspaceId } }))) throw new BadRequestException(`Tool "${t.name}" references a missing workflow`);
      if (t.type === 'dataTable' && !(await this.db.dataTable.findFirst({ where: { id: String(t.config.tableId ?? ''), workspaceId: ws.workspaceId } }))) throw new BadRequestException(`Tool "${t.name}" references a missing data table`);
    }
    if (new Set((body.tools ?? []).map((t) => t.name)).size !== (body.tools ?? []).length) throw new BadRequestException('Tool names must be unique');
  }

  @RequirePermission('agent:read')
  @Get('agents')
  async list(@Ws() ws: WorkspaceContext) {
    const rows = await this.db.agent.findMany({ where: { workspaceId: ws.workspaceId }, orderBy: { updatedAt: 'desc' }, include: { _count: { select: { conversations: true, knowledgeBases: true } } } });
    return rows.map(({ _count, ...a }) => ({ ...a, conversationCount: _count.conversations, knowledgeBaseCount: _count.knowledgeBases }));
  }

  @RequirePermission('agent:manage')
  @Post('agents')
  async create(@Ws() ws: WorkspaceContext, @Body(zbody(agentSchema)) body: z.infer<typeof agentSchema>) {
    await this.checkRefs(ws, body);
    const { knowledgeBaseIds, tools, outputSchema, ...rest } = body;
    const a = await this.db.agent.create({
      data: { ...rest, workspaceId: ws.workspaceId, createdById: ws.userId, tools: tools as Prisma.InputJsonValue, outputSchema: (outputSchema ?? undefined) as Prisma.InputJsonValue | undefined, knowledgeBases: { create: knowledgeBaseIds.map((knowledgeBaseId) => ({ knowledgeBaseId })) } },
    });
    await audit(this.db, { action: 'agent.created', userId: ws.userId, workspaceId: ws.workspaceId, resourceType: 'agent', resourceId: a.id });
    return this.agent(ws, a.id);
  }

  @RequirePermission('agent:read')
  @Get('agents/:id')
  get(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.agent(ws, id);
  }

  @RequirePermission('agent:manage')
  @Patch('agents/:id')
  async update(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body(zbody(agentSchema.partial())) body: Partial<z.infer<typeof agentSchema>>) {
    await this.agent(ws, id);
    await this.checkRefs(ws, body);
    const { knowledgeBaseIds, tools, outputSchema, ...rest } = body;
    await this.db.$transaction(async (tx) => {
      await tx.agent.update({ where: { id }, data: { ...rest, ...(tools ? { tools: tools as Prisma.InputJsonValue } : {}), ...(outputSchema !== undefined ? { outputSchema: (outputSchema ?? undefined) as Prisma.InputJsonValue } : {}) } });
      if (knowledgeBaseIds) {
        await tx.agentKnowledgeBase.deleteMany({ where: { agentId: id } });
        if (knowledgeBaseIds.length) await tx.agentKnowledgeBase.createMany({ data: knowledgeBaseIds.map((knowledgeBaseId) => ({ agentId: id, knowledgeBaseId })) });
      }
    });
    return this.agent(ws, id);
  }

  @RequirePermission('agent:manage')
  @Delete('agents/:id')
  async remove(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    await this.agent(ws, id);
    await this.db.agent.delete({ where: { id } });
    return { ok: true };
  }

  @RequirePermission('agent:read')
  @Get('agents/:id/conversations')
  async conversations(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    await this.agent(ws, id);
    return this.db.agentConversation.findMany({ where: { agentId: id }, orderBy: { updatedAt: 'desc' }, take: 100, include: { _count: { select: { messages: true } } } });
  }

  @RequirePermission('agent:read')
  @Get('conversations/:id')
  async conversation(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    const c = await this.db.agentConversation.findFirst({ where: { id, workspaceId: ws.workspaceId }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    if (!c) throw new NotFoundException('Conversation not found');
    return c;
  }

  @RequirePermission('agent:run')
  @Delete('conversations/:id')
  async deleteConversation(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    const r = await this.db.agentConversation.deleteMany({ where: { id, workspaceId: ws.workspaceId } });
    if (!r.count) throw new NotFoundException('Conversation not found');
    return { ok: true };
  }

  private async runJob(conversationId: string, workspaceId: string, approval?: { toolCallId: string; approved: boolean }) {
    const job = await this.q.queues.agents.add('chat', { conversationId, workspaceId, approval }, { jobId: `chat-${conversationId}-${Date.now()}` });
    let timedOut = false;
    try {
      await (job as Job).waitUntilFinished(this.q.queueEvents('agents'), 180_000);
    } catch (err) {
      if (/timed out|before finishing/i.test((err as Error).message)) timedOut = true;
    }
    const c = await this.db.agentConversation.findUniqueOrThrow({ where: { id: conversationId }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    return { ...c, timedOut };
  }

  @RequirePermission('agent:run')
  @HttpCode(200)
  @Post('agents/:id/chat')
  async chat(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body(zbody(agentChatSchema)) body: z.infer<typeof agentChatSchema>) {
    const agent = await this.agent(ws, id);
    if (!agent.credentialId) throw new BadRequestException('Select a model credential for this agent first');
    await assertUsageQuota(this.db, ws.organizationId, 'AI_TOKENS', 1);
    let conversationId = body.conversationId;
    if (conversationId) {
      const c = await this.db.agentConversation.findFirst({ where: { id: conversationId, agentId: id } });
      if (!c) throw new NotFoundException('Conversation not found');
      if (c.status === 'running') throw new BadRequestException('The agent is still answering the previous message');
      if (c.status === 'awaiting_approval') throw new BadRequestException('Approve or reject the pending tool call first');
    } else {
      const c = await this.db.agentConversation.create({ data: { workspaceId: ws.workspaceId, agentId: id, userId: ws.userId, title: body.message.slice(0, 80), source: 'playground' } });
      conversationId = c.id;
    }
    await this.db.agentMessage.create({ data: { conversationId, role: 'user', content: body.message } });
    await this.db.agentConversation.update({ where: { id: conversationId }, data: { status: 'running' } });
    return this.runJob(conversationId, ws.workspaceId);
  }

  @RequirePermission('agent:run')
  @HttpCode(200)
  @Post('conversations/:id/approve')
  async approve(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body(zbody(approvalSchema)) body: z.infer<typeof approvalSchema>) {
    const c = await this.db.agentConversation.findFirst({ where: { id, workspaceId: ws.workspaceId } });
    if (!c) throw new NotFoundException('Conversation not found');
    if (c.status !== 'awaiting_approval') throw new BadRequestException('Nothing is waiting for approval');
    await this.db.agentConversation.update({ where: { id }, data: { status: 'running' } });
    await audit(this.db, { action: body.approved ? 'agent.tool_approved' : 'agent.tool_rejected', userId: ws.userId, workspaceId: ws.workspaceId, resourceType: 'conversation', resourceId: id });
    return this.runJob(id, ws.workspaceId, body);
  }
}
