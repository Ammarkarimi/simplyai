# Project Structure

```
simplyai/
├── apps/
│   ├── api/                 NestJS REST + WebSocket API
│   │   └── src/
│   │       ├── common/      guards (auth, RBAC, API keys), pipes (zod), filters, decorators
│   │       ├── infra/       prisma, redis, queues, crypto, mail, storage, events
│   │       └── modules/     auth, workspaces, team, workflows, executions, credentials,
│   │                        integrations, webhooks, agents, knowledge, data-tables,
│   │                        variables, templates, api-keys, billing, usage, admin,
│   │                        dashboard, public-api, realtime, oauth, forms, events
│   ├── worker/              BullMQ consumers: executions, triggers (cron/poll),
│   │   └── src/             agents, ingestion, code sandbox, resume sweeper
│   └── web/                 Next.js app (App Router)
│       └── src/
│           ├── app/         routes: (auth), (app)/…, admin, public forms & chat
│           ├── components/  ui (design system), layout, editor, charts…
│           ├── lib/         api client, hooks, websocket, utils
│           └── stores/      zustand stores (editor, workspace)
├── packages/
│   ├── shared/              types, zod schemas, RBAC, plans, constants
│   ├── db/                  Prisma schema, migrations, seed
│   ├── sdk/                 node & integration SDK, safe HTTP, testing harness
│   ├── engine/              execution engine, expressions, graph analysis
│   ├── ai/                  LLM providers, agent loop, embeddings, chunking
│   └── nodes/               built-in node library and credential types
├── tests/
│   ├── e2e/                 Playwright end-to-end tests
│   └── load/                load test script
├── docker/                  Dockerfiles
├── docker-compose.yml       postgres, redis, minio, api, worker, web
└── docs/                    architecture, database, API, SDK, deployment
```
