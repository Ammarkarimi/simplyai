# Public REST API

Base URL: `${API_URL}/api/v1` · OpenAPI 3.1: `GET /api/v1/openapi.json`

## Authentication

Create an API key in **Settings → API keys**. Keys look like `sai_…`, are stored hashed, belong to one workspace and carry scopes:

| Scope | Allows |
|---|---|
| `workflows:read` | list and read workflows |
| `workflows:write` | create, update, delete, publish, activate workflows |
| `workflows:execute` | run workflows |
| `executions:read` | list and read executions |
| `executions:write` | retry, cancel, approve, delete executions |
| `events:write` | emit app events |

Send it as `Authorization: Bearer sai_…` (or `x-api-key`). Each key has a per-minute rate limit; responses include `x-ratelimit-limit` / `x-ratelimit-remaining` and `429` when exceeded.

The web app uses the same endpoints with a session cookie, an `x-workspace-id` header and an `x-csrf-token` header for mutations.

## Errors

```json
{ "statusCode": 400, "message": "name: Required", "issues": [{ "path": "name", "message": "Required" }] }
```

`401` unauthenticated · `403` missing permission/scope · `404` not found (also for resources in other workspaces) · `402` plan quota exceeded (`code: QUOTA_EXCEEDED`) · `409` conflict · `429` rate limited.

## Main endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/workflows?search=&active=&tag=&page=&pageSize=` | List workflows |
| POST | `/workflows` | Create `{ name, description?, tags?, definition? }` |
| GET | `/workflows/:id` | Workflow with draft definition, webhooks and active version |
| PATCH | `/workflows/:id` | Update name/tags/definition |
| DELETE | `/workflows/:id` | Delete |
| POST | `/workflows/:id/publish` | `{ message?, activate? }` → new version |
| POST | `/workflows/:id/activate` / `deactivate` | Toggle triggers |
| POST | `/workflows/:id/run` | `{ inputData?, triggerNodeId?, destinationNodeId? }` → `{ executionId }` |
| GET | `/workflows/:id/versions` | Version history |
| GET | `/workflows/:id/export` · POST `/workflows/import` | JSON export / import |
| GET | `/executions?status=&workflowId=&from=&to=` | List executions |
| GET | `/executions/:id` | Execution with node executions (inputs, outputs, errors, timing) |
| POST | `/executions/:id/retry` | `{ useLatestVersion? }` |
| POST | `/executions/:id/cancel` | Cancel queued/running/waiting |
| POST | `/executions/:id/approve` | `{ approved, comment? }` for Human Approval steps |
| POST | `/events` | `{ event, payload }` → starts workflows with a matching App Event Trigger |

## Workflow definition format

```json
{
  "nodes": [
    { "id": "t", "name": "Start", "type": "simplyai.manualTrigger", "position": { "x": 0, "y": 0 }, "parameters": {} },
    { "id": "h", "name": "Call API", "type": "simplyai.httpRequest", "position": { "x": 260, "y": 0 },
      "parameters": { "method": "GET", "url": "https://api.example.com/items/{{ $json.id }}" },
      "credentialId": null, "settings": { "retry": { "enabled": true, "maxTries": 3, "waitBetweenMs": 1000 } } }
  ],
  "connections": [{ "source": "t", "sourceOutput": 0, "target": "h", "targetInput": 0 }],
  "settings": { "timeoutMs": 300000, "errorWorkflowId": null }
}
```

`GET /nodes` returns every node type with its parameter schema; `GET /credential-types` and `GET /integrations` describe credentials and the marketplace.

## Webhooks

`ANY ${API_URL}/webhook/<path>` (active version) and `/webhook-test/<path>` (saved draft). Authentication options: header token, basic auth, or HMAC: `X-SimplyAI-Signature: sha256=<hex HMAC-SHA256 of the raw body>` (GitHub-style `X-Hub-Signature-256` is accepted too). Response is immediate (`{ message, executionId }` or a custom body) or the last node's output (30s, then `202`).

Hosted forms: `GET/POST /api/v1/public/forms/<path>`; hosted chat: `GET/POST /api/v1/public/chat/<path>` with `{ sessionId, message }`.

## Real-time events

Browsers obtain a 60-second token from `GET /auth/ws-token`, connect with socket.io to `${API_URL}` (`auth: { token }`) and emit `subscribe` with `{ workspaceId, executionId? , conversationId? }`. Events: `execution.started`, `node.started`, `node.finished`, `execution.waiting`, `execution.finished`, `agent.step`, `agent.finished`.
