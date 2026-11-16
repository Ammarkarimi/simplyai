import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Worker } from 'bullmq';
import { prisma } from '@simplyai/db';
import { redisConnectionOptions } from '@simplyai/core';
import { QUEUES, buildAppTemplate, emptyAppDefinition, type AppDefinition, type AppQuery } from '@simplyai/shared';
import { call, closeApp, getApp, setPlan, signUp, uniqueEmail, type Session } from './helpers';

afterAll(closeApp);

async function inviteAndJoin(owner: Session, roleKey: string): Promise<Session> {
  const email = uniqueEmail(roleKey);
  const inv = await call(owner, 'post', '/team/invitations').send({ email, roleKey }).expect(201);
  const token = decodeURIComponent(String(inv.body.inviteUrl).split('/invite/')[1]);
  return signUp(email, 'Password123', { inviteToken: token });
}

function withQueries(queries: AppQuery[]): AppDefinition {
  const def = emptyAppDefinition();
  def.queries = queries;
  return def;
}

async function anon() {
  return request((await getApp()).getHttpServer());
}

describe('apps (UI builder)', () => {
  it('creates apps from templates, validates definitions and manages versions', async () => {
    const s = await signUp();
    const templates = await call(s, 'get', '/apps/templates').expect(200);
    expect(templates.body.map((t: { key: string }) => t.key)).toEqual(expect.arrayContaining(['blank', 'dashboard', 'crm', 'landing', 'assistant']));
    const app = await call(s, 'post', '/apps').send({ name: 'CRM', template: 'crm' }).expect(201);
    expect(app.body.slug).toMatch(/^crm-[a-f0-9]{6}$/);
    const detail = await call(s, 'get', `/apps/${app.body.id}`).expect(200);
    expect(detail.body.definition.pages).toHaveLength(2);

    // duplicate component names are rejected
    const bad = structuredClone(detail.body.definition) as AppDefinition;
    bad.pages[0]!.root.children!.push({ ...bad.pages[0]!.root.children![0]!, id: 'other' });
    const r = await call(s, 'patch', `/apps/${app.body.id}`).send({ definition: bad }).expect(400);
    expect(JSON.stringify(r.body)).toMatch(/Duplicate component name/);

    // publish snapshots the draft; later draft edits stay unpublished
    const pub = await call(s, 'post', `/apps/${app.body.id}/publish`).send({ message: 'v1' }).expect(200);
    expect(pub.body.publishedVersion.version).toBe(1);
    const edited = structuredClone(detail.body.definition) as AppDefinition;
    edited.pages[0]!.name = 'Changed';
    await call(s, 'patch', `/apps/${app.body.id}`).send({ definition: edited }).expect(200);
    const live = await call(s, 'get', `/public/apps/${app.body.slug}`).expect(200);
    expect(live.body.definition.pages[0].name).toBe('Customers');
    await call(s, 'post', `/apps/${app.body.id}/publish`).send({}).expect(200);
    const versions = await call(s, 'get', `/apps/${app.body.id}/versions`).expect(200);
    expect(versions.body.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    const restored = await call(s, 'post', `/apps/${app.body.id}/versions/${versions.body[1].id}/restore`).expect(200);
    expect(restored.body.definition.pages[0].name).toBe('Customers');

    // slugs are unique
    const other = await call(s, 'post', '/apps').send({ name: 'Other' }).expect(201);
    await call(s, 'patch', `/apps/${other.body.id}`).send({ slug: app.body.slug }).expect(409);
    const dup = await call(s, 'post', `/apps/${app.body.id}/duplicate`).expect(201);
    expect(dup.body.name).toBe('CRM (copy)');
    await call(s, 'delete', `/apps/${dup.body.id}`).expect(200);
    await call(s, 'get', `/apps/${dup.body.id}`).expect(404);
  });

  it('enforces roles, tenant isolation and private/public access', async () => {
    const owner = await signUp();
    await setPlan(owner, 'business');
    const viewer = await inviteAndJoin(owner, 'viewer');
    const stranger = await signUp();
    const app = await call(owner, 'post', '/apps').send({ name: 'Internal', template: 'dashboard' }).expect(201);
    await call(viewer, 'get', '/apps').expect(200);
    await call(viewer, 'post', '/apps').send({ name: 'nope' }).expect(403);
    await call(viewer, 'patch', `/apps/${app.body.id}`).send({ name: 'nope' }).expect(403);
    await call(viewer, 'post', `/apps/${app.body.id}/publish`).send({}).expect(403);
    await call(stranger, 'get', `/apps/${app.body.id}`).expect(404);

    const client = await anon();
    await client.get(`/api/v1/public/apps/${app.body.slug}`).expect(404); // not published yet
    await call(owner, 'post', `/apps/${app.body.id}/publish`).send({}).expect(200);
    const login = await client.get(`/api/v1/public/apps/${app.body.slug}`).expect(401);
    expect(login.body.code).toBe('LOGIN_REQUIRED');
    await call(viewer, 'get', `/public/apps/${app.body.slug}`).expect(200);
    await call(stranger, 'get', `/public/apps/${app.body.slug}`).expect(404);

    await call(owner, 'patch', `/apps/${app.body.id}`).send({ access: 'PUBLIC' }).expect(200);
    const pub = await client.get(`/api/v1/public/apps/${app.body.slug}`).expect(200);
    expect(pub.body.user).toBeNull();
    expect(pub.body.definition.queries.length).toBeGreaterThan(0);
    const q = await client.post(`/api/v1/public/apps/${app.body.slug}/queries/channels`).send({ args: {} }).expect(200);
    expect(q.body.data).toHaveLength(4);

    await call(owner, 'post', `/apps/${app.body.id}/unpublish`).expect(200);
    await client.get(`/api/v1/public/apps/${app.body.slug}`).expect(404);
  });

  it('runs data table queries from a public app without exposing other tables', async () => {
    const s = await signUp();
    const intruder = await signUp();
    const table = await call(s, 'post', '/data-tables').send({ name: 'Signups', columns: [{ name: 'email', type: 'TEXT' }, { name: 'score', type: 'NUMBER' }] }).expect(201);
    const foreign = await call(intruder, 'post', '/data-tables').send({ name: 'Secret', columns: [{ name: 'x', type: 'TEXT' }] }).expect(201);
    const def = withQueries([
      { id: 'q1', name: 'listRows', kind: 'dataTable', tableId: table.body.id, operation: 'list', args: { search: '{{ state.q }}' } },
      { id: 'q2', name: 'addRow', kind: 'dataTable', tableId: table.body.id, operation: 'insert', args: { data: '{{ form.data }}' } },
      { id: 'q3', name: 'updateRow', kind: 'dataTable', tableId: table.body.id, operation: 'update' },
      { id: 'q4', name: 'deleteRow', kind: 'dataTable', tableId: table.body.id, operation: 'delete' },
      { id: 'q5', name: 'stealRows', kind: 'dataTable', tableId: foreign.body.id, operation: 'list' },
    ]);
    const app = await call(s, 'post', '/apps').send({ name: 'Signup form', definition: def }).expect(201);
    await call(s, 'patch', `/apps/${app.body.id}`).send({ access: 'PUBLIC' }).expect(200);
    await call(s, 'post', `/apps/${app.body.id}/publish`).send({}).expect(200);
    const client = await anon();
    const base = `/api/v1/public/apps/${app.body.slug}/queries`;
    const ins = await client.post(`${base}/addRow`).send({ args: { data: { email: 'ada@example.com', score: '42', ignored: 'x' } } }).expect(200);
    expect(ins.body.data).toMatchObject({ email: 'ada@example.com', score: 42 });
    expect(ins.body.data.ignored).toBeUndefined();
    await client.post(`${base}/addRow`).send({ args: { data: { email: 'grace@example.com', score: 7 } } }).expect(200);
    const list = await client.post(`${base}/listRows`).send({ args: { search: 'grace' } }).expect(200);
    expect(list.body.data.map((r: { email: string }) => r.email)).toEqual(['grace@example.com']);
    expect(list.body.meta.total).toBe(1);
    const upd = await client.post(`${base}/q3`).send({ args: { rowId: ins.body.data.id, data: { score: 99 } } }).expect(200);
    expect(upd.body.data.score).toBe(99);
    await client.post(`${base}/deleteRow`).send({ args: { rowId: ins.body.data.id } }).expect(200);
    await client.post(`${base}/deleteRow`).send({ args: { rowId: ins.body.data.id } }).expect(404);
    expect(await prisma.dataTableRow.count({ where: { tableId: table.body.id } })).toBe(1);
    // a query pointing at another workspace's table resolves to nothing
    await client.post(`${base}/stealRows`).send({ args: {} }).expect(404);
    await client.post(`${base}/unknown`).send({ args: {} }).expect(404);
  });

  it('runs workflow queries through the App Trigger', async () => {
    const s = await signUp();
    const appTriggerWorkflow = {
      nodes: [
        { id: 'a', name: 'App', type: 'simplyai.appTrigger', position: { x: 0, y: 0 }, parameters: {} },
        { id: 'set', name: 'Set', type: 'simplyai.set', position: { x: 200, y: 0 }, parameters: { assignments: [{ name: 'ok', type: 'boolean', value: 'true' }] } },
      ],
      connections: [{ source: 'a', target: 'set', sourceOutput: 0, targetInput: 0 }],
    };
    const manualOnly = await call(s, 'post', '/workflows').send({ name: 'Manual', definition: { nodes: [{ id: 't', name: 'Start', type: 'simplyai.manualTrigger', position: { x: 0, y: 0 }, parameters: {} }], connections: [] } }).expect(201);
    const wf = await call(s, 'post', '/workflows').send({ name: 'Echo', definition: appTriggerWorkflow }).expect(201);
    const def = withQueries([
      { id: 'q1', name: 'echo', kind: 'workflow', workflowId: wf.body.id, payload: '{{ ({ message: "hi" }) }}' },
      { id: 'q2', name: 'manual', kind: 'workflow', workflowId: manualOnly.body.id },
      { id: 'q3', name: 'missing', kind: 'workflow' },
    ]);
    const app = await call(s, 'post', '/apps').send({ name: 'Echo app', definition: def }).expect(201);
    const missing = await call(s, 'post', `/apps/${app.body.id}/queries/q3/run`).send({ args: {} }).expect(400);
    expect(missing.body.message).toMatch(/Select a workflow/);
    const noTrigger = await call(s, 'post', `/apps/${app.body.id}/queries/q2/run`).send({ args: {} }).expect(422);
    expect(noTrigger.body.message).toMatch(/App Trigger/);

    // a stand-in worker completes executions so the API returns the output
    const seen: unknown[] = [];
    const worker = new Worker(QUEUES.executions, async (job) => {
      const ex = await prisma.execution.findUniqueOrThrow({ where: { id: job.data.executionId } });
      seen.push({ mode: ex.mode, input: ex.inputData, trigger: ex.triggerNodeKey });
      const input = (ex.inputData as Array<{ json: Record<string, unknown> }>)[0]!.json;
      return { status: 'SUCCESS', output: [{ json: { echo: input.message, ok: true } }] };
    }, { connection: redisConnectionOptions() });
    try {
      const draft = await call(s, 'post', `/apps/${app.body.id}/queries/q1/run`).send({ args: { message: 'hello' } }).expect(200);
      expect(draft.body.data).toEqual({ echo: 'hello', ok: true });
      expect(seen.at(-1)).toMatchObject({ mode: 'MANUAL', trigger: 'a', input: [{ json: { message: 'hello' } }] });

      await call(s, 'patch', `/apps/${app.body.id}`).send({ access: 'PUBLIC' }).expect(200);
      await call(s, 'post', `/apps/${app.body.id}/publish`).send({}).expect(200);
      const client = await anon();
      const inactive = await client.post(`/api/v1/public/apps/${app.body.slug}/queries/echo`).send({ args: { message: 'x' } }).expect(422);
      expect(inactive.body.message).toMatch(/Activate the workflow/);
      await call(s, 'post', `/workflows/${wf.body.id}/publish`).send({ activate: true }).expect(200);
      const live = await client.post(`/api/v1/public/apps/${app.body.slug}/queries/echo`).send({ args: { message: 'from the web' } }).expect(200);
      expect(live.body.data).toEqual({ echo: 'from the web', ok: true });
      expect(seen.at(-1)).toMatchObject({ mode: 'APP' });
    } finally {
      await worker.close();
    }
  });
});
