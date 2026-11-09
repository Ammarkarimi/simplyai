import { createHmac } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '@simplyai/db';
import { call, closeApp, getApp, MANUAL_WORKFLOW, signUp } from './helpers';

afterAll(closeApp);

describe('workflows', () => {
  it('saves drafts to normalized tables and publishes versions', async () => {
    const s = await signUp();
    const wf = await call(s, 'post', '/workflows').send({ name: 'Draft', definition: MANUAL_WORKFLOW }).expect(201);
    expect(await prisma.workflowNode.count({ where: { workflowId: wf.body.id } })).toBe(2);
    expect(await prisma.workflowConnection.count({ where: { workflowId: wf.body.id } })).toBe(1);
    const detail = await call(s, 'get', `/workflows/${wf.body.id}`).expect(200);
    expect(detail.body.definition.nodes.map((n: { id: string }) => n.id).sort()).toEqual(['s', 't']);
    const pub = await call(s, 'post', `/workflows/${wf.body.id}/publish`).send({ message: 'first' }).expect(200);
    expect(pub.body.version.version).toBe(1);
    const versions = await call(s, 'get', `/workflows/${wf.body.id}/versions`).expect(200);
    expect(versions.body).toHaveLength(1);
  });

  it('refuses to activate manual-only or invalid workflows', async () => {
    const s = await signUp();
    const wf = await call(s, 'post', '/workflows').send({ name: 'Manual', definition: MANUAL_WORKFLOW }).expect(201);
    const r = await call(s, 'post', `/workflows/${wf.body.id}/activate`).expect(400);
    expect(r.body.message).toMatch(/schedule, webhook/i);
    const bad = await call(s, 'post', '/workflows').send({ name: 'Bad', definition: { nodes: [{ id: 'w', name: 'Hook', type: 'simplyai.webhookTrigger', position: { x: 0, y: 0 }, parameters: {} }, { id: 'h', name: 'HTTP', type: 'simplyai.httpRequest', position: { x: 1, y: 0 }, parameters: { url: '' } }], connections: [{ source: 'w', target: 'h', sourceOutput: 0, targetInput: 0 }] } }).expect(201);
    const v = await call(s, 'post', `/workflows/${bad.body.id}/validate`).send({}).expect(200);
    expect(v.body.errors.join(' ')).toMatch(/URL is required/);
    await call(s, 'post', `/workflows/${bad.body.id}/activate`).expect(400);
  });

  it('queues manual executions and enforces plan quotas', async () => {
    const s = await signUp();
    const wf = await call(s, 'post', '/workflows').send({ name: 'Run', definition: MANUAL_WORKFLOW }).expect(201);
    const run = await call(s, 'post', `/workflows/${wf.body.id}/run`).send({ inputData: { a: 1 } }).expect(201);
    const ex = await prisma.execution.findUniqueOrThrow({ where: { id: run.body.executionId } });
    expect(ex.status).toBe('QUEUED');
    expect(ex.inputData).toEqual([{ json: { a: 1 } }]);
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: s.workspaceId } });
    await prisma.plan.update({ where: { key: 'free' }, data: { maxWorkflows: 2 } });
    try {
      await call(s, 'post', '/workflows').send({ name: 'two' }).expect(201);
      const q = await call(s, 'post', '/workflows').send({ name: 'three' }).expect(402);
      expect(q.body.code).toBe('QUOTA_EXCEEDED');
    } finally {
      await prisma.plan.update({ where: { key: 'free' }, data: { maxWorkflows: 5 } });
    }
    expect(ws.organizationId).toBeTruthy();
  });
});

describe('webhook ingress', () => {
  it('verifies HMAC signatures, records requests and starts executions', async () => {
    const s = await signUp();
    const def = {
      nodes: [{ id: 'hook', name: 'Hook', type: 'simplyai.webhookTrigger', position: { x: 0, y: 0 }, parameters: { path: `test-${Date.now()}`, methods: ['POST'] } }],
      connections: [],
    };
    const wf = await call(s, 'post', '/workflows').send({ name: 'Hook', definition: def }).expect(201);
    const hooks = await call(s, 'get', '/webhooks').expect(200);
    const hook = hooks.body.find((h: { workflow: { id: string } }) => h.workflow.id === wf.body.id);
    expect(hook.active).toBe(false);
    await call(s, 'patch', `/webhooks/${hook.id}`).send({ authType: 'HMAC', auth: { secret: 'shh-secret-123' } }).expect(200);
    const server = (await getApp()).getHttpServer();
    const body = JSON.stringify({ hello: 'world' });
    await request(server).post(`/webhook/${hook.path}`).set('content-type', 'application/json').send(body).expect(404);
    await request(server).post(`/webhook-test/${hook.path}`).set('content-type', 'application/json').send(body).expect(401);
    const sig = `sha256=${createHmac('sha256', 'shh-secret-123').update(body).digest('hex')}`;
    const ok = await request(server).post(`/webhook-test/${hook.path}`).set('content-type', 'application/json').set('x-simplyai-signature', sig).send(body).expect(200);
    expect(ok.body.executionId).toBeTruthy();
    const ex = await prisma.execution.findUniqueOrThrow({ where: { id: ok.body.executionId } });
    expect((ex.inputData as Array<{ json: { body: unknown } }>)[0]!.json.body).toEqual({ hello: 'world' });
    const history = await call(s, 'get', `/webhooks/${hook.id}/requests`).expect(200);
    expect(history.body.items.map((r: { statusCode: number }) => r.statusCode).sort()).toEqual([200, 401]);
    await request(server).get(`/webhook-test/${hook.path}`).expect(405);
  });
});

describe('data tables, variables and secrets', () => {
  it('stores typed rows and never returns secret values', async () => {
    const s = await signUp();
    const t = await call(s, 'post', '/data-tables').send({ name: 'Leads', columns: [{ name: 'email', type: 'TEXT' }, { name: 'score', type: 'NUMBER' }] }).expect(201);
    await call(s, 'post', `/data-tables/${t.body.id}/rows`).send({ data: { email: 'a@b.co', score: '42' } }).expect(201);
    await call(s, 'post', `/data-tables/${t.body.id}/rows`).send({ data: { score: 'abc' } }).expect(400);
    const rows = await call(s, 'get', `/data-tables/${t.body.id}/rows`).query({ search: 'a@b' }).expect(200);
    expect(rows.body.items[0].data).toEqual({ email: 'a@b.co', score: 42 });
    await call(s, 'post', '/variables').send({ scope: 'WORKSPACE', key: 'REGION', value: 'eu' }).expect(201);
    await call(s, 'post', '/variables').send({ scope: 'WORKSPACE', key: 'REGION', value: 'us' }).expect(400);
    await call(s, 'post', '/secrets').send({ key: 'TOKEN', value: 'very-secret-value' }).expect(201);
    const list = await call(s, 'get', '/secrets').expect(200);
    expect(JSON.stringify(list.body)).not.toContain('very-secret-value');
  });
});
