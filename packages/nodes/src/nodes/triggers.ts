import { defineNode, NodeOperationError, type Item, type NodeDefinition } from '@simplyai/sdk';
import { assertHostAllowed, assertIdentifier } from '../lib/net';

const main = [{ name: 'main' }];

export const manualTrigger = defineNode({
  type: 'simplyai.manualTrigger', version: 1, displayName: 'Manual Trigger', category: 'trigger', icon: 'mouse-pointer-click', color: '#7c3aed',
  description: 'Start the workflow by clicking "Execute workflow" or through the API',
  trigger: 'manual', inputs: [], outputs: main,
  properties: [{ name: 'testData', displayName: 'Test data (JSON)', type: 'json', default: '{}', description: 'Item emitted when the workflow is run manually without input' }],
  docs: 'Runs when you click **Execute workflow** in the editor or call `POST /api/v1/workflows/:id/run`. Any JSON body sent through the API becomes the output item.',
  async execute(ctx) {
    const items = ctx.getInputItems();
    const hasData = items.some((i) => Object.keys(i.json).length > 0);
    if (hasData) return [items];
    const raw = ctx.getRawParam<string>('testData');
    try {
      const v = raw ? JSON.parse(raw) : {};
      return [(Array.isArray(v) ? v : [v]).map((json) => ({ json }))];
    } catch {
      return [items];
    }
  },
});

export const scheduleTrigger = defineNode({
  type: 'simplyai.scheduleTrigger', version: 1, displayName: 'Schedule Trigger', category: 'trigger', icon: 'clock', color: '#7c3aed',
  description: 'Run the workflow on a schedule (interval or cron)', trigger: 'schedule', inputs: [], outputs: main,
  properties: [
    { name: 'mode', displayName: 'Mode', type: 'options', default: 'interval', noExpression: true, options: [{ name: 'Interval', value: 'interval' }, { name: 'Cron expression', value: 'cron' }] },
    { name: 'intervalValue', displayName: 'Every', type: 'number', default: 15, min: 1, displayOptions: { show: { mode: ['interval'] } }, noExpression: true },
    { name: 'intervalUnit', displayName: 'Unit', type: 'options', default: 'minutes', noExpression: true, displayOptions: { show: { mode: ['interval'] } }, options: [{ name: 'Minutes', value: 'minutes' }, { name: 'Hours', value: 'hours' }, { name: 'Days', value: 'days' }] },
    { name: 'cron', displayName: 'Cron expression', type: 'cron', default: '0 9 * * 1-5', placeholder: '0 9 * * 1-5', displayOptions: { show: { mode: ['cron'] } }, noExpression: true, description: 'minute hour day-of-month month day-of-week' },
    { name: 'timezone', displayName: 'Timezone', type: 'string', default: 'UTC', noExpression: true },
  ],
  docs: 'Activate the workflow to start the schedule. Each run emits `{ timestamp, scheduledAt }`.',
  outputExample: { timestamp: '2026-01-01T09:00:00.000Z', timezone: 'UTC' },
});

export const webhookTrigger = defineNode({
  type: 'simplyai.webhookTrigger', version: 1, displayName: 'Webhook Trigger', category: 'trigger', icon: 'webhook', color: '#7c3aed',
  description: 'Start the workflow when an HTTP request hits a unique URL', trigger: 'webhook', inputs: [], outputs: main,
  properties: [
    { name: 'path', displayName: 'Path', type: 'string', default: '', noExpression: true, description: 'Unique path; generated automatically when empty' },
    { name: 'methods', displayName: 'HTTP methods', type: 'multiOptions', noExpression: true, default: ['POST'], options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ name: m, value: m })) },
    { name: 'responseMode', displayName: 'Respond', type: 'options', default: 'IMMEDIATE', noExpression: true, options: [{ name: 'Immediately', value: 'IMMEDIATE' }, { name: 'When last node finishes', value: 'LAST_NODE' }] },
    { name: 'responseCode', displayName: 'Response code', type: 'number', default: 200, noExpression: true },
    { name: 'notice', displayName: 'Authentication, custom responses and request history are managed on the Webhooks page.', type: 'notice' },
  ],
  docs: 'Each request produces one item: `{ method, headers, query, body, path }`. Configure authentication (header token, basic auth, HMAC signature) in **Webhooks**.',
  outputExample: { method: 'POST', headers: { 'content-type': 'application/json' }, query: {}, body: { email: 'ada@example.com' } },
});

export const formTrigger = defineNode({
  type: 'simplyai.formTrigger', version: 1, displayName: 'Form Submission Trigger', category: 'trigger', icon: 'clipboard-list', color: '#7c3aed',
  description: 'Publish a hosted form and run the workflow on every submission', trigger: 'form', inputs: [], outputs: main,
  properties: [
    { name: 'path', displayName: 'Form path', type: 'string', default: '', noExpression: true },
    { name: 'formTitle', displayName: 'Form title', type: 'string', default: 'Contact us', required: true, noExpression: true },
    { name: 'formDescription', displayName: 'Description', type: 'text', default: '', noExpression: true },
    {
      name: 'fields', displayName: 'Fields', type: 'fixedCollection', noExpression: true,
      default: [{ label: 'Name', name: 'name', fieldType: 'text', required: true }, { label: 'Email', name: 'email', fieldType: 'email', required: true }],
      fields: [
        { name: 'label', displayName: 'Label', type: 'string', default: '' },
        { name: 'name', displayName: 'Field key', type: 'string', default: '' },
        { name: 'fieldType', displayName: 'Type', type: 'options', default: 'text', options: ['text', 'email', 'number', 'textarea', 'select', 'checkbox', 'date'].map((v) => ({ name: v, value: v })) },
        { name: 'options', displayName: 'Options (comma separated, for select)', type: 'string', default: '' },
        { name: 'required', displayName: 'Required', type: 'boolean', default: false },
      ],
    },
    { name: 'submitLabel', displayName: 'Submit button label', type: 'string', default: 'Submit', noExpression: true },
    { name: 'successMessage', displayName: 'Success message', type: 'string', default: 'Thanks! Your response has been recorded.', noExpression: true },
  ],
  docs: 'Activate the workflow to publish the form at `/f/<path>`. Each submission emits the submitted fields plus `submittedAt`.',
});

export const chatTrigger = defineNode({
  type: 'simplyai.chatTrigger', version: 1, displayName: 'Chat Message Trigger', category: 'trigger', icon: 'message-circle', color: '#7c3aed',
  description: 'Hosted chat page; every message starts the workflow and the last node replies', trigger: 'chat', inputs: [], outputs: main,
  properties: [
    { name: 'path', displayName: 'Chat path', type: 'string', default: '', noExpression: true },
    { name: 'title', displayName: 'Title', type: 'string', default: 'Chat with us', noExpression: true },
    { name: 'welcomeMessage', displayName: 'Welcome message', type: 'text', default: 'Hi! How can I help you today?', noExpression: true },
    { name: 'responseField', displayName: 'Reply field', type: 'string', default: 'output', noExpression: true, description: 'Field of the last node output used as the reply' },
  ],
  docs: 'Each message emits `{ sessionId, message, history }`. The reply is taken from the configured field of the last executed node (e.g. the AI Agent `output`).',
});

export const appEventTrigger = defineNode({
  type: 'simplyai.appEventTrigger', version: 1, displayName: 'App Event Trigger', category: 'trigger', icon: 'zap', color: '#7c3aed',
  description: 'Run when an application event is emitted (API, other workflows or system events)', trigger: 'event', inputs: [], outputs: main,
  properties: [
    { name: 'eventName', displayName: 'Event name', type: 'string', default: 'customer.created', required: true, noExpression: true, description: 'Use system.execution.failed to react to failed executions in this workspace' },
  ],
  docs: 'Emit events with `POST /api/v1/events` `{ "event": "customer.created", "payload": {…} }` or the **Emit App Event** node. Built-in events: `system.execution.failed`, `system.execution.succeeded`.',
});

export const emailTrigger = defineNode({
  type: 'simplyai.emailTrigger', version: 1, displayName: 'Email Trigger (IMAP)', category: 'trigger', icon: 'mail', color: '#7c3aed', integration: 'email',
  description: 'Poll a mailbox and run for every new email', trigger: 'poll', inputs: [], outputs: main,
  credentials: { types: ['imap'], required: true },
  properties: [
    { name: 'mailbox', displayName: 'Mailbox', type: 'string', default: 'INBOX', noExpression: true },
    { name: 'pollMinutes', displayName: 'Check every (minutes)', type: 'number', default: 5, min: 1, noExpression: true },
    { name: 'markSeen', displayName: 'Mark as read', type: 'boolean', default: false, noExpression: true },
    { name: 'maxPerPoll', displayName: 'Max emails per check', type: 'number', default: 20, min: 1, max: 200, noExpression: true },
  ],
  docs: 'Only emails received after activation are processed. Output: `{ from, to, subject, text, html, date, messageId }`.',
  async poll(ctx) {
    const { ImapFlow } = await import('imapflow');
    const { simpleParser } = await import('mailparser');
    const cred = (await ctx.getCredential()).data as Record<string, unknown>;
    await assertHostAllowed(String(cred.host));
    const client = new ImapFlow({
      host: String(cred.host), port: Number(cred.port ?? 993), secure: cred.secure !== false,
      auth: { user: String(cred.user), pass: String(cred.password) }, logger: false,
    });
    await client.connect();
    try {
      const lock = await client.getMailboxLock(ctx.getParam<string>('mailbox', 'INBOX'));
      try {
        const status = client.mailbox && typeof client.mailbox === 'object' ? client.mailbox : null;
        const uidNext = Number((status as { uidNext?: number } | null)?.uidNext ?? 1);
        if (ctx.isFirstPoll || ctx.state.lastUid === undefined) {
          ctx.state.lastUid = uidNext - 1;
          return null;
        }
        const lastUid = Number(ctx.state.lastUid);
        if (uidNext - 1 <= lastUid) return null;
        const max = Number(ctx.getParam('maxPerPoll', 20));
        const items: Item[] = [];
        let maxSeen = lastUid;
        for await (const msg of client.fetch(`${lastUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
          if (msg.uid <= lastUid) continue;
          maxSeen = Math.max(maxSeen, msg.uid);
          if (items.length >= max) continue;
          const parsed = await simpleParser(msg.source as Buffer);
          items.push({
            json: {
              uid: msg.uid, messageId: parsed.messageId, subject: parsed.subject ?? '', from: parsed.from?.text ?? '', to: Array.isArray(parsed.to) ? parsed.to.map((t) => t.text).join(', ') : parsed.to?.text ?? '',
              date: parsed.date?.toISOString(), text: parsed.text ?? '', html: typeof parsed.html === 'string' ? parsed.html : '',
              attachments: parsed.attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, size: a.size })),
            },
          });
        }
        if (ctx.getParam('markSeen', false) && maxSeen > lastUid) await client.messageFlagsAdd(`${lastUid + 1}:${maxSeen}`, ['\\Seen'], { uid: true });
        ctx.state.lastUid = maxSeen;
        return items.length ? items : null;
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
  },
});

export const databaseTrigger = defineNode({
  type: 'simplyai.databaseTrigger', version: 1, displayName: 'Database Trigger', category: 'trigger', icon: 'database', color: '#7c3aed',
  description: 'Poll a PostgreSQL or MySQL table and run for new rows', trigger: 'poll', inputs: [], outputs: main,
  credentials: { types: ['postgres', 'mysql'], required: true },
  properties: [
    { name: 'table', displayName: 'Table', type: 'string', default: '', required: true, noExpression: true, placeholder: 'public.orders' },
    { name: 'cursorColumn', displayName: 'Cursor column', type: 'string', default: 'id', required: true, noExpression: true, description: 'Monotonically increasing column (id or created_at)' },
    { name: 'pollMinutes', displayName: 'Check every (minutes)', type: 'number', default: 1, min: 1, noExpression: true },
    { name: 'limit', displayName: 'Max rows per check', type: 'number', default: 100, min: 1, max: 1000, noExpression: true },
  ],
  docs: 'On activation the current maximum cursor value is stored; every later check emits rows with a greater cursor value.',
  async poll(ctx) {
    const cred = await ctx.getCredential();
    const d = cred.data as Record<string, unknown>;
    await assertHostAllowed(String(d.host));
    const table = assertIdentifier(ctx.getParam<string>('table'), 'table name');
    const col = assertIdentifier(ctx.getParam<string>('cursorColumn'), 'column name');
    const limit = Math.min(1000, Number(ctx.getParam('limit', 100)));
    const { queryDatabase } = await import('./developer/sql');
    if (ctx.isFirstPoll || ctx.state.cursor === undefined) {
      const rows = await queryDatabase(cred.type as 'postgres' | 'mysql', d, `SELECT MAX(${col}) AS max FROM ${table}`, []);
      ctx.state.cursor = (rows[0] as { max?: unknown } | undefined)?.max ?? null;
      return null;
    }
    const cursor = ctx.state.cursor;
    const ph = cred.type === 'postgres' ? '$1' : '?';
    const rows = cursor === null
      ? await queryDatabase(cred.type as 'postgres' | 'mysql', d, `SELECT * FROM ${table} ORDER BY ${col} ASC LIMIT ${limit}`, [])
      : await queryDatabase(cred.type as 'postgres' | 'mysql', d, `SELECT * FROM ${table} WHERE ${col} > ${ph} ORDER BY ${col} ASC LIMIT ${limit}`, [cursor]);
    if (!rows.length) return null;
    const last = rows[rows.length - 1] as Record<string, unknown>;
    ctx.state.cursor = last[col] instanceof Date ? (last[col] as Date).toISOString() : (last[col] as never);
    return rows.map((r) => ({ json: r as Record<string, unknown> }));
  },
});

export const errorTrigger = defineNode({
  type: 'simplyai.errorTrigger', version: 1, displayName: 'Error Handler', category: 'logic', subcategory: 'Errors', icon: 'shield-alert', color: '#dc2626',
  description: 'Runs when any node in this workflow fails; connect notification or cleanup steps', trigger: 'error', inputs: [], outputs: main,
  properties: [],
  docs: 'When a node fails (and is not set to continue on fail), execution jumps here with `{ error, node, execution, workflow }`. The execution is still marked as failed.',
  outputExample: { error: { message: 'Request failed with status 500' }, node: { name: 'HTTP Request' }, execution: { id: 'abc' } },
});

export const triggerNodes: NodeDefinition[] = [
  manualTrigger, scheduleTrigger, webhookTrigger, formTrigger, emailTrigger, databaseTrigger, appEventTrigger, chatTrigger, errorTrigger,
];

export function assertNever(v: never): never {
  throw new NodeOperationError(`Unexpected value ${String(v)}`);
}
