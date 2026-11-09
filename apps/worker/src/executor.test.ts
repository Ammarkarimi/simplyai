import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encrypt, prisma, type Prisma } from '@simplyai/db';
import { createExecution, encryptCredentialData } from '@simplyai/core';
import type { WorkflowDefinition } from '@simplyai/shared';
import { processExecutionJob } from './executor';
import { queues, redis } from './context';

let workspaceId = '';
let server: http.Server;
let baseUrl = '';
const received: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];

const node = (id: string, type: string, parameters: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({ id, name: id, type, position: { x: 0, y: 0 }, parameters, ...extra });
const edge = (source: string, target: string, sourceOutput = 0, targetInput = 0) => ({ source, target, sourceOutput, targetInput });

async function workflow(name: string, def: WorkflowDefinition) {
  const wf = await prisma.workflow.create({ data: { workspaceId, name } });
  return { wf, def };
}

async function run(name: string, def: WorkflowDefinition, items?: Array<{ json: Record<string, unknown> }>) {
  const { wf } = await workflow(name, def);
  const ex = await createExecution(prisma, null, { workspaceId, workflowId: wf.id, mode: 'MANUAL', definition: def, triggerNodeId: def.nodes[0]!.id, items, inline: true });
  await prisma.execution.update({ where: { id: ex.id }, data: { status: 'QUEUED', startedAt: null } });
  const result = await processExecutionJob({ executionId: ex.id });
  const stored = await prisma.execution.findUniqueOrThrow({ where: { id: ex.id }, include: { nodeExecutions: true } });
  return { result, stored, workflowId: wf.id };
}

beforeAll(async () => {
  const owner = await prisma.role.findFirstOrThrow({ where: { workspaceId: null, key: 'owner' } });
  const user = await prisma.user.create({ data: { email: `worker.${Date.now()}@test.dev`, name: 'Worker Test' } });
  const org = await prisma.organization.create({ data: { name: 'Worker Org', slug: `worker-${Date.now()}`, members: { create: { userId: user.id, role: 'OWNER' } } } });
  const plan = await prisma.plan.findUniqueOrThrow({ where: { key: 'business' } });
  await prisma.subscription.create({ data: { organizationId: org.id, planId: plan.id, currentPeriodEnd: new Date(Date.now() + 86_400_000) } });
  const ws = await prisma.workspace.create({ data: { organizationId: org.id, name: 'W', slug: 'w', members: { create: { userId: user.id, roleId: owner.id } } } });
  workspaceId = ws.id;
  await prisma.variable.create({ data: { scope: 'WORKSPACE', workspaceId, key: 'GREETING', value: 'Hello' } });
  await prisma.secret.create({ data: { workspaceId, key: 'API_TOKEN', encryptedValue: encrypt('tok_supersecret_value', `secret:${workspaceId}`) } });
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, echo: body ? JSON.parse(body) : null, auth: req.headers.authorization ?? null }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  server.close();
  await queues.close();
  redis.disconnect();
});

describe('worker execution pipeline', () => {
  it('runs code in the sandbox, persists node executions and usage', async () => {
    const def: WorkflowDefinition = {
      nodes: [
        node('start', 'simplyai.manualTrigger'),
        node('code', 'simplyai.code', { mode: 'each', code: 'return { n: $json.n, square: $json.n * $json.n }' }),
        node('greet', 'simplyai.set', { assignments: [{ name: 'msg', type: 'string', value: '{{ $vars.GREETING }} #{{ $json.n }}' }] }),
      ],
      connections: [edge('start', 'code'), edge('code', 'greet')],
    };
    const { result, stored } = await run('sandbox', def, [{ json: { n: 3 } }, { json: { n: 4 } }]);
    expect(result.status).toBe('SUCCESS');
    expect(stored.status).toBe('SUCCESS');
    expect(stored.nodeExecutions).toHaveLength(3);
    expect(stored.outputData).toEqual([{ json: { n: 3, square: 9, msg: 'Hello #3' }, pairedItem: 0 }, { json: { n: 4, square: 16, msg: 'Hello #4' }, pairedItem: 1 }]);
    const tasks = await prisma.usageRecord.findFirst({ where: { workspaceId, metric: 'TASKS' } });
    expect(Number(tasks?.quantity)).toBeGreaterThanOrEqual(2);
  });

  it('authenticates HTTP requests with credentials and redacts secrets from logs', async () => {
    const cred = await prisma.credential.create({ data: { workspaceId, name: 'Bearer', type: 'httpBearerAuth', encryptedData: encryptCredentialData(workspaceId, { token: 'cred_token_abcdef' }) } });
    const def: WorkflowDefinition = {
      nodes: [
        node('start', 'simplyai.manualTrigger'),
        node('call', 'simplyai.httpRequest', { method: 'POST', url: `${baseUrl}/hook`, bodyType: 'json', jsonBody: '{"secret": "{{ $secrets.API_TOKEN }}"}' }, { credentialId: cred.id }),
      ],
      connections: [edge('start', 'call')],
    };
    const { stored } = await run('http', def);
    expect(stored.status).toBe('SUCCESS');
    expect(received.at(-1)!.headers.authorization).toBe('Bearer cred_token_abcdef');
    expect(JSON.parse(received.at(-1)!.body)).toEqual({ secret: 'tok_supersecret_value' });
    const persisted = JSON.stringify(stored.nodeExecutions.map((n) => n.outputData)) + JSON.stringify(stored.outputData);
    expect(persisted).not.toContain('tok_supersecret_value');
    expect(persisted).not.toContain('cred_token_abcdef');
    expect(persisted).toContain('[REDACTED]');
  });

  it('writes to data tables and runs sub-workflows', async () => {
    const table = await prisma.dataTable.create({ data: { workspaceId, name: `t${Date.now()}`, columns: { create: [{ name: 'email', type: 'TEXT' }, { name: 'score', type: 'NUMBER' }] } } });
    const childDef: WorkflowDefinition = {
      nodes: [node('in', 'simplyai.manualTrigger'), node('double', 'simplyai.set', { assignments: [{ name: 'score', type: 'number', value: '{{ $json.score * 2 }}' }] })],
      connections: [edge('in', 'double')],
    };
    const child = await prisma.workflow.create({ data: { workspaceId, name: 'child' } });
    await prisma.workflowVersion.create({ data: { workflowId: child.id, version: 1, definition: childDef as unknown as Prisma.InputJsonValue } }).then((v) => prisma.workflow.update({ where: { id: child.id }, data: { activeVersionId: v.id } }));
    const def: WorkflowDefinition = {
      nodes: [
        node('start', 'simplyai.manualTrigger'),
        node('sub', 'simplyai.executeWorkflow', { workflowId: child.id, mode: 'all', waitForCompletion: true }),
        node('save', 'simplyai.dataTable', { operation: 'upsert', tableId: table.id, matchColumn: 'email', data: '{{ JSON.stringify($json) }}' }),
      ],
      connections: [edge('start', 'sub'), edge('sub', 'save')],
    };
    const { stored } = await run('subflow', def, [{ json: { email: 'a@b.co', score: 21 } }]);
    expect(stored.status).toBe('SUCCESS');
    const rows = await prisma.dataTableRow.findMany({ where: { tableId: table.id } });
    expect(rows.map((r) => r.data)).toEqual([{ email: 'a@b.co', score: 42 }]);
    expect(await prisma.execution.count({ where: { parentExecutionId: stored.id } })).toBe(1);
  });

  it('marks failures with node details and persists waiting state', async () => {
    const failing: WorkflowDefinition = { nodes: [node('start', 'simplyai.manualTrigger'), node('bad', 'simplyai.code', { code: 'throw new Error("kaboom")' })], connections: [edge('start', 'bad')] };
    const f = await run('fail', failing);
    expect(f.stored.status).toBe('FAILED');
    expect((f.stored.error as { message: string; nodeName: string }).message).toContain('kaboom');
    expect((f.stored.error as { nodeName: string }).nodeName).toBe('bad');

    const waiting: WorkflowDefinition = { nodes: [node('start', 'simplyai.manualTrigger'), node('ok', 'simplyai.approval', { message: 'Approve?' })], connections: [edge('start', 'ok')] };
    const w = await run('wait', waiting);
    expect(w.stored.status).toBe('WAITING');
    expect((w.stored.state as { waiting: { kind: string } }).waiting.kind).toBe('approval');
    await prisma.execution.update({ where: { id: w.stored.id }, data: { status: 'QUEUED' } });
    const resumed = await processExecutionJob({ executionId: w.stored.id, resume: { approved: true } });
    expect(resumed.status).toBe('SUCCESS');
  });
});
