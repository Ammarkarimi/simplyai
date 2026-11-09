import { Prisma } from '@simplyai/db';
import { NodeOperationError, type DataTableFilter } from '@simplyai/sdk';
import { db } from './context';

const MAX_SCAN = 20_000;

function matches(row: Record<string, unknown>, f: DataTableFilter): boolean {
  const v = row[f.column];
  const target = f.value;
  const num = (x: unknown) => (typeof x === 'number' ? x : Number(x));
  switch (f.operator) {
    case 'eq': return String(v ?? '') === String(target ?? '');
    case 'neq': return String(v ?? '') !== String(target ?? '');
    case 'contains': return String(v ?? '').toLowerCase().includes(String(target ?? '').toLowerCase());
    case 'gt': return num(v) > num(target);
    case 'gte': return num(v) >= num(target);
    case 'lt': return num(v) < num(target);
    case 'lte': return num(v) <= num(target);
    case 'isEmpty': return v === null || v === undefined || v === '';
    case 'isNotEmpty': return !(v === null || v === undefined || v === '');
    default: return true;
  }
}

export function dataTableService(workspaceId: string) {
  const table = async (tableId: string) => {
    const t = await db.dataTable.findFirst({ where: { id: tableId, workspaceId }, include: { columns: true } });
    if (!t) throw new NodeOperationError('Data table not found in this workspace');
    return t;
  };
  const clean = (cols: { name: string; type: string }[], data: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const c of cols) {
      if (!(c.name in data)) continue;
      const v = data[c.name];
      if (v === undefined || v === null || v === '') out[c.name] = null;
      else if (c.type === 'NUMBER') {
        const n = Number(v);
        if (Number.isNaN(n)) throw new NodeOperationError(`Column ${c.name} expects a number`);
        out[c.name] = n;
      } else if (c.type === 'BOOLEAN') out[c.name] = v === true || v === 'true' || v === 1 || v === '1';
      else if (c.type === 'JSON') out[c.name] = typeof v === 'string' ? JSON.parse(v) : v;
      else if (c.type === 'DATE') out[c.name] = new Date(v as string).toISOString();
      else out[c.name] = typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
    return out;
  };
  const scan = async (tableId: string, filters: DataTableFilter[]) => {
    const rows = await db.dataTableRow.findMany({ where: { tableId }, orderBy: { createdAt: 'asc' }, take: MAX_SCAN });
    return rows.filter((r) => filters.every((f) => matches(r.data as Record<string, unknown>, f)));
  };
  return {
    async find(tableId: string, filters: DataTableFilter[], options?: { limit?: number }) {
      await table(tableId);
      return (await scan(tableId, filters)).slice(0, options?.limit ?? 100).map((r) => ({ id: r.id, ...(r.data as object), createdAt: r.createdAt.toISOString() }));
    },
    async insert(tableId: string, rows: Array<Record<string, unknown>>) {
      const t = await table(tableId);
      const created = [];
      for (const r of rows) {
        const row = await db.dataTableRow.create({ data: { tableId, data: clean(t.columns, r) as Prisma.InputJsonValue } });
        created.push({ id: row.id, ...(row.data as object) });
      }
      await db.dataTable.update({ where: { id: tableId }, data: { updatedAt: new Date() } });
      return created;
    },
    async update(tableId: string, filters: DataTableFilter[], data: Record<string, unknown>) {
      const t = await table(tableId);
      if (!filters.length) throw new NodeOperationError('Updating requires a filter');
      const rows = await scan(tableId, filters);
      const patch = clean(t.columns, data);
      for (const r of rows) await db.dataTableRow.update({ where: { id: r.id }, data: { data: { ...(r.data as object), ...patch } as Prisma.InputJsonValue } });
      return rows.length;
    },
    async upsert(tableId: string, matchColumn: string, row: Record<string, unknown>) {
      const t = await table(tableId);
      const patch = clean(t.columns, row);
      const [existing] = await scan(tableId, [{ column: matchColumn, operator: 'eq', value: row[matchColumn] }]);
      if (existing) {
        const updated = await db.dataTableRow.update({ where: { id: existing.id }, data: { data: { ...(existing.data as object), ...patch } as Prisma.InputJsonValue } });
        return { id: updated.id, ...(updated.data as object), _action: 'updated' };
      }
      const created = await db.dataTableRow.create({ data: { tableId, data: patch as Prisma.InputJsonValue } });
      return { id: created.id, ...(created.data as object), _action: 'inserted' };
    },
    async delete(tableId: string, filters: DataTableFilter[]) {
      await table(tableId);
      if (!filters.length) throw new NodeOperationError('Deleting requires a filter');
      const rows = await scan(tableId, filters);
      await db.dataTableRow.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
      return rows.length;
    },
  };
}
