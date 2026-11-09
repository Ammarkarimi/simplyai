import { afterAll, describe, expect, it } from 'vitest';
import { sha256, prisma } from '@simplyai/db';
import { call, closeApp, MANUAL_WORKFLOW, setPlan, signUp, uniqueEmail, type Session } from './helpers';

afterAll(closeApp);

async function inviteAndJoin(owner: Session, roleKey: string): Promise<Session> {
  const email = uniqueEmail(roleKey);
  const inv = await call(owner, 'post', '/team/invitations').send({ email, roleKey }).expect(201);
  const token = decodeURIComponent(String(inv.body.inviteUrl).split('/invite/')[1]);
  const member = await signUp(email, 'Password123', { inviteToken: token });
  expect(member.workspaceId).toBe(owner.workspaceId);
  return member;
}

describe('role based access control', () => {
  it('enforces viewer / operator / editor permissions', async () => {
    const owner = await signUp();
    await setPlan(owner, 'business');
    const wf = await call(owner, 'post', '/workflows').send({ name: 'RBAC', definition: MANUAL_WORKFLOW }).expect(201);
    const viewer = await inviteAndJoin(owner, 'viewer');
    const operator = await inviteAndJoin(owner, 'operator');
    const editor = await inviteAndJoin(owner, 'editor');

    await call(viewer, 'get', `/workflows/${wf.body.id}`).expect(200);
    await call(viewer, 'patch', `/workflows/${wf.body.id}`).send({ name: 'nope' }).expect(403);
    await call(viewer, 'post', `/workflows/${wf.body.id}/run`).send({}).expect(403);
    await call(viewer, 'get', '/credentials').expect(200);
    await call(viewer, 'post', '/credentials').send({ name: 'x', type: 'httpBearerAuth', data: { token: 'abc' } }).expect(403);

    await call(operator, 'post', `/workflows/${wf.body.id}/run`).send({}).expect(201);
    await call(operator, 'patch', `/workflows/${wf.body.id}`).send({ name: 'nope' }).expect(403);

    await call(editor, 'patch', `/workflows/${wf.body.id}`).send({ name: 'Renamed' }).expect(200);
    await call(editor, 'post', '/team/invitations').send({ email: uniqueEmail(), roleKey: 'viewer' }).expect(403);
    await call(editor, 'get', '/api-keys').expect(403);
  });

  it('prevents privilege escalation when managing members', async () => {
    const owner = await signUp();
    await setPlan(owner, 'business');
    const admin = await inviteAndJoin(owner, 'admin');
    await call(admin, 'post', '/team/invitations').send({ email: uniqueEmail(), roleKey: 'owner' }).expect(403);
    await call(admin, 'patch', `/team/members/${owner.userId}`).send({ roleKey: 'viewer' }).expect(403);
    await call(owner, 'delete', `/team/members/${owner.userId}`).expect(400);
  });
});

describe('tenant isolation', () => {
  it('blocks access to other workspaces and their resources', async () => {
    const a = await signUp();
    const b = await signUp();
    const wf = await call(a, 'post', '/workflows').send({ name: 'Private' }).expect(201);
    await call(b, 'get', `/workflows/${wf.body.id}`, a.workspaceId).expect(403);
    await call(b, 'get', `/workflows/${wf.body.id}`).expect(404);
    const cred = await call(a, 'post', '/credentials').send({ name: 'A key', type: 'httpBearerAuth', data: { token: 'super-secret-token' } }).expect(201);
    expect(JSON.stringify(cred.body)).not.toContain('super-secret-token');
    expect(cred.body.data.token).toBe('••••••••');
    const stored = await prisma.credential.findUniqueOrThrow({ where: { id: cred.body.id } });
    expect(stored.encryptedData).not.toContain('super-secret-token');
    // using A's credential id in B's workflow is silently dropped
    const def = { ...MANUAL_WORKFLOW, nodes: MANUAL_WORKFLOW.nodes.map((n) => ({ ...n, credentialId: cred.body.id })) };
    const bwf = await call(b, 'post', '/workflows').send({ name: 'steal', definition: def }).expect(201);
    const node = await prisma.workflowNode.findFirstOrThrow({ where: { workflowId: bwf.body.id, nodeKey: 't' } });
    expect(node.credentialId).toBeNull();
  });
});

describe('api keys', () => {
  it('authenticates with scopes and rejects revoked keys', async () => {
    const s = await signUp();
    const wf = await call(s, 'post', '/workflows').send({ name: 'API', definition: MANUAL_WORKFLOW }).expect(201);
    const key = await call(s, 'post', '/api-keys').send({ name: 'ro', scopes: ['workflows:read'], rateLimitPerMinute: 3 }).expect(201);
    expect(key.body.key).toMatch(/^sai_/);
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: key.body.id } })).keyHash).toBe(sha256(key.body.key));
    const app = (await import('./helpers')).getApp;
    const server = (await app()).getHttpServer();
    const req = (await import('supertest')).default;
    await req(server).get('/api/v1/workflows').set('authorization', `Bearer ${key.body.key}`).expect(200);
    await req(server).post(`/api/v1/workflows/${wf.body.id}/run`).set('authorization', `Bearer ${key.body.key}`).send({}).expect(403);
    // 3 requests per minute: the 4th request in the window is rejected
    await req(server).get('/api/v1/workflows').set('authorization', `Bearer ${key.body.key}`).expect(200);
    await req(server).get('/api/v1/workflows').set('authorization', `Bearer ${key.body.key}`).expect(429);
    await call(s, 'delete', `/api-keys/${key.body.id}`).expect(200);
    await req(server).get('/api/v1/workflows').set('authorization', `Bearer ${key.body.key}`).expect(401);
    await req(server).get('/api/v1/workflows').set('authorization', 'Bearer sai_invalid').expect(401);
  });
});
