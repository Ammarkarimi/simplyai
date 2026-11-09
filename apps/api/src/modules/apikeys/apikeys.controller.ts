import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { randomToken, sha256 } from '@simplyai/db';
import { audit } from '@simplyai/core';
import { API_KEY_SCOPES, apiKeySchema } from '@simplyai/shared';
import { RequirePermission, SessionOnly, Ws } from '../../common/decorators';
import type { WorkspaceContext } from '../../common/context';
import { zbody } from '../../common/zod.pipe';
import { PrismaService } from '../../infra/prisma.service';

@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly prisma: PrismaService) {}

  @SessionOnly()
  @RequirePermission('apikey:manage')
  @Get()
  async list(@Ws() ws: WorkspaceContext) {
    const keys = await this.prisma.db.apiKey.findMany({ where: { workspaceId: ws.workspaceId }, orderBy: { createdAt: 'desc' }, include: { createdBy: { select: { name: true } } } });
    return { scopes: API_KEY_SCOPES, keys: keys.map(({ keyHash: _h, ...k }) => ({ ...k, active: !k.revokedAt && (!k.expiresAt || k.expiresAt > new Date()) })) };
  }

  @SessionOnly()
  @RequirePermission('apikey:manage')
  @Post()
  async create(@Ws() ws: WorkspaceContext, @Body(zbody(apiKeySchema)) body: z.infer<typeof apiKeySchema>) {
    const valid = new Set<string>(API_KEY_SCOPES.map((s) => s.key));
    const bad = body.scopes.filter((s) => !valid.has(s));
    if (bad.length) throw new BadRequestException(`Unknown scopes: ${bad.join(', ')}`);
    const raw = `sai_${randomToken(30)}`;
    const key = await this.prisma.db.apiKey.create({
      data: {
        workspaceId: ws.workspaceId, name: body.name, prefix: raw.slice(0, 10), keyHash: sha256(raw), scopes: body.scopes, rateLimitPerMinute: body.rateLimitPerMinute,
        expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null, createdById: ws.userId,
      },
    });
    await audit(this.prisma.db, { action: 'apikey.created', userId: ws.userId, workspaceId: ws.workspaceId, resourceId: key.id, metadata: { scopes: body.scopes } });
    return { id: key.id, name: key.name, prefix: key.prefix, key: raw, scopes: key.scopes, expiresAt: key.expiresAt };
  }

  @SessionOnly()
  @RequirePermission('apikey:manage')
  @Delete(':id')
  async revoke(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    const r = await this.prisma.db.apiKey.updateMany({ where: { id, workspaceId: ws.workspaceId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) throw new NotFoundException('API key not found');
    await audit(this.prisma.db, { action: 'apikey.revoked', userId: ws.userId, workspaceId: ws.workspaceId, resourceId: id });
    return { ok: true };
  }
}
