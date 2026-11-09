import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '@simplyai/db';
import { loadDraftDefinition, saveDraftDefinition } from '@simplyai/core';
import {
  createWorkflowSchema, listQuerySchema, publishWorkflowSchema, runWorkflowSchema, updateWorkflowSchema, workflowDefinitionSchema,
  type WorkflowDefinition,
} from '@simplyai/shared';
import { RequirePermission, Ws } from '../../common/decorators';
import type { WorkspaceContext } from '../../common/context';
import { zbody, ZodPipe } from '../../common/zod.pipe';
import { paginate, pageResult } from '../../common/pagination';
import { PrismaService } from '../../infra/prisma.service';
import { WorkflowsService } from './workflows.service';

const workflowListQuery = listQuerySchema.extend({
  active: z.enum(['true', 'false']).optional(),
  tag: z.string().max(40).optional(),
  sort: z.enum(['updatedAt', 'name', 'createdAt']).default('updatedAt'),
});
const importSchema = z.object({ name: z.string().min(1).max(150), description: z.string().max(2000).optional(), tags: z.array(z.string()).optional(), definition: workflowDefinitionSchema });

@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly service: WorkflowsService, private readonly prisma: PrismaService) {}

  @RequirePermission('workflow:read')
  @Get()
  async list(@Ws() ws: WorkspaceContext, @Query(new ZodPipe(workflowListQuery)) q: z.infer<typeof workflowListQuery>) {
    const where: Prisma.WorkflowWhereInput = {
      workspaceId: ws.workspaceId, archivedAt: null,
      ...(q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { description: { contains: q.search, mode: 'insensitive' } }] } : {}),
      ...(q.active ? { active: q.active === 'true' } : {}),
      ...(q.tag ? { tags: { has: q.tag } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.workflow.findMany({
        where, orderBy: { [q.sort]: q.sort === 'name' ? 'asc' : 'desc' }, ...paginate(q.page, q.pageSize),
        include: {
          nodes: { select: { type: true } },
          createdBy: { select: { name: true } },
          executions: { take: 1, orderBy: { queuedAt: 'desc' }, select: { id: true, status: true, queuedAt: true } },
          _count: { select: { executions: true } },
        },
      }),
      this.prisma.db.workflow.count({ where }),
    ]);
    const items = rows.map(({ nodes, executions, _count, ...w }) => ({
      ...w, nodeTypes: [...new Set(nodes.map((n) => n.type))], nodeCount: nodes.length, lastExecution: executions[0] ?? null, executionCount: _count.executions,
    }));
    return pageResult(items, total, q.page, q.pageSize);
  }

  @RequirePermission('workflow:read')
  @Get('tags')
  async tags(@Ws() ws: WorkspaceContext) {
    const rows = await this.prisma.db.workflow.findMany({ where: { workspaceId: ws.workspaceId, archivedAt: null }, select: { tags: true } });
    return [...new Set(rows.flatMap((r) => r.tags))].sort();
  }

  @RequirePermission('workflow:create')
  @Post()
  create(@Ws() ws: WorkspaceContext, @Body(zbody(createWorkflowSchema)) body: z.infer<typeof createWorkflowSchema>) {
    return this.service.create(ws, body);
  }

  @RequirePermission('workflow:create')
  @Post('import')
  import(@Ws() ws: WorkspaceContext, @Body(zbody(importSchema)) body: z.infer<typeof importSchema>) {
    return this.service.create(ws, body);
  }

  @RequirePermission('workflow:read')
  @Get(':id')
  detail(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.service.detail(ws, id);
  }

  @RequirePermission('workflow:update')
  @Patch(':id')
  update(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body(zbody(updateWorkflowSchema)) body: z.infer<typeof updateWorkflowSchema>) {
    return this.service.update(ws, id, body);
  }

  @RequirePermission('workflow:delete')
  @Delete(':id')
  async remove(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    await this.service.remove(ws, id);
    return { ok: true };
  }

  @RequirePermission('workflow:create')
  @Post(':id/duplicate')
  duplicate(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.service.duplicate(ws, id);
  }

  @RequirePermission('workflow:read')
  @HttpCode(200)
  @Post(':id/validate')
  async validate(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body() body: { definition?: unknown }) {
    await this.service.get(ws, id);
    const def = body?.definition ? (workflowDefinitionSchema.parse(body.definition) as WorkflowDefinition) : await loadDraftDefinition(this.prisma.db, id);
    return this.service.validate(def);
  }

  @RequirePermission('workflow:read')
  @Get(':id/export')
  async export(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    const wf = await this.service.get(ws, id);
    const definition = await loadDraftDefinition(this.prisma.db, id);
    for (const n of definition.nodes) n.credentialId = null;
    return { name: wf.name, description: wf.description, tags: wf.tags, definition, exportedAt: new Date().toISOString(), format: 'simplyai.workflow.v1' };
  }

  // ─── Versions & activation ───

  @RequirePermission('workflow:read')
  @Get(':id/versions')
  async versions(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    const wf = await this.service.get(ws, id);
    const rows = await this.prisma.db.workflowVersion.findMany({ where: { workflowId: id }, orderBy: { version: 'desc' }, include: { createdBy: { select: { name: true } } }, take: 100 });
    return rows.map(({ definition, ...v }) => ({ ...v, nodeCount: (definition as unknown as WorkflowDefinition).nodes.length, isActive: v.id === wf.activeVersionId }));
  }

  @RequirePermission('workflow:read')
  @Get(':id/versions/:versionId')
  async version(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Param('versionId') versionId: string) {
    await this.service.get(ws, id);
    const v = await this.prisma.db.workflowVersion.findFirst({ where: { id: versionId, workflowId: id } });
    if (!v) throw new NotFoundException('Version not found');
    return v;
  }

  @RequirePermission('workflow:update')
  @HttpCode(200)
  @Post(':id/versions/:versionId/restore')
  async restore(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Param('versionId') versionId: string) {
    await this.service.get(ws, id);
    const v = await this.prisma.db.workflowVersion.findFirst({ where: { id: versionId, workflowId: id } });
    if (!v) throw new NotFoundException('Version not found');
    await this.prisma.db.$transaction((tx) => saveDraftDefinition(tx, id, ws.workspaceId, v.definition as unknown as WorkflowDefinition));
    return this.service.detail(ws, id);
  }

  @RequirePermission('workflow:update')
  @HttpCode(200)
  @Post(':id/publish')
  publish(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body(zbody(publishWorkflowSchema)) body: z.infer<typeof publishWorkflowSchema>) {
    return this.service.publish(ws, id, body.message, body.activate);
  }

  @RequirePermission('workflow:activate')
  @HttpCode(200)
  @Post(':id/activate')
  async activate(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    await this.service.activate(ws, id);
    return this.service.detail(ws, id);
  }

  @RequirePermission('workflow:activate')
  @HttpCode(200)
  @Post(':id/deactivate')
  async deactivate(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    await this.service.deactivate(ws, id);
    return this.service.detail(ws, id);
  }

  @RequirePermission('workflow:execute')
  @Post(':id/run')
  async run(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body(zbody(runWorkflowSchema)) body: z.infer<typeof runWorkflowSchema>) {
    const ex = await this.service.run(ws, id, body, ws.roleKey === 'api' ? 'API' : 'MANUAL');
    return { executionId: ex.id, status: ex.status };
  }
}
