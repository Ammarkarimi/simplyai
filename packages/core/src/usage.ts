import type { Plan, PrismaClient, UsageMetric } from '@simplyai/db';
import { monthStart, UNLIMITED, DEFAULT_PLANS } from '@simplyai/shared';

export class QuotaExceededError extends Error {
  override name = 'QuotaExceededError';
  constructor(message: string, public readonly limit: string) {
    super(message);
  }
}

/** Returns the plan of an organization (falls back to the Free plan). */
export async function getOrganizationPlan(db: PrismaClient, organizationId: string): Promise<Plan> {
  const sub = await db.subscription.findUnique({ where: { organizationId }, include: { plan: true } });
  if (sub && sub.status !== 'CANCELED') return sub.plan;
  const free = await db.plan.findUnique({ where: { key: 'free' } });
  if (free) return free;
  const d = DEFAULT_PLANS[0]!;
  return { id: 'free', stripePriceId: null, isPublic: true, updatedAt: new Date(), ...d } as Plan;
}

export async function getMonthlyUsage(db: PrismaClient, organizationId: string, metric: UsageMetric, workspaceId?: string): Promise<number> {
  const agg = await db.usageRecord.aggregate({
    where: { organizationId, metric, period: monthStart(), ...(workspaceId ? { workspaceId } : {}) },
    _sum: { quantity: true },
  });
  return Number(agg._sum.quantity ?? 0);
}

export async function incrementUsage(db: PrismaClient, organizationId: string, workspaceId: string, metric: UsageMetric, quantity: number): Promise<void> {
  if (quantity <= 0) return;
  const period = monthStart();
  await db.usageRecord.upsert({
    where: { organizationId_workspaceId_metric_period: { organizationId, workspaceId, metric, period } },
    create: { organizationId, workspaceId, metric, period, quantity: BigInt(Math.round(quantity)) },
    update: { quantity: { increment: BigInt(Math.round(quantity)) } },
  });
}

const METRIC_LIMIT: Record<UsageMetric, keyof Plan> = { EXECUTIONS: 'monthlyExecutions', TASKS: 'monthlyTasks', AI_TOKENS: 'monthlyAiTokens' };
const METRIC_LABEL: Record<UsageMetric, string> = { EXECUTIONS: 'monthly executions', TASKS: 'monthly tasks', AI_TOKENS: 'monthly AI tokens' };

export async function assertUsageQuota(db: PrismaClient, organizationId: string, metric: UsageMetric, adding = 1): Promise<void> {
  const plan = await getOrganizationPlan(db, organizationId);
  const limit = plan[METRIC_LIMIT[metric]] as number;
  if (limit === UNLIMITED) return;
  const used = await getMonthlyUsage(db, organizationId, metric);
  if (used + adding > limit) throw new QuotaExceededError(`Your ${plan.name} plan allows ${limit.toLocaleString()} ${METRIC_LABEL[metric]}. Upgrade to continue.`, METRIC_LIMIT[metric]);
}

/** Count-based limits (workflows, credentials, members…). */
export async function assertCountLimit(db: PrismaClient, organizationId: string, limit: 'maxWorkflows' | 'maxActiveWorkflows' | 'maxCredentials' | 'maxMembers' | 'maxWorkspaces', current: number): Promise<void> {
  const plan = await getOrganizationPlan(db, organizationId);
  const max = plan[limit] as number;
  if (max !== UNLIMITED && current + 1 > max) {
    const labels = { maxWorkflows: 'workflows', maxActiveWorkflows: 'active workflows', maxCredentials: 'credentials', maxMembers: 'team members', maxWorkspaces: 'workspaces' };
    throw new QuotaExceededError(`Your ${plan.name} plan allows up to ${max} ${labels[limit]}. Upgrade to add more.`, limit);
  }
}
