import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '@simplyai/db';
import { audit } from '@simplyai/core';
import {
  APP_TEMPLATES, appDefinitionSchema, buildAppTemplate, createAppSchema, emptyAppDefinition, publishAppSchema, runAppQuerySchema, updateAppSchema,
  type AppDefinition,
} from '@simplyai/shared';
import { RateLimit, RequirePermission, Ws } from '../../common/decorators';
import type { WorkspaceContext } from '../../common/context';
import { zbody } from '../../common/zod.pipe';
import { PrismaService } from '../../infra/prisma.service';
import { AppsService } from './apps.service';

const json = (d: AppDefinition) => d as unknown as Prisma.InputJsonValue;

export function parseDefinition(value: unknown): AppDefinition {
  const parsed = appDefinitionSchema.safeParse(value);
  if (!parsed.success) throw new BadRequestException({ message: `Invalid app: ${parsed.error.issues[0]?.message ?? 'definition'}`, issues: parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message })) });
  if (JSON.stringify(parsed.data).length > 2_000_000) throw new BadRequestException('The app is too large (2 MB limit)');
  return parsed.data as AppDefinition;
}

@Controller('apps')
export class AppsController {
  constructor(private readonly prisma: PrismaService, private readonly apps: AppsService) {}

  private get db() {
    return this.prisma.db;
  }

  private async load(ws: WorkspaceContext, id: string) {
    const app = await this.db.app.findFirst({ where: { id, workspaceId: ws.workspaceId }, include: { publishedVersion: { select: { id: true, version: true, createdAt: true } } } });
    if (!app) throw new NotFoundException('App not found');
    return app;
  }

  @RequirePermission('app:read')
  @Get()
  async list(@Ws() ws: WorkspaceContext) {
    const apps = await this.db.app.findMany({
      where: { workspaceId: ws.workspaceId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, description: true, slug: true, icon: true, color: true, access: true, publishedAt: true, updatedAt: true, createdAt: true, publishedVersion: { select: { version: true } } },
    });
    return apps;
  }

  @RequirePermission('app:read')
  @Get('templates')
  templates() {
    return APP_TEMPLATES.map(({ build: _b, ...t }) => t);
  }

  @RequirePermission('app:manage')
  @Post()
  async create(@Ws() ws: WorkspaceContext, @Body(zbody(createAppSchema)) body: z.infer<typeof createAppSchema>) {
    let definition: AppDefinition;
    if (body.definition !== undefined) definition = parseDefinition(body.definition);
    else if (body.template) {
      const built = buildAppTemplate(body.template);
      if (!built) throw new BadRequestException('Unknown template');
      definition = built;
    } else definition = emptyAppDefinition();
    const tpl = APP_TEMPLATES.find((t) => t.key === body.template);
    const app = await this.db.app.create({
      data: {
        workspaceId: ws.workspaceId, name: body.name, description: body.description ?? tpl?.description, slug: await this.apps.uniqueSlug(body.name),
        icon: tpl && tpl.key !== 'blank' ? tpl.icon : 'layout-dashboard', color: tpl?.color && tpl.key !== 'blank' ? tpl.color : '#7c3aed', definition: json(definition), createdById: ws.userId,
      },
    });
    await audit(this.db, { action: 'app.created', userId: ws.userId, workspaceId: ws.workspaceId, resourceType: 'app', resourceId: app.id });
    return app;
  }

  @RequirePermission('app:read')
  @Get(':id')
  get(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.load(ws, id);
  }

  @RequirePermission('app:manage')
  @Patch(':id')
  async update(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body(zbody(updateAppSchema)) body: z.infer<typeof updateAppSchema>) {
    await this.load(ws, id);
    if (body.slug) {
      const taken = await this.db.app.findFirst({ where: { slug: body.slug, NOT: { id } }, select: { id: true } });
      if (taken) throw new ConflictException('This URL is already taken');
    }
    const { definition, ...rest } = body;
    if (definition && JSON.stringify(definition).length > 2_000_000) throw new BadRequestException('The app is too large (2 MB limit)');
    await this.db.app.update({ where: { id }, data: { ...rest, ...(definition ? { definition: json(definition as AppDefinition) } : {}) } });
    if (body.access) await audit(this.db, { action: 'app.access_changed', userId: ws.userId, workspaceId: ws.workspaceId, resourceType: 'app', resourceId: id, metadata: { access: body.access } });
    return this.load(ws, id);
  }

  @RequirePermission('app:manage')
  @Delete(':id')
  async remove(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    await this.load(ws, id);
    await this.db.app.update({ where: { id }, data: { publishedVersionId: null } });
    await this.db.app.delete({ where: { id } });
    await audit(this.db, { action: 'app.deleted', userId: ws.userId, workspaceId: ws.workspaceId, resourceType: 'app', resourceId: id });
    return { ok: true };
  }

  @RequirePermission('app:manage')
  @Post(':id/duplicate')
  async duplicate(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    const app = await this.load(ws, id);
    const name = `${app.name} (copy)`.slice(0, 100);
    return this.db.app.create({
      data: { workspaceId: ws.workspaceId, name, description: app.description, slug: await this.apps.uniqueSlug(name), icon: app.icon, color: app.color, definition: app.definition as Prisma.InputJsonValue, createdById: ws.userId },
    });
  }

  @RequirePermission('app:manage')
  @HttpCode(200)
  @Post(':id/publish')
  async publish(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body(zbody(publishAppSchema)) body: z.infer<typeof publishAppSchema>) {
    const app = await this.load(ws, id);
    const definition = parseDefinition(app.definition);
    const last = await this.db.appVersion.findFirst({ where: { appId: id }, orderBy: { version: 'desc' }, select: { version: true } });
    const version = await this.db.appVersion.create({ data: { appId: id, version: (last?.version ?? 0) + 1, definition: json(definition), message: body.message, createdById: ws.userId } });
    await this.db.app.update({ where: { id }, data: { publishedVersionId: version.id, publishedAt: new Date() } });
    await audit(this.db, { action: 'app.published', userId: ws.userId, workspaceId: ws.workspaceId, resourceType: 'app', resourceId: id, metadata: { version: version.version } });
    return this.load(ws, id);
  }

  @RequirePermission('app:manage')
  @HttpCode(200)
  @Post(':id/unpublish')
  async unpublish(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    await this.load(ws, id);
    await this.db.app.update({ where: { id }, data: { publishedVersionId: null, publishedAt: null } });
    await audit(this.db, { action: 'app.unpublished', userId: ws.userId, workspaceId: ws.workspaceId, resourceType: 'app', resourceId: id });
    return this.load(ws, id);
  }

  @RequirePermission('app:read')
  @Get(':id/versions')
  async versions(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    await this.load(ws, id);
    return this.db.appVersion.findMany({ where: { appId: id }, orderBy: { version: 'desc' }, take: 100, select: { id: true, version: true, message: true, createdAt: true, createdById: true } });
  }

  @RequirePermission('app:manage')
  @HttpCode(200)
  @Post(':id/versions/:versionId/restore')
  async restore(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Param('versionId') versionId: string) {
    await this.load(ws, id);
    const v = await this.db.appVersion.findFirst({ where: { id: versionId, appId: id } });
    if (!v) throw new NotFoundException('Version not found');
    await this.db.app.update({ where: { id }, data: { definition: v.definition as Prisma.InputJsonValue } });
    return this.load(ws, id);
  }

  /** Builder preview: runs a query of the draft (or the query sent by the builder) against workflow drafts. */
  @RequirePermission('app:manage')
  @RateLimit(240, 60)
  @HttpCode(200)
  @Post(':id/queries/:queryId/run')
  async runQuery(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Param('queryId') queryId: string, @Body(zbody(runAppQuerySchema)) body: z.infer<typeof runAppQuerySchema>) {
    const app = await this.load(ws, id);
    const query = body.query ?? this.apps.findQuery(app.definition as unknown as AppDefinition, queryId);
    return this.apps.run(query, body.args, { workspaceId: ws.workspaceId, test: true, userId: ws.userId });
  }
}
