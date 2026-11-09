import type { Request } from 'express';
import type { ApiKey, Session, User } from '@simplyai/db';

export type AuthContext =
  | { kind: 'session'; user: User; session: Session }
  | { kind: 'apiKey'; apiKey: ApiKey; user: null };

export interface WorkspaceContext {
  workspaceId: string;
  organizationId: string;
  permissions: string[];
  roleKey: string;
  userId: string | null;
}

export interface AppRequest extends Request {
  auth?: AuthContext;
  ws?: WorkspaceContext;
  rawBody?: Buffer;
}

export function clientIp(req: Request): string {
  return (req.ip ?? req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
}
