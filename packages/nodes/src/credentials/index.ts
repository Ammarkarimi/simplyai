import { defineCredentialType, type CredentialDefinition, type NodeProperty } from '@simplyai/sdk';

const str = (name: string, displayName: string, extra: Partial<NodeProperty> = {}): NodeProperty => ({ name, displayName, type: 'string', required: true, ...extra });
const secret = (name: string, displayName: string, extra: Partial<NodeProperty> = {}): NodeProperty => ({ name, displayName, type: 'string', required: true, password: true, ...extra });
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const basic = (u: unknown, p: unknown) => `Basic ${Buffer.from(`${s(u)}:${s(p)}`).toString('base64')}`;
const bearer = (t: unknown) => ({ headers: { authorization: `Bearer ${s(t)}` } });
const oauthToken = (d: Record<string, unknown>) => s((d.oauthTokenData as Record<string, unknown> | undefined)?.access_token);

const oauthProps = (scopes: string): NodeProperty[] => [
  str('clientId', 'Client ID'),
  secret('clientSecret', 'Client secret'),
  { name: 'scope', displayName: 'Scopes', type: 'string', default: scopes, description: 'Space separated OAuth scopes' },
];

const connectionProps = (port: number): NodeProperty[] => [
  str('host', 'Host'),
  { name: 'port', displayName: 'Port', type: 'number', default: port, required: true },
  str('database', 'Database'),
  str('user', 'User'),
  secret('password', 'Password', { required: false }),
  { name: 'ssl', displayName: 'Use SSL', type: 'boolean', default: false },
];

export const credentialTypes: CredentialDefinition[] = [
  // ─── Generic HTTP ───
  defineCredentialType({
    type: 'httpHeaderAuth', displayName: 'Header Auth', authKind: 'apiKey', testable: false,
    properties: [str('name', 'Header name', { default: 'X-API-Key' }), secret('value', 'Header value')],
    authenticate: (d) => ({ headers: { [s(d.name)]: s(d.value) } }),
  }),
  defineCredentialType({
    type: 'httpBearerAuth', displayName: 'Bearer Token', authKind: 'apiKey', testable: false,
    properties: [secret('token', 'Token')],
    authenticate: (d) => bearer(d.token),
  }),
  defineCredentialType({
    type: 'httpBasicAuth', displayName: 'Basic Auth', authKind: 'basic', testable: false,
    properties: [str('user', 'User'), secret('password', 'Password')],
    authenticate: (d) => ({ headers: { authorization: basic(d.user, d.password) } }),
  }),
  defineCredentialType({
    type: 'httpQueryAuth', displayName: 'Query Auth', authKind: 'apiKey', testable: false,
    properties: [str('name', 'Parameter name'), secret('value', 'Parameter value')],
    authenticate: (d) => ({ query: { [s(d.name)]: s(d.value) } }),
  }),
  defineCredentialType({
    type: 'oAuth2Api', displayName: 'OAuth2 (generic)', authKind: 'oauth2', testable: false,
    description: 'Connect any OAuth2 provider using the authorization code flow',
    oauth2: { authorizationUrl: '', tokenUrl: '', scopes: [] },
    properties: [
      str('authUrl', 'Authorization URL', { placeholder: 'https://provider.com/oauth/authorize' }),
      str('accessTokenUrl', 'Access token URL', { placeholder: 'https://provider.com/oauth/token' }),
      ...oauthProps(''),
      { name: 'authQueryParameters', displayName: 'Extra authorization query', type: 'string', default: '', placeholder: 'access_type=offline&prompt=consent' },
    ],
    authenticate: (d) => bearer(oauthToken(d)),
  }),
  defineCredentialType({
    type: 'restApi', displayName: 'REST API Connection', authKind: 'custom', testable: true,
    description: 'Base URL plus authentication for the REST API node',
    properties: [
      str('baseUrl', 'Base URL', { placeholder: 'https://api.example.com/v1' }),
      { name: 'authType', displayName: 'Authentication', type: 'options', default: 'none', options: [
        { name: 'None', value: 'none' }, { name: 'Bearer token', value: 'bearer' }, { name: 'Header', value: 'header' }, { name: 'Basic auth', value: 'basic' },
      ] },
      { name: 'token', displayName: 'Token / header value / password', type: 'string', password: true, default: '', displayOptions: { hide: { authType: ['none'] } } },
      { name: 'headerName', displayName: 'Header name', type: 'string', default: 'X-API-Key', displayOptions: { show: { authType: ['header'] } } },
      { name: 'username', displayName: 'Username', type: 'string', default: '', displayOptions: { show: { authType: ['basic'] } } },
      { name: 'testPath', displayName: 'Test path', type: 'string', default: '/', description: 'GET request used to test the connection' },
    ],
    authenticate: (d) => {
      const headers: Record<string, string> = {};
      if (d.authType === 'bearer') headers.authorization = `Bearer ${s(d.token)}`;
      if (d.authType === 'header') headers[s(d.headerName) || 'x-api-key'] = s(d.token);
      if (d.authType === 'basic') headers.authorization = basic(d.username, d.token);
      return { headers, baseUrl: s(d.baseUrl) };
    },
    test: async (d, http) => {
      await http({ url: `${s(d.baseUrl).replace(/\/$/, '')}${s(d.testPath) || '/'}`, headers: {} });
    },
  }),

  // ─── AI providers ───
  defineCredentialType({
    type: 'openAiApi', displayName: 'OpenAI', integration: 'openai', authKind: 'apiKey', testable: true,
    properties: [secret('apiKey', 'API key'), { name: 'organization', displayName: 'Organization ID', type: 'string', default: '' }, { name: 'baseUrl', displayName: 'Base URL', type: 'string', default: 'https://api.openai.com/v1' }],
    authenticate: (d) => ({ headers: { authorization: `Bearer ${s(d.apiKey)}`, ...(d.organization ? { 'openai-organization': s(d.organization) } : {}) } }),
    test: async (d, http) => {
      await http({ url: `${s(d.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/models`, headers: { authorization: `Bearer ${s(d.apiKey)}` } });
    },
  }),
  defineCredentialType({
    type: 'anthropicApi', displayName: 'Anthropic', integration: 'anthropic', authKind: 'apiKey', testable: true,
    properties: [secret('apiKey', 'API key')],
    authenticate: (d) => ({ headers: { 'x-api-key': s(d.apiKey), 'anthropic-version': '2023-06-01' } }),
    test: async (d, http) => {
      await http({ url: 'https://api.anthropic.com/v1/models', headers: { 'x-api-key': s(d.apiKey), 'anthropic-version': '2023-06-01' } });
    },
  }),
  defineCredentialType({
    type: 'googleGeminiApi', displayName: 'Google Gemini', integration: 'gemini', authKind: 'apiKey', testable: true,
    properties: [secret('apiKey', 'API key')],
    authenticate: (d) => ({ headers: { 'x-goog-api-key': s(d.apiKey) } }),
    test: async (d, http) => {
      await http({ url: 'https://generativelanguage.googleapis.com/v1beta/models', headers: { 'x-goog-api-key': s(d.apiKey) } });
    },
  }),
  defineCredentialType({
    type: 'customLlmApi', displayName: 'Custom LLM (OpenAI compatible)', integration: 'customLlm', authKind: 'apiKey', testable: true,
    description: 'Any endpoint implementing the OpenAI chat completions API (vLLM, Ollama, LM Studio, Azure, Groq, Together…)',
    properties: [str('baseUrl', 'Base URL', { placeholder: 'http://localhost:11434/v1' }), secret('apiKey', 'API key', { required: false })],
    authenticate: (d) => (d.apiKey ? bearer(d.apiKey) : {}),
    test: async (d, http) => {
      await http({ url: `${s(d.baseUrl).replace(/\/$/, '')}/models`, headers: d.apiKey ? { authorization: `Bearer ${s(d.apiKey)}` } : {} });
    },
  }),

  // ─── Google & Microsoft OAuth2 ───
  defineCredentialType({
    type: 'googleOAuth2Api', displayName: 'Google OAuth2', integration: 'google', authKind: 'oauth2', testable: true,
    description: 'One connection for Gmail, Sheets, Drive, Docs and Calendar',
    docsUrl: 'https://developers.google.com/identity/protocols/oauth2/web-server',
    oauth2: {
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: [],
      authQueryParameters: { access_type: 'offline', prompt: 'consent' },
    },
    properties: oauthProps(
      'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/userinfo.email',
    ),
    authenticate: (d) => bearer(oauthToken(d)),
    test: async (d, http) => {
      const r = await http<{ email?: string }>({ url: 'https://www.googleapis.com/oauth2/v3/userinfo', headers: { authorization: `Bearer ${oauthToken(d)}` } });
      return r.body.email ? `Connected as ${r.body.email}` : undefined;
    },
  }),
  defineCredentialType({
    type: 'microsoftOAuth2Api', displayName: 'Microsoft 365 OAuth2', integration: 'microsoft', authKind: 'oauth2', testable: true,
    description: 'Outlook mail and Microsoft Teams through Microsoft Graph',
    oauth2: {
      authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scopes: [],
    },
    properties: oauthProps('offline_access User.Read Mail.ReadWrite Mail.Send ChannelMessage.Send Team.ReadBasic.All Channel.ReadBasic.All'),
    authenticate: (d) => bearer(oauthToken(d)),
    test: async (d, http) => {
      const r = await http<{ mail?: string; userPrincipalName?: string }>({ url: 'https://graph.microsoft.com/v1.0/me', headers: { authorization: `Bearer ${oauthToken(d)}` } });
      return `Connected as ${r.body.mail ?? r.body.userPrincipalName}`;
    },
  }),

  // ─── Communication ───
  defineCredentialType({
    type: 'slackApi', displayName: 'Slack', integration: 'slack', authKind: 'apiKey', testable: true,
    properties: [secret('accessToken', 'Bot / user OAuth token', { placeholder: 'xoxb-…' })],
    authenticate: (d) => bearer(d.accessToken),
    test: async (d, http) => {
      const r = await http<{ ok: boolean; error?: string; team?: string; user?: string }>({ url: 'https://slack.com/api/auth.test', method: 'POST', headers: { authorization: `Bearer ${s(d.accessToken)}` } });
      if (!r.body.ok) throw new Error(`Slack: ${r.body.error}`);
      return `Connected to ${r.body.team} as ${r.body.user}`;
    },
  }),
  defineCredentialType({
    type: 'teamsWebhook', displayName: 'Microsoft Teams Incoming Webhook', integration: 'teams', authKind: 'custom', testable: false,
    properties: [secret('webhookUrl', 'Webhook URL')],
  }),
  defineCredentialType({
    type: 'discordWebhook', displayName: 'Discord Webhook', integration: 'discord', authKind: 'custom', testable: true,
    properties: [secret('webhookUrl', 'Webhook URL', { placeholder: 'https://discord.com/api/webhooks/…' })],
    test: async (d, http) => {
      const r = await http<{ name?: string }>({ url: s(d.webhookUrl) });
      return `Webhook "${r.body.name}"`;
    },
  }),
  defineCredentialType({
    type: 'discordBotApi', displayName: 'Discord Bot', integration: 'discord', authKind: 'apiKey', testable: true,
    properties: [secret('botToken', 'Bot token')],
    authenticate: (d) => ({ headers: { authorization: `Bot ${s(d.botToken)}` } }),
    test: async (d, http) => {
      const r = await http<{ username?: string }>({ url: 'https://discord.com/api/v10/users/@me', headers: { authorization: `Bot ${s(d.botToken)}` } });
      return `Connected as ${r.body.username}`;
    },
  }),
  defineCredentialType({
    type: 'telegramApi', displayName: 'Telegram Bot', integration: 'telegram', authKind: 'apiKey', testable: true,
    properties: [secret('botToken', 'Bot token', { placeholder: '123456:ABC-DEF…' })],
    test: async (d, http) => {
      const r = await http<{ ok: boolean; result?: { username: string } }>({ url: `https://api.telegram.org/bot${s(d.botToken)}/getMe` });
      return `Connected as @${r.body.result?.username}`;
    },
  }),
  defineCredentialType({
    type: 'whatsAppApi', displayName: 'WhatsApp Cloud API', integration: 'whatsapp', authKind: 'apiKey', testable: true,
    properties: [secret('accessToken', 'Access token'), str('phoneNumberId', 'Phone number ID'), { name: 'apiVersion', displayName: 'Graph API version', type: 'string', default: 'v21.0' }],
    authenticate: (d) => bearer(d.accessToken),
    test: async (d, http) => {
      await http({ url: `https://graph.facebook.com/${s(d.apiVersion || 'v21.0')}/${s(d.phoneNumberId)}`, headers: { authorization: `Bearer ${s(d.accessToken)}` } });
    },
  }),
  defineCredentialType({
    type: 'twilioApi', displayName: 'Twilio', integration: 'twilio', authKind: 'basic', testable: true,
    properties: [str('accountSid', 'Account SID'), secret('authToken', 'Auth token')],
    authenticate: (d) => ({ headers: { authorization: basic(d.accountSid, d.authToken) } }),
    test: async (d, http) => {
      const r = await http<{ friendly_name?: string }>({ url: `https://api.twilio.com/2010-04-01/Accounts/${s(d.accountSid)}.json`, headers: { authorization: basic(d.accountSid, d.authToken) } });
      return `Account ${r.body.friendly_name}`;
    },
  }),
  defineCredentialType({
    type: 'vonageApi', displayName: 'Vonage SMS', integration: 'sms', authKind: 'apiKey', testable: false,
    properties: [str('apiKey', 'API key'), secret('apiSecret', 'API secret')],
  }),
  defineCredentialType({
    type: 'smtp', displayName: 'SMTP', integration: 'smtp', authKind: 'connection', testable: true,
    properties: [
      str('host', 'Host'),
      { name: 'port', displayName: 'Port', type: 'number', default: 587, required: true },
      { name: 'secure', displayName: 'Use TLS (port 465)', type: 'boolean', default: false },
      { name: 'user', displayName: 'User', type: 'string', default: '' },
      secret('password', 'Password', { required: false }),
      { name: 'from', displayName: 'Default sender', type: 'string', default: '', placeholder: 'Team <team@example.com>' },
    ],
  }),
  defineCredentialType({
    type: 'imap', displayName: 'IMAP', integration: 'email', authKind: 'connection', testable: true,
    properties: [
      str('host', 'Host'),
      { name: 'port', displayName: 'Port', type: 'number', default: 993, required: true },
      { name: 'secure', displayName: 'Use TLS', type: 'boolean', default: true },
      str('user', 'User'),
      secret('password', 'Password'),
    ],
  }),

  // ─── Business apps ───
  defineCredentialType({
    type: 'airtableApi', displayName: 'Airtable', integration: 'airtable', authKind: 'apiKey', testable: true,
    properties: [secret('accessToken', 'Personal access token')],
    authenticate: (d) => bearer(d.accessToken),
    test: async (d, http) => {
      await http({ url: 'https://api.airtable.com/v0/meta/whoami', headers: { authorization: `Bearer ${s(d.accessToken)}` } });
    },
  }),
  defineCredentialType({
    type: 'notionApi', displayName: 'Notion', integration: 'notion', authKind: 'apiKey', testable: true,
    properties: [secret('apiKey', 'Internal integration secret')],
    authenticate: (d) => ({ headers: { authorization: `Bearer ${s(d.apiKey)}`, 'notion-version': '2022-06-28' } }),
    test: async (d, http) => {
      await http({ url: 'https://api.notion.com/v1/users/me', headers: { authorization: `Bearer ${s(d.apiKey)}`, 'notion-version': '2022-06-28' } });
    },
  }),
  defineCredentialType({
    type: 'hubspotApi', displayName: 'HubSpot', integration: 'hubspot', authKind: 'apiKey', testable: true,
    properties: [secret('accessToken', 'Private app access token')],
    authenticate: (d) => bearer(d.accessToken),
    test: async (d, http) => {
      await http({ url: 'https://api.hubapi.com/crm/v3/objects/contacts?limit=1', headers: { authorization: `Bearer ${s(d.accessToken)}` } });
    },
  }),
  defineCredentialType({
    type: 'salesforceOAuth2Api', displayName: 'Salesforce', integration: 'salesforce', authKind: 'oauth2', testable: true,
    oauth2: { authorizationUrl: 'https://login.salesforce.com/services/oauth2/authorize', tokenUrl: 'https://login.salesforce.com/services/oauth2/token', scopes: [] },
    properties: [...oauthProps('api refresh_token'), { name: 'environment', displayName: 'Environment', type: 'options', default: 'production', options: [{ name: 'Production', value: 'production' }, { name: 'Sandbox', value: 'sandbox' }] }],
    authenticate: (d) => ({ ...bearer(oauthToken(d)), baseUrl: `${s((d.oauthTokenData as Record<string, unknown> | undefined)?.instance_url)}/services/data/v61.0` }),
    test: async (d, http) => {
      await http({ url: `${s((d.oauthTokenData as Record<string, unknown> | undefined)?.instance_url)}/services/data/v61.0/limits`, headers: { authorization: `Bearer ${oauthToken(d)}` } });
    },
  }),
  defineCredentialType({
    type: 'shopifyApi', displayName: 'Shopify', integration: 'shopify', authKind: 'apiKey', testable: true,
    properties: [str('shopDomain', 'Shop domain', { placeholder: 'my-store.myshopify.com' }), secret('accessToken', 'Admin API access token')],
    authenticate: (d) => ({ headers: { 'x-shopify-access-token': s(d.accessToken) }, baseUrl: `https://${s(d.shopDomain).replace(/^https?:\/\//, '').replace(/\/$/, '')}/admin/api/2024-10` }),
    test: async (d, http) => {
      const r = await http<{ shop?: { name: string } }>({ url: `https://${s(d.shopDomain).replace(/^https?:\/\//, '')}/admin/api/2024-10/shop.json`, headers: { 'x-shopify-access-token': s(d.accessToken) } });
      return `Connected to ${r.body.shop?.name}`;
    },
  }),
  defineCredentialType({
    type: 'wooCommerceApi', displayName: 'WooCommerce', integration: 'woocommerce', authKind: 'basic', testable: true,
    properties: [str('url', 'Store URL', { placeholder: 'https://shop.example.com' }), str('consumerKey', 'Consumer key'), secret('consumerSecret', 'Consumer secret')],
    authenticate: (d) => ({ headers: { authorization: basic(d.consumerKey, d.consumerSecret) }, baseUrl: `${s(d.url).replace(/\/$/, '')}/wp-json/wc/v3` }),
    test: async (d, http) => {
      await http({ url: `${s(d.url).replace(/\/$/, '')}/wp-json/wc/v3/system_status`, headers: { authorization: basic(d.consumerKey, d.consumerSecret) } });
    },
  }),
  defineCredentialType({
    type: 'wordpressApi', displayName: 'WordPress', integration: 'wordpress', authKind: 'basic', testable: true,
    properties: [str('url', 'Site URL'), str('username', 'Username'), secret('applicationPassword', 'Application password')],
    authenticate: (d) => ({ headers: { authorization: basic(d.username, d.applicationPassword) }, baseUrl: `${s(d.url).replace(/\/$/, '')}/wp-json/wp/v2` }),
    test: async (d, http) => {
      const r = await http<{ name?: string }>({ url: `${s(d.url).replace(/\/$/, '')}/wp-json/wp/v2/users/me`, headers: { authorization: basic(d.username, d.applicationPassword) } });
      return `Connected as ${r.body.name}`;
    },
  }),
  defineCredentialType({
    type: 'stripeApi', displayName: 'Stripe', integration: 'stripe', authKind: 'apiKey', testable: true,
    properties: [secret('secretKey', 'Secret key', { placeholder: 'sk_live_…' })],
    authenticate: (d) => bearer(d.secretKey),
    test: async (d, http) => {
      await http({ url: 'https://api.stripe.com/v1/balance', headers: { authorization: `Bearer ${s(d.secretKey)}` } });
    },
  }),
  defineCredentialType({
    type: 'trelloApi', displayName: 'Trello', integration: 'trello', authKind: 'apiKey', testable: true,
    properties: [str('apiKey', 'API key'), secret('apiToken', 'API token')],
    authenticate: (d) => ({ query: { key: s(d.apiKey), token: s(d.apiToken) } }),
    test: async (d, http) => {
      const r = await http<{ fullName?: string }>({ url: `https://api.trello.com/1/members/me?key=${encodeURIComponent(s(d.apiKey))}&token=${encodeURIComponent(s(d.apiToken))}` });
      return `Connected as ${r.body.fullName}`;
    },
  }),
  defineCredentialType({
    type: 'asanaApi', displayName: 'Asana', integration: 'asana', authKind: 'apiKey', testable: true,
    properties: [secret('accessToken', 'Personal access token')],
    authenticate: (d) => bearer(d.accessToken),
    test: async (d, http) => {
      await http({ url: 'https://app.asana.com/api/1.0/users/me', headers: { authorization: `Bearer ${s(d.accessToken)}` } });
    },
  }),
  defineCredentialType({
    type: 'jiraApi', displayName: 'Jira Cloud', integration: 'jira', authKind: 'basic', testable: true,
    properties: [str('domain', 'Site domain', { placeholder: 'your-team.atlassian.net' }), str('email', 'Email'), secret('apiToken', 'API token')],
    authenticate: (d) => ({ headers: { authorization: basic(d.email, d.apiToken) }, baseUrl: `https://${s(d.domain).replace(/^https?:\/\//, '').replace(/\/$/, '')}/rest/api/3` }),
    test: async (d, http) => {
      const r = await http<{ displayName?: string }>({ url: `https://${s(d.domain).replace(/^https?:\/\//, '')}/rest/api/3/myself`, headers: { authorization: basic(d.email, d.apiToken) } });
      return `Connected as ${r.body.displayName}`;
    },
  }),

  // ─── Databases ───
  defineCredentialType({ type: 'postgres', displayName: 'PostgreSQL', integration: 'postgres', authKind: 'connection', testable: true, properties: connectionProps(5432) }),
  defineCredentialType({ type: 'mysql', displayName: 'MySQL', integration: 'mysql', authKind: 'connection', testable: true, properties: connectionProps(3306) }),
  defineCredentialType({
    type: 'mongoDb', displayName: 'MongoDB', integration: 'mongodb', authKind: 'connection', testable: true,
    properties: [secret('connectionString', 'Connection string', { placeholder: 'mongodb+srv://user:pass@cluster/db' }), str('database', 'Database')],
  }),
  defineCredentialType({
    type: 'redis', displayName: 'Redis', integration: 'redis', authKind: 'connection', testable: true,
    properties: [
      str('host', 'Host'),
      { name: 'port', displayName: 'Port', type: 'number', default: 6379, required: true },
      secret('password', 'Password', { required: false }),
      { name: 'database', displayName: 'Database number', type: 'number', default: 0 },
      { name: 'tls', displayName: 'Use TLS', type: 'boolean', default: false },
    ],
  }),
  defineCredentialType({
    type: 'supabaseApi', displayName: 'Supabase', integration: 'supabase', authKind: 'apiKey', testable: true,
    properties: [str('url', 'Project URL', { placeholder: 'https://xyz.supabase.co' }), secret('serviceRoleKey', 'Service role key')],
    authenticate: (d) => ({ headers: { apikey: s(d.serviceRoleKey), authorization: `Bearer ${s(d.serviceRoleKey)}` }, baseUrl: `${s(d.url).replace(/\/$/, '')}/rest/v1` }),
    test: async (d, http) => {
      await http({ url: `${s(d.url).replace(/\/$/, '')}/rest/v1/`, headers: { apikey: s(d.serviceRoleKey), authorization: `Bearer ${s(d.serviceRoleKey)}` } });
    },
  }),
  defineCredentialType({
    type: 'firebaseServiceAccount', displayName: 'Firebase (service account)', integration: 'firebase', authKind: 'custom', testable: true,
    properties: [{ name: 'serviceAccountJson', displayName: 'Service account JSON', type: 'json', required: true, password: true, description: 'Paste the JSON key of a service account with Firestore access' }],
  }),
];
