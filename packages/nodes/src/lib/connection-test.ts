import { assertHostAllowed } from './net';
import { queryDatabase } from '../nodes/developer/sql';

/** Test non-HTTP credentials (databases, SMTP, IMAP). Returns a status message. */
export async function testConnectionCredential(type: string, d: Record<string, unknown>): Promise<string | null> {
  switch (type) {
    case 'postgres':
    case 'mysql':
      await queryDatabase(type, d, 'SELECT 1 AS ok', []);
      return `Connected to ${String(d.database)}`;
    case 'mongoDb': {
      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(String(d.connectionString), { serverSelectionTimeoutMS: 8000 });
      try {
        await client.connect();
        await client.db(String(d.database)).command({ ping: 1 });
        return 'Connected';
      } finally {
        await client.close().catch(() => undefined);
      }
    }
    case 'redis': {
      await assertHostAllowed(String(d.host));
      const Redis = (await import('ioredis')).default;
      const c = new Redis({ host: String(d.host), port: Number(d.port ?? 6379), password: d.password ? String(d.password) : undefined, db: Number(d.database ?? 0), tls: d.tls ? {} : undefined, lazyConnect: true, connectTimeout: 8000, maxRetriesPerRequest: 0 });
      try {
        await c.connect();
        return `PING → ${await c.ping()}`;
      } finally {
        c.disconnect();
      }
    }
    case 'smtp': {
      await assertHostAllowed(String(d.host));
      const nodemailer = await import('nodemailer');
      const t = nodemailer.createTransport({ host: String(d.host), port: Number(d.port ?? 587), secure: !!d.secure, auth: d.user ? { user: String(d.user), pass: String(d.password ?? '') } : undefined, connectionTimeout: 8000 });
      await t.verify();
      t.close();
      return 'SMTP server accepted the connection';
    }
    case 'imap': {
      await assertHostAllowed(String(d.host));
      const { ImapFlow } = await import('imapflow');
      const c = new ImapFlow({ host: String(d.host), port: Number(d.port ?? 993), secure: d.secure !== false, auth: { user: String(d.user), pass: String(d.password) }, logger: false });
      await c.connect();
      await c.logout();
      return 'Mailbox login succeeded';
    }
    case 'firebaseServiceAccount': {
      const sa = typeof d.serviceAccountJson === 'string' ? JSON.parse(d.serviceAccountJson) : d.serviceAccountJson;
      if (!sa?.private_key || !sa?.client_email || !sa?.project_id) throw new Error('Service account JSON must contain project_id, client_email and private_key');
      return `Service account for project ${sa.project_id}`;
    }
    default:
      return null;
  }
}
