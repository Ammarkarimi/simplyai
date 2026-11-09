# Database Architecture

The source of truth is [`packages/db/prisma/schema.prisma`](../packages/db/prisma/schema.prisma).
Migrations live in `packages/db/prisma/migrations` and are applied with
`pnpm db:migrate`.

## Entity overview

```
Organization 1─* Workspace 1─* Workflow 1─* WorkflowNode
     │              │              ├─* WorkflowConnection
     │              │              ├─* WorkflowVersion (immutable snapshots)
     │              │              ├─* Execution 1─* NodeExecution
     │              │              ├─* Webhook 1─* WebhookRequest
     │              │              └─* TriggerRegistration
     │              ├─* WorkspaceMember *─1 User
     │              ├─* Role (custom roles; system roles have workspaceId = null)
     │              ├─* Invitation
     │              ├─* Credential (AES-GCM encrypted)
     │              ├─* Agent 1─* AgentConversation 1─* AgentMessage
     │              │     └─* AgentKnowledgeBase *─1 KnowledgeBase 1─* KnowledgeDocument 1─* KnowledgeChunk
     │              ├─* AgentMemory
     │              ├─* DataTable 1─* DataTableColumn / DataTableRow
     │              ├─* Variable (WORKSPACE / WORKFLOW / ENVIRONMENT scope)
     │              ├─* Secret (encrypted)
     │              ├─* Template (workspace-shared or private)
     │              ├─* ApiKey (SHA-256 hashed)
     │              └─* StoredFile
     ├─* OrganizationMember *─1 User
     ├─1 Subscription *─1 Plan
     ├─* Invoice
     ├─* UsageRecord (monthly counters per workspace & metric)
     └─* Variable (GLOBAL scope)

User 1─* Session, VerificationToken
AuditLog, SystemLog, FeatureFlag, Integration (catalog) – platform level
```

## Design notes

* **Normalized workflow graph** – the editable draft is stored in
  `WorkflowNode` / `WorkflowConnection` (unique `(workflowId, nodeKey)` and
  `(workflowId, name)`), so nodes can be queried (e.g. "which workflows use
  the Slack node", "which nodes use this credential" – used before deleting a
  credential). Publishing creates an immutable `WorkflowVersion` snapshot; the
  active version is what triggers run. Every execution stores the exact
  snapshot it executed (`workflowSnapshot`) so history stays accurate after
  edits.
* **Executions** – indexed by `(workspaceId, queuedAt desc)`,
  `(workflowId, queuedAt desc)`, `(workspaceId, status)` and
  `(status, waitUntil)` (resume sweeper). `NodeExecution` is indexed by
  `(executionId, startedAt)` for the timeline.
* **Tenant isolation** – every tenant table has a `workspaceId` foreign key with
  `ON DELETE CASCADE`; services always filter by workspace.
* **Secrets** – `Credential.encryptedData`, `Secret.encryptedValue` and
  `Webhook.encryptedAuth` are AES-256-GCM ciphertexts bound to the workspace
  (AAD). Session tokens, verification tokens, invitation tokens and API keys
  are stored only as SHA-256 hashes.
* **Usage counters** – `UsageRecord` is a monthly counter keyed by
  `(organizationId, workspaceId, metric, period)` and incremented with
  `upsert`, which keeps quota checks O(1).
* **Roles** – permissions are data (`Role.permissions`), seeded from
  `packages/shared/src/rbac.ts`; workspaces can add custom roles.
* **Vectors** – `KnowledgeChunk.embedding` is a `float8[]`; cosine similarity is
  computed in the worker. The column can be migrated to `pgvector` without API
  changes when large knowledge bases are needed.
