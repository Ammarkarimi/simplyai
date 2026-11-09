import type { Execution, ExecutionMode, Prisma, PrismaClient } from '@simplyai/db';
import type { Item, WorkflowDefinition } from '@simplyai/shared';
import type { Queues } from './queues';
import { assertUsageQuota, incrementUsage } from './usage';

export interface CreateExecutionParams {
  workspaceId: string;
  workflowId: string;
  mode: ExecutionMode;
  definition: WorkflowDefinition;
  workflowVersionId?: string | null;
  triggerNodeId?: string | null;
  destinationNodeId?: string | null;
  items?: Item[];
  createdById?: string | null;
  retryOfId?: string | null;
  parentExecutionId?: string | null;
  /** do not enqueue (sub-workflows run inline in the worker) */
  inline?: boolean;
}

export async function createExecution(db: PrismaClient, queues: Queues | null, p: CreateExecutionParams): Promise<Execution> {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: p.workspaceId }, select: { organizationId: true } });
  await assertUsageQuota(db, ws.organizationId, 'EXECUTIONS');
  const execution = await db.execution.create({
    data: {
      workspaceId: p.workspaceId,
      workflowId: p.workflowId,
      workflowVersionId: p.workflowVersionId ?? null,
      mode: p.mode,
      status: p.inline ? 'RUNNING' : 'QUEUED',
      triggerNodeKey: p.triggerNodeId ?? null,
      destinationNodeKey: p.destinationNodeId ?? null,
      workflowSnapshot: p.definition as unknown as Prisma.InputJsonValue,
      inputData: (p.items ?? null) as unknown as Prisma.InputJsonValue,
      createdById: p.createdById ?? null,
      retryOfId: p.retryOfId ?? null,
      parentExecutionId: p.parentExecutionId ?? null,
      startedAt: p.inline ? new Date() : null,
    },
  });
  await incrementUsage(db, ws.organizationId, p.workspaceId, 'EXECUTIONS', 1);
  if (!p.inline && queues) await queues.executions.add('run', { executionId: execution.id }, { jobId: execution.id });
  return execution;
}

/** Find the trigger node a run should start from. */
export function pickTrigger(def: WorkflowDefinition, isTrigger: (type: string) => string | undefined, preferred?: string | null, kinds?: string[]): string | undefined {
  if (preferred && def.nodes.some((n) => n.id === preferred)) return preferred;
  const triggers = def.nodes.filter((n) => !n.disabled && isTrigger(n.type) && isTrigger(n.type) !== 'error');
  if (kinds) return triggers.find((n) => kinds.includes(isTrigger(n.type)!))?.id;
  return (triggers.find((n) => isTrigger(n.type) === 'manual') ?? triggers[0])?.id;
}
