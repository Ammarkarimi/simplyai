import { Controller, Get, Query } from '@nestjs/common';
import { Prisma } from '@simplyai/db';
import { RequirePermission, Ws } from '../../common/decorators';
import type { WorkspaceContext } from '../../common/context';
import { PrismaService } from '../../infra/prisma.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  @RequirePermission('workflow:read')
  @Get()
  async overview(@Ws() ws: WorkspaceContext, @Query('from') fromQ?: string, @Query('to') toQ?: string) {
    const db = this.prisma.db;
    const to = toQ ? new Date(toQ) : new Date();
    const from = fromQ ? new Date(fromQ) : new Date(to.getTime() - 14 * 86_400_000);
    const range = { gte: from, lte: to };
    const wsId = ws.workspaceId;
    const [totalWorkflows, activeWorkflows, byStatus, running, top, errors, activity, perDay, avg, agents, credentials] = await Promise.all([
      db.workflow.count({ where: { workspaceId: wsId, archivedAt: null } }),
      db.workflow.count({ where: { workspaceId: wsId, active: true } }),
      db.execution.groupBy({ by: ['status'], where: { workspaceId: wsId, queuedAt: range }, _count: { _all: true } }),
      db.execution.count({ where: { workspaceId: wsId, status: { in: ['RUNNING', 'QUEUED', 'WAITING'] } } }),
      db.execution.groupBy({ by: ['workflowId'], where: { workspaceId: wsId, queuedAt: range }, _count: { _all: true }, orderBy: { _count: { workflowId: 'desc' } }, take: 6 }),
      db.execution.findMany({ where: { workspaceId: wsId, status: 'FAILED', queuedAt: range }, orderBy: { queuedAt: 'desc' }, take: 6, select: { id: true, error: true, queuedAt: true, workflow: { select: { id: true, name: true } } } }),
      db.auditLog.findMany({ where: { workspaceId: wsId }, orderBy: { createdAt: 'desc' }, take: 10, include: { user: { select: { name: true } } } }),
      db.$queryRaw<Array<{ day: Date; status: string; count: bigint }>>`
        SELECT date_trunc('day', "queuedAt") AS day, status::text AS status, COUNT(*)::bigint AS count
        FROM "Execution" WHERE "workspaceId" = ${wsId} AND "queuedAt" BETWEEN ${from} AND ${to}
        GROUP BY 1, 2 ORDER BY 1`,
      db.execution.aggregate({ where: { workspaceId: wsId, queuedAt: range, durationMs: { not: null } }, _avg: { durationMs: true } }),
      db.agent.count({ where: { workspaceId: wsId } }),
      db.credential.count({ where: { workspaceId: wsId } }),
    ]);
    const counts = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])) as Record<string, number>;
    const total = byStatus.reduce((s, x) => s + x._count._all, 0);
    const finished = (counts.SUCCESS ?? 0) + (counts.FAILED ?? 0);
    const names = await db.workflow.findMany({ where: { id: { in: top.map((t) => t.workflowId) } }, select: { id: true, name: true, active: true } });
    const days: Record<string, { date: string; success: number; failed: number; other: number }> = {};
    for (let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())); d <= to; d = new Date(d.getTime() + 86_400_000)) {
      const k = d.toISOString().slice(0, 10);
      days[k] = { date: k, success: 0, failed: 0, other: 0 };
    }
    for (const r of perDay) {
      const k = new Date(r.day).toISOString().slice(0, 10);
      const bucket = (days[k] ??= { date: k, success: 0, failed: 0, other: 0 });
      if (r.status === 'SUCCESS') bucket.success += Number(r.count);
      else if (r.status === 'FAILED') bucket.failed += Number(r.count);
      else bucket.other += Number(r.count);
    }
    return {
      range: { from, to },
      workflows: { total: totalWorkflows, active: activeWorkflows },
      executions: { total, success: counts.SUCCESS ?? 0, failed: counts.FAILED ?? 0, cancelled: counts.CANCELLED ?? 0, running, successRate: finished ? Math.round(((counts.SUCCESS ?? 0) / finished) * 1000) / 10 : null, avgDurationMs: avg._avg.durationMs ? Math.round(avg._avg.durationMs) : null },
      agents, credentials,
      chart: Object.values(days),
      topWorkflows: top.map((t) => ({ workflowId: t.workflowId, name: names.find((n) => n.id === t.workflowId)?.name ?? 'Deleted workflow', active: names.find((n) => n.id === t.workflowId)?.active ?? false, executions: t._count._all })),
      recentErrors: errors.map((e) => ({ id: e.id, workflow: e.workflow, at: e.queuedAt, message: (e.error as { message?: string } | null)?.message ?? 'Unknown error', nodeName: (e.error as { nodeName?: string } | null)?.nodeName ?? null })),
      recentActivity: activity.map((a) => ({ id: a.id, action: a.action, user: a.user?.name ?? 'System', at: a.createdAt, resourceType: a.resourceType, resourceId: a.resourceId })),
    };
  }
}
