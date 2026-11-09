import type { IntegrationDefinition, NodeDefinition, CredentialDefinition } from '@simplyai/sdk';

type Meta = Omit<IntegrationDefinition, 'triggers' | 'actions' | 'credentialTypes'> & { credentialTypes?: string[] };

const META: Meta[] = [
  { key: 'http', name: 'HTTP Request', description: 'Call any REST, GraphQL or webhook endpoint with built-in auth helpers and SSRF protection.', category: 'Developer', color: '#f97316', website: 'https://developer.mozilla.org/docs/Web/HTTP' },
  { key: 'webhook', name: 'Webhooks', description: 'Receive HTTP requests with authentication, signature verification and request history.', category: 'Developer', color: '#7c3aed' },
  { key: 'openai', name: 'OpenAI', description: 'GPT models for chat, generation, classification, embeddings and agents.', category: 'AI', logo: 'openai', color: '#10a37f', website: 'https://platform.openai.com' },
  { key: 'anthropic', name: 'Anthropic', description: 'Anthropic models for chat, analysis and tool-using agents.', category: 'AI', logo: 'anthropic', color: '#d97757', website: 'https://www.anthropic.com' },
  { key: 'gemini', name: 'Google Gemini', description: 'Gemini models for chat, multimodal reasoning and embeddings.', category: 'AI', logo: 'googlegemini', color: '#8e75b2', website: 'https://ai.google.dev' },
  { key: 'customLlm', name: 'Custom LLM', description: 'Any OpenAI-compatible endpoint: vLLM, Ollama, LM Studio, Groq, Together, Azure and more.', category: 'AI', color: '#6366f1' },
  { key: 'gmail', name: 'Gmail', description: 'Send, search, read and label Gmail messages.', category: 'Communication', logo: 'gmail', color: '#ea4335', website: 'https://mail.google.com', credentialTypes: ['googleOAuth2Api'] },
  { key: 'outlook', name: 'Outlook', description: 'Send and read Microsoft 365 mail through Microsoft Graph.', category: 'Communication', color: '#0078d4', credentialTypes: ['microsoftOAuth2Api'] },
  { key: 'slack', name: 'Slack', description: 'Post and update messages, react, list channels and look up users.', category: 'Communication', logo: 'slack', color: '#4a154b', website: 'https://api.slack.com' },
  { key: 'teams', name: 'Microsoft Teams', description: 'Post to channels with incoming webhooks or Microsoft Graph.', category: 'Communication', color: '#5059c9', credentialTypes: ['teamsWebhook', 'microsoftOAuth2Api'] },
  { key: 'discord', name: 'Discord', description: 'Send messages with webhooks or bots.', category: 'Communication', logo: 'discord', color: '#5865f2' },
  { key: 'telegram', name: 'Telegram', description: 'Bot messages, photos and documents.', category: 'Communication', logo: 'telegram', color: '#26a5e4' },
  { key: 'whatsapp', name: 'WhatsApp', description: 'Text and template messages through the WhatsApp Business Cloud API.', category: 'Communication', logo: 'whatsapp', color: '#25d366' },
  { key: 'sms', name: 'SMS', description: 'Send text messages through Twilio or Vonage.', category: 'Communication', color: '#0891b2', credentialTypes: ['twilioApi', 'vonageApi'] },
  { key: 'smtp', name: 'SMTP Email', description: 'Send email with attachments through any SMTP server.', category: 'Communication', color: '#0f766e' },
  { key: 'email', name: 'Email (IMAP)', description: 'Trigger workflows from new emails in any IMAP mailbox.', category: 'Communication', color: '#0f766e' },
  { key: 'twilio', name: 'Twilio', description: 'SMS, WhatsApp and voice calls.', category: 'Communication', logo: 'twilio', color: '#f22f46' },
  { key: 'googleSheets', name: 'Google Sheets', description: 'Append, read, update and clear spreadsheet rows.', category: 'Productivity', logo: 'googlesheets', color: '#0f9d58', credentialTypes: ['googleOAuth2Api'] },
  { key: 'googleDrive', name: 'Google Drive', description: 'Search, upload, download, share and delete files.', category: 'Productivity', logo: 'googledrive', color: '#1fa463', credentialTypes: ['googleOAuth2Api'] },
  { key: 'googleDocs', name: 'Google Docs', description: 'Create documents, read content and append text.', category: 'Productivity', logo: 'googledocs', color: '#4285f4', credentialTypes: ['googleOAuth2Api'] },
  { key: 'googleCalendar', name: 'Google Calendar', description: 'List, create and delete events.', category: 'Productivity', logo: 'googlecalendar', color: '#4285f4', credentialTypes: ['googleOAuth2Api'] },
  { key: 'airtable', name: 'Airtable', description: 'List, create, update and delete records.', category: 'Productivity', logo: 'airtable', color: '#18bfff' },
  { key: 'notion', name: 'Notion', description: 'Create pages, query databases and append content.', category: 'Productivity', logo: 'notion', color: '#000000' },
  { key: 'trello', name: 'Trello', description: 'Create and move cards, add comments.', category: 'Project management', logo: 'trello', color: '#0079bf' },
  { key: 'asana', name: 'Asana', description: 'Create, list and complete tasks.', category: 'Project management', logo: 'asana', color: '#f06a6a' },
  { key: 'jira', name: 'Jira', description: 'Create, search, comment on and transition issues.', category: 'Project management', logo: 'jira', color: '#0052cc' },
  { key: 'hubspot', name: 'HubSpot', description: 'Contacts, deals and CRM search.', category: 'CRM', logo: 'hubspot', color: '#ff7a59' },
  { key: 'salesforce', name: 'Salesforce', description: 'Records and SOQL queries.', category: 'CRM', color: '#00a1e0' },
  { key: 'shopify', name: 'Shopify', description: 'Orders, products and customers.', category: 'E-commerce', logo: 'shopify', color: '#96bf48' },
  { key: 'woocommerce', name: 'WooCommerce', description: 'Orders and products in WooCommerce stores.', category: 'E-commerce', logo: 'woocommerce', color: '#96588a' },
  { key: 'stripe', name: 'Stripe', description: 'Customers, payment intents, charges and invoices.', category: 'Finance', logo: 'stripe', color: '#635bff' },
  { key: 'wordpress', name: 'WordPress', description: 'Create, update and list posts.', category: 'Marketing', logo: 'wordpress', color: '#21759b' },
  { key: 'postgres', name: 'PostgreSQL', description: 'Query, insert, update and poll tables.', category: 'Databases', logo: 'postgresql', color: '#336791' },
  { key: 'mysql', name: 'MySQL', description: 'Query, insert, update and poll tables.', category: 'Databases', logo: 'mysql', color: '#00758f' },
  { key: 'mongodb', name: 'MongoDB', description: 'Find, insert, update, delete and aggregate documents.', category: 'Databases', logo: 'mongodb', color: '#47a248' },
  { key: 'redis', name: 'Redis', description: 'Keys, lists and pub/sub.', category: 'Databases', logo: 'redis', color: '#dc382d' },
  { key: 'supabase', name: 'Supabase', description: 'Rows through the Supabase REST API.', category: 'Databases', logo: 'supabase', color: '#3ecf8e' },
  { key: 'firebase', name: 'Firebase', description: 'Cloud Firestore documents.', category: 'Databases', logo: 'firebase', color: '#ffca28' },
];

export function buildIntegrations(nodes: NodeDefinition[], credentials: CredentialDefinition[]): IntegrationDefinition[] {
  return META.map((m) => {
    const related = nodes.filter((n) => n.integration === m.key || (m.key === 'http' && ['simplyai.httpRequest', 'simplyai.restApi', 'simplyai.graphql', 'simplyai.webhookCall'].includes(n.type)) || (m.key === 'webhook' && n.trigger === 'webhook'));
    const aiRelated = ['openai', 'anthropic', 'gemini', 'customLlm'].includes(m.key) ? nodes.filter((n) => n.category === 'ai' && n.credentials) : [];
    const all = [...new Set([...related, ...aiRelated])];
    const credentialTypes = m.credentialTypes ?? credentials.filter((c) => c.integration === m.key).map((c) => c.type);
    return {
      ...m,
      credentialTypes,
      triggers: all.filter((n) => n.trigger).map((n) => n.type),
      actions: all.filter((n) => !n.trigger).map((n) => n.type),
    };
  });
}
