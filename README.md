# SimplyAI

**AI-powered workflow automation and integration platform.** Build automations visually, connect 35+ apps, create AI agents with tools and knowledge, and monitor every execution in real time.

![Stack](https://img.shields.io/badge/stack-Next.js%20·%20NestJS%20·%20PostgreSQL%20·%20Redis%20·%20BullMQ-7c3aed)

## Highlights

- **Visual workflow builder** – infinite canvas (XYFlow), drag & drop palette with 82 nodes, expressions, undo/redo, copy/paste, multi-select, groups, sticky notes, minimap, version history, publish/activate.
- **Execution engine** – dependency-ordered and parallel scheduling, If/Switch/Filter/Merge, loops, waits that survive restarts, human approval, sub-workflows, retries with backoff, timeouts, continue-on-fail, error handlers, cancellation.
- **Triggers** – manual, schedule (cron/interval), webhook (auth + HMAC), hosted forms, hosted chat, IMAP email polling, database polling, app events.
- **AI platform** – OpenAI, Anthropic, Gemini and OpenAI-compatible endpoints; Agent Studio with tool calling, memory, knowledge bases (RAG), JSON output schemas, human approval and a playground; 13 AI nodes.
- **Integrations** – Gmail, Outlook, Slack, Teams, Discord, Telegram, WhatsApp, Twilio/SMS, SMTP, Google Sheets/Drive/Docs/Calendar, Airtable, Notion, HubSpot, Salesforce, Shopify, WooCommerce, WordPress, Stripe, Trello, Asana, Jira, PostgreSQL, MySQL, MongoDB, Redis, Supabase, Firebase, HTTP/REST/GraphQL — plus an SDK for custom nodes.
- **Monitoring** – live visual debugger, node-by-node timeline, input/output inspection, stack traces, retry/cancel, dashboard analytics.
- **SaaS** – organizations, workspaces, RBAC (Owner/Admin/Editor/Operator/Viewer + custom roles), invitations, API keys with scopes and rate limits, plans and quotas, Stripe billing, audit log, platform admin panel with health, queues, workers and feature flags.
- **Security** – Argon2id passwords, HttpOnly sessions + CSRF, AES-256-GCM encrypted credentials bound to the workspace, secret redaction in logs, SSRF protection, sandboxed code execution, tenant isolation.

## Architecture

```
apps/web     Next.js 15 UI (React 19, Tailwind, XYFlow, React Query, Zustand)
apps/api     NestJS 11 REST API + socket.io gateway + webhook ingress
apps/worker  BullMQ workers: executions, triggers, agents, document ingestion, sandbox
packages/    shared · db (Prisma) · sdk · engine · nodes · ai · core
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DATABASE.md](docs/DATABASE.md), [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) and [docs/ROADMAP.md](docs/ROADMAP.md).

## Quick start (local development)

Requirements: Node.js 22, pnpm 10, PostgreSQL 16, Redis 7.

```bash
cp .env.example .env
# generate secrets
sed -i "s/^ENCRYPTION_KEY=$/ENCRYPTION_KEY=$(openssl rand -hex 32)/" .env
sed -i "s/^SESSION_SECRET=$/SESSION_SECRET=$(openssl rand -hex 32)/" .env

pnpm install
pnpm build:packages
pnpm db:migrate        # apply migrations
pnpm db:seed           # roles, plans, templates and the demo workspace
pnpm dev               # api :4000, worker, web :3000
```

Open http://localhost:3000 and sign in with **admin@simplyai.dev / SimplyAI-demo1** (platform admin, demo workspace with runnable workflows), or create a new account.

> For local development with webhooks calling services on `localhost`, set `ALLOW_PRIVATE_NETWORK=true`. Keep it `false` in production (SSRF protection).

## Docker

```bash
export ENCRYPTION_KEY=$(openssl rand -hex 32) SESSION_SECRET=$(openssl rand -hex 32)
docker compose up --build
```

This starts PostgreSQL, Redis, MinIO (S3 storage), runs migrations + seed, and launches the API, two workers and the web app. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Testing

```bash
pnpm test        # unit + integration tests (needs PostgreSQL and Redis; uses database simplyai_test)
pnpm test:e2e    # Playwright end-to-end tests against a running stack
pnpm test:load -- --url http://localhost:4000/api/v1/health --duration 30 --concurrency 50
```

| Suite | What it covers |
|---|---|
| `packages/engine`, `packages/nodes` | expression sandbox, branching, merge, loops, parallelism, retries, timeouts, cancellation, waits/resume, approvals, error handlers, transforms |
| `packages/sdk` | SSRF guard, HTTP client, node definitions and validation |
| `packages/ai` | provider adapters, tool-calling agent loop, approvals, embeddings, chunking |
| `apps/api` | authentication, CSRF, RBAC, privilege escalation, tenant isolation, encrypted credentials, API key scopes & rate limits, webhook HMAC auth, quotas |
| `apps/worker` | full execution pipeline, sandbox isolation & limits, credential auth, secret redaction, data tables, sub-workflows, approvals |
| `tests/e2e` | sign-up, login, editor build/save/execute, templates, executions, data tables, credentials |

## Optional integrations

| Feature | Configure |
|---|---|
| Email (verification, password reset, invitations) | `SMTP_*` — without it emails are printed to the API log |
| Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (redirect: `${APP_URL}/api/v1/auth/google/callback`) |
| Payments | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and Stripe price ids on plans (admin panel). Webhook: `${API_URL}/api/v1/billing/stripe/webhook` |
| Object storage | `S3_*` (any S3-compatible service); defaults to local disk |
| OAuth2 app connections | create the OAuth app at the provider with redirect `${APP_URL}/api/v1/oauth2/callback` |

Features that need these show a clear "not configured" state in the UI.

## Documentation

- In-app: **Documentation** in the sidebar (concepts, expressions, triggers, AI, webhooks, API, SDK, searchable node reference)
- [docs/API.md](docs/API.md) — public REST API and authentication
- [docs/SDK.md](docs/SDK.md) — building custom nodes and integrations
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — production deployment and operations
