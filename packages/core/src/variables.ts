import { decrypt, type PrismaClient } from '@simplyai/db';

/** Resolve variables for a workflow: global < workspace < environment < workflow. */
export async function resolveVariables(db: PrismaClient, workspaceId: string, workflowId?: string): Promise<Record<string, string>> {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { organizationId: true, activeEnvironment: true } });
  const vars = await db.variable.findMany({
    where: {
      OR: [
        { scope: 'GLOBAL', organizationId: ws.organizationId },
        { scope: 'WORKSPACE', workspaceId },
        { scope: 'ENVIRONMENT', workspaceId, environment: ws.activeEnvironment },
        ...(workflowId ? [{ scope: 'WORKFLOW' as const, workflowId }] : []),
      ],
    },
  });
  const rank = { GLOBAL: 0, WORKSPACE: 1, ENVIRONMENT: 2, WORKFLOW: 3 } as const;
  const out: Record<string, string> = {};
  for (const v of vars.sort((a, b) => rank[a.scope] - rank[b.scope])) out[v.key] = v.value;
  return out;
}

export async function resolveSecrets(db: PrismaClient, workspaceId: string): Promise<Record<string, string>> {
  const secrets = await db.secret.findMany({ where: { workspaceId } });
  const out: Record<string, string> = {};
  for (const s of secrets) out[s.key] = decrypt(s.encryptedValue, `secret:${workspaceId}`);
  return out;
}
