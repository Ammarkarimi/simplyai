import type { Prisma } from '@simplyai/db';
import { createExecution, dispatchEvent, getRegistry, resolveCredential, applyCredential, systemLog, type TriggerJob } from '@simplyai/core';
import { httpRequest, type PollContext } from '@simplyai/sdk';
import type { WorkflowDefinition } from '@simplyai/shared';
import { db, log, queues } from './context';

async function activeWorkflow(workflowId: string) {
  const wf = await db.workflow.findUnique({ where: { id: workflowId }, include: { activeVersion: true } });
  if (!wf || !wf.active || !wf.activeVersion) return null;
  return { wf, definition: wf.activeVersion.definition as unknown as WorkflowDefinition };
}

async function fireSchedule(job: Extract<TriggerJob, { kind: 'schedule' }>) {
  const a = await activeWorkflow(job.workflowId);
  if (!a) return { skipped: 'inactive' };
  const node = a.definition.nodes.find((n) => n.id === job.nodeKey);
  if (!node || node.disabled) return { skipped: 'node missing' };
  const now = new Date();
  await createExecution(db, queues, {
    workspaceId: a.wf.workspaceId, workflowId: a.wf.id, mode: 'SCHEDULE', definition: a.definition, workflowVersionId: a.wf.activeVersionId, triggerNodeId: node.id,
    items: [{ json: { timestamp: now.toISOString(), timezone: String(node.parameters.timezone ?? 'UTC'), workflow: a.wf.name } }],
  });
  await db.triggerRegistration.updateMany({ where: { workflowId: a.wf.id, nodeKey: node.id }, data: { lastFiredAt: now } });
  return { started: 1 };
}

async function poll(job: Extract<TriggerJob, { kind: 'poll' }>) {
  const a = await activeWorkflow(job.workflowId);
  if (!a) return { skipped: 'inactive' };
  const node = a.definition.nodes.find((n) => n.id === job.nodeKey);
  const def = node && getRegistry().getNode(node.type);
  if (!node || !def?.poll) return { skipped: 'node missing' };
  const lockKey = `sai:poll-lock:${a.wf.id}:${node.id}`;
  const { redis } = await import('./context');
  if (!(await redis.set(lockKey, '1', 'EX', 300, 'NX'))) return { skipped: 'already polling' };
  try {
    const staticData = (a.wf.staticData ?? {}) as Record<string, Record<string, unknown>>;
    const state = { ...(staticData[node.id] ?? {}) };
    const isFirstPoll = Object.keys(state).length === 0;
    const getCredential = async <T,>() => {
      if (!node.credentialId) throw new Error(`"${node.name}" needs a credential`);
      return (await resolveCredential(db, a.wf.workspaceId, node.credentialId, def.credentials?.types ?? [])) as never as import('@simplyai/sdk').ResolvedCredential<T>;
    };
    const ctx: PollContext = {
      node, workflow: { id: a.wf.id, name: a.wf.name, workspaceId: a.wf.workspaceId },
      getParam: <T,>(name: string, fallback?: T) => (node.parameters[name] ?? def.properties.find((p) => p.name === name)?.default ?? fallback) as T,
      getCredential,
      http: (o) => httpRequest(o),
      httpWithAuth: async (o) => httpRequest(applyCredential(await getCredential(), o)),
      state, isFirstPoll, signal: AbortSignal.timeout(240_000),
      logger: { debug() {}, info: (m) => log.info(m), warn: (m) => log.warn(m), error: (m) => log.error(m) },
    };
    const items = await def.poll(ctx);
    await db.workflow.update({ where: { id: a.wf.id }, data: { staticData: { ...staticData, [node.id]: state } as Prisma.InputJsonValue } });
    if (!items?.length) return { started: 0 };
    await createExecution(db, queues, { workspaceId: a.wf.workspaceId, workflowId: a.wf.id, mode: 'POLL', definition: a.definition, workflowVersionId: a.wf.activeVersionId, triggerNodeId: node.id, items });
    await db.triggerRegistration.updateMany({ where: { workflowId: a.wf.id, nodeKey: node.id }, data: { lastFiredAt: new Date() } });
    return { started: 1, items: items.length };
  } catch (err) {
    await systemLog(db, 'warn', 'poll-trigger', `Polling "${node.name}" in "${a.wf.name}" failed: ${(err as Error).message}`, { workflowId: a.wf.id });
    throw err;
  } finally {
    await redis.del(lockKey);
  }
}

/** Resume executions whose wait time passed (safety net for lost delayed jobs) and apply retention. */
async function maintenance() {
  const due = await db.execution.findMany({ where: { status: 'WAITING', waitUntil: { lte: new Date(Date.now() - 60_000) } }, select: { id: true }, take: 200 });
  for (const e of due) await queues.executions.add('resume', { executionId: e.id, resume: {} }, { jobId: `resume-${e.id}-sweep-${Math.floor(Date.now() / 60_000)}` });
  const orgs = await db.organization.findMany({ include: { subscription: { include: { plan: true } }, workspaces: { select: { id: true } } } });
  let removed = 0;
  for (const o of orgs) {
    const days = o.subscription?.plan.executionRetentionDays ?? 7;
    const r = await db.execution.deleteMany({ where: { workspaceId: { in: o.workspaces.map((w) => w.id) }, status: { in: ['SUCCESS', 'FAILED', 'CANCELLED'] }, queuedAt: { lt: new Date(Date.now() - days * 86_400_000) } } });
    removed += r.count;
  }
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.verificationToken.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } });
  await db.systemLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } });
  if (removed) log.info('retention cleanup', { removed });
  return { resumed: due.length, removed };
}

export async function processTriggerJob(job: TriggerJob) {
  switch (job.kind) {
    case 'schedule': return fireSchedule(job);
    case 'poll': return poll(job);
    case 'event': return { started: await dispatchEvent(db, queues, job.workspaceId, job.event, job.payload) };
    case 'maintenance': return maintenance();
  }
}
