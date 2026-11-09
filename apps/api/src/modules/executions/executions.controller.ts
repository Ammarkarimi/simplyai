import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '@simplyai/db';
import { audit, createExecution } from '@simplyai/core';
import { executionListQuerySchema, type Item, type WorkflowDefinition } from '@simplyai/shared';
import { RequirePermission, Ws } from '../../common/decorators';
import type { WorkspaceContext } from '../../common/context';
import { zbody, ZodPipe } from '../../common/zod.pipe';
import { paginate, pageResult } from '../../common/pagination';
import { PrismaService } from '../../infra/prisma.service';
import { QueuesService } from '../../infra/queues.service';
import { RedisService } from '../../infra/redis.service';

const approveSchema = z.object({ approved: z.boolean(), comment: z.string().max(1000).optional() });
const bulkDeleteSchema = z.object({ ids: z.array(z.string()).max(500).optional(), status: z.enum(['SUCCESS', 'FAILED', 'CANCELLED']).optional(), olderThanDays: z.number().int().min(0).optional() });

@Controller('executions')
export class ExecutionsController {
  constructor(private readonly prisma: PrismaService, private readonly q: QueuesService, private readonly redis: RedisService) {}

  private get db() {
    return this.prisma.db;
  }

  private async find(ws: WorkspaceContext, id: string) {
    const ex = await this.db.execution.findFirst({ where: { id, workspaceId: ws.workspaceId } });
    if (!ex) throw new NotFoundException('Execution not found');
    return ex;
  }

  @RequirePermission('execution:read')
  @Get()
  async list(@Ws() ws: WorkspaceContext, @Query(new ZodPipe(executionListQuerySchema)) q: z.infer<typeof executionListQuerySchema>) {
    const where: Prisma.ExecutionWhereInput = {
      workspaceId: ws.workspaceId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.workflowId ? { workflowId: q.workflowId } : {}),
      ...(q.mode ? { mode: q.mode as never } : {}),
      ...(q.search ? { OR: [{ id: { contains: q.search } }, { workflow: { name: { contains: q.search, mode: 'insensitive' } } }] } : {}),
      ...(q.from || q.to ? { queuedAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.execution.findMany({
        where, orderBy: { queuedAt: 'desc' }, ...paginate(q.page, q.pageSize),
        select: { id: true, workflowId: true, mode: true, status: true, queuedAt: true, startedAt: true, finishedAt: true, durationMs: true, error: true, retryOfId: true, waitUntil: true, workflow: { select: { name: true } } },
      }),
      this.db.execution.count({ where }),
    ]);
    return pageResult(items, total, q.page, q.pageSize);
  }

  @RequirePermission('execution:read')
  @Get('counts')
  async counts(@Ws() ws: WorkspaceContext) {
    const rows = await this.db.execution.groupBy({ by: ['status'], where: { workspaceId: ws.workspaceId }, _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }

  @RequirePermission('execution:read')
  @Get(':id')
  async detail(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    const ex = await this.db.execution.findFirst({
      where: { id, workspaceId: ws.workspaceId },
      include: {
        workflow: { select: { id: true, name: true } },
        nodeExecutions: { orderBy: [{ startedAt: 'asc' }] },
        createdBy: { select: { name: true } },
        children: { select: { id: true, status: true, workflowId: true } },
      },
    });
    if (!ex) throw new NotFoundException('Execution not found');
    const { state, ...rest } = ex;
    const waiting = (state as { waiting?: { nodeId: string; kind: string; message?: string; until?: string } } | null)?.waiting ?? null;
    return { ...rest, waiting: ex.status === 'WAITING' ? waiting : null };
  }

  @RequirePermission('execution:manage')
  @Post(':id/retry')
  async retry(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body() body: { useLatestVersion?: boolean }) {
    const ex = await this.find(ws, id);
    if (['QUEUED', 'RUNNING', 'WAITING'].includes(ex.status)) throw new BadRequestException('Only finished executions can be retried');
    let definition = ex.workflowSnapshot as unknown as WorkflowDefinition;
    let versionId = ex.workflowVersionId;
    if (body?.useLatestVersion) {
      const wf = await this.db.workflow.findUniqueOrThrow({ where: { id: ex.workflowId }, include: { activeVersion: true } });
      if (wf.activeVersion) {
        definition = wf.activeVersion.definition as unknown as WorkflowDefinition;
        versionId = wf.activeVersion.id;
      }
    }
    const created = await createExecution(this.db, this.q.queues, {
      workspaceId: ws.workspaceId, workflowId: ex.workflowId, mode: 'RETRY', definition, workflowVersionId: versionId,
      triggerNodeId: ex.triggerNodeKey, destinationNodeId: ex.destinationNodeKey, items: (ex.inputData as unknown as Item[] | null) ?? undefined, createdById: ws.userId, retryOfId: ex.id,
    });
    return { executionId: created.id };
  }

  @RequirePermission('execution:manage')
  @HttpCode(200)
  @Post(':id/cancel')
  async cancel(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    const ex = await this.find(ws, id);
    if (ex.status === 'QUEUED' || ex.status === 'WAITING') {
      await this.q.queues.executions.remove(ex.id).catch(() => undefined);
      const now = new Date();
      await this.db.execution.update({ where: { id }, data: { status: 'CANCELLED', finishedAt: now, durationMs: ex.startedAt ? now.getTime() - ex.startedAt.getTime() : 0, state: undefined } });
      await this.redis.publishEvent({ type: 'execution.finished', workspaceId: ws.workspaceId, executionId: id, workflowId: ex.workflowId, status: 'CANCELLED', at: now.toISOString() });
    } else if (ex.status === 'RUNNING') {
      await this.redis.requestCancel(id);
    } else throw new BadRequestException(`Execution is already ${ex.status.toLowerCase()}`);
    await audit(this.db, { action: 'execution.cancelled', userId: ws.userId, workspaceId: ws.workspaceId, resourceType: 'execution', resourceId: id });
    return { ok: true };
  }

  @RequirePermission('execution:manage')
  @HttpCode(200)
  @Post(':id/approve')
  async approve(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body(zbody(approveSchema)) body: z.infer<typeof approveSchema>) {
    const ex = await this.find(ws, id);
    const waiting = (ex.state as { waiting?: { kind: string } } | null)?.waiting;
    if (ex.status !== 'WAITING' || waiting?.kind !== 'approval') throw new BadRequestException('This execution is not waiting for approval');
    const claimed = await this.db.execution.updateMany({ where: { id, status: 'WAITING' }, data: { status: 'QUEUED' } });
    if (!claimed.count) throw new BadRequestException('This approval was already handled');
    await this.q.queues.executions.add('resume', { executionId: id, resume: { approved: body.approved, data: { comment: body.comment ?? null, by: ws.userId }, userId: ws.userId ?? undefined } }, { jobId: `approval-${id}-${Date.now()}` });
    await audit(this.db, { action: body.approved ? 'execution.approved' : 'execution.rejected', userId: ws.userId, workspaceId: ws.workspaceId, resourceType: 'execution', resourceId: id });
    return { ok: true };
  }

  @RequirePermission('execution:manage')
  @Delete(':id')
  async remove(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    const ex = await this.find(ws, id);
    if (['QUEUED', 'RUNNING', 'WAITING'].includes(ex.status)) throw new BadRequestException('Cancel the execution before deleting it');
    await this.db.execution.delete({ where: { id } });
    return { ok: true };
  }

  @RequirePermission('execution:manage')
  @HttpCode(200)
  @Post('bulk-delete')
  async bulkDelete(@Ws() ws: WorkspaceContext, @Body(zbody(bulkDeleteSchema)) body: z.infer<typeof bulkDeleteSchema>) {
    const r = await this.db.execution.deleteMany({
      where: {
        workspaceId: ws.workspaceId, status: body.status ? body.status : { in: ['SUCCESS', 'FAILED', 'CANCELLED'] },
        ...(body.ids ? { id: { in: body.ids } } : {}),
        ...(body.olderThanDays !== undefined ? { queuedAt: { lt: new Date(Date.now() - body.olderThanDays * 86_400_000) } } : {}),
      },
    });
    return { deleted: r.count };
  }
}
