# Deployment & Operations

## Components

| Service | Command | Scales | Notes |
|---|---|---|---|
| `api` | `node apps/api/dist/main.js` | horizontally (stateless) | Public entry point: REST, WebSocket (`/socket.io`), webhooks (`/webhook/*`). Put it behind a TLS-terminating proxy. |
| `worker` | `node apps/worker/dist/main.js` | horizontally | Runs executions, schedules/polls, agents, document ingestion. Concurrency per process: `WORKER_CONCURRENCY`. |
| `web` | `next start` in `apps/web` | horizontally | Proxies `/api/v1/*` to `API_INTERNAL_URL` (build-time). Browser WebSocket goes to `NEXT_PUBLIC_WS_URL`. |
| `migrate` | `prisma migrate deploy && node dist/seed/run.js` | once per release | Seed is idempotent (roles, plans, templates; demo data unless `SEED_DEMO=false`). |
| PostgreSQL 16 | | | System of record. |
| Redis 7 | | | Queues, pub/sub, rate limits, cancellation, heartbeats. Enable persistence (AOF). |
| S3-compatible storage | | | Knowledge base documents. Falls back to `STORAGE_LOCAL_DIR`. |

## Docker Compose

```bash
export ENCRYPTION_KEY=$(openssl rand -hex 32) SESSION_SECRET=$(openssl rand -hex 32)
export APP_URL=https://app.example.com API_URL=https://api.example.com
docker compose up -d --build
```

Images are built from `docker/Dockerfile` targets `api`, `worker`, `web`, `migrate`. `NEXT_PUBLIC_WS_URL` and `API_INTERNAL_URL` are baked into the web build (build args).

## Production checklist

- **Secrets**: generate unique `ENCRYPTION_KEY` (32 bytes) and `SESSION_SECRET`. Back up `ENCRYPTION_KEY` — credentials cannot be decrypted without it.
- **HTTPS**: serve `APP_URL` and `API_URL` over TLS; session cookies become `Secure` automatically for `https` URLs.
- **Same-site cookies**: the browser calls the API through the web app (`/api/v1` rewrite), so cookies stay first-party. Expose the API domain publicly only for webhooks, OAuth callbacks hit `APP_URL`.
- **SSRF**: keep `ALLOW_PRIVATE_NETWORK=false`. If workflows must reach internal services, run dedicated workers in a network segment and document the exception.
- **Code sandbox**: user code runs in a child process with no environment variables, no `require`, `eval` disabled, memory (`CODE_SANDBOX_MEMORY_MB`) and time (`CODE_SANDBOX_TIMEOUT_MS`) limits, and Node's permission model when available. For hostile multi-tenant workloads also run workers in a hardened container (gVisor / Kata, read-only root FS, no egress to internal networks).
- **Email**: configure `SMTP_*` for verification, password reset and invitations.
- **Platform admins**: users whose email is listed in `PLATFORM_ADMIN_EMAILS` become platform admins on sign-in.
- **Backups**: PostgreSQL (PITR), Redis AOF (queue state), object storage.
- **Retention**: a maintenance job runs every 5 minutes: resumes overdue waits, deletes finished executions older than the plan's `executionRetentionDays`, purges expired sessions and old system logs.

## Scaling

- Add worker replicas for throughput; BullMQ distributes jobs. Queues: `executions`, `triggers`, `agents`, `ingest`.
- Schedules are BullMQ job schedulers (deduplicated across workers); polling triggers take a Redis lock per trigger.
- API instances share Redis pub/sub for realtime events, so any instance can serve any socket.
- Large outputs are truncated before persistence (`EXECUTION_MAX_PAYLOAD_BYTES`).

## Monitoring

- `GET /api/v1/health` — DB and Redis connectivity (for load balancers).
- Admin panel → **Overview** (API, DB, Redis, workers, stuck executions), **Workers & queues** (job counts, failed jobs, retry/clean), **Logs** (system and audit logs).
- Workers log JSON lines to stdout; ship them to your log platform.

## Upgrades

1. Build new images.
2. Run the `migrate` target (migrations are forward-only).
3. Roll the API, then workers, then web. Workers finish in-flight jobs on `SIGTERM`; waiting executions are persisted and resume on any worker.
