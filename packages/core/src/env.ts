import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

let loaded = false;
/** Load the repository root .env (and the current directory .env) once. */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  const candidates = [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../../.env'), path.resolve(__dirname, '../../../.env')];
  for (const file of candidates) if (fs.existsSync(file)) dotenv.config({ path: file, override: false });
}
loadEnv();

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const env = {
  get nodeEnv() { return process.env.NODE_ENV ?? 'development'; },
  get isProd() { return process.env.NODE_ENV === 'production'; },
  get appUrl() { return (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, ''); },
  get apiUrl() { return (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, ''); },
  get apiPort() { return Number(process.env.API_PORT ?? process.env.PORT ?? 4000); },
  get redisUrl() { return process.env.REDIS_URL ?? 'redis://localhost:6379'; },
  get sessionSecret() { return required('SESSION_SECRET'); },
  get workerConcurrency() { return Number(process.env.WORKER_CONCURRENCY ?? 10); },
  get maxPayloadBytes() { return Number(process.env.EXECUTION_MAX_PAYLOAD_BYTES ?? 1_048_576); },
  get sandboxTimeoutMs() { return Number(process.env.CODE_SANDBOX_TIMEOUT_MS ?? 10_000); },
  get sandboxMemoryMb() { return Number(process.env.CODE_SANDBOX_MEMORY_MB ?? 128); },
  get googleClientId() { return process.env.GOOGLE_CLIENT_ID ?? ''; },
  get googleClientSecret() { return process.env.GOOGLE_CLIENT_SECRET ?? ''; },
  get stripeSecretKey() { return process.env.STRIPE_SECRET_KEY ?? ''; },
  get stripeWebhookSecret() { return process.env.STRIPE_WEBHOOK_SECRET ?? ''; },
  get platformAdminEmails() { return (process.env.PLATFORM_ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean); },
};
