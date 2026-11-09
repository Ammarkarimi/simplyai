import { Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '@simplyai/db';
import { getRegistry, loadDraftDefinition } from '@simplyai/core';
import { templateSchema, type WorkflowDefinition } from '@simplyai/shared';
import { RequirePermission, Ws } from '../../common/decorators';
import type { WorkspaceContext } from '../../common/context';
import { zbody } from '../../common/zod.pipe';
import { PrismaService } from '../../infra/prisma.service';
import { WorkflowsService } from '../workflows/workflows.service';

const installSchema = z.object({ name: z.string().min(1).max(150).optional() });

@Controller('templates')
export class TemplatesController {
  constructor(private readonly prisma: PrismaService, private readonly workflows: WorkflowsService) {}

  private visible(ws: WorkspaceContext): Prisma.TemplateWhereInput {
    return { OR: [{ visibility: 'PUBLIC' }, { visibility: 'WORKSPACE', workspaceId: ws.workspaceId }, { visibility: 'PRIVATE', workspaceId: ws.workspaceId, createdById: ws.userId ?? '__none__' }] };
  }

  private summarize(def: WorkflowDefinition) {
    const registry = getRegistry();
    const types = [...new Set(def.nodes.map((n) => n.type))];
    return {
      nodeCount: def.nodes.length,
      nodeTypes: types,
      integrations: [...new Set(types.map((t) => registry.getNode(t)?.integration).filter(Boolean))],
      credentialTypes: [...new Set(types.flatMap((t) => registry.getNode(t)?.credentials?.types.slice(0, 1) ?? []))],
    };
  }

  @RequirePermission('workflow:read')
  @Get()
  async list(@Ws() ws: WorkspaceContext, @Query('search') search?: string, @Query('category') category?: string, @Query('scope') scope?: string) {
    const where: Prisma.TemplateWhereInput = {
      AND: [
        this.visible(ws),
        ...(search ? [{ OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { description: { contains: search, mode: 'insensitive' as const } }, { tags: { has: search.toLowerCase() } }] }] : []),
        ...(category ? [{ category }] : []),
        ...(scope === 'public' ? [{ visibility: 'PUBLIC' as const }] : scope === 'team' ? [{ visibility: 'WORKSPACE' as const }] : scope === 'mine' ? [{ createdById: ws.userId ?? '__none__' }] : []),
      ],
    };
    const rows = await this.prisma.db.template.findMany({ where, orderBy: [{ featured: 'desc' }, { installs: 'desc' }, { createdAt: 'desc' }], include: { createdBy: { select: { name: true } } } });
    return rows.map(({ definition, ...t }) => ({ ...t, ...this.summarize(definition as unknown as WorkflowDefinition) }));
  }

  @RequirePermission('workflow:read')
  @Get('categories')
  async categories(@Ws() ws: WorkspaceContext) {
    const rows = await this.prisma.db.template.groupBy({ by: ['category'], where: this.visible(ws), _count: { _all: true } });
    return rows.map((r) => ({ category: r.category, count: r._count._all })).sort((a, b) => a.category.localeCompare(b.category));
  }

  @RequirePermission('workflow:read')
  @Get(':id')
  async get(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    const t = await this.prisma.db.template.findFirst({ where: { AND: [{ id }, this.visible(ws)] }, include: { createdBy: { select: { name: true } } } });
    if (!t) throw new NotFoundException('Template not found');
    return { ...t, ...this.summarize(t.definition as unknown as WorkflowDefinition) };
  }

  @RequirePermission('workflow:create')
  @Post(':id/install')
  async install(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body(zbody(installSchema)) body: z.infer<typeof installSchema>) {
    const t = await this.prisma.db.template.findFirst({ where: { AND: [{ id }, this.visible(ws)] } });
    if (!t) throw new NotFoundException('Template not found');
    const def = JSON.parse(JSON.stringify(t.definition)) as WorkflowDefinition;
    for (const n of def.nodes) {
      n.credentialId = null;
      if (typeof n.parameters.path === 'string') n.parameters.path = '';
    }
    const wf = await this.workflows.create(ws, { name: body.name ?? t.name, description: t.description, tags: t.tags.slice(0, 20), definition: def });
    await this.prisma.db.template.update({ where: { id }, data: { installs: { increment: 1 } } });
    return wf;
  }

  @RequirePermission('template:manage')
  @Post()
  async createFromWorkflow(@Ws() ws: WorkspaceContext, @Body(zbody(templateSchema)) body: z.infer<typeof templateSchema>) {
    const wf = await this.workflows.get(ws, body.workflowId);
    const def = await loadDraftDefinition(this.prisma.db, wf.id);
    for (const n of def.nodes) n.credentialId = null;
    return this.prisma.db.template.create({
      data: {
        workspaceId: ws.workspaceId, createdById: ws.userId, name: body.name, description: body.description, category: body.category,
        tags: body.tags.map((t) => t.toLowerCase()), visibility: body.visibility, definition: def as unknown as Prisma.InputJsonValue,
      },
    });
  }

  @RequirePermission('template:manage')
  @Delete(':id')
  async remove(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    const t = await this.prisma.db.template.findFirst({ where: { id, workspaceId: ws.workspaceId } });
    if (!t) throw new NotFoundException('Template not found');
    if (t.visibility === 'PRIVATE' && t.createdById !== ws.userId) throw new ForbiddenException('Only the author can delete a private template');
    await this.prisma.db.template.delete({ where: { id } });
    return { ok: true };
  }
}
