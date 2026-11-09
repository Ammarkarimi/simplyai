import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Query } from '@nestjs/common';
import { z } from 'zod';
import { randomToken, type Prisma } from '@simplyai/db';
import { audit, env } from '@simplyai/core';
import { listQuerySchema, webhookUpdateSchema } from '@simplyai/shared';
import { RequirePermission, Ws } from '../../common/decorators';
import type { WorkspaceContext } from '../../common/context';
import { zbody, ZodPipe } from '../../common/zod.pipe';
import { paginate, pageResult } from '../../common/pagination';
import { PrismaService } from '../../infra/prisma.service';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly prisma: PrismaService, private readonly service: WebhooksService) {}

  private urls(path: string, kind: string) {
    if (kind === 'FORM') return { url: `${env.appUrl}/f/${path}`, testUrl: `${env.appUrl}/f/${path}?test=1` };
    if (kind === 'CHAT') return { url: `${env.appUrl}/c/${path}`, testUrl: `${env.appUrl}/c/${path}?test=1` };
    return { url: `${env.apiUrl}/webhook/${path}`, testUrl: `${env.apiUrl}/webhook-test/${path}` };
  }

  private present(w: Prisma.WebhookGetPayload<{ include: { workflow: { select: { id: true; name: true; active: true } } } }>) {
    const cfg = this.service.authConfig(w);
    return {
      id: w.id, kind: w.kind, path: w.path, methods: w.methods, active: w.active, nodeKey: w.nodeKey, workflow: w.workflow,
      authType: w.authType, auth: { headerName: cfg.headerName ?? 'x-webhook-token', username: cfg.username ?? '', hasToken: !!cfg.token, hasPassword: !!cfg.password, hasSecret: !!cfg.secret },
      responseMode: w.responseMode, responseCode: w.responseCode, responseHeaders: w.responseHeaders, responseBody: w.responseBody, createdAt: w.createdAt, updatedAt: w.updatedAt,
      ...this.urls(w.path, w.kind),
    };
  }

  @RequirePermission('webhook:read')
  @Get()
  async list(@Ws() ws: WorkspaceContext) {
    const rows = await this.prisma.db.webhook.findMany({ where: { workspaceId: ws.workspaceId }, include: { workflow: { select: { id: true, name: true, active: true } }, _count: { select: { requests: true } } }, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => ({ ...this.present(r), requestCount: r._count.requests }));
  }

  @RequirePermission('webhook:read')
  @Get(':id')
  async get(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    const w = await this.prisma.db.webhook.findFirst({ where: { id, workspaceId: ws.workspaceId }, include: { workflow: { select: { id: true, name: true, active: true } } } });
    if (!w) throw new NotFoundException('Webhook not found');
    return this.present(w);
  }

  @RequirePermission('webhook:manage')
  @Patch(':id')
  async update(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body(zbody(webhookUpdateSchema)) body: z.infer<typeof webhookUpdateSchema>) {
    const w = await this.prisma.db.webhook.findFirst({ where: { id, workspaceId: ws.workspaceId } });
    if (!w) throw new NotFoundException('Webhook not found');
    const authType = body.authType ?? w.authType;
    const current = this.service.authConfig(w);
    const next = { ...current, ...Object.fromEntries(Object.entries(body.auth ?? {}).filter(([, v]) => v !== undefined && v !== '')) };
    if (authType === 'HEADER' && !next.token) next.token = randomToken(24);
    if (authType === 'HMAC' && !next.secret) next.secret = randomToken(32);
    if (authType === 'BASIC' && (!next.username || !next.password)) throw new BadRequestException('Basic auth needs a username and password');
    const updated = await this.prisma.db.webhook.update({
      where: { id },
      include: { workflow: { select: { id: true, name: true, active: true } } },
      data: {
        methods: w.kind === 'WEBHOOK' ? body.methods : undefined, authType, encryptedAuth: this.service.encryptAuth(ws.workspaceId, next),
        responseMode: w.kind === 'WEBHOOK' ? body.responseMode : undefined, responseCode: body.responseCode, responseHeaders: body.responseHeaders as Prisma.InputJsonValue | undefined, responseBody: body.responseBody,
      },
    });
    await audit(this.prisma.db, { action: 'webhook.updated', userId: ws.userId, workspaceId: ws.workspaceId, resourceType: 'webhook', resourceId: id, metadata: { authType } });
    return this.present(updated);
  }

  /** Reveal the generated token / secret once for configuring the sender. */
  @RequirePermission('webhook:manage')
  @Get(':id/secret')
  async secret(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    const w = await this.prisma.db.webhook.findFirst({ where: { id, workspaceId: ws.workspaceId } });
    if (!w) throw new NotFoundException('Webhook not found');
    const cfg = this.service.authConfig(w);
    return { authType: w.authType, headerName: cfg.headerName ?? 'x-webhook-token', token: cfg.token ?? null, secret: cfg.secret ?? null };
  }

  @RequirePermission('webhook:read')
  @Get(':id/requests')
  async requests(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Query(new ZodPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>) {
    const w = await this.prisma.db.webhook.findFirst({ where: { id, workspaceId: ws.workspaceId } });
    if (!w) throw new NotFoundException('Webhook not found');
    const [items, total] = await Promise.all([
      this.prisma.db.webhookRequest.findMany({ where: { webhookId: id }, orderBy: { receivedAt: 'desc' }, ...paginate(q.page, q.pageSize), include: { execution: { select: { status: true } } } }),
      this.prisma.db.webhookRequest.count({ where: { webhookId: id } }),
    ]);
    return pageResult(items, total, q.page, q.pageSize);
  }
}
