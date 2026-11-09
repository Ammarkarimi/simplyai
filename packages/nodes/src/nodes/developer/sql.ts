import { assertHostAllowed } from '../../lib/net';

type Conn = Record<string, unknown>;

/** Run a parameterized query against PostgreSQL or MySQL using a short-lived connection. */
export async function queryDatabase(kind: 'postgres' | 'mysql', c: Conn, sql: string, params: unknown[], timeoutMs = 30_000): Promise<Record<string, unknown>[]> {
  await assertHostAllowed(String(c.host));
  if (kind === 'postgres') {
    const { Client } = await import('pg');
    const client = new Client({
      host: String(c.host), port: Number(c.port ?? 5432), database: String(c.database), user: String(c.user), password: c.password ? String(c.password) : undefined,
      ssl: c.ssl ? { rejectUnauthorized: false } : undefined, statement_timeout: timeoutMs, connectionTimeoutMillis: 10_000,
    });
    await client.connect();
    try {
      const res = await client.query(sql, params);
      return (res.rows ?? []) as Record<string, unknown>[];
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({
    host: String(c.host), port: Number(c.port ?? 3306), database: String(c.database), user: String(c.user), password: c.password ? String(c.password) : undefined,
    ssl: c.ssl ? {} : undefined, connectTimeout: 10_000,
  });
  try {
    const [rows] = await conn.query({ sql, timeout: timeoutMs }, params);
    if (Array.isArray(rows)) return rows as Record<string, unknown>[];
    const r = rows as { affectedRows?: number; insertId?: number };
    return [{ affectedRows: r.affectedRows, insertId: r.insertId }];
  } finally {
    await conn.end().catch(() => undefined);
  }
}
