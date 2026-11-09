import { createExecution, getRegistry, loadDraftDefinition, pickTrigger } from '@simplyai/core';
import { NodeOperationError, type RuntimeServices } from '@simplyai/sdk';
import type { WorkflowDefinition } from '@simplyai/shared';
import { db } from './context';
import { runExecution } from './executor';

/** Sub-workflow runner for agents in the playground (no parent execution). */
export function runExecutionSubWorkflow(workspaceId: string): RuntimeServices['runSubWorkflow'] {
  return async (workflowId, items, opts) => {
    const wf = await db.workflow.findFirst({ where: { id: workflowId, workspaceId }, include: { activeVersion: true } });
    if (!wf) throw new NodeOperationError('Workflow not found in this workspace');
    const definition = (wf.activeVersion?.definition as unknown as WorkflowDefinition | undefined) ?? (await loadDraftDefinition(db, wf.id));
    const trigger = pickTrigger(definition, (t) => getRegistry().getNode(t)?.trigger);
    if (!trigger) throw new NodeOperationError(`Workflow "${wf.name}" has no trigger`);
    const ex = await createExecution(db, null, { workspaceId, workflowId: wf.id, mode: 'SUBWORKFLOW', definition, workflowVersionId: wf.activeVersionId, triggerNodeId: trigger, items, inline: true });
    const r = await runExecution(ex, undefined, 1, opts.signal);
    if (r.status !== 'SUCCESS') throw new NodeOperationError(`Workflow "${wf.name}" ${r.status.toLowerCase()}: ${r.error?.message ?? ''}`);
    return r.output;
  };
}
