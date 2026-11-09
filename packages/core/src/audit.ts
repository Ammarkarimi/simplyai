import type { Prisma, PrismaClient } from '@simplyai/db';

export interface AuditEntry {
  action: string;
  userId?: string | null;
  workspaceId?: string | null;
  organizationId?: string | null;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

export async function audit(db: PrismaClient, e: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action: e.action, userId: e.userId ?? null, workspaceId: e.workspaceId ?? null, organizationId: e.organizationId ?? null,
        resourceType: e.resourceType, resourceId: e.resourceId, metadata: (e.metadata ?? {}) as Prisma.InputJsonValue, ip: e.ip ?? null, userAgent: e.userAgent?.slice(0, 300) ?? null,
      },
    });
  } catch {
    /* audit logging must never break the request */
  }
}

export async function systemLog(db: PrismaClient, level: 'info' | 'warn' | 'error', source: string, message: string, context: Record<string, unknown> = {}): Promise<void> {
  try {
    await db.systemLog.create({ data: { level, source, message: message.slice(0, 2000), context: context as Prisma.InputJsonValue } });
  } catch {
    /* ignore */
  }
}
