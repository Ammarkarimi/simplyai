import { defineNode, NodeOperationError, type Item, type NodeDefinition } from '@simplyai/sdk';
import { defineRestNode, enc } from '../lib/rest';
import { assertHostAllowed } from '../lib/net';

const main = [{ name: 'main' }];

function mimeMessage(o: { to: string; cc?: string; bcc?: string; subject: string; body: string; html: boolean; from?: string; replyTo?: string }): string {
  const headers = [
    o.from ? `From: ${o.from}` : '',
    `To: ${o.to}`,
    o.cc ? `Cc: ${o.cc}` : '',
    o.bcc ? `Bcc: ${o.bcc}` : '',
    o.replyTo ? `Reply-To: ${o.replyTo}` : '',
    `Subject: =?UTF-8?B?${Buffer.from(o.subject).toString('base64')}?=`,
    'MIME-Version: 1.0',
    `Content-Type: ${o.html ? 'text/html' : 'text/plain'}; charset="UTF-8"`,
    'Content-Transfer-Encoding: base64',
  ].filter(Boolean);
  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${Buffer.from(o.body).toString('base64')}`).toString('base64url');
}

const emailProps = [
  { name: 'to', displayName: 'To', type: 'string' as const, default: '{{ $json.email }}', required: true },
  { name: 'cc', displayName: 'CC', type: 'string' as const, default: '' },
  { name: 'subject', displayName: 'Subject', type: 'string' as const, default: '', required: true },
  { name: 'body', displayName: 'Body', type: 'text' as const, default: '', required: true, rows: 6 },
  { name: 'html', displayName: 'Body is HTML', type: 'boolean' as const, default: false },
];

export const gmailNode = defineRestNode({
  type: 'simplyai.gmail', displayName: 'Gmail', description: 'Send, search and read Gmail messages', integration: 'gmail', category: 'communication',
  color: '#ea4335', credentialTypes: ['googleOAuth2Api'], baseUrl: 'https://gmail.googleapis.com/gmail/v1/users/me',
  operations: [
    {
      value: 'send', name: 'Send email', method: 'POST', url: () => '/messages/send',
      body: (p) => ({ raw: mimeMessage({ to: p('to'), cc: p('cc'), subject: p('subject'), body: p('body'), html: !!p('html') }) }),
      properties: emailProps,
    },
    {
      value: 'search', name: 'Search messages', method: 'GET', url: () => '/messages',
      query: (p) => ({ q: p('query'), maxResults: p('limit', 20) }),
      output: (b) => b.messages ?? [],
      properties: [{ name: 'query', displayName: 'Search query', type: 'string', default: 'is:unread newer_than:1d' }, { name: 'limit', displayName: 'Limit', type: 'number', default: 20 }],
    },
    {
      value: 'get', name: 'Get message', method: 'GET', url: (p) => `/messages/${enc(p('messageId'))}`, query: () => ({ format: 'full' }),
      output: (b) => {
        const headers = Object.fromEntries((b.payload?.headers ?? []).map((h: { name: string; value: string }) => [h.name.toLowerCase(), h.value]));
        const findText = (part: any): string => (part?.mimeType === 'text/plain' && part.body?.data ? Buffer.from(part.body.data, 'base64url').toString('utf8') : (part?.parts ?? []).map(findText).join(''));
        return { id: b.id, threadId: b.threadId, labelIds: b.labelIds, snippet: b.snippet, from: headers.from, to: headers.to, subject: headers.subject, date: headers.date, text: findText(b.payload) };
      },
      properties: [{ name: 'messageId', displayName: 'Message ID', type: 'string', default: '{{ $json.id }}', required: true }],
    },
    {
      value: 'reply', name: 'Reply to thread', method: 'POST', url: () => '/messages/send',
      body: (p) => ({ threadId: p('threadId'), raw: mimeMessage({ to: p('to'), subject: p('subject'), body: p('body'), html: !!p('html') }) }),
      properties: [{ name: 'threadId', displayName: 'Thread ID', type: 'string', default: '{{ $json.threadId }}', required: true }, ...emailProps.filter((p) => p.name !== 'cc')],
    },
    {
      value: 'addLabel', name: 'Add label', method: 'POST', url: (p) => `/messages/${enc(p('messageId'))}/modify`,
      body: (p) => ({ addLabelIds: String(p('labelIds')).split(',').map((s) => s.trim()) }),
      properties: [{ name: 'messageId', displayName: 'Message ID', type: 'string', default: '{{ $json.id }}', required: true }, { name: 'labelIds', displayName: 'Label IDs (comma separated)', type: 'string', default: 'STARRED' }],
    },
  ],
});

export const outlookNode = defineRestNode({
  type: 'simplyai.outlook', displayName: 'Outlook', description: 'Send and read Outlook / Microsoft 365 mail', integration: 'outlook', category: 'communication',
  color: '#0078d4', credentialTypes: ['microsoftOAuth2Api'], baseUrl: 'https://graph.microsoft.com/v1.0/me',
  operations: [
    {
      value: 'send', name: 'Send email', method: 'POST', url: () => '/sendMail',
      body: (p) => ({
        message: {
          subject: p('subject'), body: { contentType: p('html') ? 'HTML' : 'Text', content: p('body') },
          toRecipients: String(p('to')).split(',').map((a) => ({ emailAddress: { address: a.trim() } })),
          ccRecipients: String(p('cc') ?? '').split(',').filter((a) => a.trim()).map((a) => ({ emailAddress: { address: a.trim() } })),
        },
        saveToSentItems: true,
      }),
      output: () => ({ sent: true }),
      properties: emailProps,
    },
    {
      value: 'list', name: 'List messages', method: 'GET', url: (p) => `/mailFolders/${enc(p('folder', 'inbox'))}/messages`,
      query: (p) => ({ $top: p('limit', 20), $filter: p('filter') || undefined, $select: 'id,subject,from,receivedDateTime,bodyPreview,isRead' }),
      output: (b) => b.value ?? [],
      properties: [{ name: 'folder', displayName: 'Folder', type: 'string', default: 'inbox' }, { name: 'filter', displayName: 'OData filter', type: 'string', default: 'isRead eq false' }, { name: 'limit', displayName: 'Limit', type: 'number', default: 20 }],
    },
  ],
});

export const slackNode = defineRestNode({
  type: 'simplyai.slack', displayName: 'Slack', description: 'Send messages and interact with Slack channels', integration: 'slack', category: 'communication',
  color: '#4a154b', credentialTypes: ['slackApi'], baseUrl: 'https://slack.com/api',
  operations: [
    {
      value: 'postMessage', name: 'Send message', method: 'POST', url: () => '/chat.postMessage',
      body: (p) => ({ channel: p('channel'), text: p('text'), ...(p('threadTs') ? { thread_ts: p('threadTs') } : {}), ...(p<string>('blocks') ? { blocks: JSON.parse(p<string>('blocks')) } : {}) }),
      output: slackOk,
      properties: [
        { name: 'channel', displayName: 'Channel', type: 'string', default: '#general', required: true, description: 'Channel name or ID; the bot must be a member' },
        { name: 'text', displayName: 'Text', type: 'text', default: '', required: true },
        { name: 'threadTs', displayName: 'Reply in thread (ts)', type: 'string', default: '' },
        { name: 'blocks', displayName: 'Blocks (JSON, optional)', type: 'json', default: '' },
      ],
    },
    {
      value: 'updateMessage', name: 'Update message', method: 'POST', url: () => '/chat.update',
      body: (p) => ({ channel: p('channel'), ts: p('ts'), text: p('text') }), output: slackOk,
      properties: [
        { name: 'channel', displayName: 'Channel', type: 'string', default: '', required: true },
        { name: 'ts', displayName: 'Message ts', type: 'string', default: '{{ $json.ts }}', required: true },
        { name: 'text', displayName: 'Text', type: 'text', default: '', required: true },
      ],
    },
    {
      value: 'listChannels', name: 'List channels', method: 'GET', url: () => '/conversations.list', query: (p) => ({ limit: p('limit', 100), types: 'public_channel,private_channel' }),
      output: (b) => slackOk(b).channels ?? [],
      properties: [{ name: 'limit', displayName: 'Limit', type: 'number', default: 100 }],
    },
    {
      value: 'getUser', name: 'Find user by email', method: 'GET', url: () => '/users.lookupByEmail', query: (p) => ({ email: p('email') }),
      output: (b) => slackOk(b).user,
      properties: [{ name: 'email', displayName: 'Email', type: 'string', default: '{{ $json.email }}', required: true }],
    },
    {
      value: 'addReaction', name: 'Add reaction', method: 'POST', url: () => '/reactions.add',
      body: (p) => ({ channel: p('channel'), timestamp: p('ts'), name: p('emoji') }), output: slackOk,
      properties: [
        { name: 'channel', displayName: 'Channel', type: 'string', default: '', required: true },
        { name: 'ts', displayName: 'Message ts', type: 'string', default: '{{ $json.ts }}', required: true },
        { name: 'emoji', displayName: 'Emoji name', type: 'string', default: 'white_check_mark' },
      ],
    },
  ],
});

function slackOk(b: any) {
  if (b && b.ok === false) throw new NodeOperationError(`Slack API error: ${b.error}`);
  return b;
}

export const teamsNode = defineNode({
  type: 'simplyai.teams', version: 1, displayName: 'Microsoft Teams', category: 'communication', icon: 'teams', integration: 'teams', color: '#5059c9',
  description: 'Post messages to Teams channels (incoming webhook or Microsoft Graph)', inputs: main, outputs: main, usableAsTool: true,
  credentials: { types: ['teamsWebhook', 'microsoftOAuth2Api'], required: true },
  properties: [
    { name: 'text', displayName: 'Message', type: 'text', default: '', required: true },
    { name: 'title', displayName: 'Title (webhook)', type: 'string', default: '' },
    { name: 'teamId', displayName: 'Team ID (Graph)', type: 'string', default: '', description: 'Only for Microsoft 365 OAuth2 credentials' },
    { name: 'channelId', displayName: 'Channel ID (Graph)', type: 'string', default: '' },
  ],
  async execute(ctx) {
    const cred = await ctx.getCredential();
    const out: Item[] = [];
    const items = ctx.getInputItems().length ? ctx.getInputItems() : [{ json: {} }];
    for (let i = 0; i < items.length; i++) {
      const text = String(ctx.getParam('text', i));
      if (cred.type === 'teamsWebhook') {
        const title = ctx.getParam<string>('title', i);
        await ctx.http({
          url: String(cred.data.webhookUrl), method: 'POST',
          body: { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: { type: 'AdaptiveCard', version: '1.4', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', body: [...(title ? [{ type: 'TextBlock', weight: 'Bolder', size: 'Medium', text: title }] : []), { type: 'TextBlock', wrap: true, text }] } }] },
        });
        out.push({ json: { sent: true }, pairedItem: i });
      } else {
        const r = await ctx.httpWithAuth({ url: `https://graph.microsoft.com/v1.0/teams/${enc(ctx.getParam('teamId', i))}/channels/${enc(ctx.getParam('channelId', i))}/messages`, method: 'POST', body: { body: { contentType: 'html', content: text } } });
        out.push({ json: r.body as Record<string, unknown>, pairedItem: i });
      }
    }
    return [out];
  },
});

export const discordNode = defineNode({
  type: 'simplyai.discord', version: 1, displayName: 'Discord', category: 'communication', icon: 'discord', integration: 'discord', color: '#5865f2',
  description: 'Send messages through a webhook or bot', inputs: main, outputs: main, usableAsTool: true,
  credentials: { types: ['discordWebhook', 'discordBotApi'], required: true },
  properties: [
    { name: 'content', displayName: 'Message', type: 'text', default: '', required: true },
    { name: 'username', displayName: 'Username override (webhook)', type: 'string', default: '' },
    { name: 'channelId', displayName: 'Channel ID (bot)', type: 'string', default: '' },
  ],
  async execute(ctx) {
    const cred = await ctx.getCredential();
    const out: Item[] = [];
    const items = ctx.getInputItems().length ? ctx.getInputItems() : [{ json: {} }];
    for (let i = 0; i < items.length; i++) {
      const content = String(ctx.getParam('content', i)).slice(0, 2000);
      if (cred.type === 'discordWebhook') {
        const r = await ctx.http({ url: String(cred.data.webhookUrl), method: 'POST', query: { wait: 'true' }, body: { content, username: ctx.getParam<string>('username', i) || undefined } });
        out.push({ json: r.body as Record<string, unknown>, pairedItem: i });
      } else {
        const channel = ctx.getParam<string>('channelId', i);
        if (!channel) throw new NodeOperationError('Channel ID is required when using a bot credential');
        const r = await ctx.httpWithAuth({ url: `https://discord.com/api/v10/channels/${enc(channel)}/messages`, method: 'POST', body: { content } });
        out.push({ json: r.body as Record<string, unknown>, pairedItem: i });
      }
    }
    return [out];
  },
});

export const telegramNode = defineNode({
  type: 'simplyai.telegram', version: 1, displayName: 'Telegram', category: 'communication', icon: 'telegram', integration: 'telegram', color: '#26a5e4',
  description: 'Send messages, photos and documents with a Telegram bot', inputs: main, outputs: main, usableAsTool: true,
  credentials: { types: ['telegramApi'], required: true },
  properties: [
    { name: 'operation', displayName: 'Operation', type: 'options', default: 'sendMessage', noExpression: true, options: [{ name: 'Send message', value: 'sendMessage' }, { name: 'Send photo', value: 'sendPhoto' }, { name: 'Send document', value: 'sendDocument' }, { name: 'Get updates', value: 'getUpdates' }] },
    { name: 'chatId', displayName: 'Chat ID', type: 'string', default: '{{ $json.chatId }}', displayOptions: { hide: { operation: ['getUpdates'] } } },
    { name: 'text', displayName: 'Text / caption', type: 'text', default: '', displayOptions: { hide: { operation: ['getUpdates'] } } },
    { name: 'fileUrl', displayName: 'File URL', type: 'string', default: '', displayOptions: { show: { operation: ['sendPhoto', 'sendDocument'] } } },
    { name: 'parseMode', displayName: 'Formatting', type: 'options', default: '', displayOptions: { hide: { operation: ['getUpdates'] } }, options: [{ name: 'Plain', value: '' }, { name: 'Markdown', value: 'MarkdownV2' }, { name: 'HTML', value: 'HTML' }] },
  ],
  async execute(ctx) {
    const token = String((await ctx.getCredential()).data.botToken);
    const out: Item[] = [];
    const items = ctx.getInputItems().length ? ctx.getInputItems() : [{ json: {} }];
    for (let i = 0; i < items.length; i++) {
      const op = ctx.getRawParam<string>('operation');
      const base = `https://api.telegram.org/bot${token}/${op}`;
      const parseMode = ctx.getParam<string>('parseMode', i) || undefined;
      let body: Record<string, unknown> = {};
      if (op === 'sendMessage') body = { chat_id: ctx.getParam('chatId', i), text: ctx.getParam('text', i), parse_mode: parseMode };
      if (op === 'sendPhoto') body = { chat_id: ctx.getParam('chatId', i), photo: ctx.getParam('fileUrl', i), caption: ctx.getParam('text', i), parse_mode: parseMode };
      if (op === 'sendDocument') body = { chat_id: ctx.getParam('chatId', i), document: ctx.getParam('fileUrl', i), caption: ctx.getParam('text', i), parse_mode: parseMode };
      const r = await ctx.http<{ ok: boolean; result: unknown; description?: string }>({ url: base, method: 'POST', body });
      if (!r.body.ok) throw new NodeOperationError(`Telegram: ${r.body.description}`);
      const result = r.body.result;
      (Array.isArray(result) ? result : [result]).forEach((x) => out.push({ json: x as Record<string, unknown>, pairedItem: i }));
    }
    return [out];
  },
});

export const whatsappNode = defineRestNode({
  type: 'simplyai.whatsapp', displayName: 'WhatsApp', description: 'Send WhatsApp messages with the WhatsApp Business Cloud API', integration: 'whatsapp', category: 'communication',
  color: '#25d366', credentialTypes: ['whatsAppApi'],
  operations: [
    {
      value: 'sendText', name: 'Send text message', method: 'POST', url: () => '/messages',
      body: (p) => ({ messaging_product: 'whatsapp', recipient_type: 'individual', to: p('to'), type: 'text', text: { preview_url: false, body: p('text') } }),
      properties: [{ name: 'to', displayName: 'Recipient phone (E.164)', type: 'string', default: '{{ $json.phone }}', required: true }, { name: 'text', displayName: 'Message', type: 'text', default: '', required: true }],
    },
    {
      value: 'sendTemplate', name: 'Send template message', method: 'POST', url: () => '/messages',
      body: (p) => ({
        messaging_product: 'whatsapp', to: p('to'), type: 'template',
        template: { name: p('template'), language: { code: p('language', 'en_US') }, components: String(p('variables') ?? '').trim() ? [{ type: 'body', parameters: String(p('variables')).split('|').map((t) => ({ type: 'text', text: t.trim() })) }] : [] },
      }),
      properties: [
        { name: 'to', displayName: 'Recipient phone (E.164)', type: 'string', default: '{{ $json.phone }}', required: true },
        { name: 'template', displayName: 'Template name', type: 'string', default: 'hello_world', required: true },
        { name: 'language', displayName: 'Language code', type: 'string', default: 'en_US' },
        { name: 'variables', displayName: 'Body variables (separate with |)', type: 'string', default: '' },
      ],
    },
  ],
});
// The WhatsApp base URL depends on the phone number id stored in the credential.
const waExecute = whatsappNode.execute!;
whatsappNode.execute = async (ctx) => {
  const cred = await ctx.getCredential();
  const base = `https://graph.facebook.com/${String(cred.data.apiVersion || 'v21.0')}/${String(cred.data.phoneNumberId)}`;
  const wrapped = { ...ctx, httpWithAuth: (o: Parameters<typeof ctx.httpWithAuth>[0]) => ctx.httpWithAuth({ ...o, url: o.url.startsWith('/') ? base + o.url : o.url }) };
  return waExecute(wrapped as typeof ctx);
};

export const twilioNode = defineRestNode({
  type: 'simplyai.twilio', displayName: 'Twilio', description: 'Send SMS and WhatsApp messages or place calls with Twilio', integration: 'twilio', category: 'communication',
  color: '#f22f46', credentialTypes: ['twilioApi'],
  operations: [
    {
      value: 'sms', name: 'Send SMS', method: 'POST', bodyType: 'form',
      url: () => '/Messages.json', body: (p) => ({ To: p('to'), From: p('from'), Body: p('message') }),
      properties: [{ name: 'from', displayName: 'From', type: 'string', default: '', required: true }, { name: 'to', displayName: 'To', type: 'string', default: '{{ $json.phone }}', required: true }, { name: 'message', displayName: 'Message', type: 'text', default: '', required: true }],
    },
    {
      value: 'whatsapp', name: 'Send WhatsApp message', method: 'POST', bodyType: 'form',
      url: () => '/Messages.json', body: (p) => ({ To: `whatsapp:${String(p('to')).replace(/^whatsapp:/, '')}`, From: `whatsapp:${String(p('from')).replace(/^whatsapp:/, '')}`, Body: p('message') }),
      properties: [{ name: 'from', displayName: 'From', type: 'string', default: '', required: true }, { name: 'to', displayName: 'To', type: 'string', default: '{{ $json.phone }}', required: true }, { name: 'message', displayName: 'Message', type: 'text', default: '', required: true }],
    },
    {
      value: 'call', name: 'Make a call (text to speech)', method: 'POST', bodyType: 'form',
      url: () => '/Calls.json',
      body: (p) => ({ To: p('to'), From: p('from'), Twiml: `<Response><Say>${String(p('message')).replace(/[<>&]/g, '')}</Say></Response>` }),
      properties: [{ name: 'from', displayName: 'From', type: 'string', default: '', required: true }, { name: 'to', displayName: 'To', type: 'string', default: '{{ $json.phone }}', required: true }, { name: 'message', displayName: 'Message', type: 'text', default: '', required: true }],
    },
  ],
});
const twExecute = twilioNode.execute!;
twilioNode.execute = async (ctx) => {
  const sid = String((await ctx.getCredential()).data.accountSid);
  const base = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}`;
  return twExecute({ ...ctx, httpWithAuth: (o: Parameters<typeof ctx.httpWithAuth>[0]) => ctx.httpWithAuth({ ...o, url: o.url.startsWith('/') ? base + o.url : o.url }) } as typeof ctx);
};

export const smsNode = defineNode({
  type: 'simplyai.sms', version: 1, displayName: 'SMS', category: 'communication', icon: 'message-square-text', integration: 'sms', color: '#0891b2',
  description: 'Send SMS through Twilio or Vonage', inputs: main, outputs: main, usableAsTool: true,
  credentials: { types: ['twilioApi', 'vonageApi'], required: true },
  properties: [
    { name: 'from', displayName: 'From (number or sender id)', type: 'string', default: '', required: true },
    { name: 'to', displayName: 'To', type: 'string', default: '{{ $json.phone }}', required: true },
    { name: 'message', displayName: 'Message', type: 'text', default: '', required: true },
  ],
  async execute(ctx) {
    const cred = await ctx.getCredential();
    const out: Item[] = [];
    const items = ctx.getInputItems().length ? ctx.getInputItems() : [{ json: {} }];
    for (let i = 0; i < items.length; i++) {
      const from = ctx.getParam<string>('from', i), to = ctx.getParam<string>('to', i), text = String(ctx.getParam('message', i));
      if (cred.type === 'twilioApi') {
        const r = await ctx.httpWithAuth({ url: `https://api.twilio.com/2010-04-01/Accounts/${enc(cred.data.accountSid)}/Messages.json`, method: 'POST', bodyType: 'form', body: { To: to, From: from, Body: text } });
        out.push({ json: { provider: 'twilio', ...(r.body as object) }, pairedItem: i });
      } else {
        const r = await ctx.http<{ messages: Array<{ status: string; 'error-text'?: string }> }>({ url: 'https://rest.nexmo.com/sms/json', method: 'POST', bodyType: 'form', body: { api_key: cred.data.apiKey, api_secret: cred.data.apiSecret, from, to, text } });
        const m = r.body.messages?.[0];
        if (m && m.status !== '0') throw new NodeOperationError(`Vonage: ${m['error-text']}`);
        out.push({ json: { provider: 'vonage', ...(r.body as object) }, pairedItem: i });
      }
    }
    return [out];
  },
});

export const smtpNode = defineNode({
  type: 'simplyai.smtp', version: 1, displayName: 'Send Email (SMTP)', category: 'communication', icon: 'mail', integration: 'smtp', color: '#0f766e',
  description: 'Send email through any SMTP server', inputs: main, outputs: main, usableAsTool: true,
  credentials: { types: ['smtp'], required: true },
  properties: [
    { name: 'from', displayName: 'From', type: 'string', default: '', description: 'Defaults to the credential sender' },
    ...emailProps,
    { name: 'replyTo', displayName: 'Reply-To', type: 'string', default: '' },
    { name: 'attachments', displayName: 'Attach binary fields (comma separated)', type: 'string', default: '' },
  ],
  async execute(ctx) {
    const nodemailer = await import('nodemailer');
    const c = (await ctx.getCredential()).data as Record<string, unknown>;
    await assertHostAllowed(String(c.host));
    const transport = nodemailer.createTransport({
      host: String(c.host), port: Number(c.port ?? 587), secure: !!c.secure,
      auth: c.user ? { user: String(c.user), pass: String(c.password ?? '') } : undefined,
      connectionTimeout: 15_000, socketTimeout: 30_000,
    });
    try {
      const out: Item[] = [];
      const items = ctx.getInputItems().length ? ctx.getInputItems() : [{ json: {} }];
      for (let i = 0; i < items.length; i++) {
        const html = !!ctx.getParam('html', i);
        const body = String(ctx.getParam('body', i));
        const attachFields = String(ctx.getParam('attachments', i) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        const attachments = attachFields.map((f) => items[i]!.binary?.[f]).filter((b): b is NonNullable<typeof b> => !!b?.data).map((b) => ({ filename: b.fileName ?? 'file', content: Buffer.from(b.data!, 'base64'), contentType: b.mimeType }));
        const info = await transport.sendMail({
          from: ctx.getParam<string>('from', i) || String(c.from || c.user), to: ctx.getParam<string>('to', i), cc: ctx.getParam<string>('cc', i) || undefined,
          replyTo: ctx.getParam<string>('replyTo', i) || undefined, subject: ctx.getParam<string>('subject', i), ...(html ? { html: body } : { text: body }), attachments,
        });
        out.push({ json: { messageId: info.messageId, accepted: info.accepted as never, rejected: info.rejected as never }, pairedItem: i });
      }
      return [out];
    } finally {
      transport.close();
    }
  },
});

export const communicationNodes: NodeDefinition[] = [gmailNode, outlookNode, slackNode, teamsNode, discordNode, telegramNode, whatsappNode, smsNode, smtpNode, twilioNode];
