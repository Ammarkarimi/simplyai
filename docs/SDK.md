# Node & Integration SDK

Custom nodes depend only on `@simplyai/sdk`. The engine discovers them through a `NodeRegistry`, so new integrations never require engine changes.

## Concepts

| Concept | Helper | Purpose |
|---|---|---|
| Node | `defineNode()` | A trigger or action: description (UI, validation, docs) + `execute()` (or `poll()` for polling triggers). |
| Credential type | `defineCredentialType()` | Fields shown in the credential form, `authenticate()` to sign requests, optional `test()`, OAuth2 settings. |
| Integration | `defineIntegration()` | Marketplace entry grouping nodes and credentials (name, logo, category). |
| REST node builder | `defineRestNode()` (`@simplyai/nodes`) | Declarative operations → HTTP requests, used by most built-in business nodes. |

## A node

```ts
import { defineNode, NodeOperationError } from '@simplyai/sdk';

export const weather = defineNode({
  type: 'acme.weather',          // unique, namespaced
  version: 1,
  displayName: 'Weather',
  description: 'Current weather for a city',
  category: 'developer',         // trigger | logic | transform | ai | communication | business | developer
  icon: 'cloud-sun',             // lucide icon name or an integration key with a brand logo
  color: '#0ea5e9',
  inputs: [{ name: 'main' }],
  outputs: [{ name: 'main' }],
  usableAsTool: true,
  properties: [
    { name: 'city', displayName: 'City', type: 'string', required: true, default: '{{ $json.city }}' },
    { name: 'units', displayName: 'Units', type: 'options', default: 'metric', options: [{ name: 'Metric', value: 'metric' }, { name: 'Imperial', value: 'imperial' }] },
  ],
  docs: 'Returns `{ temperature, conditions }` for each input item.',
  async execute(ctx) {
    const out = [];
    for (let i = 0; i < ctx.getInputItems().length; i++) {
      const city = ctx.getParam<string>('city', i);       // expressions resolved per item
      if (!city) throw new NodeOperationError('City is empty', { itemIndex: i });
      const res = await ctx.http<{ current: { temp: number } }>({ url: 'https://api.example.com/weather', query: { city, units: ctx.getParam('units', i) } });
      out.push({ json: { city, temperature: res.body.current.temp }, pairedItem: i });
    }
    return [out];                                          // one array per output port
  },
});
```

### Execution context (`ctx`)

| Member | Description |
|---|---|
| `getInputItems(port?)`, `inputs` | Items received on each input |
| `getParam(name, itemIndex?, fallback?)` | Parameter with expressions resolved for that item |
| `getRawParam(name)` | Unresolved parameter |
| `getCredential()` / `hasCredential()` | Decrypted credential selected on the node (OAuth tokens refreshed automatically) |
| `http(options)` | SSRF-safe HTTP client (timeouts, size limits, redirect validation) |
| `httpWithAuth(options)` | Same, with the credential's `authenticate()` applied; relative URLs use the credential `baseUrl` |
| `services` | Runtime services: `runSubWorkflow`, `runCode`, `llmChat`, `llmEmbed`, `runAgent`, `memory`, `knowledge`, `dataTables`, `emitEvent`, `recordUsage` |
| `nodeState`, `staticData` | Per-execution node state (loops) and persisted workflow state (cursors) |
| `signal` | `AbortSignal` for cancellation/timeouts — pass it to long operations |
| `continueOnFail`, `logger`, `runIndex`, `execution`, `workflow` | Metadata |

### Control signals

Return instead of items to control the flow:

```ts
return { control: 'wait', kind: 'time', until: new Date(Date.now() + 3_600_000).toISOString() };
return { control: 'wait', kind: 'approval', message: 'Please approve' };
return { control: 'stop', status: 'error', message: 'Invalid order' };
```

### Property types

`string`, `text`, `number`, `boolean`, `options`, `multiOptions`, `json`, `code`, `keyValue`, `fixedCollection` (list of sub-forms), `conditions` (condition builder), `cron`, `workflow`, `agent`, `dataTable`, `knowledgeBase`, `notice`. Use `displayOptions: { show: { operation: ['send'] } }` to show fields conditionally and `dynamicOutputs` to derive output ports from a list parameter (e.g. Switch rules).

## Polling triggers

```ts
defineNode({
  type: 'acme.newOrders', trigger: 'poll', inputs: [], outputs: [{ name: 'main' }], /* … */
  properties: [{ name: 'pollMinutes', displayName: 'Check every (minutes)', type: 'number', default: 5 }],
  async poll(ctx) {
    if (ctx.isFirstPoll) { ctx.state.since = new Date().toISOString(); return null; }   // establish a cursor
    const res = await ctx.httpWithAuth<{ orders: Array<{ id: string; createdAt: string }> }>({ url: '/orders', query: { since: String(ctx.state.since) } });
    if (!res.body.orders.length) return null;
    ctx.state.since = res.body.orders.at(-1)!.createdAt;                              // persisted for the next poll
    return res.body.orders.map((o) => ({ json: o }));
  },
});
```

## Credential types

```ts
defineCredentialType({
  type: 'acmeApi', displayName: 'Acme', authKind: 'apiKey', testable: true, integration: 'acme',
  properties: [{ name: 'apiKey', displayName: 'API key', type: 'string', password: true, required: true }],
  authenticate: (d) => ({ headers: { authorization: `Bearer ${d.apiKey}` }, baseUrl: 'https://api.acme.com/v1' }),
  test: async (d, http) => { await http({ url: 'https://api.acme.com/v1/me', headers: { authorization: `Bearer ${d.apiKey}` } }); },
});
```

OAuth2 types set `authKind: 'oauth2'` and `oauth2: { authorizationUrl, tokenUrl, scopes }`; SimplyAI runs the authorization-code flow, stores tokens encrypted and refreshes them before use.

## Declarative REST nodes

```ts
import { defineRestNode, enc } from '@simplyai/nodes';

export const acme = defineRestNode({
  type: 'acme.tickets', displayName: 'Acme Tickets', description: 'Manage Acme tickets', integration: 'acme', color: '#0ea5e9',
  credentialTypes: ['acmeApi'],
  operations: [
    { value: 'create', name: 'Create ticket', method: 'POST', url: () => '/tickets', body: (p) => ({ title: p('title') }),
      properties: [{ name: 'title', displayName: 'Title', type: 'string', required: true }] },
    { value: 'get', name: 'Get ticket', method: 'GET', url: (p) => `/tickets/${enc(p('id'))}`,
      properties: [{ name: 'id', displayName: 'Ticket ID', type: 'string', required: true, default: '{{ $json.id }}' }] },
  ],
});
```

## Registering

```ts
import { getRegistry } from '@simplyai/core';
getRegistry().use({ nodes: [weather, acme], credentials: [acmeCredential], integrations: [acmeIntegration] });
```

Register the bundle in both `apps/api` (catalog, validation) and `apps/worker` (execution) at startup.

## Testing

```ts
import { testNode } from '@simplyai/sdk';
const out = await testNode(weather, { parameters: { city: 'Paris' }, inputs: [[{ json: {} }]], http: async () => ({ status: 200, statusText: 'OK', headers: {}, url: '', body: { current: { temp: 21 } } }) });
```

For whole workflows, run `new WorkflowEngine({ registry, definition, services, … }).run()` from `@simplyai/engine` (see `packages/nodes/src/engine.test.ts`).
