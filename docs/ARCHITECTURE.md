# SimplyAI — System Architecture

SimplyAI is a multi-tenant workflow automation platform. Users visually compose
workflows out of nodes (triggers, logic, data transformation, AI, integrations),
and a distributed execution engine runs them reliably with full observability.

## 1. High-level topology

```
                ┌──────────────────────────────────────────────────────────┐
  Browser ─────▶│ apps/web  (Next.js 15, React 19, Tailwind, XYFlow)       │
                │  • App UI, editor, dashboards                            │
                │  • /api/* is rewritten (same-origin) to apps/api         │
                └───────────────┬──────────────────────────────┬───────────┘
                                │ REST (cookie session + CSRF) │ WebSocket (socket.io,
                                ▼                              │  short-lived WS token)
                ┌───────────────────────────────────────────────▼──────────┐
  3rd parties ─▶│ apps/api  (NestJS 11)                                    │
  (webhooks,    │  • Auth, RBAC, tenants, REST + public API (API keys)     │
   OAuth2       │  • Webhook / form / chat ingress, OAuth2 callbacks       │
   callbacks)   │  • Enqueues jobs, never runs user code                   │
                │  • WS gateway relays engine events from Redis pub/sub    │
                └───────┬───────────────────────┬──────────────────────────┘
                        │ Prisma                │ BullMQ (Redis)
                        ▼                       ▼
                ┌───────────────┐      ┌──────────────────────────────────┐
                │ PostgreSQL    │◀─────│ apps/worker (N replicas)         │
                │ (system of    │      │  • Execution engine (packages/   │
                │  record)      │      │    engine) + node library        │
                └───────────────┘      │  • Scheduler (cron / polling)    │
                        ▲              │  • Code sandbox (child process)  │
                        │              │  • AI agent runtime, RAG ingest  │
                ┌───────┴───────┐      └──────────────────────────────────┘
                │ S3 / MinIO or │◀── documents, binary data, exports
                │ local storage │
                └───────────────┘
```

* **apps/web** – presentation only. Talks to the API over REST (React Query) and
  receives real-time execution updates over WebSocket.
* **apps/api** – the only component exposed to the internet. Stateless; scale
  horizontally. Owns authentication, authorization, validation and enqueueing.
* **apps/worker** – consumes queues and executes workflows. Stateless; scale
  horizontally. User-supplied code never runs in the API process; in the
  worker it runs inside an isolated child process with CPU/memory/time limits.
* **PostgreSQL** – all durable state (workflows, versions, executions, node
  executions, credentials (encrypted), billing, audit logs…).
* **Redis** – BullMQ queues, pub/sub for real-time events, rate limiting,
  cancellation signals, worker heartbeats, caching.

## 2. Packages

| Package | Responsibility |
|---|---|
| `packages/shared` | Isomorphic types, zod schemas, RBAC permission matrix, plan definitions, constants. Used by every app. |
| `packages/db` | Prisma schema, migrations, generated client, seed data (plans, roles, templates, demo workspace). |
| `packages/sdk` | The node/integration SDK: `defineNode`, `defineCredentialType`, `defineIntegration`, parameter validation, safe HTTP client (SSRF guard), test harness. Third-party nodes depend only on this. |
| `packages/engine` | Workflow execution engine: graph analysis, dependency-ordered and parallel scheduling, branching, merges, loops, retries, timeouts, wait/resume, cancellation, expression evaluation, secret redaction. Has no knowledge of specific nodes. |
| `packages/nodes` | The built-in node library (triggers, logic, transform, AI, communication, business apps, developer) and credential types, registered through the SDK. |
| `packages/ai` | Provider-agnostic LLM layer (OpenAI, Anthropic, Gemini, OpenAI-compatible custom endpoints): chat, tool calling, embeddings, agent loop, chunking and retrieval. |

The engine receives a `NodeRegistry` and a `RuntimeServices` object
(credentials resolver, sub-workflow runner, sandbox, AI, data tables, storage,
event emitter). This keeps it decoupled: adding a node never requires touching
the engine.

## 3. Request flow examples

### Manual execution from the editor
1. `POST /api/workflows/:id/run` – API checks `workflow:execute`, plan quota,
   snapshots the current definition, creates an `Execution` (status `QUEUED`)
   and enqueues a BullMQ job on `executions`.
2. Worker picks the job, marks the execution `RUNNING`, runs the engine.
3. Each node start/finish is persisted as a `NodeExecution` and published on
   Redis channel `sai:events`.
4. API's WS gateway forwards events to sockets in room `execution:<id>`; the
   editor highlights nodes live (visual debugger).
5. Final status, outputs, error and duration are persisted; usage counters are
   incremented.

### Webhook trigger
`ANY /webhook/:path` → lookup `Webhook` → verify auth (header token, basic,
HMAC-SHA256 signature) → persist `WebhookRequest` → enqueue execution →
respond immediately (`onReceived`) or wait for completion (`lastNode`) with a
configurable timeout.

### Schedules and polling triggers
Activating a workflow registers its triggers (`TriggerRegistration`). Schedule
triggers become BullMQ repeatable jobs (cron, with timezone); polling triggers
(email/IMAP, database) become repeatable poll jobs that persist their cursor
in `Workflow.staticData` and only start executions when new items exist.

### Waiting and human approval
`Wait` nodes either sleep in-process (short waits) or persist the engine state
on the execution (`WAITING`) and schedule a delayed `resume` job. Approval
waits stay `WAITING` until a user approves/rejects through the UI or API.

## 4. Execution engine

* **Data model** – n8n-style items: every connection carries an array of
  `{ json, binary? }` items. Nodes have numbered input and output ports.
* **Scheduling** – nodes reachable from the starting trigger are analysed;
  a node becomes *ready* when every non-back-edge upstream source is settled
  and at least one input received items. All ready nodes run concurrently
  (bounded), giving parallel branches for free; chains run sequentially.
  Nodes whose inputs settle empty are marked *skipped* and propagate
  settlement, which makes `If`/`Switch` + `Merge` patterns correct.
* **Loops** – the `Loop` node owns a body (nodes reachable from its `loop`
  output that lead back to it). Back-edges are excluded from readiness; each
  iteration resets the body state and emits the next batch until `done`.
* **Reliability** – per-node retries (max tries, backoff), per-node and
  per-workflow timeouts with `AbortSignal`, `continueOnFail`, error output,
  in-workflow `Error Handler` trigger, workflow-level error workflow.
* **Cancellation** – `POST /executions/:id/cancel` sets a Redis flag and
  publishes a signal; running nodes are aborted via `AbortSignal`.
* **Expressions** – `{{ $json.email }}`, `{{ $('HTTP Request').item.json.id }}`,
  `$vars`, `$secrets`, `$execution`, `$workflow`, `$now`. Parsed with `jsep`
  and evaluated by a whitelisting interpreter (no `eval`, no prototype access).
* **Secrets** – secret values resolved during execution are redacted from all
  persisted inputs/outputs and logs.

## 5. Security model

| Concern | Implementation |
|---|---|
| Authentication | Argon2id password hashes, DB-backed sessions (hashed tokens) in `HttpOnly; SameSite=Lax` cookies, Google OAuth2, email verification, password reset tokens (hashed, single-use, expiring). |
| CSRF | Double-submit token (`sai_csrf` cookie + `x-csrf-token` header) for cookie-authenticated mutating requests. |
| Authorization | Role table (Owner/Admin/Editor/Operator/Viewer) with permission lists; guards check `workspace membership + permission` on every route; organization roles for billing. |
| Tenant isolation | Every tenant-owned row carries `workspaceId`; all queries are scoped. Credential ciphertexts use the workspace id as AES-GCM additional authenticated data, so a ciphertext cannot be decrypted under another workspace. |
| Secrets at rest | AES-256-GCM (`ENCRYPTION_KEY`), never returned to the frontend, redacted from execution logs. |
| Public API | API keys (`sai_…`, SHA-256 hashed), scopes, per-key rate limits (Redis). |
| Webhooks | Optional header token, basic auth or HMAC-SHA256 signature verification with timing-safe comparison. |
| SSRF | Outbound HTTP from nodes goes through the SDK client, which validates every resolved IP (blocks loopback, private, link-local, metadata ranges) at connect time and on redirects. |
| Code execution | `Code` nodes run in a separate child process with a stripped environment, `vm` context without `require`/`process`, memory cap, wall-clock timeout, output size limit. |
| Input validation | zod schemas on every endpoint; Prisma parameterized queries; React escapes output (no `dangerouslySetInnerHTML` on user content). |
| Audit | `AuditLog` for security-relevant actions (logins, credential changes, member changes, workflow activation…). |
| Resource limits | Workflow timeouts, max items per node output, max payload size, plan quotas. |

## 6. Real-time

Workers publish JSON events to Redis channel `sai:events`. Each API instance
subscribes and forwards to socket.io rooms (`workspace:<id>`, `execution:<id>`).
Clients authenticate the socket with a 60-second signed token obtained from
`GET /api/auth/ws-token`, so the WebSocket can live on a different origin.

## 7. Scaling

* API and workers are stateless; run as many replicas as needed.
* BullMQ distributes jobs; per-worker concurrency is configurable
  (`WORKER_CONCURRENCY`). Separate queues (`executions`, `triggers`, `agents`,
  `ingest`) let operators scale workloads independently.
* Large execution payloads are truncated for storage beyond a configurable
  size; retention is governed by plan (`executionRetentionDays`).
