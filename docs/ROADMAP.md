# Implementation Roadmap & Status

Legend: ✅ implemented and covered by automated tests · ☑️ implemented, verified manually or via the UI · 🔌 implemented, requires external accounts/keys to exercise against the real provider · ⏳ planned

## Phase 1 — Foundation
- ✅ Monorepo (pnpm workspaces), strict TypeScript, shared package
- ✅ PostgreSQL schema (38 models) + migrations (Prisma), idempotent seed
- ✅ Sign up, login, logout, sessions, CSRF, password reset & email verification tokens
- 🔌 Google sign-in (needs `GOOGLE_CLIENT_ID/SECRET`)
- ✅ Organizations, workspaces, workspace switching, RBAC with system and custom roles
- ☑️ Dashboard analytics with date ranges

## Phase 2 — Workflow builder
- ☑️ XYFlow canvas, searchable palette, drag & drop, quick-add from a dangling connection
- ☑️ Schema-driven configuration panel (all property types, credential picker, expressions, raw JSON, docs)
- ☑️ Undo/redo, copy/paste (clipboard), duplicate, multi-select, groups, sticky notes, minimap
- ✅ Draft persistence in normalized tables, immutable versions, publish/activate, restore
- ✅ Browser E2E: build → save → execute → reload

## Phase 3 — Execution engine
- ✅ BullMQ queues and workers; dependency-ordered and parallel scheduling
- ✅ If/Switch/Filter/Merge, loops, in-process and persisted waits, human approval, sub-workflows
- ✅ Retries with backoff, timeouts, continue-on-fail, error output, error handler node, error workflow
- ✅ Cancellation, realtime events (socket.io), visual debugger
- ✅ Schedule, webhook, form, chat, app-event triggers; ☑️ IMAP and database polling triggers
- ✅ Code sandbox (separate process, no env/require/eval, memory & time limits)

## Phase 4 — Integrations
- ✅ HTTP Request / REST / GraphQL with SSRF protection, outgoing signed webhooks
- ✅ Webhook management with header/basic/HMAC auth, response modes and request history
- 🔌 Google (Sheets, Drive, Docs, Calendar, Gmail), Outlook, Teams via OAuth2
- 🔌 Slack, Discord, Telegram, WhatsApp, Twilio, Vonage SMS, SMTP
- 🔌 Airtable, Notion, HubSpot, Salesforce, Shopify, WooCommerce, WordPress, Stripe, Trello, Asana, Jira
- 🔌 PostgreSQL, MySQL, MongoDB, Redis, Supabase, Firebase (connection tests built in)
- ✅ Integration SDK, declarative REST builder, node test harness

Integration nodes call the providers' documented REST APIs; they are exercised by unit tests of the shared machinery but were not run against live third-party accounts in this repository.

## Phase 5 — AI platform
- ✅ Provider layer: OpenAI, Anthropic, Gemini, OpenAI-compatible endpoints (tested with a local compatible server)
- ✅ Agent loop with tool calling, memory and human approval; ☑️ Agent Studio & playground
- ☑️ Knowledge bases: upload (PDF/MD/TXT/CSV/JSON/HTML), chunking, embeddings, vector search, RAG node
- 🔌 Live model calls require provider API keys

## Phase 6 — SaaS
- ✅ Invitations, role changes, privilege-escalation guards
- ✅ Plans, quotas (executions, workflows, members, credentials, AI tokens), usage counters
- 🔌 Stripe checkout, billing portal, webhooks and invoices (needs Stripe keys and price ids)
- ☑️ Templates marketplace (10 public templates, team and private templates)
- ☑️ Admin panel: users, organizations, workspaces, plan limits, usage, health, logs, workers, queues, feature flags, integration toggles

## Phase 7 — Production readiness
- ✅ 84 unit/integration tests across 8 packages, 8 Playwright E2E tests, load test scripts
- ✅ Dockerfile (api, worker, web, migrate) and docker-compose stack with MinIO
- ✅ CI workflow (build, tests, web type-check and build)
- ✅ Deployment, API and SDK documentation

## Next steps
- ⏳ pgvector storage for very large knowledge bases (embeddings currently `float8[]` with in-worker cosine similarity)
- ⏳ SSO (SAML/OIDC) for Enterprise plans
- ⏳ Collaborative editing presence in the workflow editor
- ⏳ Binary file handling nodes (upload/download pipeline through object storage)
