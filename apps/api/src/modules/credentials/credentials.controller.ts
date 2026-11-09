import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { randomToken } from '@simplyai/db';
import {
  applyCredential, assertCountLimit, audit, buildAuthorizeUrl, decryptCredentialData, encryptCredentialData, env, exchangeOAuthCode, getRegistry, maskCredentialData, mergeCredentialData, refreshOAuthIfNeeded,
} from '@simplyai/core';
import { testConnectionCredential } from '@simplyai/nodes';
import { httpRequest, type HttpRequestOptions } from '@simplyai/sdk';
import { createCredentialSchema, updateCredentialSchema } from '@simplyai/shared';
import { Public, RequirePermission, Ws } from '../../common/decorators';
import type { WorkspaceContext } from '../../common/context';
import { zbody } from '../../common/zod.pipe';
import { PrismaService } from '../../infra/prisma.service';

@Controller()
export class CredentialsController {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.db;
  }

  private async find(ws: WorkspaceContext, id: string) {
    const c = await this.db.credential.findFirst({ where: { id, workspaceId: ws.workspaceId } });
    if (!c) throw new NotFoundException('Credential not found');
    return c;
  }

  private present(c: { id: string; name: string; type: string; status: string; statusMessage: string | null; lastTestedAt: Date | null; createdAt: Date; updatedAt: Date; workspaceId: string; encryptedData: string }) {
    const def = getRegistry().getCredential(c.type);
    let data: Record<string, unknown> = {};
    let connected = false;
    try {
      const raw = decryptCredentialData(c);
      data = maskCredentialData(def, raw);
      connected = def?.authKind === 'oauth2' ? !!(raw.oauthTokenData as Record<string, unknown> | undefined)?.access_token : true;
    } catch {
      data = {};
    }
    return {
      id: c.id, name: c.name, type: c.type, typeName: def?.displayName ?? c.type, integration: def?.integration ?? null, authKind: def?.authKind ?? 'custom',
      status: c.status, statusMessage: c.statusMessage, lastTestedAt: c.lastTestedAt, createdAt: c.createdAt, updatedAt: c.updatedAt, data, connected,
    };
  }

  @RequirePermission('credential:read')
  @Get('credentials')
  async list(@Ws() ws: WorkspaceContext, @Query('type') type?: string) {
    const rows = await this.db.credential.findMany({ where: { workspaceId: ws.workspaceId, ...(type ? { type: { in: type.split(',') } } : {}) }, orderBy: { updatedAt: 'desc' }, include: { _count: { select: { nodes: true } } } });
    return rows.map((r) => ({ ...this.present(r), usedByNodes: r._count.nodes }));
  }

  @RequirePermission('credential:read')
  @Get('credentials/:id')
  async get(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    const c = await this.find(ws, id);
    const usage = await this.db.workflowNode.findMany({ where: { credentialId: id }, select: { name: true, workflow: { select: { id: true, name: true } } } });
    return { ...this.present(c), usage };
  }

  @RequirePermission('credential:manage')
  @Post('credentials')
  async create(@Ws() ws: WorkspaceContext, @Body(zbody(createCredentialSchema)) body: z.infer<typeof createCredentialSchema>) {
    const def = getRegistry().getCredential(body.type);
    if (!def) throw new BadRequestException(`Unknown credential type ${body.type}`);
    const count = await this.db.credential.count({ where: { workspace: { organizationId: ws.organizationId } } });
    await assertCountLimit(this.db, ws.organizationId, 'maxCredentials', count);
    const data = this.clean(def.properties.map((p) => p.name), body.data);
    const missing = def.properties.filter((p) => p.required && (data[p.name] === undefined || data[p.name] === '')).map((p) => p.displayName);
    if (missing.length) throw new BadRequestException(`Missing: ${missing.join(', ')}`);
    const c = await this.db.credential.create({
      data: { workspaceId: ws.workspaceId, name: body.name, type: body.type, encryptedData: encryptCredentialData(ws.workspaceId, data), status: def.authKind === 'oauth2' ? 'PENDING_OAUTH' : 'ACTIVE', createdById: ws.userId },
    });
    await audit(this.db, { action: 'credential.created', userId: ws.userId, workspaceId: ws.workspaceId, resourceType: 'credential', resourceId: c.id, metadata: { type: body.type } });
    return this.present(c);
  }

  private clean(allowed: string[], data: Record<string, unknown>) {
    const out: Record<string, unknown> = {};
    for (const k of allowed) if (data[k] !== undefined) out[k] = typeof data[k] === 'string' ? (data[k] as string).trim() : data[k];
    return out;
  }

  @RequirePermission('credential:manage')
  @Patch('credentials/:id')
  async update(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body(zbody(updateCredentialSchema)) body: z.infer<typeof updateCredentialSchema>) {
    const c = await this.find(ws, id);
    const def = getRegistry().getCredential(c.type)!;
    let encryptedData = c.encryptedData;
    if (body.data) {
      const merged = mergeCredentialData(decryptCredentialData(c), this.clean(def.properties.map((p) => p.name), body.data));
      encryptedData = encryptCredentialData(ws.workspaceId, merged);
    }
    const updated = await this.db.credential.update({ where: { id }, data: { name: body.name, encryptedData } });
    await audit(this.db, { action: 'credential.updated', userId: ws.userId, workspaceId: ws.workspaceId, resourceType: 'credential', resourceId: id });
    return this.present(updated);
  }

  @RequirePermission('credential:manage')
  @Delete('credentials/:id')
  async remove(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Query('force') force?: string) {
    await this.find(ws, id);
    const used = await this.db.workflowNode.count({ where: { credentialId: id } });
    if (used && force !== 'true') throw new BadRequestException(`This credential is used by ${used} node(s). Pass force=true to delete anyway.`);
    await this.db.credential.delete({ where: { id } });
    await audit(this.db, { action: 'credential.deleted', userId: ws.userId, workspaceId: ws.workspaceId, resourceType: 'credential', resourceId: id });
    return { ok: true };
  }

  @RequirePermission('credential:manage')
  @HttpCode(200)
  @Post('credentials/:id/test')
  async test(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    const c = await this.find(ws, id);
    const def = getRegistry().getCredential(c.type);
    let ok = false;
    let message: string;
    try {
      let data = decryptCredentialData(c);
      if (def?.authKind === 'oauth2') data = await refreshOAuthIfNeeded(this.db, c, data);
      const conn = await testConnectionCredential(c.type, data);
      if (conn !== null) message = conn;
      else if (def?.test) message = (await def.test(data, <T>(o: HttpRequestOptions) => httpRequest<T>({ ...o, timeoutMs: 15_000 }))) || 'Connection successful';
      else message = 'This credential type has no automatic test; it will be validated when a workflow uses it.';
      ok = true;
    } catch (err) {
      message = (err as Error).message;
    }
    await this.db.credential.update({ where: { id }, data: { lastTestedAt: new Date(), status: ok ? 'ACTIVE' : 'ERROR', statusMessage: ok ? null : message.slice(0, 500) } });
    return { ok, message };
  }

  // ─── OAuth2 ───

  @RequirePermission('credential:manage')
  @HttpCode(200)
  @Post('credentials/:id/oauth2/authorize')
  async authorize(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    const c = await this.find(ws, id);
    const state = randomToken(24);
    const url = buildAuthorizeUrl(c.type, decryptCredentialData(c), state);
    await this.db.credential.update({ where: { id }, data: { oauthState: state } });
    return { url, redirectUri: `${env.appUrl}/api/v1/oauth2/callback` };
  }

  @RequirePermission('credential:manage')
  @HttpCode(200)
  @Post('credentials/:id/oauth2/revoke')
  async revoke(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    const c = await this.find(ws, id);
    const data = decryptCredentialData(c);
    delete data.oauthTokenData;
    await this.db.credential.update({ where: { id }, data: { encryptedData: encryptCredentialData(ws.workspaceId, data), status: 'PENDING_OAUTH', statusMessage: 'Disconnected' } });
    await audit(this.db, { action: 'credential.revoked', userId: ws.userId, workspaceId: ws.workspaceId, resourceType: 'credential', resourceId: id });
    return { ok: true };
  }

  @Public()
  @Get('oauth2/callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Query('error') error: string | undefined, @Res() res: Response) {
    const back = (params: Record<string, string>) => res.redirect(`${env.appUrl}/credentials?${new URLSearchParams(params)}`);
    if (!state) return back({ oauth: 'error', message: 'Missing state' });
    const c = await this.db.credential.findUnique({ where: { oauthState: state } });
    if (!c) return back({ oauth: 'error', message: 'Unknown or expired authorization request' });
    if (error || !code) {
      await this.db.credential.update({ where: { id: c.id }, data: { oauthState: null, status: 'ERROR', statusMessage: error ?? 'Authorization was cancelled' } });
      return back({ oauth: 'error', message: error ?? 'Authorization cancelled', id: c.id });
    }
    try {
      const data = decryptCredentialData(c);
      const token = await exchangeOAuthCode(c.type, data, code);
      await this.db.credential.update({ where: { id: c.id }, data: { oauthState: null, encryptedData: encryptCredentialData(c.workspaceId, { ...data, oauthTokenData: token }), status: 'ACTIVE', statusMessage: null } });
      await audit(this.db, { action: 'credential.connected', workspaceId: c.workspaceId, resourceType: 'credential', resourceId: c.id });
      return back({ oauth: 'success', id: c.id });
    } catch (err) {
      await this.db.credential.update({ where: { id: c.id }, data: { oauthState: null, status: 'ERROR', statusMessage: (err as Error).message.slice(0, 500) } });
      return back({ oauth: 'error', message: (err as Error).message, id: c.id });
    }
  }
}

export { applyCredential };
