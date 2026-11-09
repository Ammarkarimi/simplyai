import { createHmac } from 'node:crypto';
import { defineNode, keyValueToObject, NodeOperationError, parseJsonParam, toItems, type Item, type NodeDefinition, type NodeProperty } from '@simplyai/sdk';
import { assertHostAllowed, assertIdentifier } from '../../lib/net';
import { queryDatabase } from './sql';

const main = [{ name: 'main' }];

const HTTP_AUTH_TYPES = ['httpHeaderAuth', 'httpBearerAuth', 'httpBasicAuth', 'httpQueryAuth', 'oAuth2Api', 'googleOAuth2Api', 'microsoftOAuth2Api', 'restApi'];

const bodyProps: NodeProperty[] = [
  { name: 'bodyType', displayName: 'Body', type: 'options', default: 'json', noExpression: true, displayOptions: { hide: { method: ['GET', 'HEAD'] } }, options: [{ name: 'JSON', value: 'json' }, { name: 'Form URL-encoded', value: 'form' }, { name: 'Raw text', value: 'raw' }, { name: 'None', value: 'none' }] },
  { name: 'jsonBody', displayName: 'JSON body', type: 'json', default: '{\n  "message": "{{ $json.message }}"\n}', displayOptions: { show: { bodyType: ['json'] }, hide: { method: ['GET', 'HEAD'] } } },
  { name: 'formBody', displayName: 'Form fields', type: 'keyValue', default: [], displayOptions: { show: { bodyType: ['form'] }, hide: { method: ['GET', 'HEAD'] } } },
  { name: 'rawBody', displayName: 'Raw body', type: 'text', default: '', displayOptions: { show: { bodyType: ['raw'] }, hide: { method: ['GET', 'HEAD'] } } },
  { name: 'contentType', displayName: 'Content type', type: 'string', default: 'text/plain', displayOptions: { show: { bodyType: ['raw'] }, hide: { method: ['GET', 'HEAD'] } } },
];

function buildBody(ctx: Parameters<NonNullable<NodeDefinition['execute']>>[0], i: number) {
  const method = ctx.getParam<string>('method', i, 'GET');
  if (method === 'GET' || method === 'HEAD') return { body: undefined, headers: {} as Record<string, string> };
  const type = ctx.getParam<string>('bodyType', i, 'json');
  if (type === 'json') return { body: parseJsonParam(ctx.getParam('jsonBody', i), 'JSON body') as never, headers: {} as Record<string, string> };
  if (type === 'form') return { body: keyValueToObject(ctx.getParam('formBody', i)), bodyType: 'form' as const, headers: {} as Record<string, string> };
  if (type === 'raw') return { body: String(ctx.getParam('rawBody', i) ?? ''), headers: { 'content-type': ctx.getParam<string>('contentType', i, 'text/plain') } };
  return { body: undefined, headers: {} as Record<string, string> };
}

export const httpRequestNode = defineNode({
  type: 'simplyai.httpRequest', version: 1, displayName: 'HTTP Request', category: 'developer', subcategory: 'HTTP', icon: 'globe', color: '#f97316',
  description: 'Call any HTTP API', inputs: main, outputs: main, usableAsTool: true,
  credentials: { types: HTTP_AUTH_TYPES, required: false },
  properties: [
    { name: 'method', displayName: 'Method', type: 'options', default: 'GET', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((m) => ({ name: m, value: m })) },
    { name: 'url', displayName: 'URL', type: 'string', default: 'https://api.example.com/items', required: true },
    { name: 'queryParameters', displayName: 'Query parameters', type: 'keyValue', default: [] },
    { name: 'headers', displayName: 'Headers', type: 'keyValue', default: [] },
    ...bodyProps,
    { name: 'responseFormat', displayName: 'Response format', type: 'options', default: 'auto', noExpression: true, options: [{ name: 'Auto detect', value: 'auto' }, { name: 'JSON', value: 'json' }, { name: 'Text', value: 'text' }] },
    { name: 'fullResponse', displayName: 'Include status and headers', type: 'boolean', default: false, noExpression: true },
    { name: 'splitArray', displayName: 'Split array responses into items', type: 'boolean', default: true, noExpression: true },
    { name: 'neverError', displayName: 'Do not fail on 4xx/5xx', type: 'boolean', default: false, noExpression: true },
    { name: 'timeout', displayName: 'Timeout (ms)', type: 'number', default: 30000, min: 100, max: 300000, noExpression: true },
  ],
  docs: 'Requests to private or internal network addresses are blocked unless the platform allows them. Attach a credential to authenticate (header, bearer, basic, query or OAuth2).',
  async execute(ctx) {
    const out: Item[] = [];
    const items = ctx.getInputItems().length ? ctx.getInputItems() : [{ json: {} }];
    for (let i = 0; i < items.length; i++) {
      const { body, headers, bodyType } = buildBody(ctx, i) as { body: unknown; headers: Record<string, string>; bodyType?: 'form' };
      const req = {
        url: ctx.getParam<string>('url', i),
        method: ctx.getParam<string>('method', i, 'GET'),
        query: keyValueToObject(ctx.getParam('queryParameters', i)),
        headers: { ...keyValueToObject(ctx.getParam('headers', i)), ...headers },
        body: body as never,
        bodyType,
        responseType: ctx.getRawParam<'auto' | 'json' | 'text'>('responseFormat'),
        timeoutMs: Number(ctx.getRawParam('timeout') ?? 30000),
        throwOnError: !ctx.getRawParam<boolean>('neverError'),
      };
      const res = ctx.hasCredential() ? await ctx.httpWithAuth(req) : await ctx.http(req);
      if (ctx.getRawParam<boolean>('fullResponse')) out.push({ json: { statusCode: res.status, headers: res.headers, body: res.body as never }, pairedItem: i });
      else if (Array.isArray(res.body) && ctx.getRawParam<boolean>('splitArray') !== false) out.push(...toItems(res.body, i));
      else out.push(...toItems(typeof res.body === 'object' && res.body !== null ? res.body : { data: res.body }, i));
    }
    return [out];
  },
});

export const restApiNode = defineNode({
  type: 'simplyai.restApi', version: 1, displayName: 'REST API', category: 'developer', subcategory: 'HTTP', icon: 'server', color: '#f97316',
  description: 'Call endpoints of a saved REST API connection (base URL + auth)', inputs: main, outputs: main, usableAsTool: true,
  credentials: { types: ['restApi'], required: true },
  properties: [
    { name: 'method', displayName: 'Method', type: 'options', default: 'GET', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ name: m, value: m })) },
    { name: 'path', displayName: 'Path', type: 'string', default: '/resources', required: true, description: 'Appended to the connection base URL' },
    { name: 'queryParameters', displayName: 'Query parameters', type: 'keyValue', default: [] },
    ...bodyProps,
    { name: 'resultPath', displayName: 'Result path', type: 'string', default: '', description: 'Optional field holding the list, e.g. data.items', noExpression: true },
  ],
  async execute(ctx) {
    const { getPath } = await import('@simplyai/sdk');
    const out: Item[] = [];
    const items = ctx.getInputItems().length ? ctx.getInputItems() : [{ json: {} }];
    for (let i = 0; i < items.length; i++) {
      const { body, headers, bodyType } = buildBody(ctx, i) as { body: unknown; headers: Record<string, string>; bodyType?: 'form' };
      const path = ctx.getParam<string>('path', i);
      const res = await ctx.httpWithAuth({ url: path.startsWith('/') ? path : `/${path}`, method: ctx.getParam('method', i), query: keyValueToObject(ctx.getParam('queryParameters', i)), headers, body: body as never, bodyType });
      const rp = ctx.getRawParam<string>('resultPath');
      out.push(...toItems(rp ? getPath(res.body, rp) : res.body, i));
    }
    return [out];
  },
});

export const graphqlNode = defineNode({
  type: 'simplyai.graphql', version: 1, displayName: 'GraphQL', category: 'developer', subcategory: 'HTTP', icon: 'share-2', color: '#e535ab',
  description: 'Run GraphQL queries and mutations', inputs: main, outputs: main, usableAsTool: true,
  credentials: { types: ['httpHeaderAuth', 'httpBearerAuth', 'httpBasicAuth', 'oAuth2Api'], required: false },
  properties: [
    { name: 'endpoint', displayName: 'Endpoint', type: 'string', default: 'https://api.example.com/graphql', required: true },
    { name: 'query', displayName: 'Query', type: 'code', language: 'graphql', default: 'query ($id: ID!) {\n  node(id: $id) { id }\n}', required: true },
    { name: 'variables', displayName: 'Variables (JSON)', type: 'json', default: '{}' },
    { name: 'headers', displayName: 'Headers', type: 'keyValue', default: [] },
  ],
  async execute(ctx) {
    const out: Item[] = [];
    const items = ctx.getInputItems().length ? ctx.getInputItems() : [{ json: {} }];
    for (let i = 0; i < items.length; i++) {
      const req = {
        url: ctx.getParam<string>('endpoint', i), method: 'POST',
        headers: keyValueToObject(ctx.getParam('headers', i)),
        body: { query: ctx.getParam<string>('query', i), variables: parseJsonParam(ctx.getParam('variables', i), 'Variables') ?? {} },
      };
      const res = ctx.hasCredential() ? await ctx.httpWithAuth<{ data?: unknown; errors?: Array<{ message: string }> }>(req) : await ctx.http<{ data?: unknown; errors?: Array<{ message: string }> }>(req);
      if (res.body?.errors?.length && !res.body.data) throw new NodeOperationError(`GraphQL error: ${res.body.errors.map((e) => e.message).join('; ')}`);
      out.push({ json: { data: res.body?.data as never, errors: (res.body?.errors ?? null) as never }, pairedItem: i });
    }
    return [out];
  },
});

export const webhookCallNode = defineNode({
  type: 'simplyai.webhookCall', version: 1, displayName: 'Webhook', category: 'developer', subcategory: 'HTTP', icon: 'send', color: '#f97316',
  description: 'Send a signed outgoing webhook (HMAC-SHA256)', inputs: main, outputs: main,
  properties: [
    { name: 'url', displayName: 'Destination URL', type: 'string', default: '', required: true },
    { name: 'payload', displayName: 'Payload (JSON)', type: 'json', default: '{{ JSON.stringify($json) }}' },
    { name: 'secret', displayName: 'Signing secret', type: 'string', default: '{{ $secrets.WEBHOOK_SECRET }}', description: 'Signature is sent in X-SimplyAI-Signature as sha256=<hex>' },
    { name: 'eventName', displayName: 'Event name header', type: 'string', default: 'simplyai.event' },
  ],
  async execute(ctx) {
    const out: Item[] = [];
    for (let i = 0; i < Math.max(1, ctx.getInputItems().length); i++) {
      const raw = ctx.getParam<unknown>('payload', i);
      const body = typeof raw === 'string' ? raw : JSON.stringify(raw ?? {});
      try { JSON.parse(body); } catch { throw new NodeOperationError('Payload must be valid JSON'); }
      const ts = Math.floor(Date.now() / 1000).toString();
      const secret = ctx.getParam<string>('secret', i);
      const headers: Record<string, string> = { 'content-type': 'application/json', 'x-simplyai-event': ctx.getParam<string>('eventName', i), 'x-simplyai-timestamp': ts };
      if (secret) headers['x-simplyai-signature'] = `sha256=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;
      const res = await ctx.http({ url: ctx.getParam<string>('url', i), method: 'POST', headers, body });
      out.push({ json: { statusCode: res.status, response: res.body as never }, pairedItem: i });
    }
    return [out];
  },
});

const sqlProps = (kind: 'postgres' | 'mysql'): NodeProperty[] => [
  { name: 'operation', displayName: 'Operation', type: 'options', default: 'query', noExpression: true, options: [{ name: 'Execute query', value: 'query' }, { name: 'Insert rows', value: 'insert' }, { name: 'Select rows', value: 'select' }, { name: 'Update rows', value: 'update' }, { name: 'Delete rows', value: 'delete' }] },
  { name: 'query', displayName: 'SQL', type: 'code', language: 'sql', default: kind === 'postgres' ? 'SELECT * FROM users WHERE email = $1' : 'SELECT * FROM users WHERE email = ?', displayOptions: { show: { operation: ['query'] } } },
  { name: 'queryParams', displayName: 'Query parameters (JSON array)', type: 'json', default: '["{{ $json.email }}"]', displayOptions: { show: { operation: ['query'] } }, description: 'Values bound to placeholders — never concatenate input into SQL' },
  { name: 'table', displayName: 'Table', type: 'string', default: '', displayOptions: { hide: { operation: ['query'] } } },
  { name: 'columns', displayName: 'Values (JSON object)', type: 'json', default: '{{ JSON.stringify($json) }}', displayOptions: { show: { operation: ['insert', 'update'] } } },
  { name: 'whereColumn', displayName: 'Where column', type: 'string', default: 'id', displayOptions: { show: { operation: ['update', 'delete', 'select'] } } },
  { name: 'whereValue', displayName: 'Where value (empty = all rows for select)', type: 'string', default: '{{ $json.id }}', displayOptions: { show: { operation: ['update', 'delete', 'select'] } } },
  { name: 'limit', displayName: 'Limit', type: 'number', default: 100, displayOptions: { show: { operation: ['select'] } } },
];

function sqlNode(kind: 'postgres' | 'mysql', displayName: string, color: string) {
  return defineNode({
    type: `simplyai.${kind}`, version: 1, displayName, category: 'developer', subcategory: 'Databases', icon: kind, integration: kind, color,
    description: `Query and modify ${displayName} databases`, inputs: main, outputs: main, usableAsTool: true,
    credentials: { types: [kind], required: true },
    properties: sqlProps(kind),
    docs: 'All values are sent as bound parameters. Table and column names are validated identifiers.',
    async execute(ctx) {
      const cred = (await ctx.getCredential()).data;
      const ph = (n: number) => (kind === 'postgres' ? `$${n}` : '?');
      const out: Item[] = [];
      const items = ctx.getInputItems().length ? ctx.getInputItems() : [{ json: {} }];
      const op = ctx.getRawParam<string>('operation');
      for (let i = 0; i < items.length; i++) {
        let sql: string;
        let params: unknown[];
        if (op === 'query') {
          sql = ctx.getRawParam<string>('query');
          const p = parseJsonParam(ctx.getParam('queryParams', i), 'Query parameters');
          params = Array.isArray(p) ? p : p === undefined ? [] : [p];
        } else {
          const table = assertIdentifier(ctx.getParam<string>('table', i), 'table');
          const values = (parseJsonParam(ctx.getParam('columns', i), 'Values') ?? {}) as Record<string, unknown>;
          const whereCol = ctx.getParam<string>('whereColumn', i);
          const whereVal = ctx.getParam<unknown>('whereValue', i);
          if (op === 'insert') {
            const cols = Object.keys(values).map((c) => assertIdentifier(c, 'column'));
            if (!cols.length) throw new NodeOperationError('No values to insert');
            sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, k) => ph(k + 1)).join(', ')})${kind === 'postgres' ? ' RETURNING *' : ''}`;
            params = cols.map((c) => values[c]);
          } else if (op === 'update') {
            const cols = Object.keys(values).map((c) => assertIdentifier(c, 'column'));
            sql = `UPDATE ${table} SET ${cols.map((c, k) => `${c} = ${ph(k + 1)}`).join(', ')} WHERE ${assertIdentifier(whereCol, 'column')} = ${ph(cols.length + 1)}${kind === 'postgres' ? ' RETURNING *' : ''}`;
            params = [...cols.map((c) => values[c]), whereVal];
          } else if (op === 'delete') {
            sql = `DELETE FROM ${table} WHERE ${assertIdentifier(whereCol, 'column')} = ${ph(1)}`;
            params = [whereVal];
          } else {
            const limit = Math.min(10_000, Number(ctx.getParam('limit', i, 100)));
            if (whereVal === '' || whereVal === undefined || whereVal === null) { sql = `SELECT * FROM ${table} LIMIT ${limit}`; params = []; }
            else { sql = `SELECT * FROM ${table} WHERE ${assertIdentifier(whereCol, 'column')} = ${ph(1)} LIMIT ${limit}`; params = [whereVal]; }
          }
        }
        const rows = await queryDatabase(kind, cred, sql, params);
        if (rows.length) out.push(...rows.map((r) => ({ json: r, pairedItem: i })));
        else out.push({ json: { success: true, rowCount: 0 }, pairedItem: i });
      }
      return [out];
    },
  });
}

export const postgresNode = sqlNode('postgres', 'PostgreSQL', '#336791');
export const mysqlNode = sqlNode('mysql', 'MySQL', '#00758f');

export const mongoNode = defineNode({
  type: 'simplyai.mongodb', version: 1, displayName: 'MongoDB', category: 'developer', subcategory: 'Databases', icon: 'mongodb', integration: 'mongodb', color: '#47a248',
  description: 'Find, insert, update, delete and aggregate documents', inputs: main, outputs: main, usableAsTool: true,
  credentials: { types: ['mongoDb'], required: true },
  properties: [
    { name: 'operation', displayName: 'Operation', type: 'options', default: 'find', noExpression: true, options: ['find', 'insert', 'update', 'delete', 'aggregate'].map((v) => ({ name: v[0]!.toUpperCase() + v.slice(1), value: v })) },
    { name: 'collection', displayName: 'Collection', type: 'string', default: '', required: true },
    { name: 'filter', displayName: 'Filter (JSON)', type: 'json', default: '{}', displayOptions: { show: { operation: ['find', 'update', 'delete'] } } },
    { name: 'document', displayName: 'Document (JSON)', type: 'json', default: '{{ JSON.stringify($json) }}', displayOptions: { show: { operation: ['insert'] } } },
    { name: 'update', displayName: 'Update (JSON)', type: 'json', default: '{ "$set": { "status": "done" } }', displayOptions: { show: { operation: ['update'] } } },
    { name: 'pipeline', displayName: 'Pipeline (JSON array)', type: 'json', default: '[]', displayOptions: { show: { operation: ['aggregate'] } } },
    { name: 'limit', displayName: 'Limit', type: 'number', default: 100, displayOptions: { show: { operation: ['find'] } } },
  ],
  async execute(ctx) {
    const { MongoClient } = await import('mongodb');
    const d = (await ctx.getCredential()).data as Record<string, string>;
    const hosts = (d.connectionString ?? '').replace(/^mongodb(\+srv)?:\/\/([^@]*@)?/, '').split(/[/?]/)[0]!.split(',');
    for (const h of hosts) await assertHostAllowed(h.split(':')[0]!);
    const client = new MongoClient(d.connectionString!, { serverSelectionTimeoutMS: 10_000 });
    await client.connect();
    try {
      const out: Item[] = [];
      const items = ctx.getInputItems().length ? ctx.getInputItems() : [{ json: {} }];
      for (let i = 0; i < items.length; i++) {
        const coll = client.db(d.database).collection(ctx.getParam<string>('collection', i));
        const op = ctx.getRawParam<string>('operation');
        const j = (n: string) => parseJsonParam(ctx.getParam(n, i), n) as Record<string, unknown>;
        if (op === 'find') (await coll.find(j('filter') ?? {}).limit(Number(ctx.getParam('limit', i, 100))).toArray()).forEach((doc) => out.push({ json: JSON.parse(JSON.stringify(doc)), pairedItem: i }));
        else if (op === 'insert') { const r = await coll.insertOne(j('document')); out.push({ json: { insertedId: String(r.insertedId) }, pairedItem: i }); }
        else if (op === 'update') { const r = await coll.updateMany(j('filter') ?? {}, j('update')); out.push({ json: { matched: r.matchedCount, modified: r.modifiedCount }, pairedItem: i }); }
        else if (op === 'delete') { const r = await coll.deleteMany(j('filter') ?? {}); out.push({ json: { deleted: r.deletedCount }, pairedItem: i }); }
        else (await coll.aggregate((parseJsonParam(ctx.getParam('pipeline', i), 'pipeline') as object[]) ?? []).toArray()).forEach((doc) => out.push({ json: JSON.parse(JSON.stringify(doc)), pairedItem: i }));
      }
      return [out];
    } finally {
      await client.close().catch(() => undefined);
    }
  },
});

export const redisNode = defineNode({
  type: 'simplyai.redis', version: 1, displayName: 'Redis', category: 'developer', subcategory: 'Databases', icon: 'redis', integration: 'redis', color: '#dc382d',
  description: 'Get, set, delete, increment keys, push to lists and publish messages', inputs: main, outputs: main, usableAsTool: true,
  credentials: { types: ['redis'], required: true },
  properties: [
    { name: 'operation', displayName: 'Operation', type: 'options', default: 'get', noExpression: true, options: ['get', 'set', 'delete', 'incr', 'lpush', 'rpop', 'publish', 'keys'].map((v) => ({ name: v.toUpperCase(), value: v })) },
    { name: 'key', displayName: 'Key / channel / pattern', type: 'string', default: '', required: true },
    { name: 'value', displayName: 'Value', type: 'string', default: '', displayOptions: { show: { operation: ['set', 'lpush', 'publish'] } } },
    { name: 'ttl', displayName: 'TTL seconds (0 = none)', type: 'number', default: 0, displayOptions: { show: { operation: ['set'] } } },
  ],
  async execute(ctx) {
    const Redis = (await import('ioredis')).default;
    const d = (await ctx.getCredential()).data as Record<string, unknown>;
    await assertHostAllowed(String(d.host));
    const client = new Redis({ host: String(d.host), port: Number(d.port ?? 6379), password: d.password ? String(d.password) : undefined, db: Number(d.database ?? 0), tls: d.tls ? {} : undefined, lazyConnect: true, connectTimeout: 10_000, maxRetriesPerRequest: 1 });
    await client.connect();
    try {
      const out: Item[] = [];
      const items = ctx.getInputItems().length ? ctx.getInputItems() : [{ json: {} }];
      for (let i = 0; i < items.length; i++) {
        const key = ctx.getParam<string>('key', i), value = ctx.getParam<unknown>('value', i);
        const v = typeof value === 'string' ? value : JSON.stringify(value);
        let r: unknown;
        switch (ctx.getRawParam<string>('operation')) {
          case 'get': { const raw = await client.get(key); try { r = raw === null ? null : JSON.parse(raw); } catch { r = raw; } break; }
          case 'set': { const ttl = Number(ctx.getParam('ttl', i, 0)); r = ttl > 0 ? await client.set(key, v, 'EX', ttl) : await client.set(key, v); break; }
          case 'delete': r = await client.del(key); break;
          case 'incr': r = await client.incr(key); break;
          case 'lpush': r = await client.lpush(key, v); break;
          case 'rpop': r = await client.rpop(key); break;
          case 'publish': r = await client.publish(key, v); break;
          case 'keys': r = (await client.scan(0, 'MATCH', key, 'COUNT', 1000))[1]; break;
        }
        out.push({ json: { key, value: r as never }, pairedItem: i });
      }
      return [out];
    } finally {
      client.disconnect();
    }
  },
});

export const executeCodeNode = defineNode({
  type: 'simplyai.executeCode', version: 1, displayName: 'Execute Code', category: 'developer', subcategory: 'Code', icon: 'terminal', color: '#f97316',
  description: 'Run a JavaScript snippet once and output its return value', inputs: main, outputs: main, usableAsTool: true,
  properties: [
    { name: 'code', displayName: 'JavaScript', type: 'code', language: 'javascript', noExpression: true, rows: 12, default: '// Runs once in the sandbox. `items` holds all input items.\nconst total = items.reduce((sum, i) => sum + (Number(i.json.amount) || 0), 0);\nreturn { total, count: items.length };' },
  ],
  async execute(ctx) {
    return [await ctx.services.runCode(ctx.getRawParam<string>('code'), ctx.getInputItems(), { mode: 'all', signal: ctx.signal })];
  },
});

export const emitEventNode = defineNode({
  type: 'simplyai.emitEvent', version: 1, displayName: 'Emit App Event', category: 'developer', subcategory: 'Platform', icon: 'radio', color: '#f97316',
  description: 'Emit an application event that starts workflows using the App Event Trigger', inputs: main, outputs: main,
  properties: [
    { name: 'eventName', displayName: 'Event name', type: 'string', default: 'customer.created', required: true },
    { name: 'payload', displayName: 'Payload (JSON)', type: 'json', default: '{{ JSON.stringify($json) }}' },
  ],
  async execute(ctx) {
    const out: Item[] = [];
    for (let i = 0; i < Math.max(1, ctx.getInputItems().length); i++) {
      const payload = (parseJsonParam(ctx.getParam('payload', i), 'Payload') ?? {}) as Record<string, unknown>;
      const started = await ctx.services.emitEvent(ctx.getParam<string>('eventName', i), payload);
      out.push({ json: { event: ctx.getParam<string>('eventName', i), workflowsTriggered: started }, pairedItem: i });
    }
    return [out];
  },
});

export const dataTableNode = defineNode({
  type: 'simplyai.dataTable', version: 1, displayName: 'Data Table', category: 'developer', subcategory: 'Platform', icon: 'table', color: '#7c3aed',
  description: 'Read and write SimplyAI data tables', inputs: main, outputs: main, usableAsTool: true,
  properties: [
    { name: 'operation', displayName: 'Operation', type: 'options', default: 'insert', noExpression: true, options: [{ name: 'Insert row', value: 'insert' }, { name: 'Find rows', value: 'find' }, { name: 'Update rows', value: 'update' }, { name: 'Upsert row', value: 'upsert' }, { name: 'Delete rows', value: 'delete' }] },
    { name: 'tableId', displayName: 'Table', type: 'dataTable', default: '', required: true },
    { name: 'data', displayName: 'Row data (JSON)', type: 'json', default: '{{ JSON.stringify($json) }}', displayOptions: { show: { operation: ['insert', 'update', 'upsert'] } } },
    { name: 'matchColumn', displayName: 'Match column', type: 'string', default: 'email', displayOptions: { show: { operation: ['upsert'] } } },
    { name: 'filterColumn', displayName: 'Filter column', type: 'string', default: '', displayOptions: { show: { operation: ['find', 'update', 'delete'] } } },
    { name: 'filterOperator', displayName: 'Operator', type: 'options', default: 'eq', displayOptions: { show: { operation: ['find', 'update', 'delete'] } }, options: ['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'isNotEmpty'].map((v) => ({ name: v, value: v })) },
    { name: 'filterValue', displayName: 'Filter value', type: 'string', default: '', displayOptions: { show: { operation: ['find', 'update', 'delete'] } } },
    { name: 'limit', displayName: 'Limit', type: 'number', default: 100, displayOptions: { show: { operation: ['find'] } } },
  ],
  async execute(ctx) {
    const out: Item[] = [];
    const items = ctx.getInputItems().length ? ctx.getInputItems() : [{ json: {} }];
    const op = ctx.getRawParam<string>('operation');
    for (let i = 0; i < items.length; i++) {
      const tableId = ctx.getParam<string>('tableId', i);
      const data = () => (parseJsonParam(ctx.getParam('data', i), 'Row data') ?? {}) as Record<string, unknown>;
      const col = ctx.getParam<string>('filterColumn', i);
      const filters = col ? [{ column: col, operator: ctx.getParam<'eq'>('filterOperator', i, 'eq'), value: ctx.getParam('filterValue', i) }] : [];
      if (op === 'insert') (await ctx.services.dataTables.insert(tableId, [data()])).forEach((r) => out.push({ json: r, pairedItem: i }));
      else if (op === 'find') (await ctx.services.dataTables.find(tableId, filters, { limit: Number(ctx.getParam('limit', i, 100)) })).forEach((r) => out.push({ json: r, pairedItem: i }));
      else if (op === 'update') out.push({ json: { updated: await ctx.services.dataTables.update(tableId, filters, data()) }, pairedItem: i });
      else if (op === 'upsert') out.push({ json: await ctx.services.dataTables.upsert(tableId, ctx.getParam<string>('matchColumn', i), data()), pairedItem: i });
      else out.push({ json: { deleted: await ctx.services.dataTables.delete(tableId, filters) }, pairedItem: i });
    }
    return [out];
  },
});

export { supabaseNode, firebaseNode } from './hosted';

import { supabaseNode, firebaseNode } from './hosted';
export const developerNodes: NodeDefinition[] = [
  httpRequestNode, restApiNode, graphqlNode, webhookCallNode, postgresNode, mysqlNode, mongoNode, redisNode, supabaseNode, firebaseNode, executeCodeNode, emitEventNode, dataTableNode,
];
