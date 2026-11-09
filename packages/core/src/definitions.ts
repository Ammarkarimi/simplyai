import type { Prisma, PrismaClient } from '@simplyai/db';
import type { WorkflowDefinition, WorkflowMeta, WorkflowSettings, NodeSettings } from '@simplyai/shared';

type Tx = Prisma.TransactionClient | PrismaClient;

/** Build a definition from the normalized draft tables. */
export async function loadDraftDefinition(db: Tx, workflowId: string): Promise<WorkflowDefinition> {
  const wf = await db.workflow.findUniqueOrThrow({
    where: { id: workflowId },
    include: { nodes: { orderBy: { createdAt: 'asc' } }, connections: true },
  });
  return {
    nodes: wf.nodes.map((n) => ({
      id: n.nodeKey,
      name: n.name,
      type: n.type,
      typeVersion: n.typeVersion,
      position: { x: n.positionX, y: n.positionY },
      parameters: (n.parameters ?? {}) as Record<string, unknown>,
      credentialId: n.credentialId,
      disabled: n.disabled,
      notes: n.notes,
      settings: (n.settings ?? {}) as NodeSettings,
    })),
    connections: wf.connections.map((c) => ({ id: c.id, source: c.sourceKey, sourceOutput: c.sourceOutput, target: c.targetKey, targetInput: c.targetInput })),
    settings: (wf.settings ?? {}) as WorkflowSettings,
    meta: (wf.meta ?? {}) as WorkflowMeta,
  };
}

/** Replace the draft graph of a workflow. Credential ids must belong to the workspace. */
export async function saveDraftDefinition(db: Prisma.TransactionClient, workflowId: string, workspaceId: string, def: WorkflowDefinition): Promise<void> {
  const credIds = [...new Set(def.nodes.map((n) => n.credentialId).filter((c): c is string => !!c))];
  const valid = credIds.length
    ? new Set((await db.credential.findMany({ where: { id: { in: credIds }, workspaceId }, select: { id: true } })).map((c) => c.id))
    : new Set<string>();
  const nodeIds = new Set(def.nodes.map((n) => n.id));
  await db.workflowConnection.deleteMany({ where: { workflowId } });
  await db.workflowNode.deleteMany({ where: { workflowId } });
  if (def.nodes.length) {
    await db.workflowNode.createMany({
      data: def.nodes.map((n) => ({
        workflowId,
        nodeKey: n.id,
        name: n.name,
        type: n.type,
        typeVersion: n.typeVersion ?? 1,
        positionX: n.position.x,
        positionY: n.position.y,
        parameters: (n.parameters ?? {}) as Prisma.InputJsonValue,
        credentialId: n.credentialId && valid.has(n.credentialId) ? n.credentialId : null,
        disabled: !!n.disabled,
        notes: n.notes ?? null,
        settings: (n.settings ?? {}) as Prisma.InputJsonValue,
      })),
    });
  }
  const seen = new Set<string>();
  const conns = def.connections.filter((c) => {
    const k = `${c.source}:${c.sourceOutput}:${c.target}:${c.targetInput}`;
    if (seen.has(k) || !nodeIds.has(c.source) || !nodeIds.has(c.target)) return false;
    seen.add(k);
    return true;
  });
  if (conns.length) {
    await db.workflowConnection.createMany({
      data: conns.map((c) => ({ workflowId, sourceKey: c.source, sourceOutput: c.sourceOutput ?? 0, targetKey: c.target, targetInput: c.targetInput ?? 0 })),
    });
  }
  await db.workflow.update({
    where: { id: workflowId },
    data: { settings: (def.settings ?? {}) as Prisma.InputJsonValue, meta: (def.meta ?? {}) as Prisma.InputJsonValue },
  });
}
