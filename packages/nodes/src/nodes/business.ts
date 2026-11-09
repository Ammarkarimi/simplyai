import type { NodeDefinition, NodeProperty } from '@simplyai/sdk';
import { defineRestNode, enc, jsonParam } from '../lib/rest';

const jsonField = (name: string, displayName: string, def = '{}'): NodeProperty => ({ name, displayName, type: 'json', default: def });
const strField = (name: string, displayName: string, def = '', required = true): NodeProperty => ({ name, displayName, type: 'string', default: def, required });
const numField = (name: string, displayName: string, def: number): NodeProperty => ({ name, displayName, type: 'number', default: def });
const google = { credentialTypes: ['googleOAuth2Api'], category: 'business' as const, subcategory: 'Google' };

export const googleSheetsNode = defineRestNode({
  ...google, type: 'simplyai.googleSheets', displayName: 'Google Sheets', description: 'Read, append and update rows in Google Sheets', integration: 'googleSheets', color: '#0f9d58',
  baseUrl: 'https://sheets.googleapis.com/v4/spreadsheets',
  operations: [
    {
      value: 'append', name: 'Append row', method: 'POST',
      url: (p) => `/${enc(p('spreadsheetId'))}/values/${enc(p('range'))}:append`,
      query: () => ({ valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' }),
      body: (p) => {
        const v = p<unknown>('values');
        const row = typeof v === 'string' ? (v.trim().startsWith('[') ? JSON.parse(v) : v.split(',').map((x) => x.trim())) : v;
        return { values: [row] };
      },
      output: (b) => b.updates ?? b,
      properties: [
        strField('spreadsheetId', 'Spreadsheet ID'), strField('range', 'Sheet / range', 'Sheet1!A:Z'),
        { name: 'values', displayName: 'Row values (JSON array or comma separated)', type: 'string', default: '["{{ $json.name }}", "{{ $json.email }}"]', required: true },
      ],
    },
    {
      value: 'read', name: 'Read rows', method: 'GET', url: (p) => `/${enc(p('spreadsheetId'))}/values/${enc(p('range'))}`,
      output: (b, p) => {
        const rows: string[][] = b.values ?? [];
        if (!p('headerRow', true) || rows.length === 0) return rows.map((r) => ({ values: r }));
        const [header, ...data] = rows;
        return data.map((r, idx) => ({ _row: idx + 2, ...Object.fromEntries(header!.map((h, i) => [h, r[i] ?? ''])) }));
      },
      properties: [strField('spreadsheetId', 'Spreadsheet ID'), strField('range', 'Sheet / range', 'Sheet1!A:Z'), { name: 'headerRow', displayName: 'First row contains headers', type: 'boolean', default: true }],
    },
    {
      value: 'update', name: 'Update range', method: 'PUT', url: (p) => `/${enc(p('spreadsheetId'))}/values/${enc(p('range'))}`,
      query: () => ({ valueInputOption: 'USER_ENTERED' }),
      body: (p) => ({ values: JSON.parse(String(p('rows'))) }),
      properties: [strField('spreadsheetId', 'Spreadsheet ID'), strField('range', 'Sheet / range', 'Sheet1!A2:C2'), { name: 'rows', displayName: 'Rows (JSON 2D array)', type: 'json', default: '[["{{ $json.name }}", "{{ $json.status }}"]]', required: true }],
    },
    {
      value: 'clear', name: 'Clear range', method: 'POST', url: (p) => `/${enc(p('spreadsheetId'))}/values/${enc(p('range'))}:clear`, body: () => ({}),
      properties: [strField('spreadsheetId', 'Spreadsheet ID'), strField('range', 'Sheet / range', 'Sheet1!A2:Z')],
    },
    {
      value: 'create', name: 'Create spreadsheet', method: 'POST', url: () => '', body: (p) => ({ properties: { title: p('title') } }),
      properties: [strField('title', 'Title', 'New spreadsheet')],
    },
  ],
});

export const googleDriveNode = defineRestNode({
  ...google, type: 'simplyai.googleDrive', displayName: 'Google Drive', description: 'List, create, share and delete Drive files', integration: 'googleDrive', color: '#1fa463',
  operations: [
    {
      value: 'list', name: 'List / search files', method: 'GET', url: () => 'https://www.googleapis.com/drive/v3/files',
      query: (p) => ({ q: p('query') || undefined, pageSize: p('limit', 50), fields: 'files(id,name,mimeType,modifiedTime,webViewLink,size)' }),
      output: (b) => b.files ?? [],
      properties: [strField('query', 'Query', "trashed = false and name contains 'report'", false), numField('limit', 'Limit', 50)],
    },
    {
      value: 'createText', name: 'Upload text file', method: 'POST',
      url: () => 'https://www.googleapis.com/upload/drive/v3/files',
      query: () => ({ uploadType: 'multipart', fields: 'id,name,webViewLink' }),
      run: async (ctx, p) => {
        const boundary = `simplyai${Date.now()}`;
        const meta = { name: p('name'), mimeType: p('mimeType', 'text/plain'), parents: p<string>('folderId') ? [p('folderId')] : undefined };
        const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${p('mimeType', 'text/plain')}\r\n\r\n${p('content')}\r\n--${boundary}--`;
        const r = await ctx.httpWithAuth({ url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body });
        return r.body;
      },
      properties: [strField('name', 'File name', 'notes.txt'), { name: 'content', displayName: 'Content', type: 'text', default: '', required: true }, strField('mimeType', 'MIME type', 'text/plain', false), strField('folderId', 'Folder ID', '', false)],
    },
    {
      value: 'download', name: 'Download text content', method: 'GET', url: (p) => `https://www.googleapis.com/drive/v3/files/${enc(p('fileId'))}`, query: () => ({ alt: 'media' }),
      output: (b) => ({ content: typeof b === 'string' ? b : JSON.stringify(b) }),
      properties: [strField('fileId', 'File ID', '{{ $json.id }}')],
    },
    {
      value: 'createFolder', name: 'Create folder', method: 'POST', url: () => 'https://www.googleapis.com/drive/v3/files',
      body: (p) => ({ name: p('name'), mimeType: 'application/vnd.google-apps.folder', parents: p<string>('folderId') ? [p('folderId')] : undefined }),
      properties: [strField('name', 'Folder name', 'New folder'), strField('folderId', 'Parent folder ID', '', false)],
    },
    {
      value: 'share', name: 'Share file', method: 'POST', url: (p) => `https://www.googleapis.com/drive/v3/files/${enc(p('fileId'))}/permissions`,
      body: (p) => ({ type: 'user', role: p('role', 'reader'), emailAddress: p('email') }),
      properties: [strField('fileId', 'File ID', '{{ $json.id }}'), strField('email', 'Email'), { name: 'role', displayName: 'Role', type: 'options', default: 'reader', options: [{ name: 'Reader', value: 'reader' }, { name: 'Commenter', value: 'commenter' }, { name: 'Writer', value: 'writer' }] }],
    },
    { value: 'delete', name: 'Delete file', method: 'DELETE', url: (p) => `https://www.googleapis.com/drive/v3/files/${enc(p('fileId'))}`, output: () => ({ deleted: true }), properties: [strField('fileId', 'File ID', '{{ $json.id }}')] },
  ],
});

export const googleDocsNode = defineRestNode({
  ...google, type: 'simplyai.googleDocs', displayName: 'Google Docs', description: 'Create documents and read or append text', integration: 'googleDocs', color: '#4285f4',
  baseUrl: 'https://docs.googleapis.com/v1/documents',
  operations: [
    { value: 'create', name: 'Create document', method: 'POST', url: () => '', body: (p) => ({ title: p('title') }), properties: [strField('title', 'Title', 'New document')] },
    {
      value: 'get', name: 'Get document text', method: 'GET', url: (p) => `/${enc(p('documentId'))}`,
      output: (b) => ({
        documentId: b.documentId, title: b.title,
        text: (b.body?.content ?? []).flatMap((c: any) => c.paragraph?.elements ?? []).map((e: any) => e.textRun?.content ?? '').join(''),
      }),
      properties: [strField('documentId', 'Document ID')],
    },
    {
      value: 'append', name: 'Append text', method: 'POST', url: (p) => `/${enc(p('documentId'))}:batchUpdate`,
      body: (p) => ({ requests: [{ insertText: { endOfSegmentLocation: {}, text: `${p('text')}\n` } }] }),
      properties: [strField('documentId', 'Document ID'), { name: 'text', displayName: 'Text', type: 'text', default: '', required: true }],
    },
  ],
});

export const googleCalendarNode = defineRestNode({
  ...google, type: 'simplyai.googleCalendar', displayName: 'Google Calendar', description: 'List, create and delete calendar events', integration: 'googleCalendar', color: '#4285f4',
  baseUrl: 'https://www.googleapis.com/calendar/v3/calendars',
  operations: [
    {
      value: 'list', name: 'List events', method: 'GET', url: (p) => `/${enc(p('calendarId', 'primary'))}/events`,
      query: (p) => ({ timeMin: p('timeMin') || new Date().toISOString(), maxResults: p('limit', 25), singleEvents: true, orderBy: 'startTime' }),
      output: (b) => b.items ?? [],
      properties: [strField('calendarId', 'Calendar ID', 'primary'), strField('timeMin', 'From (ISO date)', '', false), numField('limit', 'Limit', 25)],
    },
    {
      value: 'create', name: 'Create event', method: 'POST', url: (p) => `/${enc(p('calendarId', 'primary'))}/events`,
      body: (p) => ({
        summary: p('summary'), description: p('description'), location: p('location') || undefined,
        start: { dateTime: p('start'), timeZone: p('timezone', 'UTC') }, end: { dateTime: p('end'), timeZone: p('timezone', 'UTC') },
        attendees: String(p('attendees') ?? '').split(',').map((e) => e.trim()).filter(Boolean).map((email) => ({ email })),
      }),
      properties: [
        strField('calendarId', 'Calendar ID', 'primary'), strField('summary', 'Title', 'Meeting'), strField('description', 'Description', '', false), strField('location', 'Location', '', false),
        strField('start', 'Start (ISO date-time)', '2026-01-01T10:00:00Z'), strField('end', 'End (ISO date-time)', '2026-01-01T10:30:00Z'), strField('timezone', 'Timezone', 'UTC', false), strField('attendees', 'Attendees (comma separated emails)', '', false),
      ],
    },
    { value: 'delete', name: 'Delete event', method: 'DELETE', url: (p) => `/${enc(p('calendarId', 'primary'))}/events/${enc(p('eventId'))}`, output: () => ({ deleted: true }), properties: [strField('calendarId', 'Calendar ID', 'primary'), strField('eventId', 'Event ID', '{{ $json.id }}')] },
  ],
});

export const airtableNode = defineRestNode({
  type: 'simplyai.airtable', displayName: 'Airtable', description: 'List, create, update and delete Airtable records', integration: 'airtable', color: '#18bfff',
  credentialTypes: ['airtableApi'], baseUrl: 'https://api.airtable.com/v0',
  operations: [
    {
      value: 'list', name: 'List records', method: 'GET', url: (p) => `/${enc(p('baseId'))}/${enc(p('table'))}`,
      query: (p) => ({ filterByFormula: p('formula') || undefined, maxRecords: p('limit', 100), view: p('view') || undefined }),
      output: (b) => (b.records ?? []).map((r: any) => ({ id: r.id, createdTime: r.createdTime, ...r.fields })),
      properties: [strField('baseId', 'Base ID'), strField('table', 'Table name or ID'), strField('formula', 'Filter formula', '', false), strField('view', 'View', '', false), numField('limit', 'Max records', 100)],
    },
    {
      value: 'create', name: 'Create record', method: 'POST', url: (p) => `/${enc(p('baseId'))}/${enc(p('table'))}`,
      body: (p) => ({ fields: jsonParam(p('fields'), 'Fields'), typecast: true }),
      output: (r) => ({ id: r.id, ...r.fields }),
      properties: [strField('baseId', 'Base ID'), strField('table', 'Table name or ID'), jsonField('fields', 'Fields (JSON)', '{ "Name": "{{ $json.name }}" }')],
    },
    {
      value: 'update', name: 'Update record', method: 'PATCH', url: (p) => `/${enc(p('baseId'))}/${enc(p('table'))}/${enc(p('recordId'))}`,
      body: (p) => ({ fields: jsonParam(p('fields'), 'Fields'), typecast: true }), output: (r) => ({ id: r.id, ...r.fields }),
      properties: [strField('baseId', 'Base ID'), strField('table', 'Table name or ID'), strField('recordId', 'Record ID', '{{ $json.id }}'), jsonField('fields', 'Fields (JSON)', '{}')],
    },
    { value: 'delete', name: 'Delete record', method: 'DELETE', url: (p) => `/${enc(p('baseId'))}/${enc(p('table'))}/${enc(p('recordId'))}`, properties: [strField('baseId', 'Base ID'), strField('table', 'Table name or ID'), strField('recordId', 'Record ID', '{{ $json.id }}')] },
  ],
});

const notionTitle = (t: string) => ({ title: [{ text: { content: t } }] });
export const notionNode = defineRestNode({
  type: 'simplyai.notion', displayName: 'Notion', description: 'Create pages, query databases and append content', integration: 'notion', color: '#000000',
  credentialTypes: ['notionApi'], baseUrl: 'https://api.notion.com/v1',
  operations: [
    {
      value: 'createPage', name: 'Create database page', method: 'POST', url: () => '/pages',
      body: (p) => ({ parent: { database_id: p('databaseId') }, properties: { [p<string>('titleProperty', 'Name')]: notionTitle(p('title')), ...jsonParam(p('properties'), 'Properties') }, children: p<string>('content') ? [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: p('content') } }] } }] : [] }),
      properties: [strField('databaseId', 'Database ID'), strField('titleProperty', 'Title property', 'Name'), strField('title', 'Title', '{{ $json.title }}'), jsonField('properties', 'Other properties (Notion JSON)', '{}'), { name: 'content', displayName: 'Page text', type: 'text', default: '' }],
    },
    {
      value: 'queryDatabase', name: 'Query database', method: 'POST', url: (p) => `/databases/${enc(p('databaseId'))}/query`,
      body: (p) => ({ page_size: p('limit', 50), ...(p<string>('filter') ? { filter: jsonParam(p('filter'), 'Filter') } : {}) }),
      output: (b) => b.results ?? [],
      properties: [strField('databaseId', 'Database ID'), jsonField('filter', 'Filter (Notion JSON)', ''), numField('limit', 'Limit', 50)],
    },
    { value: 'getPage', name: 'Get page', method: 'GET', url: (p) => `/pages/${enc(p('pageId'))}`, properties: [strField('pageId', 'Page ID', '{{ $json.id }}')] },
    {
      value: 'appendBlock', name: 'Append paragraph', method: 'PATCH', url: (p) => `/blocks/${enc(p('pageId'))}/children`,
      body: (p) => ({ children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: p('content') } }] } }] }),
      properties: [strField('pageId', 'Page ID', '{{ $json.id }}'), { name: 'content', displayName: 'Text', type: 'text', default: '', required: true }],
    },
  ],
});

export const hubspotNode = defineRestNode({
  type: 'simplyai.hubspot', displayName: 'HubSpot', description: 'Manage contacts and deals in HubSpot CRM', integration: 'hubspot', color: '#ff7a59',
  credentialTypes: ['hubspotApi'], baseUrl: 'https://api.hubapi.com/crm/v3/objects',
  operations: [
    {
      value: 'createContact', name: 'Create contact', method: 'POST', url: () => '/contacts',
      body: (p) => ({ properties: { email: p('email'), firstname: p('firstName'), lastname: p('lastName'), ...jsonParam(p('properties'), 'Properties') } }),
      properties: [strField('email', 'Email', '{{ $json.email }}'), strField('firstName', 'First name', '', false), strField('lastName', 'Last name', '', false), jsonField('properties', 'Additional properties (JSON)')],
    },
    {
      value: 'upsertContact', name: 'Create or update contact (by email)', method: 'POST', url: () => '/contacts/batch/upsert',
      body: (p) => ({ inputs: [{ idProperty: 'email', id: p('email'), properties: { email: p('email'), firstname: p('firstName'), lastname: p('lastName'), ...jsonParam(p('properties'), 'Properties') } }] }),
      output: (b) => b.results ?? [],
      properties: [strField('email', 'Email', '{{ $json.email }}'), strField('firstName', 'First name', '', false), strField('lastName', 'Last name', '', false), jsonField('properties', 'Additional properties (JSON)')],
    },
    { value: 'getContact', name: 'Get contact', method: 'GET', url: (p) => `/contacts/${enc(p('contactId'))}`, properties: [strField('contactId', 'Contact ID', '{{ $json.id }}')] },
    {
      value: 'searchContacts', name: 'Search contacts', method: 'POST', url: () => '/contacts/search',
      body: (p) => ({ query: p('query'), limit: p('limit', 20) }), output: (b) => b.results ?? [],
      properties: [strField('query', 'Search text'), numField('limit', 'Limit', 20)],
    },
    {
      value: 'createDeal', name: 'Create deal', method: 'POST', url: () => '/deals',
      body: (p) => ({ properties: { dealname: p('dealName'), amount: p('amount'), dealstage: p('stage'), pipeline: p('pipeline', 'default') } }),
      properties: [strField('dealName', 'Deal name'), strField('amount', 'Amount', '', false), strField('stage', 'Stage', 'appointmentscheduled'), strField('pipeline', 'Pipeline', 'default', false)],
    },
  ],
});

export const salesforceNode = defineRestNode({
  type: 'simplyai.salesforce', displayName: 'Salesforce', description: 'Create, update, get records and run SOQL queries', integration: 'salesforce', color: '#00a1e0',
  credentialTypes: ['salesforceOAuth2Api'],
  operations: [
    { value: 'create', name: 'Create record', method: 'POST', url: (p) => `/sobjects/${enc(p('sobject'))}`, body: (p) => jsonParam(p('fields'), 'Fields'), properties: [strField('sobject', 'Object', 'Lead'), jsonField('fields', 'Fields (JSON)', '{ "LastName": "{{ $json.lastName }}", "Company": "{{ $json.company }}" }')] },
    { value: 'update', name: 'Update record', method: 'PATCH', url: (p) => `/sobjects/${enc(p('sobject'))}/${enc(p('recordId'))}`, body: (p) => jsonParam(p('fields'), 'Fields'), output: () => ({ updated: true }), properties: [strField('sobject', 'Object', 'Lead'), strField('recordId', 'Record ID', '{{ $json.Id }}'), jsonField('fields', 'Fields (JSON)')] },
    { value: 'get', name: 'Get record', method: 'GET', url: (p) => `/sobjects/${enc(p('sobject'))}/${enc(p('recordId'))}`, properties: [strField('sobject', 'Object', 'Lead'), strField('recordId', 'Record ID', '{{ $json.Id }}')] },
    { value: 'query', name: 'SOQL query', method: 'GET', url: () => '/query', query: (p) => ({ q: p('soql') }), output: (b) => b.records ?? [], properties: [{ name: 'soql', displayName: 'SOQL', type: 'code', language: 'sql', default: 'SELECT Id, Name FROM Account LIMIT 10', required: true }] },
  ],
});

export const shopifyNode = defineRestNode({
  type: 'simplyai.shopify', displayName: 'Shopify', description: 'Orders, products and customers in Shopify', integration: 'shopify', color: '#96bf48',
  credentialTypes: ['shopifyApi'],
  operations: [
    { value: 'listOrders', name: 'List orders', method: 'GET', url: () => '/orders.json', query: (p) => ({ status: p('status', 'any'), limit: p('limit', 50) }), output: (b) => b.orders ?? [], properties: [strField('status', 'Status', 'any'), numField('limit', 'Limit', 50)] },
    { value: 'getOrder', name: 'Get order', method: 'GET', url: (p) => `/orders/${enc(p('orderId'))}.json`, output: (b) => b.order, properties: [strField('orderId', 'Order ID', '{{ $json.id }}')] },
    { value: 'listProducts', name: 'List products', method: 'GET', url: () => '/products.json', query: (p) => ({ limit: p('limit', 50) }), output: (b) => b.products ?? [], properties: [numField('limit', 'Limit', 50)] },
    {
      value: 'createProduct', name: 'Create product', method: 'POST', url: () => '/products.json',
      body: (p) => ({ product: { title: p('title'), body_html: p('description'), vendor: p('vendor') || undefined, variants: p('price') ? [{ price: String(p('price')) }] : undefined } }), output: (b) => b.product,
      properties: [strField('title', 'Title'), { name: 'description', displayName: 'Description (HTML)', type: 'text', default: '' }, strField('vendor', 'Vendor', '', false), strField('price', 'Price', '', false)],
    },
    { value: 'searchCustomers', name: 'Search customers', method: 'GET', url: () => '/customers/search.json', query: (p) => ({ query: p('query') }), output: (b) => b.customers ?? [], properties: [strField('query', 'Query', 'email:{{ $json.email }}')] },
  ],
});

export const wooCommerceNode = defineRestNode({
  type: 'simplyai.woocommerce', displayName: 'WooCommerce', description: 'Orders and products in WooCommerce stores', integration: 'woocommerce', color: '#96588a',
  credentialTypes: ['wooCommerceApi'],
  operations: [
    { value: 'listOrders', name: 'List orders', method: 'GET', url: () => '/orders', query: (p) => ({ status: p('status') || undefined, per_page: p('limit', 20) }), properties: [strField('status', 'Status', '', false), numField('limit', 'Limit', 20)] },
    { value: 'getOrder', name: 'Get order', method: 'GET', url: (p) => `/orders/${enc(p('orderId'))}`, properties: [strField('orderId', 'Order ID', '{{ $json.id }}')] },
    { value: 'updateOrderStatus', name: 'Update order status', method: 'PUT', url: (p) => `/orders/${enc(p('orderId'))}`, body: (p) => ({ status: p('status') }), properties: [strField('orderId', 'Order ID', '{{ $json.id }}'), strField('status', 'Status', 'completed')] },
    { value: 'createProduct', name: 'Create product', method: 'POST', url: () => '/products', body: (p) => ({ name: p('name'), regular_price: String(p('price') ?? ''), description: p('description') }), properties: [strField('name', 'Name'), strField('price', 'Price', '', false), { name: 'description', displayName: 'Description', type: 'text', default: '' }] },
  ],
});

export const wordpressNode = defineRestNode({
  type: 'simplyai.wordpress', displayName: 'WordPress', description: 'Create, update and list WordPress posts', integration: 'wordpress', color: '#21759b',
  credentialTypes: ['wordpressApi'],
  operations: [
    { value: 'createPost', name: 'Create post', method: 'POST', url: () => '/posts', body: (p) => ({ title: p('title'), content: p('content'), status: p('status', 'draft') }), properties: [strField('title', 'Title'), { name: 'content', displayName: 'Content (HTML)', type: 'text', default: '', required: true }, { name: 'status', displayName: 'Status', type: 'options', default: 'draft', options: ['draft', 'publish', 'pending', 'private'].map((s) => ({ name: s, value: s })) }] },
    { value: 'updatePost', name: 'Update post', method: 'POST', url: (p) => `/posts/${enc(p('postId'))}`, body: (p) => ({ title: p('title') || undefined, content: p('content') || undefined, status: p('status') || undefined }), properties: [strField('postId', 'Post ID', '{{ $json.id }}'), strField('title', 'Title', '', false), { name: 'content', displayName: 'Content (HTML)', type: 'text', default: '' }, { name: 'status', displayName: 'Status', type: 'options', default: 'draft', options: ['draft', 'publish', 'pending', 'private'].map((s) => ({ name: s, value: s })) }] },
    { value: 'listPosts', name: 'List posts', method: 'GET', url: () => '/posts', query: (p) => ({ per_page: p('limit', 10), search: p('search') || undefined }), properties: [numField('limit', 'Limit', 10), strField('search', 'Search', '', false)] },
  ],
});

export const stripeNode = defineRestNode({
  type: 'simplyai.stripe', displayName: 'Stripe', description: 'Customers, payments and invoices in Stripe', integration: 'stripe', color: '#635bff',
  credentialTypes: ['stripeApi'], baseUrl: 'https://api.stripe.com/v1',
  operations: [
    { value: 'createCustomer', name: 'Create customer', method: 'POST', bodyType: 'form', url: () => '/customers', body: (p) => ({ email: p('email'), name: p('name'), metadata: jsonParam(p('metadata'), 'Metadata') }), properties: [strField('email', 'Email', '{{ $json.email }}'), strField('name', 'Name', '', false), jsonField('metadata', 'Metadata (JSON)')] },
    { value: 'getCustomer', name: 'Get customer', method: 'GET', url: (p) => `/customers/${enc(p('customerId'))}`, properties: [strField('customerId', 'Customer ID', '{{ $json.id }}')] },
    { value: 'createPaymentIntent', name: 'Create payment intent', method: 'POST', bodyType: 'form', url: () => '/payment_intents', body: (p) => ({ amount: p('amount'), currency: p('currency', 'usd'), customer: p('customerId') || undefined, description: p('description') || undefined }), properties: [numField('amount', 'Amount (smallest unit, e.g. cents)', 1000), strField('currency', 'Currency', 'usd'), strField('customerId', 'Customer ID', '', false), strField('description', 'Description', '', false)] },
    { value: 'listCharges', name: 'List charges', method: 'GET', url: () => '/charges', query: (p) => ({ limit: p('limit', 20), customer: p('customerId') || undefined }), output: (b) => b.data ?? [], properties: [numField('limit', 'Limit', 20), strField('customerId', 'Customer ID', '', false)] },
    { value: 'listInvoices', name: 'List invoices', method: 'GET', url: () => '/invoices', query: (p) => ({ limit: p('limit', 20), customer: p('customerId') || undefined, status: p('status') || undefined }), output: (b) => b.data ?? [], properties: [numField('limit', 'Limit', 20), strField('customerId', 'Customer ID', '', false), strField('status', 'Status', '', false)] },
  ],
});

export const trelloNode = defineRestNode({
  type: 'simplyai.trello', displayName: 'Trello', description: 'Create, update and comment on Trello cards', integration: 'trello', color: '#0079bf',
  credentialTypes: ['trelloApi'], baseUrl: 'https://api.trello.com/1',
  operations: [
    { value: 'createCard', name: 'Create card', method: 'POST', url: () => '/cards', query: (p) => ({ idList: p('listId'), name: p('name'), desc: p('description') || undefined, due: p('due') || undefined }), properties: [strField('listId', 'List ID'), strField('name', 'Name'), { name: 'description', displayName: 'Description', type: 'text', default: '' }, strField('due', 'Due date', '', false)] },
    { value: 'listCards', name: 'Get cards in list', method: 'GET', url: (p) => `/lists/${enc(p('listId'))}/cards`, properties: [strField('listId', 'List ID')] },
    { value: 'updateCard', name: 'Update card', method: 'PUT', url: (p) => `/cards/${enc(p('cardId'))}`, query: (p) => ({ name: p('name') || undefined, idList: p('moveToListId') || undefined, closed: p('archive') ? true : undefined }), properties: [strField('cardId', 'Card ID', '{{ $json.id }}'), strField('name', 'New name', '', false), strField('moveToListId', 'Move to list ID', '', false), { name: 'archive', displayName: 'Archive', type: 'boolean', default: false }] },
    { value: 'addComment', name: 'Add comment', method: 'POST', url: (p) => `/cards/${enc(p('cardId'))}/actions/comments`, query: (p) => ({ text: p('text') }), properties: [strField('cardId', 'Card ID', '{{ $json.id }}'), { name: 'text', displayName: 'Comment', type: 'text', default: '', required: true }] },
  ],
});

export const asanaNode = defineRestNode({
  type: 'simplyai.asana', displayName: 'Asana', description: 'Create, list and update Asana tasks', integration: 'asana', color: '#f06a6a',
  credentialTypes: ['asanaApi'], baseUrl: 'https://app.asana.com/api/1.0',
  operations: [
    { value: 'createTask', name: 'Create task', method: 'POST', url: () => '/tasks', body: (p) => ({ data: { name: p('name'), notes: p('notes'), projects: [p('projectId')], due_on: p('dueOn') || undefined, assignee: p('assignee') || undefined } }), output: (b) => b.data, properties: [strField('projectId', 'Project ID'), strField('name', 'Name'), { name: 'notes', displayName: 'Notes', type: 'text', default: '' }, strField('dueOn', 'Due on (YYYY-MM-DD)', '', false), strField('assignee', 'Assignee (email or gid)', '', false)] },
    { value: 'listTasks', name: 'List project tasks', method: 'GET', url: (p) => `/projects/${enc(p('projectId'))}/tasks`, query: () => ({ opt_fields: 'name,completed,due_on,assignee.name' }), output: (b) => b.data ?? [], properties: [strField('projectId', 'Project ID')] },
    { value: 'updateTask', name: 'Update task', method: 'PUT', url: (p) => `/tasks/${enc(p('taskId'))}`, body: (p) => ({ data: { ...(p('name') ? { name: p('name') } : {}), completed: !!p('completed') } }), output: (b) => b.data, properties: [strField('taskId', 'Task ID', '{{ $json.gid }}'), strField('name', 'Name', '', false), { name: 'completed', displayName: 'Completed', type: 'boolean', default: false }] },
  ],
});

const adf = (text: string) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
export const jiraNode = defineRestNode({
  type: 'simplyai.jira', displayName: 'Jira', description: 'Create, search, comment and transition Jira issues', integration: 'jira', color: '#0052cc',
  credentialTypes: ['jiraApi'],
  operations: [
    { value: 'createIssue', name: 'Create issue', method: 'POST', url: () => '/issue', body: (p) => ({ fields: { project: { key: p('projectKey') }, summary: p('summary'), issuetype: { name: p('issueType', 'Task') }, description: adf(String(p('description') ?? '')) } }), properties: [strField('projectKey', 'Project key', 'PROJ'), strField('summary', 'Summary'), strField('issueType', 'Issue type', 'Task'), { name: 'description', displayName: 'Description', type: 'text', default: '' }] },
    { value: 'getIssue', name: 'Get issue', method: 'GET', url: (p) => `/issue/${enc(p('issueKey'))}`, properties: [strField('issueKey', 'Issue key', '{{ $json.key }}')] },
    { value: 'search', name: 'Search (JQL)', method: 'POST', url: () => '/search/jql', body: (p) => ({ jql: p('jql'), maxResults: p('limit', 50), fields: ['summary', 'status', 'assignee', 'priority'] }), output: (b) => b.issues ?? [], properties: [strField('jql', 'JQL', 'project = PROJ AND status != Done'), numField('limit', 'Limit', 50)] },
    { value: 'addComment', name: 'Add comment', method: 'POST', url: (p) => `/issue/${enc(p('issueKey'))}/comment`, body: (p) => ({ body: adf(String(p('comment'))) }), properties: [strField('issueKey', 'Issue key', '{{ $json.key }}'), { name: 'comment', displayName: 'Comment', type: 'text', default: '', required: true }] },
    { value: 'transition', name: 'Transition issue', method: 'POST', url: (p) => `/issue/${enc(p('issueKey'))}/transitions`, body: (p) => ({ transition: { id: String(p('transitionId')) } }), output: () => ({ transitioned: true }), properties: [strField('issueKey', 'Issue key', '{{ $json.key }}'), strField('transitionId', 'Transition ID', '31')] },
  ],
});

export const businessNodes: NodeDefinition[] = [
  googleSheetsNode, googleDriveNode, googleDocsNode, googleCalendarNode, airtableNode, notionNode, hubspotNode, salesforceNode, shopifyNode, wooCommerceNode, wordpressNode, stripeNode, trelloNode, asanaNode, jiraNode,
];
