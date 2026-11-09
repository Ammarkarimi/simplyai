import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Queue } from 'bullmq';
import { audit, getRegistry } from '@simplyai/core';
import { featureFlagSchema, listQuerySchema, monthStart, planUpdateSchema } from '@simplyai/shared';
import { CurrentUser, PlatformAdmin, SessionOnly } from '../../common/decorators';
import { ZodPipe, zbody } from '../../common/zod.pipe';
import { paginate, pageResult } from '../../common/pagination';
import { PrismaService } from '../../infra/prisma.service';
import { QueuesService } from '../../infra/queues.service';
import { RedisService } from '../../infra/redis.service';
import type { User } from '@simplyai/db';

const userUpdate = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']).optional(), isPlatformAdmin: z.boolean().optional() });
const orgPlan = z.object({ planKey: z.string() });

@SessionOnly()
@PlatformAdmin()
@Controller('admin')
export class AdminController {
  constructor(private readonly prisma: PrismaService, private readonly q: QueuesService, private readonly redis: RedisService) {}

  private get db() {
    return this.prisma.db;
  }

  @Get('stats')
  async stats() {
    const day = new Date(Date.now() - 86_400_000);
    const [users, organizations, workspaces, workflows, activeWorkflows, executions, executions24h, failed24h, agents, byPlan, byStatus] = await Promise.all([
      this.db.user.count(), this.db.organization.count(), this.db.workspace.count(), this.db.workflow.count(), this.db.workflow.count({ where: { active: true } }),
      this.db.execution.count(), this.db.execution.count({ where: { queuedAt: { gte: day } } }), this.db.execution.count({ where: { queuedAt: { gte: day }, status: 'FAILED' } }),
      this.db.agent.count(),
      this.db.subscription.groupBy({ by: ['planId'], _count: { _all: true } }),
      this.db.execution.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const plans = await this.db.plan.findMany();
    return {
      users, organizations, workspaces, workflows, activeWorkflows, executions, executions24h, failed24h, agents,
      subscriptionsByPlan: byPlan.map((p) => ({ plan: plans.find((x) => x.id === p.planId)?.name ?? p.planId, count: p._count._all })),
      executionsByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
    };
  }

  @Get('users')
  async users(@Query(new ZodPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>) {
    const where = q.search ? { OR: [{ email: { contains: q.search, mode: 'insensitive' as const } }, { name: { contains: q.search, mode: 'insensitive' as const } }] } : {};
    const [items, total] = await Promise.all([
      this.db.user.findMany({ where, orderBy: { createdAt: 'desc' }, ...paginate(q.page, q.pageSize), select: { id: true, email: true, name: true, status: true, isPlatformAdmin: true, emailVerifiedAt: true, lastLoginAt: true, createdAt: true, _count: { select: { workspaceMembers: true } } } }),
      this.db.user.count({ where }),
    ]);
    return pageResult(items, total, q.page, q.pageSize);
  }

  @Patch('users/:id')
  async updateUser(@CurrentUser() me: User, @Param('id') id: string, @Body(zbody(userUpdate)) body: z.infer<typeof userUpdate>) {
    if (id === me.id && (body.status === 'SUSPENDED' || body.isPlatformAdmin === false)) throw new BadRequestException('You cannot suspend or demote yourself');
    const u = await this.db.user.update({ where: { id }, data: body });
    if (body.status === 'SUSPENDED') await this.db.session.deleteMany({ where: { userId: id } });
    await audit(this.db, { action: 'admin.user_updated', userId: me.id, resourceType: 'user', resourceId: id, metadata: body });
    return { id: u.id, status: u.status, isPlatformAdmin: u.isPlatformAdmin };
  }

  @Get('organizations')
  async organizations(@Query(new ZodPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>) {
    const where = q.search ? { name: { contains: q.search, mode: 'insensitive' as const } } : {};
    const [rows, total] = await Promise.all([
      this.db.organization.findMany({ where, orderBy: { createdAt: 'desc' }, ...paginate(q.page, q.pageSize), include: { subscription: { include: { plan: true } }, _count: { select: { workspaces: true, members: true } } } }),
      this.db.organization.count({ where }),
    ]);
    const usage = await this.db.usageRecord.groupBy({ by: ['organizationId', 'metric'], where: { organizationId: { in: rows.map((r) => r.id) }, period: monthStart() }, _sum: { quantity: true } });
    const items = rows.map((o) => ({
      id: o.id, name: o.name, slug: o.slug, createdAt: o.createdAt, workspaces: o._count.workspaces, members: o._count.members,
      plan: o.subscription?.plan.key ?? 'free', planName: o.subscription?.plan.name ?? 'Free', status: o.subscription?.status ?? 'ACTIVE',
      usage: Object.fromEntries(usage.filter((u) => u.organizationId === o.id).map((u) => [u.metric, Number(u._sum.quantity ?? 0)])),
    }));
    return pageResult(items, total, q.page, q.pageSize);
  }

  @Patch('organizations/:id/plan')
  async setPlan(@CurrentUser() me: User, @Param('id') id: string, @Body(zbody(orgPlan)) body: z.infer<typeof orgPlan>) {
    const plan = await this.db.plan.findUnique({ where: { key: body.planKey } });
    if (!plan) throw new NotFoundException('Plan not found');
    await this.db.subscription.upsert({
      where: { organizationId: id },
      create: { organizationId: id, planId: plan.id, currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) },
      update: { planId: plan.id, status: 'ACTIVE' },
    });
    await audit(this.db, { action: 'admin.plan_changed', userId: me.id, organizationId: id, metadata: { plan: plan.key } });
    return { ok: true };
  }

  @Get('workspaces')
  async workspaces(@Query(new ZodPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>) {
    const where = q.search ? { name: { contains: q.search, mode: 'insensitive' as const } } : {};
    const [items, total] = await Promise.all([
      this.db.workspace.findMany({ where, orderBy: { createdAt: 'desc' }, ...paginate(q.page, q.pageSize), include: { organization: { select: { name: true } }, _count: { select: { members: true, workflows: true, executions: true, credentials: true } } } }),
      this.db.workspace.count({ where }),
    ]);
    return pageResult(items, total, q.page, q.pageSize);
  }

  @Get('plans')
  plans() {
    return this.db.plan.findMany({ orderBy: { sortOrder: 'asc' }, include: { _count: { select: { subscriptions: true } } } });
  }

  @Patch('plans/:id')
  async updatePlan(@CurrentUser() me: User, @Param('id') id: string, @Body(zbody(planUpdateSchema)) body: z.infer<typeof planUpdateSchema>) {
    const p = await this.db.plan.update({ where: { id }, data: body });
    await audit(this.db, { action: 'admin.plan_updated', userId: me.id, resourceType: 'plan', resourceId: id, metadata: body });
    return p;
  }

  @Get('usage')
  async usage() {
    const rows = await this.db.usageRecord.groupBy({ by: ['organizationId', 'metric'], where: { period: monthStart() }, _sum: { quantity: true } });
    const orgs = await this.db.organization.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.organizationId))] } }, select: { id: true, name: true } });
    const byOrg = new Map<string, Record<string, number>>();
    for (const r of rows) byOrg.set(r.organizationId, { ...(byOrg.get(r.organizationId) ?? {}), [r.metric]: Number(r._sum.quantity ?? 0) });
    const totals = { EXECUTIONS: 0, TASKS: 0, AI_TOKENS: 0 } as Record<string, number>;
    rows.forEach((r) => (totals[r.metric] = (totals[r.metric] ?? 0) + Number(r._sum.quantity ?? 0)));
    return {
      period: monthStart(), totals,
      organizations: [...byOrg.entries()].map(([id, u]) => ({ id, name: orgs.find((o) => o.id === id)?.name ?? id, ...u }) as { id: string; name: string } & Record<string, number>).sort((a, b) => (b.EXECUTIONS ?? 0) - (a.EXECUTIONS ?? 0)).slice(0, 50),
    };
  }

  private queueList(): Array<[string, Queue]> {
    const qs = this.q.queues;
    return [['executions', qs.executions], ['triggers', qs.triggers], ['agents', qs.agents], ['ingest', qs.ingest]] as Array<[string, Queue]>;
  }

  @Get('queues')
  async queues() {
    return Promise.all(this.queueList().map(async ([name, q]) => ({ name, counts: await q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused', 'prioritized'), schedulers: (await q.getJobSchedulersCount().catch(() => 0)) as number })));
  }

  @Get('queues/:name/failed')
  async failed(@Param('name') name: string) {
    const q = this.queueList().find(([n]) => n === name)?.[1];
    if (!q) throw new NotFoundException();
    const jobs = await q.getFailed(0, 49);
    return jobs.map((j) => ({ id: j.id, name: j.name, data: j.data, failedReason: j.failedReason, attemptsMade: j.attemptsMade, finishedOn: j.finishedOn }));
  }

  @HttpCode(200)
  @Post('queues/:name/retry-failed')
  async retryFailed(@Param('name') name: string) {
    const q = this.queueList().find(([n]) => n === name)?.[1];
    if (!q) throw new NotFoundException();
    await q.retryJobs({ state: 'failed', count: 1000 });
    return { ok: true };
  }

  @HttpCode(200)
  @Post('queues/:name/clean')
  async clean(@Param('name') name: string) {
    const q = this.queueList().find(([n]) => n === name)?.[1];
    if (!q) throw new NotFoundException();
    const removed = [...(await q.clean(0, 10_000, 'completed')), ...(await q.clean(0, 10_000, 'failed'))];
    return { removed: removed.length };
  }

  @Get('workers')
  async workers() {
    const keys = await this.redis.client.keys('sai:worker:*');
    const values = keys.length ? await this.redis.client.mget(keys) : [];
    return values.filter(Boolean).map((v) => JSON.parse(v!)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  @Get('health')
  async health() {
    const t0 = Date.now();
    const db = await this.db.$queryRaw`SELECT 1`.then(() => ({ ok: true, latencyMs: Date.now() - t0 })).catch((e: Error) => ({ ok: false, error: e.message }));
    const t1 = Date.now();
    const redis = await this.redis.client.ping().then(() => ({ ok: true, latencyMs: Date.now() - t1 })).catch((e: Error) => ({ ok: false, error: e.message }));
    const workers = await this.workers();
    const stuck = await this.db.execution.count({ where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - 3_600_000) } } });
    return {
      api: { ok: true, uptimeSec: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1_048_576), node: process.version },
      database: db, redis, workers: { count: workers.length, ok: workers.length > 0 }, stuckExecutions: stuck,
    };
  }

  @Get('logs')
  async logs(@Query(new ZodPipe(listQuerySchema.extend({ level: z.string().optional() }))) q: z.infer<typeof listQuerySchema> & { level?: string }) {
    const where = { ...(q.level ? { level: q.level } : {}), ...(q.search ? { message: { contains: q.search, mode: 'insensitive' as const } } : {}) };
    const [items, total] = await Promise.all([this.db.systemLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...paginate(q.page, q.pageSize) }), this.db.systemLog.count({ where })]);
    return pageResult(items, total, q.page, q.pageSize);
  }

  @Get('audit')
  async auditLog(@Query(new ZodPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>) {
    const where = q.search ? { action: { contains: q.search } } : {};
    const [items, total] = await Promise.all([
      this.db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...paginate(q.page, q.pageSize), include: { user: { select: { email: true } }, workspace: { select: { name: true } } } }),
      this.db.auditLog.count({ where }),
    ]);
    return pageResult(items, total, q.page, q.pageSize);
  }

  @Get('flags')
  flags() {
    return this.db.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  @Post('flags')
  async upsertFlag(@CurrentUser() me: User, @Body(zbody(featureFlagSchema)) body: z.infer<typeof featureFlagSchema>) {
    const f = await this.db.featureFlag.upsert({ where: { key: body.key }, create: body, update: body });
    await audit(this.db, { action: 'admin.flag_updated', userId: me.id, resourceType: 'flag', resourceId: body.key, metadata: { enabled: body.enabled } });
    return f;
  }

  @Delete('flags/:key')
  async deleteFlag(@Param('key') key: string) {
    await this.db.featureFlag.delete({ where: { key } });
    return { ok: true };
  }

  @Get('integrations')
  async integrations() {
    const rows = await this.db.integration.findMany();
    return getRegistry().integrationDescriptions().map((i) => {
      const r = rows.find((x) => x.key === i.key);
      return { key: i.key, name: i.name, category: i.category, enabled: r?.enabled ?? true, nodes: i.triggers.length + i.actions.length };
    });
  }

  @Patch('integrations/:key')
  async toggleIntegration(@CurrentUser() me: User, @Param('key') key: string, @Body(zbody(z.object({ enabled: z.boolean() }))) body: { enabled: boolean }) {
    const i = getRegistry().integrationDescriptions().find((x) => x.key === key);
    if (!i) throw new NotFoundException('Integration not found');
    await this.db.integration.upsert({ where: { key }, create: { key, name: i.name, description: i.description, category: i.category, enabled: body.enabled }, update: { enabled: body.enabled } });
    await audit(this.db, { action: 'admin.integration_toggled', userId: me.id, resourceId: key, metadata: body });
    return { ok: true };
  }
}
