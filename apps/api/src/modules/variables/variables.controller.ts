import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { encrypt } from '@simplyai/db';
import { audit } from '@simplyai/core';
import { secretSchema, variableSchema } from '@simplyai/shared';
import { RequirePermission, Ws } from '../../common/decorators';
import type { WorkspaceContext } from '../../common/context';
import { zbody } from '../../common/zod.pipe';
import { PrismaService } from '../../infra/prisma.service';

const updateVariable = variableSchema.pick({ value: true, description: true }).partial();
const updateSecret = secretSchema.pick({ value: true, description: true }).partial();

@Controller()
export class VariablesController {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.db;
  }

  @RequirePermission('variable:read')
  @Get('variables')
  async list(@Ws() ws: WorkspaceContext, @Query('scope') scope?: string) {
    const rows = await this.db.variable.findMany({
      where: {
        OR: [{ workspaceId: ws.workspaceId }, { scope: 'GLOBAL', organizationId: ws.organizationId }],
        ...(scope ? { scope: scope as never } : {}),
      },
      include: { workflow: { select: { name: true } } },
      orderBy: [{ scope: 'asc' }, { key: 'asc' }],
    });
    const env = await this.db.workspace.findUniqueOrThrow({ where: { id: ws.workspaceId }, select: { activeEnvironment: true } });
    return { activeEnvironment: env.activeEnvironment, variables: rows };
  }

  private async checkUnique(ws: WorkspaceContext, input: z.infer<typeof variableSchema>, excludeId?: string) {
    const where =
      input.scope === 'GLOBAL' ? { scope: 'GLOBAL' as const, organizationId: ws.organizationId, key: input.key }
      : input.scope === 'WORKSPACE' ? { scope: 'WORKSPACE' as const, workspaceId: ws.workspaceId, key: input.key }
      : input.scope === 'ENVIRONMENT' ? { scope: 'ENVIRONMENT' as const, workspaceId: ws.workspaceId, environment: input.environment, key: input.key }
      : { scope: 'WORKFLOW' as const, workflowId: input.workflowId, key: input.key };
    const dup = await this.db.variable.findFirst({ where: { ...where, ...(excludeId ? { NOT: { id: excludeId } } : {}) } });
    if (dup) throw new BadRequestException(`Variable ${input.key} already exists in this scope`);
  }

  @RequirePermission('variable:manage')
  @Post('variables')
  async create(@Ws() ws: WorkspaceContext, @Body(zbody(variableSchema)) body: z.infer<typeof variableSchema>) {
    if (body.scope === 'GLOBAL' && !ws.permissions.includes('workspace:update')) throw new ForbiddenException('Only admins can create organization-wide variables');
    if (body.scope === 'WORKFLOW') {
      if (!body.workflowId || !(await this.db.workflow.findFirst({ where: { id: body.workflowId, workspaceId: ws.workspaceId } }))) throw new BadRequestException('Select a workflow');
    }
    if (body.scope === 'ENVIRONMENT' && !body.environment) throw new BadRequestException('Environment variables need an environment name');
    await this.checkUnique(ws, body);
    const v = await this.db.variable.create({
      data: {
        scope: body.scope, key: body.key, value: body.value, description: body.description,
        organizationId: body.scope === 'GLOBAL' ? ws.organizationId : null,
        workspaceId: body.scope === 'GLOBAL' ? null : ws.workspaceId,
        workflowId: body.scope === 'WORKFLOW' ? body.workflowId : null,
        environment: body.scope === 'ENVIRONMENT' ? body.environment : null,
      },
    });
    await audit(this.db, { action: 'variable.created', userId: ws.userId, workspaceId: ws.workspaceId, resourceId: v.id, metadata: { key: v.key, scope: v.scope } });
    return v;
  }

  private async findVar(ws: WorkspaceContext, id: string) {
    const v = await this.db.variable.findFirst({ where: { id, OR: [{ workspaceId: ws.workspaceId }, { scope: 'GLOBAL', organizationId: ws.organizationId }] } });
    if (!v) throw new NotFoundException('Variable not found');
    if (v.scope === 'GLOBAL' && !ws.permissions.includes('workspace:update')) throw new ForbiddenException('Only admins can change organization-wide variables');
    return v;
  }

  @RequirePermission('variable:manage')
  @Patch('variables/:id')
  async update(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body(zbody(updateVariable)) body: z.infer<typeof updateVariable>) {
    await this.findVar(ws, id);
    return this.db.variable.update({ where: { id }, data: body });
  }

  @RequirePermission('variable:manage')
  @Delete('variables/:id')
  async remove(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    await this.findVar(ws, id);
    await this.db.variable.delete({ where: { id } });
    return { ok: true };
  }

  // ─── Secrets (values are write-only) ───

  @RequirePermission('variable:read')
  @Get('secrets')
  async secrets(@Ws() ws: WorkspaceContext) {
    return this.db.secret.findMany({ where: { workspaceId: ws.workspaceId }, select: { id: true, key: true, description: true, createdAt: true, updatedAt: true, createdBy: { select: { name: true } } }, orderBy: { key: 'asc' } });
  }

  @RequirePermission('secret:manage')
  @Post('secrets')
  async createSecret(@Ws() ws: WorkspaceContext, @Body(zbody(secretSchema)) body: z.infer<typeof secretSchema>) {
    const s = await this.db.secret.create({ data: { workspaceId: ws.workspaceId, key: body.key, description: body.description, encryptedValue: encrypt(body.value, `secret:${ws.workspaceId}`), createdById: ws.userId } });
    await audit(this.db, { action: 'secret.created', userId: ws.userId, workspaceId: ws.workspaceId, resourceId: s.id, metadata: { key: s.key } });
    return { id: s.id, key: s.key, description: s.description, createdAt: s.createdAt };
  }

  @RequirePermission('secret:manage')
  @Patch('secrets/:id')
  async updateSecret(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body(zbody(updateSecret)) body: z.infer<typeof updateSecret>) {
    const s = await this.db.secret.findFirst({ where: { id, workspaceId: ws.workspaceId } });
    if (!s) throw new NotFoundException('Secret not found');
    await this.db.secret.update({ where: { id }, data: { description: body.description, ...(body.value ? { encryptedValue: encrypt(body.value, `secret:${ws.workspaceId}`) } : {}) } });
    await audit(this.db, { action: 'secret.updated', userId: ws.userId, workspaceId: ws.workspaceId, resourceId: id, metadata: { key: s.key } });
    return { ok: true };
  }

  @RequirePermission('secret:manage')
  @Delete('secrets/:id')
  async removeSecret(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    const r = await this.db.secret.deleteMany({ where: { id, workspaceId: ws.workspaceId } });
    if (!r.count) throw new NotFoundException('Secret not found');
    await audit(this.db, { action: 'secret.deleted', userId: ws.userId, workspaceId: ws.workspaceId, resourceId: id });
    return { ok: true };
  }
}
