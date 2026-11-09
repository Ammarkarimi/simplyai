import { createSign } from 'node:crypto';
import { defineNode, NodeOperationError, parseJsonParam, type Item } from '@simplyai/sdk';
import { defineRestNode, enc, jsonParam } from '../../lib/rest';

export const supabaseNode = defineRestNode({
  type: 'simplyai.supabase', displayName: 'Supabase', description: 'Select, insert, update and delete rows through the Supabase REST API',
  integration: 'supabase', category: 'developer', subcategory: 'Databases', color: '#3ecf8e', credentialTypes: ['supabaseApi'],
  operations: [
    {
      value: 'select', name: 'Select rows', method: 'GET',
      url: (p) => `/${enc(p('table'))}`,
      query: (p) => ({ select: p('select', '*'), ...(p<string>('filter') ? Object.fromEntries(new URLSearchParams(p<string>('filter'))) : {}), limit: p('limit', 100) }),
      properties: [
        { name: 'table', displayName: 'Table', type: 'string', default: '', required: true },
        { name: 'select', displayName: 'Columns', type: 'string', default: '*' },
        { name: 'filter', displayName: 'Filter (PostgREST)', type: 'string', default: '', placeholder: 'status=eq.active&age=gt.18' },
        { name: 'limit', displayName: 'Limit', type: 'number', default: 100 },
      ],
    },
    {
      value: 'insert', name: 'Insert row', method: 'POST', url: (p) => `/${enc(p('table'))}`, headers: { prefer: 'return=representation' },
      body: (p) => jsonParam(p('data'), 'Data'),
      properties: [
        { name: 'table', displayName: 'Table', type: 'string', default: '', required: true },
        { name: 'data', displayName: 'Row (JSON)', type: 'json', default: '{{ JSON.stringify($json) }}' },
      ],
    },
    {
      value: 'update', name: 'Update rows', method: 'PATCH', headers: { prefer: 'return=representation' },
      url: (p) => `/${enc(p('table'))}?${p<string>('filter')}`,
      body: (p) => jsonParam(p('data'), 'Data'),
      properties: [
        { name: 'table', displayName: 'Table', type: 'string', default: '', required: true },
        { name: 'filter', displayName: 'Filter (PostgREST)', type: 'string', default: 'id=eq.{{ $json.id }}', required: true },
        { name: 'data', displayName: 'Row (JSON)', type: 'json', default: '{}' },
      ],
    },
    {
      value: 'delete', name: 'Delete rows', method: 'DELETE', headers: { prefer: 'return=representation' },
      url: (p) => `/${enc(p('table'))}?${p<string>('filter')}`,
      properties: [
        { name: 'table', displayName: 'Table', type: 'string', default: '', required: true },
        { name: 'filter', displayName: 'Filter (PostgREST)', type: 'string', default: 'id=eq.{{ $json.id }}', required: true },
      ],
    },
  ],
});

interface ServiceAccount { client_email: string; private_key: string; project_id: string }

const tokenCache = new Map<string, { token: string; exp: number }>();

async function googleServiceToken(sa: ServiceAccount, scope: string, http: (o: never) => Promise<{ body: unknown }>): Promise<string> {
  const cacheKey = `${sa.client_email}:${scope}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const res = await http({ url: 'https://oauth2.googleapis.com/token', method: 'POST', bodyType: 'form', body: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` } } as never);
  const body = res.body as { access_token: string; expires_in: number };
  tokenCache.set(cacheKey, { token: body.access_token, exp: Date.now() + body.expires_in * 1000 });
  return body.access_token;
}

/** Firestore REST encodes values as typed objects */
function toFirestore(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestore) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, toFirestore(x)])) } };
}

function fromFirestore(v: Record<string, unknown>): unknown {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return ((v.arrayValue as { values?: Record<string, unknown>[] }).values ?? []).map(fromFirestore);
  if ('mapValue' in v) return docFields((v.mapValue as { fields?: Record<string, Record<string, unknown>> }).fields);
  return v;
}

function docFields(fields: Record<string, Record<string, unknown>> | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields ?? {}).map(([k, x]) => [k, fromFirestore(x)]));
}

function docToJson(doc: { name: string; fields?: Record<string, Record<string, unknown>>; createTime?: string; updateTime?: string }) {
  return { id: doc.name.split('/').pop(), ...docFields(doc.fields), _createTime: doc.createTime, _updateTime: doc.updateTime };
}

export const firebaseNode = defineNode({
  type: 'simplyai.firebase', version: 1, displayName: 'Firebase Firestore', category: 'developer', subcategory: 'Databases', icon: 'firebase', integration: 'firebase', color: '#ffca28',
  description: 'Read and write Cloud Firestore documents', inputs: [{ name: 'main' }], outputs: [{ name: 'main' }], usableAsTool: true,
  credentials: { types: ['firebaseServiceAccount'], required: true },
  properties: [
    { name: 'operation', displayName: 'Operation', type: 'options', default: 'get', noExpression: true, options: [{ name: 'Get document', value: 'get' }, { name: 'List documents', value: 'list' }, { name: 'Create document', value: 'create' }, { name: 'Update document', value: 'update' }, { name: 'Delete document', value: 'delete' }] },
    { name: 'collection', displayName: 'Collection path', type: 'string', default: 'users', required: true },
    { name: 'documentId', displayName: 'Document ID', type: 'string', default: '', displayOptions: { show: { operation: ['get', 'update', 'delete', 'create'] } }, description: 'Leave empty on create for an auto id' },
    { name: 'data', displayName: 'Data (JSON)', type: 'json', default: '{{ JSON.stringify($json) }}', displayOptions: { show: { operation: ['create', 'update'] } } },
    { name: 'limit', displayName: 'Limit', type: 'number', default: 50, displayOptions: { show: { operation: ['list'] } } },
  ],
  async execute(ctx) {
    const raw = (await ctx.getCredential()).data.serviceAccountJson;
    const sa = (typeof raw === 'string' ? JSON.parse(raw) : raw) as ServiceAccount;
    if (!sa?.private_key || !sa.client_email) throw new NodeOperationError('Invalid service account JSON');
    const token = await googleServiceToken(sa, 'https://www.googleapis.com/auth/datastore', ctx.http as never);
    const base = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;
    const headers = { authorization: `Bearer ${token}` };
    const out: Item[] = [];
    const items = ctx.getInputItems().length ? ctx.getInputItems() : [{ json: {} }];
    for (let i = 0; i < items.length; i++) {
      const coll = ctx.getParam<string>('collection', i).split('/').map(encodeURIComponent).join('/');
      const id = ctx.getParam<string>('documentId', i);
      const op = ctx.getRawParam<string>('operation');
      const data = () => (parseJsonParam(ctx.getParam('data', i), 'Data') ?? {}) as Record<string, unknown>;
      const fields = () => Object.fromEntries(Object.entries(data()).map(([k, v]) => [k, toFirestore(v)]));
      if (op === 'get') out.push({ json: docToJson((await ctx.http<never>({ url: `${base}/${coll}/${enc(id)}`, headers })).body), pairedItem: i });
      else if (op === 'list') {
        const r = await ctx.http<{ documents?: never[] }>({ url: `${base}/${coll}`, headers, query: { pageSize: ctx.getParam('limit', i, 50) } });
        (r.body.documents ?? []).forEach((d) => out.push({ json: docToJson(d), pairedItem: i }));
      } else if (op === 'create') out.push({ json: docToJson((await ctx.http<never>({ url: `${base}/${coll}`, method: 'POST', headers, query: id ? { documentId: id } : {}, body: { fields: fields() } })).body), pairedItem: i });
      else if (op === 'update') {
        const f = fields();
        const query = new URLSearchParams(Object.keys(f).map((k): [string, string] => ['updateMask.fieldPaths', k]));
        out.push({ json: docToJson((await ctx.http<never>({ url: `${base}/${coll}/${enc(id)}?${query}`, method: 'PATCH', headers, body: { fields: f } })).body), pairedItem: i });
      } else {
        await ctx.http({ url: `${base}/${coll}/${enc(id)}`, method: 'DELETE', headers });
        out.push({ json: { deleted: true, id }, pairedItem: i });
      }
    }
    return [out];
  },
});
