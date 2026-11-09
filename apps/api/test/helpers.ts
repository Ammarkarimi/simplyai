import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createApp } from '../src/main';

let app: NestExpressApplication | null = null;

export async function getApp() {
  if (!app) {
    app = await createApp();
    await app.init();
  }
  return app;
}

export async function closeApp() {
  if (app) await app.close();
  app = null;
}

export interface Session {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  workspaceId: string;
  userId: string;
  email: string;
}

let counter = 0;
export function uniqueEmail(prefix = 'user') {
  return `${prefix}.${Date.now()}.${++counter}@test.dev`;
}

export async function signUp(email = uniqueEmail(), password = 'Password123', extra: Record<string, unknown> = {}): Promise<Session> {
  const a = await getApp();
  const agent = request.agent(a.getHttpServer());
  const res = await agent.post('/api/v1/auth/signup').send({ name: 'Test User', email, password, ...extra }).expect(201);
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const csrf = decodeURIComponent(cookies.find((c) => c.startsWith('sai_csrf='))!.split(';')[0]!.split('=')[1]!);
  return { agent, csrf, workspaceId: res.body.workspaces[0]?.id, userId: res.body.user.id, email };
}

export function call(s: Session, method: 'get' | 'post' | 'patch' | 'delete', path: string, workspaceId = s.workspaceId) {
  const r = s.agent[method](`/api/v1${path}`).set('x-workspace-id', workspaceId);
  return method === 'get' ? r : r.set('x-csrf-token', s.csrf);
}

export const MANUAL_WORKFLOW = {
  nodes: [
    { id: 't', name: 'Start', type: 'simplyai.manualTrigger', position: { x: 0, y: 0 }, parameters: {} },
    { id: 's', name: 'Set', type: 'simplyai.set', position: { x: 200, y: 0 }, parameters: { assignments: [{ name: 'ok', type: 'boolean', value: 'true' }] } },
  ],
  connections: [{ source: 't', target: 's', sourceOutput: 0, targetInput: 0 }],
};

export async function setPlan(s: Session, planKey: string) {
  const { prisma } = await import('@simplyai/db');
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: s.workspaceId } });
  await prisma.subscription.update({ where: { organizationId: ws.organizationId }, data: { plan: { connect: { key: planKey } } } });
}
