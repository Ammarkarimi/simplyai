import { randomBytes } from 'node:crypto';
import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Job } from 'bullmq';
import { Prisma } from '@simplyai/db';
import { createExecution, loadDraftDefinition, type ExecutionJobResult } from '@simplyai/core';
import { slugify, type AppDefinition, type AppQuery, type Item, type WorkflowDefinition } from '@simplyai/shared';
import { PrismaService } from '../../infra/prisma.service';
import { QueuesService } from '../../infra/queues.service';
import { normalizeRow } from '../datatables/datatables.service';

export interface QueryRunOptions {
  workspaceId: string;
  /** builder preview: runs the saved workflow draft */
  test: boolean;
  userId: string | null;
}

export interface QueryResult {
  data: unknown;
  meta?: Record<string, unknown>;
}

const MAX_ARGS_BYTES = 1_000_000;
const WORKFLOW_TIMEOUT_MS = 60_000;

type Row = { id: string; data: unknown; createdAt: Date; updatedAt: Date };
const flatten = (r: Row) => ({ id: r.id, ...((r.data as Record<string, unknown>) ?? {}), createdAt: r.createdAt, updatedAt: r.updatedAt });

/** Runs app queries on the server from the stored definition. */
@Injectable()
export class AppsService {
  constructor(private readonly prisma: PrismaService, private readonly q: QueuesService) {}

  private get db() {
    return this.prisma.db;
  }

  async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name).slice(0, 40) || 'app';
    for (let i = 0; i < 5; i++) {
      const slug = `${base}-${randomBytes(3).toString('hex')}`;
      if (!(await this.db.app.findUnique({ where: { slug }, select: { id: true } }))) return slug;
    }
    return `app-${randomBytes(8).toString('hex')}`;
  }

  findQuery(def: AppDefinition, queryId: string): AppQuery {
    const query = def.queries.find((x) => x.id === queryId || x.name === queryId);
    if (!query) throw new NotFoundException('Query not found');
    return query;
  }

  async run(query: AppQuery, args: Record<string, unknown>, opts: QueryRunOptions): Promise<QueryResult> {
    if (JSON.stringify(args ?? {}).length > MAX_ARGS_BYTES) throw new BadRequestException('Query arguments are too large');
    switch (query.kind) {
      case 'static':
        try {
          return { data: query.staticData ? JSON.parse(query.staticData) : null };
        } catch {
          throw new BadRequestException('Static data is not valid JSON');
        }
      case 'workflow':
        return this.runWorkflow(query, args, opts);
      case 'dataTable':
        return this.runDataTable(query, args, opts);
      default:
        throw new BadRequestException('Unknown query type');
    }
  }

  private async runWorkflow(query: AppQuery, args: Record<string, unknown>, opts: QueryRunOptions): Promise<QueryResult> {
    if (!query.workflowId) throw new BadRequestException(`Select a workflow for the "${query.name}" query`);
    const wf = await this.db.workflow.findFirst({ where: { id: query.workflowId, workspaceId: opts.workspaceId }, include: { activeVersion: true } });
    if (!wf) throw new NotFoundException('The workflow used by this query no longer exists');
    let definition: WorkflowDefinition;
    let versionId: string | null = null;
    if (opts.test) definition = await loadDraftDefinition(this.db, wf.id);
    else {
      if (!wf.active || !wf.activeVersion) throw new UnprocessableEntityException(`Activate the workflow "${wf.name}" to use it from a published app`);
      definition = wf.activeVersion.definition as unknown as WorkflowDefinition;
      versionId = wf.activeVersion.id;
    }
    const trigger = definition.nodes.find((n) => n.type === 'simplyai.appTrigger' && !n.disabled);
    if (!trigger) throw new UnprocessableEntityException(`Add an App Trigger to the workflow "${wf.name}"`);
    const payload = args && typeof args === 'object' && !Array.isArray(args) ? args : { value: args };
    const ex = await createExecution(this.db, this.q.queues, {
      workspaceId: opts.workspaceId, workflowId: wf.id, mode: opts.test ? 'MANUAL' : 'APP', definition, workflowVersionId: versionId,
      triggerNodeId: trigger.id, items: [{ json: payload as Item['json'] }], createdById: opts.userId,
    });
    const result = await this.waitForResult(ex.id);
    if (!result) throw new HttpException({ message: 'The workflow is still running', executionId: ex.id }, HttpStatus.ACCEPTED);
    if (result.status !== 'SUCCESS') throw new UnprocessableEntityException({ message: result.error?.message ?? `Workflow ${result.status.toLowerCase()}`, executionId: ex.id });
    const items = ((result.output as Item[]) ?? []).map((i) => i.json);
    return { data: items.length === 1 ? items[0] : items, meta: { executionId: ex.id, items: items.length } };
  }

  private async waitForResult(executionId: string): Promise<ExecutionJobResult | null> {
    const job = await Job.fromId<{ executionId: string }, ExecutionJobResult>(this.q.queues.executions, executionId);
    if (!job) return null;
    try {
      return await job.waitUntilFinished(this.q.queueEvents('executions'), WORKFLOW_TIMEOUT_MS);
    } catch (err) {
      if (/timed out|before finishing/i.test((err as Error).message)) return null;
      return { status: 'FAILED', output: [], error: { message: (err as Error).message } };
    }
  }

  private async runDataTable(query: AppQuery, args: Record<string, unknown>, opts: QueryRunOptions): Promise<QueryResult> {
    if (!query.tableId) throw new BadRequestException(`Select a data table for the "${query.name}" query`);
    const table = await this.db.dataTable.findFirst({ where: { id: query.tableId, workspaceId: opts.workspaceId }, include: { columns: { orderBy: { position: 'asc' } } } });
    if (!table) throw new NotFoundException('The data table used by this query no longer exists');
    const rowId = args.rowId === undefined || args.rowId === null ? '' : String(args.rowId);
    const data = args.data && typeof args.data === 'object' && !Array.isArray(args.data) ? (args.data as Record<string, unknown>) : {};
    const touch = () => this.db.dataTable.update({ where: { id: table.id }, data: { updatedAt: new Date() } });
    switch (query.operation ?? 'list') {
      case 'list': {
        const page = Math.max(1, Math.floor(Number(args.page) || 1));
        const pageSize = Math.min(500, Math.max(1, Math.floor(Number(args.pageSize) || 100)));
        const conditions: Prisma.Sql[] = [Prisma.sql`"tableId" = ${table.id}`];
        const search = typeof args.search === 'string' ? args.search.trim().slice(0, 200) : '';
        if (search) conditions.push(Prisma.sql`data::text ILIKE ${`%${search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`}`);
        if (args.filters && typeof args.filters === 'object') {
          for (const [k, v] of Object.entries(args.filters as Record<string, unknown>)) {
            if (v === undefined || v === null || v === '' || !table.columns.some((c) => c.name === k)) continue;
            conditions.push(Prisma.sql`data->>${k} = ${String(v)}`);
          }
        }
        const where = Prisma.join(conditions, ' AND ');
        const sortCol = typeof args.sort === 'string' && table.columns.some((c) => c.name === args.sort) ? args.sort : null;
        const dir = args.order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
        const order = sortCol ? Prisma.sql`ORDER BY data->>${sortCol} ${dir} NULLS LAST` : Prisma.sql`ORDER BY "createdAt" ${dir}`;
        const [rows, count] = await Promise.all([
          this.db.$queryRaw<Row[]>`SELECT id, data, "createdAt", "updatedAt" FROM "DataTableRow" WHERE ${where} ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
          this.db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "DataTableRow" WHERE ${where}`,
        ]);
        const total = Number(count[0]?.count ?? 0);
        return { data: rows.map(flatten), meta: { total, page, pageSize, columns: table.columns.map((c) => c.name) } };
      }
      case 'get': {
        const row = await this.db.dataTableRow.findFirst({ where: { id: rowId, tableId: table.id } });
        if (!row) throw new NotFoundException('Row not found');
        return { data: flatten(row) };
      }
      case 'insert': {
        const row = await this.db.dataTableRow.create({ data: { tableId: table.id, data: normalizeRow(table.columns, data) as Prisma.InputJsonValue } });
        await touch();
        return { data: flatten(row) };
      }
      case 'update': {
        const row = await this.db.dataTableRow.findFirst({ where: { id: rowId, tableId: table.id } });
        if (!row) throw new NotFoundException('Row not found');
        const updated = await this.db.dataTableRow.update({ where: { id: row.id }, data: { data: { ...(row.data as object), ...normalizeRow(table.columns, data, true) } as Prisma.InputJsonValue } });
        await touch();
        return { data: flatten(updated) };
      }
      case 'delete': {
        const r = await this.db.dataTableRow.deleteMany({ where: { id: rowId, tableId: table.id } });
        if (!r.count) throw new NotFoundException('Row not found');
        await touch();
        return { data: { id: rowId, deleted: true } };
      }
      default:
        throw new BadRequestException('Unknown data table operation');
    }
  }
}
