import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import Papa from 'papaparse';
import { z } from 'zod';
import { Prisma } from '@simplyai/db';
import { dataTableColumnSchema, dataTableQuerySchema, dataTableRowSchema, dataTableSchema } from '@simplyai/shared';
import { RequirePermission, Ws } from '../../common/decorators';
import type { WorkspaceContext } from '../../common/context';
import { zbody, ZodPipe } from '../../common/zod.pipe';
import { pageResult } from '../../common/pagination';
import { PrismaService } from '../../infra/prisma.service';
import { normalizeRow } from './datatables.service';

const updateTable = z.object({ name: dataTableSchema.shape.name.optional(), description: z.string().max(1000).nullable().optional() });
const COLUMN_NAME = /^[A-Za-z_][A-Za-z0-9_ -]{0,63}$/;

@Controller('data-tables')
export class DataTablesController {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.db;
  }

  private async table(ws: WorkspaceContext, id: string) {
    const t = await this.db.dataTable.findFirst({ where: { id, workspaceId: ws.workspaceId }, include: { columns: { orderBy: { position: 'asc' } } } });
    if (!t) throw new NotFoundException('Table not found');
    return t;
  }

  @RequirePermission('datatable:read')
  @Get()
  async list(@Ws() ws: WorkspaceContext) {
    const rows = await this.db.dataTable.findMany({ where: { workspaceId: ws.workspaceId }, include: { columns: { orderBy: { position: 'asc' } }, _count: { select: { rows: true } } }, orderBy: { updatedAt: 'desc' } });
    return rows.map(({ _count, ...t }) => ({ ...t, rowCount: _count.rows }));
  }

  @RequirePermission('datatable:manage')
  @Post()
  async create(@Ws() ws: WorkspaceContext, @Body(zbody(dataTableSchema)) body: z.infer<typeof dataTableSchema>) {
    for (const c of body.columns) if (!COLUMN_NAME.test(c.name)) throw new BadRequestException(`Invalid column name "${c.name}"`);
    if (new Set(body.columns.map((c) => c.name)).size !== body.columns.length) throw new BadRequestException('Column names must be unique');
    return this.db.dataTable.create({
      data: { workspaceId: ws.workspaceId, name: body.name, description: body.description, columns: { create: body.columns.map((c, i) => ({ name: c.name, type: c.type, position: i })) } },
      include: { columns: true },
    });
  }

  @RequirePermission('datatable:read')
  @Get(':id')
  get(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    return this.table(ws, id);
  }

  @RequirePermission('datatable:manage')
  @Patch(':id')
  async update(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body(zbody(updateTable)) body: z.infer<typeof updateTable>) {
    await this.table(ws, id);
    return this.db.dataTable.update({ where: { id }, data: body });
  }

  @RequirePermission('datatable:manage')
  @Delete(':id')
  async remove(@Ws() ws: WorkspaceContext, @Param('id') id: string) {
    await this.table(ws, id);
    await this.db.dataTable.delete({ where: { id } });
    return { ok: true };
  }

  @RequirePermission('datatable:manage')
  @Post(':id/columns')
  async addColumn(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body(zbody(dataTableColumnSchema)) body: z.infer<typeof dataTableColumnSchema>) {
    const t = await this.table(ws, id);
    if (!COLUMN_NAME.test(body.name)) throw new BadRequestException('Invalid column name');
    return this.db.dataTableColumn.create({ data: { tableId: id, name: body.name, type: body.type, position: t.columns.length } });
  }

  @RequirePermission('datatable:manage')
  @Delete(':id/columns/:columnId')
  async removeColumn(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Param('columnId') columnId: string) {
    await this.table(ws, id);
    const col = await this.db.dataTableColumn.findFirst({ where: { id: columnId, tableId: id } });
    if (!col) throw new NotFoundException('Column not found');
    await this.db.$transaction([
      this.db.dataTableColumn.delete({ where: { id: columnId } }),
      this.db.$executeRaw`UPDATE "DataTableRow" SET data = data - ${col.name} WHERE "tableId" = ${id}`,
    ]);
    return { ok: true };
  }

  @RequirePermission('datatable:read')
  @Get(':id/rows')
  async rows(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Query(new ZodPipe(dataTableQuerySchema)) q: z.infer<typeof dataTableQuerySchema>) {
    const t = await this.table(ws, id);
    const conditions: Prisma.Sql[] = [Prisma.sql`"tableId" = ${id}`];
    if (q.search) conditions.push(Prisma.sql`data::text ILIKE ${`%${q.search.replace(/[%_]/g, (m) => `\\${m}`)}%`}`);
    if (q.filterColumn && t.columns.some((c) => c.name === q.filterColumn)) conditions.push(Prisma.sql`data->>${q.filterColumn} = ${q.filterValue ?? ''}`);
    const where = Prisma.join(conditions, ' AND ');
    const sortCol = q.sort && t.columns.some((c) => c.name === q.sort) ? q.sort : null;
    const order = sortCol
      ? Prisma.sql`ORDER BY data->>${sortCol} ${q.order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`} NULLS LAST`
      : Prisma.sql`ORDER BY "createdAt" ${q.order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`}`;
    const offset = (q.page - 1) * q.pageSize;
    const [items, count] = await Promise.all([
      this.db.$queryRaw<Array<{ id: string; data: unknown; createdAt: Date; updatedAt: Date }>>`SELECT id, data, "createdAt", "updatedAt" FROM "DataTableRow" WHERE ${where} ${order} LIMIT ${q.pageSize} OFFSET ${offset}`,
      this.db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "DataTableRow" WHERE ${where}`,
    ]);
    return pageResult(items, Number(count[0]?.count ?? 0), q.page, q.pageSize);
  }

  @RequirePermission('datatable:manage')
  @Post(':id/rows')
  async insert(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Body(zbody(dataTableRowSchema)) body: z.infer<typeof dataTableRowSchema>) {
    const t = await this.table(ws, id);
    const row = await this.db.dataTableRow.create({ data: { tableId: id, data: normalizeRow(t.columns, body.data) as Prisma.InputJsonValue } });
    await this.db.dataTable.update({ where: { id }, data: { updatedAt: new Date() } });
    return row;
  }

  @RequirePermission('datatable:manage')
  @Patch(':id/rows/:rowId')
  async updateRow(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Param('rowId') rowId: string, @Body(zbody(dataTableRowSchema)) body: z.infer<typeof dataTableRowSchema>) {
    const t = await this.table(ws, id);
    const row = await this.db.dataTableRow.findFirst({ where: { id: rowId, tableId: id } });
    if (!row) throw new NotFoundException('Row not found');
    return this.db.dataTableRow.update({ where: { id: rowId }, data: { data: { ...(row.data as object), ...normalizeRow(t.columns, body.data, true) } as Prisma.InputJsonValue } });
  }

  @RequirePermission('datatable:manage')
  @Delete(':id/rows/:rowId')
  async deleteRow(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Param('rowId') rowId: string) {
    await this.table(ws, id);
    const r = await this.db.dataTableRow.deleteMany({ where: { id: rowId, tableId: id } });
    if (!r.count) throw new NotFoundException('Row not found');
    return { ok: true };
  }

  @RequirePermission('datatable:manage')
  @Post(':id/import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async importCsv(@Ws() ws: WorkspaceContext, @Param('id') id: string, @UploadedFile() file: Express.Multer.File | undefined, @Query('createColumns') createColumns?: string) {
    const t = await this.table(ws, id);
    if (!file) throw new BadRequestException('Upload a CSV file in the "file" field');
    const parsed = Papa.parse<Record<string, string>>(file.buffer.toString('utf8').replace(/^﻿/, ''), { header: true, skipEmptyLines: true });
    if (parsed.errors.length && !parsed.data.length) throw new BadRequestException(`CSV error: ${parsed.errors[0]!.message}`);
    let columns = t.columns;
    const headers = (parsed.meta.fields ?? []).filter((h) => COLUMN_NAME.test(h));
    const missing = headers.filter((h) => !columns.some((c) => c.name === h));
    if (missing.length && createColumns !== 'false') {
      await this.db.dataTableColumn.createMany({ data: missing.map((name, i) => ({ tableId: id, name, type: 'TEXT' as const, position: columns.length + i })) });
      columns = (await this.table(ws, id)).columns;
    }
    if (parsed.data.length > 50_000) throw new BadRequestException('CSV imports are limited to 50,000 rows');
    const rows = parsed.data.map((r) => normalizeRow(columns, r));
    for (let i = 0; i < rows.length; i += 1000) {
      await this.db.dataTableRow.createMany({ data: rows.slice(i, i + 1000).map((data) => ({ tableId: id, data: data as Prisma.InputJsonValue })) });
    }
    return { imported: rows.length, columnsCreated: missing.length, skippedErrors: parsed.errors.length };
  }

  @RequirePermission('datatable:read')
  @Get(':id/export')
  async exportCsv(@Ws() ws: WorkspaceContext, @Param('id') id: string, @Res() res: Response) {
    const t = await this.table(ws, id);
    const rows = await this.db.dataTableRow.findMany({ where: { tableId: id }, orderBy: { createdAt: 'asc' }, take: 100_000 });
    const csv = Papa.unparse({ fields: ['id', ...t.columns.map((c) => c.name)], data: rows.map((r) => [r.id, ...t.columns.map((c) => { const v = (r.data as Record<string, unknown>)[c.name]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v; })]) });
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${t.name.replace(/[^\w-]/g, '_')}.csv"`);
    res.send(csv);
  }
}
