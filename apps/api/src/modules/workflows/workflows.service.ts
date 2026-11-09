import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@simplyai/db';
import {
  activateTriggers, assertCountLimit, audit, createExecution, deactivateTriggers, getRegistry, loadDraftDefinition, pickTrigger, saveDraftDefinition, syncWebhooks,
} from '@simplyai/core';
import { analyzeWorkflow } from '@simplyai/engine';
import { validateNodeParameters } from '@simplyai/sdk';
import type { Item, WorkflowDefinition, CreateWorkflowInput, UpdateWorkflowInput, RunWorkflowInput } from '@simplyai/shared';
import type { WorkspaceContext } from '../../common/context';
import { PrismaService } from '../../infra/prisma.service';
import { QueuesService } from '../../infra/queues.service';

export interface ValidationReport {
  errors: string[];
  warnings: string[];
  nodes: Record<string, string[]>;
}

@Injectable()
export class WorkflowsService {
  constructor(private readonly prisma: PrismaService, private readonly q: QueuesService) {}

  private get db() {
    return this.prisma.db;
  }

  async get(ws: WorkspaceContext, id: string) {
    const wf = await this.db.workflow.findFirst({ where: { id, workspaceId: ws.workspaceId, archivedAt: null } });
    if (!wf) throw new NotFoundException('Workflow not found');
    return wf;
  }

  validate(def: WorkflowDefinition): ValidationReport {
    const registry = getRegistry();
    const { errors, warnings } = analyzeWorkflow(def, (t) => !!registry.getNode(t)?.trigger);
    const nodes: Record<string, string[]> = {};
    for (const n of def.nodes) {
      const d = registry.getNode(n.type);
      if (!d) {
        nodes[n.id] = [`Unknown node type ${n.type}`];
        errors.push(`"${n.name}" uses an unknown node type`);
        continue;
      }
      const issues = validateNodeParameters(d, n.parameters).map((i) => i.message);
      if (d.credentials?.required && !n.credentialId) issues.push('Select a credential');
      if (issues.length && !n.disabled) nodes[n.id] = issues;
    }
    for (const [id, issues] of Object.entries(nodes)) {
      const n = def.nodes.find((x) => x.id === id)!;
      errors.push(`"${n.name}": ${issues.join(', ')}`);
    }
    return { errors, warnings, nodes };
  }

  async create(ws: WorkspaceContext, input: CreateWorkflowInput) {
    const count = await this.db.workflow.count({ where: { workspaceId: ws.workspaceId, archivedAt: null } });
    await assertCountLimit(this.db, ws.organizationId, 'maxWorkflows', count);
    const def: WorkflowDefinition = input.definition ?? {
      nodes: [{ id: 'trigger', name: 'Manual Trigger', type: 'simplyai.manualTrigger', position: { x: 100, y: 200 }, parameters: {} }],
      connections: [],
    };
    const wf = await this.db.$transaction(async (tx) => {
      const w = await tx.workflow.create({ data: { workspaceId: ws.workspaceId, name: input.name, description: input.description, tags: input.tags ?? [], createdById: ws.userId } });
      await saveDraftDefinition(tx, w.id, ws.workspaceId, def);
      await syncWebhooks(tx, w, def, false);
      return w;
    });
    await audit(this.db, { action: 'workflow.created', userId: ws.userId, workspaceId: ws.workspaceId, resourceType: 'workflow', resourceId: wf.id });
    return wf;
  }

  async update(ws: WorkspaceContext, id: string, input: UpdateWorkflowInput) {
    const wf = await this.get(ws, id);
    await this.db.$transaction(async (tx) => {
      await tx.workflow.update({ where: { id }, data: { name: input.name, description: input.description, tags: input.tags } });
      if (input.definition) {
        await saveDraftDefinition(tx, id, ws.workspaceId, input.definition);
        if (!wf.active) await syncWebhooks(tx, wf, input.definition, false);
      }
    });
    return this.detail(ws, id);
  }

  async detail(ws: WorkspaceContext, id: string) {
    const wf = await this.get(ws, id);
    const [definition, webhooks, activeVersion, lastExecution] = await Promise.all([
      loadDraftDefinition(this.db, id),
      this.db.webhook.findMany({ where: { workflowId: id }, select: { id: true, nodeKey: true, path: true, kind: true, methods: true, active: true, authType: true } }),
      wf.activeVersionId ? this.db.workflowVersion.findUnique({ where: { id: wf.activeVersionId }, select: { id: true, version: true, createdAt: true } }) : null,
      this.db.execution.findFirst({ where: { workflowId: id }, orderBy: { queuedAt: 'desc' }, select: { id: true, status: true, queuedAt: true } }),
    ]);
    return { ...wf, definition, webhooks, activeVersion, lastExecution };
  }

  async publish(ws: WorkspaceContext, id: string, message?: string, activate?: boolean) {
    const wf = await this.get(ws, id);
    const def = await loadDraftDefinition(this.db, id);
    const report = this.validate(def);
    if ((activate || wf.active) && report.errors.length) throw new BadRequestException({ message: `Fix these issues before activating: ${report.errors.join('; ')}`, validation: report });
    const version = await this.db.$transaction(async (tx) => {
      const updated = await tx.workflow.update({ where: { id }, data: { versionCounter: { increment: 1 } } });
      return tx.workflowVersion.create({ data: { workflowId: id, version: updated.versionCounter, definition: def as unknown as Prisma.InputJsonValue, message, createdById: ws.userId } });
    });
    await audit(this.db, { action: 'workflow.published', userId: ws.userId, workspaceId: ws.workspaceId, resourceType: 'workflow', resourceId: id, metadata: { version: version.version } });
    if (activate || wf.active) await this.activateVersion(ws, id, version.id, def, wf.active);
    return { version, validation: report };
  }

  private async activateVersion(ws: WorkspaceContext, id: string, versionId: string, def: WorkflowDefinition, alreadyActive: boolean) {
    if (!alreadyActive) {
      const activeCount = await this.db.workflow.count({ where: { workspaceId: { in: (await this.db.workspace.findMany({ where: { organizationId: ws.organizationId }, select: { id: true } })).map((w) => w.id) }, active: true } });
      await assertCountLimit(this.db, ws.organizationId, 'maxActiveWorkflows', activeCount);
    }
    const registry = getRegistry();
    if (!def.nodes.some((n) => !n.disabled && registry.getNode(n.type)?.trigger && registry.getNode(n.type)?.trigger !== 'manual'))
      throw new BadRequestException('Add a schedule, webhook, form, chat, polling or event trigger before activating. Manual triggers only run from the editor or API.');
    await activateTriggers(this.db, this.q.queues, { id, workspaceId: ws.workspaceId }, def);
    await this.db.workflow.update({ where: { id }, data: { active: true, activeVersionId: versionId } });
    await audit(this.db, { action: 'workflow.activated', userId: ws.userId, workspaceId: ws.workspaceId, resourceType: 'workflow', resourceId: id });
  }

  async activate(ws: WorkspaceContext, id: string) {
    const wf = await this.get(ws, id);
    if (!wf.activeVersionId) return (await this.publish(ws, id, 'Published on activation', true)).version;
    const version = await this.db.workflowVersion.findUniqueOrThrow({ where: { id: wf.activeVersionId } });
    const def = version.definition as unknown as WorkflowDefinition;
    const report = this.validate(def);
    if (report.errors.length) throw new BadRequestException({ message: `Fix these issues before activating: ${report.errors.join('; ')}`, validation: report });
    await this.activateVersion(ws, id, version.id, def, wf.active);
    return version;
  }

  async deactivate(ws: WorkspaceContext, id: string) {
    await this.get(ws, id);
    await deactivateTriggers(this.db, this.q.queues, id);
    await this.db.workflow.update({ where: { id }, data: { active: false } });
    await audit(this.db, { action: 'workflow.deactivated', userId: ws.userId, workspaceId: ws.workspaceId, resourceType: 'workflow', resourceId: id });
  }

  async remove(ws: WorkspaceContext, id: string) {
    await this.get(ws, id);
    await deactivateTriggers(this.db, this.q.queues, id);
    await this.db.workflow.delete({ where: { id } });
    await audit(this.db, { action: 'workflow.deleted', userId: ws.userId, workspaceId: ws.workspaceId, resourceType: 'workflow', resourceId: id });
  }

  async duplicate(ws: WorkspaceContext, id: string) {
    const wf = await this.get(ws, id);
    const def = await loadDraftDefinition(this.db, id);
    for (const n of def.nodes) if (registryTrigger(n.type) && n.parameters.path) n.parameters = { ...n.parameters, path: '' };
    return this.create(ws, { name: `${wf.name} (copy)`, description: wf.description ?? undefined, tags: wf.tags, definition: def });
  }

  async run(ws: WorkspaceContext, id: string, input: RunWorkflowInput, mode: 'MANUAL' | 'API' = 'MANUAL') {
    await this.get(ws, id);
    const def = (input.definition as WorkflowDefinition | undefined) ?? (await loadDraftDefinition(this.db, id));
    const registry = getRegistry();
    const trigger = pickTrigger(def, (t) => registry.getNode(t)?.trigger, input.triggerNodeId);
    if (!trigger) throw new BadRequestException('Add a trigger node to run this workflow');
    let items: Item[] | undefined;
    if (input.inputData !== undefined && input.inputData !== null) {
      const arr = Array.isArray(input.inputData) ? input.inputData : [input.inputData];
      items = arr.map((d) => ({ json: d && typeof d === 'object' ? (d as Record<string, unknown>) : { value: d } }));
    }
    return createExecution(this.db, this.q.queues, {
      workspaceId: ws.workspaceId, workflowId: id, mode, definition: def, triggerNodeId: trigger, destinationNodeId: input.destinationNodeId, items, createdById: ws.userId,
    });
  }
}

function registryTrigger(type: string): boolean {
  const t = getRegistry().getNode(type)?.trigger;
  return t === 'webhook' || t === 'form' || t === 'chat';
}
