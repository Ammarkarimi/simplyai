import { randomBytes } from 'node:crypto';
import parser from 'cron-parser';
import type { Prisma, PrismaClient, WebhookKind } from '@simplyai/db';
import type { WorkflowDefinition } from '@simplyai/shared';
import type { Queues } from './queues';
import { getRegistry } from './registry';

const KIND_BY_TRIGGER: Record<string, WebhookKind> = { webhook: 'WEBHOOK', form: 'FORM', chat: 'CHAT' };

export class TriggerConfigError extends Error {
  override name = 'TriggerConfigError';
}

function sanitizePath(p: unknown): string {
  return String(p ?? '').trim().replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9/_-]/g, '-').slice(0, 120);
}

/** Create / update Webhook rows for webhook, form and chat trigger nodes. */
export async function syncWebhooks(db: PrismaClient | Prisma.TransactionClient, wf: { id: string; workspaceId: string }, def: WorkflowDefinition, active: boolean): Promise<void> {
  const registry = getRegistry();
  const nodes = def.nodes.filter((n) => KIND_BY_TRIGGER[registry.getNode(n.type)?.trigger ?? '']);
  const existing = await db.webhook.findMany({ where: { workflowId: wf.id } });
  const keep = new Set(nodes.map((n) => n.id));
  const stale = existing.filter((w) => !keep.has(w.nodeKey));
  if (stale.length) await db.webhook.deleteMany({ where: { id: { in: stale.map((w) => w.id) } } });
  for (const n of nodes) {
    const kind = KIND_BY_TRIGGER[registry.getNode(n.type)!.trigger!]!;
    const row = existing.find((w) => w.nodeKey === n.id);
    const custom = sanitizePath(n.parameters.path);
    const path = custom || row?.path || randomBytes(9).toString('base64url');
    if (custom) {
      const clash = await db.webhook.findFirst({ where: { path, NOT: { workflowId: wf.id, nodeKey: n.id } } });
      if (clash) throw new TriggerConfigError(`The path "${path}" is already used by another webhook`);
    }
    const methods = kind === 'WEBHOOK' ? (Array.isArray(n.parameters.methods) && n.parameters.methods.length ? (n.parameters.methods as string[]) : ['POST']) : kind === 'FORM' ? ['GET', 'POST'] : ['POST'];
    const responseMode = kind === 'CHAT' ? 'LAST_NODE' : kind === 'FORM' ? 'IMMEDIATE' : n.parameters.responseMode === 'LAST_NODE' ? 'LAST_NODE' : 'IMMEDIATE';
    const data = {
      path, kind, methods, responseMode: responseMode as 'LAST_NODE' | 'IMMEDIATE',
      responseCode: Number(n.parameters.responseCode ?? 200) || 200,
      active: active && !n.disabled,
    };
    if (row) await db.webhook.update({ where: { id: row.id }, data });
    else await db.webhook.create({ data: { ...data, workspaceId: wf.workspaceId, workflowId: wf.id, nodeKey: n.id } });
  }
}

export function scheduleOptions(params: Record<string, unknown>): { pattern?: string; every?: number; tz?: string } {
  if (params.mode === 'cron') {
    const pattern = String(params.cron ?? '').trim();
    const tz = String(params.timezone || 'UTC');
    try {
      parser.parseExpression(pattern, { tz });
    } catch (err) {
      throw new TriggerConfigError(`Invalid cron expression "${pattern}": ${(err as Error).message}`);
    }
    return { pattern, tz };
  }
  const value = Math.max(1, Number(params.intervalValue ?? 15));
  const unit = String(params.intervalUnit ?? 'minutes');
  const ms = value * (unit === 'days' ? 86_400_000 : unit === 'hours' ? 3_600_000 : 60_000);
  return { every: ms };
}

export const schedulerId = (kind: 'schedule' | 'poll', workflowId: string, nodeKey: string) => `${kind}:${workflowId}:${nodeKey}`;

/** Register all triggers of an activated workflow version. */
export async function activateTriggers(db: PrismaClient, queues: Queues, wf: { id: string; workspaceId: string }, def: WorkflowDefinition): Promise<void> {
  await deactivateTriggers(db, queues, wf.id);
  const registry = getRegistry();
  await syncWebhooks(db, wf, def, true);
  for (const n of def.nodes) {
    if (n.disabled) continue;
    const trigger = registry.getNode(n.type)?.trigger;
    if (!trigger) continue;
    if (trigger === 'schedule') {
      const opts = scheduleOptions(n.parameters);
      const id = schedulerId('schedule', wf.id, n.id);
      await queues.triggers.upsertJobScheduler(id, opts, { name: 'schedule', data: { kind: 'schedule', workflowId: wf.id, nodeKey: n.id } });
      await db.triggerRegistration.create({ data: { workspaceId: wf.workspaceId, workflowId: wf.id, nodeKey: n.id, kind: 'SCHEDULE', config: opts as Prisma.InputJsonValue, jobKey: id } });
    } else if (trigger === 'poll') {
      const minutes = Math.max(1, Number(n.parameters.pollMinutes ?? 5));
      const id = schedulerId('poll', wf.id, n.id);
      await queues.triggers.upsertJobScheduler(id, { every: minutes * 60_000 }, { name: 'poll', data: { kind: 'poll', workflowId: wf.id, nodeKey: n.id } });
      await db.triggerRegistration.create({ data: { workspaceId: wf.workspaceId, workflowId: wf.id, nodeKey: n.id, kind: 'POLL', config: { everyMinutes: minutes }, jobKey: id } });
    } else if (trigger === 'event') {
      const eventName = String(n.parameters.eventName ?? '').trim();
      if (!eventName) throw new TriggerConfigError(`"${n.name}" needs an event name`);
      await db.triggerRegistration.create({ data: { workspaceId: wf.workspaceId, workflowId: wf.id, nodeKey: n.id, kind: 'EVENT', config: { eventName } } });
    } else if (KIND_BY_TRIGGER[trigger]) {
      await db.triggerRegistration.create({ data: { workspaceId: wf.workspaceId, workflowId: wf.id, nodeKey: n.id, kind: KIND_BY_TRIGGER[trigger] as 'WEBHOOK' } });
    }
  }
}

export async function deactivateTriggers(db: PrismaClient, queues: Queues, workflowId: string): Promise<void> {
  const regs = await db.triggerRegistration.findMany({ where: { workflowId } });
  for (const r of regs) if (r.jobKey) await queues.triggers.removeJobScheduler(r.jobKey).catch(() => undefined);
  await db.triggerRegistration.deleteMany({ where: { workflowId } });
  await db.webhook.updateMany({ where: { workflowId }, data: { active: false } });
}
