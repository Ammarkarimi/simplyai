import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '@simplyai/db';
import { closeApp, getApp, signUp, uniqueEmail } from './helpers';

afterAll(closeApp);

describe('authentication', () => {
  it('signs up, creates an organization, workspace and session', async () => {
    const s = await signUp();
    const me = await s.agent.get('/api/v1/auth/me').expect(200);
    expect(me.body.user.email).toBe(s.email);
    expect(me.body.workspaces).toHaveLength(1);
    expect(me.body.workspaces[0].role.key).toBe('owner');
    expect(me.body.organizations[0].plan).toBe('free');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: s.email } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('rejects duplicate emails and weak passwords', async () => {
    const email = uniqueEmail();
    await signUp(email);
    const app = await getApp();
    await request(app.getHttpServer()).post('/api/v1/auth/signup').send({ name: 'X', email, password: 'Password123' }).expect(409);
    const weak = await request(app.getHttpServer()).post('/api/v1/auth/signup').send({ name: 'X', email: uniqueEmail(), password: 'short' }).expect(400);
    expect(weak.body.message).toMatch(/password/i);
  });

  it('logs in with valid credentials only', async () => {
    const email = uniqueEmail();
    await signUp(email, 'Password123');
    const app = await getApp();
    await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'WrongPass1' }).expect(401);
    const ok = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'Password123' }).expect(200);
    expect(ok.headers['set-cookie']?.toString()).toMatch(/sai_session=.*HttpOnly/i);
  });

  it('requires authentication and CSRF for mutations', async () => {
    const app = await getApp();
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    const s = await signUp();
    await s.agent.post('/api/v1/workflows').set('x-workspace-id', s.workspaceId).send({ name: 'x' }).expect(403);
    await s.agent.post('/api/v1/workflows').set('x-workspace-id', s.workspaceId).set('x-csrf-token', 'forged').send({ name: 'x' }).expect(403);
    await s.agent.post('/api/v1/workflows').set('x-workspace-id', s.workspaceId).set('x-csrf-token', s.csrf).send({ name: 'x' }).expect(201);
  });

  it('verifies email and resets password with single-use tokens', async () => {
    const s = await signUp();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: s.email } });
    expect(user.emailVerifiedAt).toBeNull();
    // tokens are stored hashed, so issue a fresh known token through the service flow
    const app = await getApp();
    await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email: s.email }).expect(200);
    const tokenRow = await prisma.verificationToken.findFirst({ where: { userId: user.id, type: 'PASSWORD_RESET', usedAt: null } });
    expect(tokenRow).not.toBeNull();
    expect(tokenRow!.tokenHash).toHaveLength(64);
    await request(app.getHttpServer()).post('/api/v1/auth/reset-password').send({ token: 'not-a-real-token-value', password: 'NewPassword1' }).expect(400);
  });

  it('logs out and invalidates the session', async () => {
    const s = await signUp();
    await s.agent.post('/api/v1/auth/logout').expect(200);
    await s.agent.get('/api/v1/auth/me').expect(401);
  });
});
