import Papa from 'papaparse';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { defineNode, deletePath, getPath, NodeOperationError, setPath, type Item, type NodeDefinition } from '@simplyai/sdk';
import { addToDateSafe } from '../lib/time';

const main = [{ name: 'main' }];
const cloneJson = (j: Record<string, unknown>) => JSON.parse(JSON.stringify(j)) as Record<string, unknown>;

function castValue(value: unknown, type: string): unknown {
  switch (type) {
    case 'number': {
      const n = Number(value);
      if (value === '' || Number.isNaN(n)) throw new NodeOperationError(`"${String(value)}" is not a number`);
      return n;
    }
    case 'boolean':
      return value === true || value === 'true' || value === 1 || value === '1';
    case 'json':
      if (typeof value !== 'string') return value;
      try {
        return JSON.parse(value);
      } catch {
        throw new NodeOperationError(`Value is not valid JSON`);
      }
    case 'string':
      return value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    default:
      return value;
  }
}

export const setVariables = defineNode({
  type: 'simplyai.set', version: 1, displayName: 'Set Variables', category: 'transform', icon: 'pen-line', color: '#16a34a',
  description: 'Set typed fields on each item (supports expressions and nested paths)', inputs: main, outputs: main,
  properties: [
    {
      name: 'assignments', displayName: 'Fields to set', type: 'fixedCollection', default: [{ name: 'status', type: 'string', value: 'processed' }],
      fields: [
        { name: 'name', displayName: 'Name (dot path)', type: 'string', default: '' },
        { name: 'type', displayName: 'Type', type: 'options', default: 'string', options: ['string', 'number', 'boolean', 'json'].map((v) => ({ name: v, value: v })) },
        { name: 'value', displayName: 'Value', type: 'string', default: '' },
      ],
    },
    { name: 'keepOnlySet', displayName: 'Keep only the fields set here', type: 'boolean', default: false, noExpression: true },
  ],
  async execute(ctx) {
    const keepOnly = ctx.getRawParam<boolean>('keepOnlySet');
    return [ctx.getInputItems().map((item, i) => {
      const json = keepOnly ? {} : cloneJson(item.json);
      for (const a of ctx.getParam<Array<{ name: string; type: string; value: unknown }>>('assignments', i) ?? []) {
        if (!a.name) continue;
        setPath(json, a.name, castValue(a.value, a.type));
      }
      return { json, binary: item.binary, pairedItem: i };
    })];
  },
});

export const editFields = defineNode({
  type: 'simplyai.editFields', version: 1, displayName: 'Edit Fields', category: 'transform', icon: 'pencil-ruler', color: '#16a34a',
  description: 'Rename, copy, remove or keep fields', inputs: main, outputs: main,
  properties: [
    {
      name: 'operations', displayName: 'Operations', type: 'fixedCollection', noExpression: true, default: [{ action: 'rename', field: 'old_name', newName: 'newName' }],
      fields: [
        { name: 'action', displayName: 'Action', type: 'options', default: 'rename', options: [{ name: 'Rename', value: 'rename' }, { name: 'Copy', value: 'copy' }, { name: 'Remove', value: 'remove' }, { name: 'Keep only', value: 'keep' }] },
        { name: 'field', displayName: 'Field (dot path)', type: 'string', default: '' },
        { name: 'newName', displayName: 'New name (rename / copy)', type: 'string', default: '' },
      ],
    },
  ],
  async execute(ctx) {
    const ops = ctx.getRawParam<Array<{ action: string; field: string; newName?: string }>>('operations') ?? [];
    return [ctx.getInputItems().map((item, i) => {
      let json = cloneJson(item.json);
      const keep = ops.filter((o) => o.action === 'keep').map((o) => o.field);
      for (const op of ops) {
        if (!op.field) continue;
        const v = getPath(json, op.field);
        if (op.action === 'rename' && op.newName) { deletePath(json, op.field); setPath(json, op.newName, v); }
        if (op.action === 'copy' && op.newName) setPath(json, op.newName, JSON.parse(JSON.stringify(v ?? null)));
        if (op.action === 'remove') deletePath(json, op.field);
      }
      if (keep.length) {
        const kept: Record<string, unknown> = {};
        keep.forEach((k) => setPath(kept, k, getPath(json, k)));
        json = kept;
      }
      return { json, binary: item.binary, pairedItem: i };
    })];
  },
});

export const jsonParser = defineNode({
  type: 'simplyai.jsonParse', version: 1, displayName: 'JSON Parser', category: 'transform', icon: 'braces', color: '#16a34a',
  description: 'Parse a JSON string field into structured data', inputs: main, outputs: main,
  properties: [
    { name: 'field', displayName: 'Source field', type: 'string', default: 'body', required: true, noExpression: true },
    { name: 'target', displayName: 'Target field (empty = replace item)', type: 'string', default: '', noExpression: true },
    { name: 'splitArray', displayName: 'Split arrays into items', type: 'boolean', default: true, noExpression: true },
  ],
  async execute(ctx) {
    const field = ctx.getRawParam<string>('field'), target = ctx.getRawParam<string>('target');
    const split = ctx.getRawParam<boolean>('splitArray');
    const out: Item[] = [];
    ctx.getInputItems().forEach((item, i) => {
      const raw = getPath(item.json, field);
      let parsed: unknown;
      try {
        parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (err) {
        throw new NodeOperationError(`Field "${field}" does not contain valid JSON: ${(err as Error).message}`, { itemIndex: i });
      }
      if (target) {
        const json = cloneJson(item.json);
        setPath(json, target, parsed);
        out.push({ json, pairedItem: i });
      } else if (Array.isArray(parsed) && split) parsed.forEach((p) => out.push({ json: p && typeof p === 'object' ? p : { value: p }, pairedItem: i }));
      else out.push({ json: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { value: parsed }, pairedItem: i });
    });
    return [out];
  },
});

export const jsonFormatter = defineNode({
  type: 'simplyai.jsonFormat', version: 1, displayName: 'JSON Formatter', category: 'transform', icon: 'file-json', color: '#16a34a',
  description: 'Serialize items or a field to a JSON string', inputs: main, outputs: main,
  properties: [
    { name: 'source', displayName: 'Source', type: 'options', default: 'item', noExpression: true, options: [{ name: 'Whole item', value: 'item' }, { name: 'Field', value: 'field' }, { name: 'All items as one array', value: 'all' }] },
    { name: 'field', displayName: 'Field', type: 'string', default: '', noExpression: true, displayOptions: { show: { source: ['field'] } } },
    { name: 'target', displayName: 'Target field', type: 'string', default: 'json', noExpression: true },
    { name: 'indent', displayName: 'Indentation', type: 'number', default: 2, min: 0, max: 8, noExpression: true },
  ],
  async execute(ctx) {
    const src = ctx.getRawParam<string>('source'), target = ctx.getRawParam<string>('target') || 'json';
    const indent = Number(ctx.getRawParam('indent') ?? 2);
    const items = ctx.getInputItems();
    if (src === 'all') return [[{ json: { [target]: JSON.stringify(items.map((i) => i.json), null, indent) } }]];
    return [items.map((item, i) => {
      const value = src === 'field' ? getPath(item.json, ctx.getRawParam<string>('field')) : item.json;
      return { json: { ...item.json, [target]: JSON.stringify(value, null, indent) }, pairedItem: i };
    })];
  },
});

export const csvParser = defineNode({
  type: 'simplyai.csvParse', version: 1, displayName: 'CSV Parser', category: 'transform', icon: 'sheet', color: '#16a34a',
  description: 'Convert CSV text into items, or items into CSV', inputs: main, outputs: main,
  properties: [
    { name: 'operation', displayName: 'Operation', type: 'options', default: 'parse', noExpression: true, options: [{ name: 'CSV → items', value: 'parse' }, { name: 'Items → CSV', value: 'generate' }] },
    { name: 'field', displayName: 'Field with CSV text', type: 'string', default: 'csv', noExpression: true, displayOptions: { show: { operation: ['parse'] } } },
    { name: 'delimiter', displayName: 'Delimiter', type: 'string', default: ',', noExpression: true },
    { name: 'header', displayName: 'First row is header', type: 'boolean', default: true, noExpression: true },
    { name: 'target', displayName: 'Target field', type: 'string', default: 'csv', noExpression: true, displayOptions: { show: { operation: ['generate'] } } },
  ],
  async execute(ctx) {
    const delimiter = ctx.getRawParam<string>('delimiter') || ',';
    const header = ctx.getRawParam<boolean>('header') !== false;
    if (ctx.getRawParam('operation') === 'generate') {
      const csv = Papa.unparse(ctx.getInputItems().map((i) => i.json), { delimiter, header });
      return [[{ json: { [ctx.getRawParam<string>('target') || 'csv']: csv } }]];
    }
    const field = ctx.getRawParam<string>('field');
    const out: Item[] = [];
    ctx.getInputItems().forEach((item, i) => {
      let text = getPath(item.json, field);
      if (text === undefined && item.binary?.[field]?.data) text = Buffer.from(item.binary[field]!.data!, 'base64').toString('utf8');
      if (typeof text !== 'string') throw new NodeOperationError(`Field "${field}" does not contain CSV text`, { itemIndex: i });
      const parsed = Papa.parse(text.trim(), { delimiter, header, skipEmptyLines: true, dynamicTyping: true });
      if (parsed.errors.length && !parsed.data.length) throw new NodeOperationError(`CSV error: ${parsed.errors[0]!.message}`);
      for (const row of parsed.data) out.push({ json: Array.isArray(row) ? { row } : (row as Record<string, unknown>), pairedItem: i });
    });
    return [out];
  },
});

export const xmlParser = defineNode({
  type: 'simplyai.xml', version: 1, displayName: 'XML Parser', category: 'transform', icon: 'code-xml', color: '#16a34a',
  description: 'Convert XML to JSON or JSON to XML', inputs: main, outputs: main,
  properties: [
    { name: 'operation', displayName: 'Operation', type: 'options', default: 'toJson', noExpression: true, options: [{ name: 'XML → JSON', value: 'toJson' }, { name: 'JSON → XML', value: 'toXml' }] },
    { name: 'field', displayName: 'Source field', type: 'string', default: 'xml', noExpression: true },
    { name: 'target', displayName: 'Target field', type: 'string', default: 'data', noExpression: true },
  ],
  async execute(ctx) {
    const op = ctx.getRawParam('operation'), field = ctx.getRawParam<string>('field'), target = ctx.getRawParam<string>('target') || 'data';
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', processEntities: true, allowBooleanAttributes: true });
    const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', format: true });
    return [ctx.getInputItems().map((item, i) => {
      const value = getPath(item.json, field);
      if (op === 'toJson') {
        if (typeof value !== 'string') throw new NodeOperationError(`Field "${field}" is not an XML string`, { itemIndex: i });
        return { json: { ...item.json, [target]: parser.parse(value) }, pairedItem: i };
      }
      return { json: { ...item.json, [target]: builder.build(value ?? item.json) }, pairedItem: i };
    })];
  },
});

export const dateFormatter = defineNode({
  type: 'simplyai.dateTime', version: 1, displayName: 'Date Formatter', category: 'transform', icon: 'calendar-clock', color: '#16a34a',
  description: 'Format, shift and compare dates', inputs: main, outputs: main,
  properties: [
    { name: 'operation', displayName: 'Operation', type: 'options', default: 'format', noExpression: true, options: [{ name: 'Format date', value: 'format' }, { name: 'Add / subtract time', value: 'add' }, { name: 'Difference between dates', value: 'diff' }, { name: 'Current date', value: 'now' }] },
    { name: 'value', displayName: 'Date', type: 'string', default: '{{ $json.date }}', displayOptions: { hide: { operation: ['now'] } } },
    { name: 'format', displayName: 'Format', type: 'string', default: 'YYYY-MM-DD HH:mm', displayOptions: { show: { operation: ['format', 'now'] } }, description: 'Tokens: YYYY MM DD HH mm ss, MMMM (month name), dddd (weekday), ISO, unix' },
    { name: 'timezone', displayName: 'Timezone', type: 'string', default: 'UTC' },
    { name: 'amount', displayName: 'Amount (negative to subtract)', type: 'number', default: 1, displayOptions: { show: { operation: ['add'] } } },
    { name: 'unit', displayName: 'Unit', type: 'options', default: 'days', displayOptions: { show: { operation: ['add', 'diff'] } }, options: ['seconds', 'minutes', 'hours', 'days', 'weeks', 'months', 'years'].map((u) => ({ name: u, value: u })) },
    { name: 'otherDate', displayName: 'Compare with', type: 'string', default: '{{ $now }}', displayOptions: { show: { operation: ['diff'] } } },
    { name: 'target', displayName: 'Target field', type: 'string', default: 'formattedDate', noExpression: true },
  ],
  async execute(ctx) {
    const { formatDate } = await import('../lib/date-format');
    return [ctx.getInputItems().map((item, i) => {
      const op = ctx.getParam<string>('operation', i);
      const tz = ctx.getParam<string>('timezone', i, 'UTC') || 'UTC';
      const date = op === 'now' ? new Date() : new Date(ctx.getParam<string>('value', i));
      if (Number.isNaN(date.getTime())) throw new NodeOperationError('Invalid date value', { itemIndex: i });
      let result: unknown;
      if (op === 'format' || op === 'now') result = formatDate(date, ctx.getParam<string>('format', i), tz);
      else if (op === 'add') result = addToDateSafe(date, Number(ctx.getParam('amount', i)), ctx.getParam<string>('unit', i)).toISOString();
      else {
        const other = new Date(ctx.getParam<string>('otherDate', i));
        const unitMs: Record<string, number> = { seconds: 1e3, minutes: 6e4, hours: 3.6e6, days: 8.64e7, weeks: 6.048e8, months: 2.629746e9, years: 3.15576e10 };
        result = Math.round(((other.getTime() - date.getTime()) / (unitMs[ctx.getParam<string>('unit', i)] ?? 1)) * 100) / 100;
      }
      return { json: { ...item.json, [ctx.getRawParam<string>('target') || 'formattedDate']: result }, pairedItem: i };
    })];
  },
});

export const textFormatter = defineNode({
  type: 'simplyai.text', version: 1, displayName: 'Text Formatter', category: 'transform', icon: 'type', color: '#16a34a',
  description: 'Transform text: case, trim, replace, template, truncate, slug, split', inputs: main, outputs: main,
  properties: [
    { name: 'operation', displayName: 'Operation', type: 'options', default: 'template', noExpression: true, options: [
      { name: 'Template', value: 'template' }, { name: 'Uppercase', value: 'upper' }, { name: 'Lowercase', value: 'lower' }, { name: 'Title case', value: 'title' },
      { name: 'Trim', value: 'trim' }, { name: 'Replace', value: 'replace' }, { name: 'Truncate', value: 'truncate' }, { name: 'Slugify', value: 'slug' },
      { name: 'Split into list', value: 'split' }, { name: 'Strip HTML', value: 'stripHtml' }, { name: 'Extract emails', value: 'emails' },
    ] },
    { name: 'text', displayName: 'Text', type: 'text', default: '{{ $json.text }}', rows: 3 },
    { name: 'search', displayName: 'Search for', type: 'string', default: '', displayOptions: { show: { operation: ['replace'] } } },
    { name: 'replaceWith', displayName: 'Replace with', type: 'string', default: '', displayOptions: { show: { operation: ['replace'] } } },
    { name: 'length', displayName: 'Max length', type: 'number', default: 100, displayOptions: { show: { operation: ['truncate'] } } },
    { name: 'separator', displayName: 'Separator', type: 'string', default: ',', displayOptions: { show: { operation: ['split'] } } },
    { name: 'target', displayName: 'Target field', type: 'string', default: 'text', noExpression: true },
  ],
  async execute(ctx) {
    return [ctx.getInputItems().map((item, i) => {
      const op = ctx.getParam<string>('operation', i);
      const raw = ctx.getParam<unknown>('text', i, '');
      const text = raw === undefined || raw === null ? '' : typeof raw === 'string' ? raw : JSON.stringify(raw);
      let r: unknown;
      switch (op) {
        case 'upper': r = text.toUpperCase(); break;
        case 'lower': r = text.toLowerCase(); break;
        case 'title': r = text.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); break;
        case 'trim': r = text.trim(); break;
        case 'replace': r = text.split(ctx.getParam<string>('search', i)).join(ctx.getParam<string>('replaceWith', i) ?? ''); break;
        case 'truncate': { const n = Number(ctx.getParam('length', i, 100)); r = text.length > n ? `${text.slice(0, Math.max(0, n - 1))}…` : text; break; }
        case 'slug': r = text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); break;
        case 'split': r = text.split(ctx.getParam<string>('separator', i) || ',').map((s) => s.trim()).filter(Boolean); break;
        case 'stripHtml': r = text.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); break;
        case 'emails': r = [...new Set(text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [])]; break;
        default: r = text;
      }
      return { json: { ...item.json, [ctx.getRawParam<string>('target') || 'text']: r }, pairedItem: i };
    })];
  },
});

export const codeNode = defineNode({
  type: 'simplyai.code', version: 1, displayName: 'Code', category: 'transform', icon: 'code', color: '#16a34a',
  description: 'Run JavaScript in an isolated sandbox to transform items', inputs: main, outputs: main,
  properties: [
    { name: 'mode', displayName: 'Mode', type: 'options', default: 'all', noExpression: true, options: [{ name: 'Run once for all items', value: 'all' }, { name: 'Run once for each item', value: 'each' }] },
    {
      name: 'code', displayName: 'JavaScript', type: 'code', language: 'javascript', noExpression: true, rows: 14,
      default: '// `items` is an array of { json } objects. Return an array of items or plain objects.\nreturn items.map((item) => ({\n  json: { ...item.json, processedAt: new Date().toISOString() },\n}));',
    },
  ],
  docs: 'Code runs in a separate sandboxed process without network, filesystem or environment access, with time and memory limits.\n\n* **All items**: `items` is the input array; return an array.\n* **Each item**: `item`/`$json` is the current item; return an object.\n\nAvailable helpers: `$input`, `$json`, `$vars`, `console.log` (captured).',
  async execute(ctx) {
    const items = ctx.getInputItems();
    const out = await ctx.services.runCode(ctx.getRawParam<string>('code'), items, { mode: ctx.getRawParam('mode') === 'each' ? 'each' : 'all', signal: ctx.signal });
    return [out];
  },
});

export const dataMapping = defineNode({
  type: 'simplyai.mapping', version: 1, displayName: 'Data Mapping', category: 'transform', icon: 'arrow-right-left', color: '#16a34a',
  description: 'Map source fields to a new structure', inputs: main, outputs: main,
  properties: [
    {
      name: 'mappings', displayName: 'Mappings', type: 'fixedCollection', default: [{ target: 'customer.email', source: '{{ $json.email }}' }],
      fields: [
        { name: 'target', displayName: 'Target field (dot path)', type: 'string', default: '' },
        { name: 'source', displayName: 'Value', type: 'string', default: '' },
        { name: 'defaultValue', displayName: 'Default if empty', type: 'string', default: '' },
      ],
    },
    { name: 'includeUnmapped', displayName: 'Include original fields', type: 'boolean', default: false, noExpression: true },
  ],
  async execute(ctx) {
    const include = ctx.getRawParam<boolean>('includeUnmapped');
    return [ctx.getInputItems().map((item, i) => {
      const json: Record<string, unknown> = include ? cloneJson(item.json) : {};
      for (const m of ctx.getParam<Array<{ target: string; source: unknown; defaultValue?: unknown }>>('mappings', i) ?? []) {
        if (!m.target) continue;
        const v = m.source === undefined || m.source === null || m.source === '' ? (m.defaultValue === '' ? null : m.defaultValue) : m.source;
        setPath(json, m.target, v);
      }
      return { json, pairedItem: i };
    })];
  },
});

export const aggregateNode = defineNode({
  type: 'simplyai.aggregate', version: 1, displayName: 'Aggregate', category: 'transform', icon: 'sigma', color: '#16a34a',
  description: 'Combine items into one: collect a field, count, sum, average', inputs: main, outputs: main,
  properties: [
    { name: 'operation', displayName: 'Operation', type: 'options', default: 'collect', noExpression: true, options: [{ name: 'Collect all items', value: 'collect' }, { name: 'Collect field values', value: 'field' }, { name: 'Count', value: 'count' }, { name: 'Sum', value: 'sum' }, { name: 'Average', value: 'avg' }, { name: 'Min', value: 'min' }, { name: 'Max', value: 'max' }] },
    { name: 'field', displayName: 'Field', type: 'string', default: 'amount', noExpression: true, displayOptions: { hide: { operation: ['collect', 'count'] } } },
    { name: 'target', displayName: 'Output field', type: 'string', default: 'result', noExpression: true },
  ],
  async execute(ctx) {
    const items = ctx.getInputItems();
    const op = ctx.getRawParam<string>('operation'), field = ctx.getRawParam<string>('field'), target = ctx.getRawParam<string>('target') || 'result';
    const vals = items.map((i) => getPath(i.json, field));
    const nums = vals.map(Number).filter((n) => Number.isFinite(n));
    let r: unknown;
    if (op === 'collect') r = items.map((i) => i.json);
    else if (op === 'field') r = vals;
    else if (op === 'count') r = items.length;
    else if (op === 'sum') r = nums.reduce((a, b) => a + b, 0);
    else if (op === 'avg') r = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    else if (op === 'min') r = nums.length ? Math.min(...nums) : null;
    else r = nums.length ? Math.max(...nums) : null;
    return [[{ json: { [target]: r, count: items.length } }]];
  },
});

export const sortLimit = defineNode({
  type: 'simplyai.sort', version: 1, displayName: 'Sort & Limit', category: 'transform', icon: 'arrow-down-wide-narrow', color: '#16a34a',
  description: 'Sort items by a field, remove duplicates and limit the count', inputs: main, outputs: main,
  properties: [
    { name: 'field', displayName: 'Sort by field', type: 'string', default: '', noExpression: true },
    { name: 'order', displayName: 'Order', type: 'options', default: 'asc', noExpression: true, options: [{ name: 'Ascending', value: 'asc' }, { name: 'Descending', value: 'desc' }] },
    { name: 'dedupeField', displayName: 'Remove duplicates by field', type: 'string', default: '', noExpression: true },
    { name: 'limit', displayName: 'Limit (0 = no limit)', type: 'number', default: 0, min: 0, noExpression: true },
  ],
  async execute(ctx) {
    let items = [...ctx.getInputItems()];
    const field = ctx.getRawParam<string>('field');
    if (field) {
      const dir = ctx.getRawParam('order') === 'desc' ? -1 : 1;
      items.sort((a, b) => {
        const x = getPath(a.json, field) as never, y = getPath(b.json, field) as never;
        return x === y ? 0 : x > y ? dir : -dir;
      });
    }
    const dedupe = ctx.getRawParam<string>('dedupeField');
    if (dedupe) {
      const seen = new Set<string>();
      items = items.filter((i) => {
        const k = JSON.stringify(getPath(i.json, dedupe));
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    const limit = Number(ctx.getRawParam('limit') ?? 0);
    return [limit > 0 ? items.slice(0, limit) : items];
  },
});

export const transformNodes: NodeDefinition[] = [
  setVariables, editFields, jsonParser, jsonFormatter, csvParser, xmlParser, dateFormatter, textFormatter, codeNode, dataMapping, aggregateNode, sortLimit,
];
