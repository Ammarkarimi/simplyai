# Implementation Roadmap

Status legend: ✅ implemented · 🟡 partial (see notes) · ⏳ planned

## Phase 1 — Foundation
- ✅ Monorepo (pnpm workspaces), strict TypeScript, shared package
- ✅ PostgreSQL schema + migrations (Prisma), seed data
- ✅ Authentication: sign up, login, logout, sessions, CSRF, email verification, password reset, Google OAuth
- ✅ Organizations, workspaces, workspace switching, RBAC
- ✅ Dashboard analytics

## Phase 2 — Workflow builder
- ✅ XYFlow infinite canvas, palette, search, drag & drop, connections
- ✅ Node configuration panel generated from node schemas, expressions, JSON view
- ✅ Undo/redo, copy/paste, multi-select, grouping, sticky-note annotations, minimap
- ✅ Persistence (draft nodes/connections), versions, publish/activate

## Phase 3 — Execution engine
- ✅ BullMQ queues and workers, dependency-ordered + parallel scheduling
- ✅ Branching, switch, merge, loops, wait (in-process & persisted), approvals
- ✅ Retries, timeouts, continue-on-fail, error handler, error workflow
- ✅ Sub-workflows, cancellation, real-time WebSocket events, visual debugger
- ✅ Schedule, webhook, form, chat, polling (email, database) and app-event triggers

## Phase 4 — Integrations
- ✅ HTTP Request / REST / GraphQL with SSRF protection
- ✅ Webhooks management with auth & request history
- ✅ Google (Sheets, Drive, Docs, Calendar, Gmail) via OAuth2
- ✅ Slack, Teams, Discord, Telegram, WhatsApp, Twilio/SMS, SMTP, Outlook
- ✅ Airtable, Notion, HubSpot, Salesforce, Shopify, WooCommerce, WordPress, Stripe, Trello, Asana, Jira
- ✅ PostgreSQL, MySQL, MongoDB, Redis, Supabase, Firebase
- ✅ Integration SDK for custom nodes

## Phase 5 — AI platform
- ✅ Providers: OpenAI, Anthropic, Gemini, custom OpenAI-compatible endpoints
- ✅ Agent Studio + playground, tool calling, memory, human approval
- ✅ Knowledge bases (upload, chunk, embed), vector search, RAG

## Phase 6 — SaaS
- ✅ Team invitations and roles
- ✅ Plans, quotas, usage analytics, Stripe checkout & webhooks, invoices
- ✅ Templates marketplace (public, workspace, private)
- ✅ Admin panel: users, workspaces, plans/limits, usage, health, logs, workers, queues, feature flags

## Phase 7 — Production readiness
- ✅ Unit, integration, API, permission and engine tests (Vitest)
- ✅ End-to-end tests (Playwright) and load test script
- ✅ Docker images, docker-compose, CI workflow
- ✅ Deployment documentation

The checklist above is updated as each phase lands in the repository; any
feature that requires external configuration (OAuth client ids, Stripe keys,
SMTP, LLM API keys) shows a clear "not configured" state in the UI.
