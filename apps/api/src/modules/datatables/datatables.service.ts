import { BadRequestException } from '@nestjs/common';
import type { ColumnType, DataTableColumn } from '@simplyai/db';

/** Coerce a value to the column type; throws on invalid input. */
export function coerce(col: Pick<DataTableColumn, 'name' | 'type'>, v: unknown): unknown {
  if (v === undefined || v === null || v === '') return null;
  switch (col.type as ColumnType) {
    case 'NUMBER': {
      const n = Number(v);
      if (Number.isNaN(n)) throw new BadRequestException(`${col.name} must be a number`);
      return n;
    }
    case 'BOOLEAN':
      return v === true || v === 'true' || v === 1 || v === '1' || v === 'yes';
    case 'DATE': {
      const d = new Date(v as string);
      if (Number.isNaN(d.getTime())) throw new BadRequestException(`${col.name} must be a date`);
      return d.toISOString();
    }
    case 'JSON':
      if (typeof v === 'string') {
        try {
          return JSON.parse(v);
        } catch {
          throw new BadRequestException(`${col.name} must be valid JSON`);
        }
      }
      return v;
    default:
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
}

export function normalizeRow(columns: DataTableColumn[], data: Record<string, unknown>, partial = false): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of columns) if (!partial || c.name in data) out[c.name] = coerce(c, data[c.name]);
  return out;
}
