import type { PrismaClient, Prisma } from '@prisma/client';
import { note, workflow } from './builder';

const T = {
  webhook: 'simplyai.webhookTrigger', form: 'simplyai.formTrigger', schedule: 'simplyai.scheduleTrigger', manual: 'simplyai.manualTrigger', email: 'simplyai.emailTrigger', chat: 'simplyai.chatTrigger', error: 'simplyai.errorTrigger',
  classify: 'simplyai.textClassifier', llm: 'simplyai.llmChat', gen: 'simplyai.textGeneration', extract: 'simplyai.informationExtractor', summarize: 'simplyai.summarize', agent: 'simplyai.aiAgent',
  slack: 'simplyai.slack', jira: 'simplyai.jira', hubspot: 'simplyai.hubspot', smtp: 'simplyai.smtp', gmail: 'simplyai.gmail', sheets: 'simplyai.googleSheets', docs: 'simplyai.googleDocs',
  set: 'simplyai.set', code: 'simplyai.code', if: 'simplyai.if', loop: 'simplyai.loop', wait: 'simplyai.wait', approval: 'simplyai.approval', dataTable: 'simplyai.dataTable', http: 'simplyai.httpRequest',
  sort: 'simplyai.sort', telegram: 'simplyai.telegram', discord: 'simplyai.discord', mapping: 'simplyai.mapping', salesforce: 'simplyai.salesforce', wordpress: 'simplyai.wordpress', notion: 'simplyai.notion',
  whatsapp: 'simplyai.whatsapp', filter: 'simplyai.filter', aggregate: 'simplyai.aggregate', merge: 'simplyai.merge',
};

export const TEMPLATES: Array<{ name: string; description: string; category: string; tags: string[]; icon: string; featured?: boolean; definition: ReturnType<typeof workflow> }> = [
  {
    name: 'AI Customer Support Automation', category: 'Customer support', icon: 'headphones', featured: true, tags: ['ai', 'support', 'slack', 'jira'],
    description: 'Classify incoming support requests with AI and route them: billing questions to Slack, bugs to Jira, sales leads to HubSpot and everything else gets an AI-drafted email reply.',
    definition: workflow(
      [
        ['in', 'Support Request', T.webhook, 0, 200, { methods: ['POST'], responseMode: 'IMMEDIATE' }],
        ['cls', 'Classify Request', T.classify, 260, 200, { text: '{{ $json.body.subject }}\n{{ $json.body.message }}', categories: [{ name: 'Billing', description: 'Invoices, refunds, payments' }, { name: 'Technical', description: 'Bugs, errors, outages' }, { name: 'Sales', description: 'Pricing, demos, upgrades' }] }],
        ['billing', 'Notify Billing Team', T.slack, 560, 40, { operation: 'postMessage', channel: '#billing', text: ':money_with_wings: New billing request from {{ $json.body.email }}: {{ $json.body.subject }}' }],
        ['bug', 'Create Jira Bug', T.jira, 560, 170, { operation: 'createIssue', projectKey: 'SUP', issueType: 'Bug', summary: '{{ $json.body.subject }}', description: '{{ $json.body.message }}\n\nReported by {{ $json.body.email }}' }],
        ['lead', 'Upsert HubSpot Contact', T.hubspot, 560, 300, { operation: 'upsertContact', email: '{{ $json.body.email }}', firstName: '{{ $json.body.name }}' }],
        ['draft', 'Draft Reply', T.llm, 560, 430, { systemPrompt: 'You are a friendly support agent for {{ $vars.COMPANY_NAME }}. Write a concise, helpful reply. Sign as "The Support Team".', prompt: '{{ $json.body.message }}' }],
        ['send', 'Send Reply', T.smtp, 820, 430, { to: "{{ $('Support Request').item.json.body.email }}", subject: "Re: {{ $('Support Request').item.json.body.subject }}", body: '{{ $json.response }}' }],
      ],
      [['in', 'cls'], ['cls', 'billing', 0], ['cls', 'bug', 1], ['cls', 'lead', 2], ['cls', 'draft', 3], ['draft', 'send']],
      { annotations: [note('n1', 'POST { email, name, subject, message } to the webhook URL. Configure Slack, Jira, HubSpot, SMTP and an LLM credential.', 0, 20)] },
    ),
  },
  {
    name: 'Lead Generation Automation', category: 'Sales', icon: 'magnet', featured: true, tags: ['form', 'crm', 'lead scoring'],
    description: 'Publish a hosted lead form, score each submission, sync it to HubSpot and alert sales in Slack for hot leads while logging everything to Google Sheets.',
    definition: workflow(
      [
        ['form', 'Lead Form', T.form, 0, 200, { formTitle: 'Talk to sales', formDescription: 'Tell us about your team and we will get back within a day.', fields: [{ label: 'Full name', name: 'name', fieldType: 'text', required: true }, { label: 'Work email', name: 'email', fieldType: 'email', required: true }, { label: 'Company', name: 'company', fieldType: 'text', required: true }, { label: 'Team size', name: 'teamSize', fieldType: 'select', options: '1-10,11-50,51-200,200+', required: true }, { label: 'What do you want to automate?', name: 'message', fieldType: 'textarea' }], successMessage: 'Thanks! Our team will contact you shortly.' }],
        ['score', 'Score Lead', T.code, 260, 200, { mode: 'each', code: "const sizes = { '1-10': 10, '11-50': 30, '51-200': 50, '200+': 70 };\nconst freeMail = /@(gmail|yahoo|hotmail|outlook)\\./i.test($json.email);\nconst score = (sizes[$json.teamSize] ?? 0) + (freeMail ? 0 : 20) + (($json.message ?? '').length > 80 ? 10 : 0);\nreturn { ...$json, score, tier: score >= 60 ? 'hot' : score >= 30 ? 'warm' : 'cold' };" }],
        ['crm', 'Sync to HubSpot', T.hubspot, 520, 200, { operation: 'upsertContact', email: '{{ $json.email }}', firstName: "{{ $json.name.split(' ')[0] }}", lastName: "{{ $json.name.split(' ').slice(1).join(' ') }}", properties: '{ "company": "{{ $json.company }}" }' }],
        ['hot', 'Hot Lead?', T.if, 780, 200, { conditions: { combinator: 'and', conditions: [{ left: "{{ $('Score Lead').item.json.score }}", operator: 'gte', right: '60' }] } }],
        ['alert', 'Alert Sales', T.slack, 1040, 100, { operation: 'postMessage', channel: '#sales', text: ":fire: Hot lead: {{ $('Score Lead').item.json.name }} ({{ $('Score Lead').item.json.company }}, {{ $('Score Lead').item.json.teamSize }}) score {{ $('Score Lead').item.json.score }}" }],
        ['log', 'Log to Sheet', T.sheets, 1040, 300, { operation: 'append', spreadsheetId: 'YOUR_SHEET_ID', range: 'Leads!A:F', values: "[\"{{ $('Score Lead').item.json.name }}\", \"{{ $('Score Lead').item.json.email }}\", \"{{ $('Score Lead').item.json.company }}\", \"{{ $('Score Lead').item.json.score }}\", \"{{ $now }}\"]" }],
      ],
      [['form', 'score'], ['score', 'crm'], ['crm', 'hot'], ['hot', 'alert', 0], ['hot', 'log', 1]],
    ),
  },
  {
    name: 'Email Marketing Automation', category: 'Marketing', icon: 'mail', tags: ['email', 'ai', 'personalization', 'loop'],
    description: 'Every Monday, read subscribers from Google Sheets, write a personalized email for each one with AI, send it with rate limiting and post a summary to Slack.',
    definition: workflow(
      [
        ['cron', 'Every Monday 9:00', T.schedule, 0, 200, { mode: 'cron', cron: '0 9 * * 1', timezone: 'UTC' }],
        ['read', 'Read Subscribers', T.sheets, 240, 200, { operation: 'read', spreadsheetId: 'YOUR_SHEET_ID', range: 'Subscribers!A:D', headerRow: true }],
        ['active', 'Only Subscribed', T.filter, 480, 200, { conditions: { combinator: 'and', conditions: [{ left: '{{ $json.status }}', operator: 'equals', right: 'subscribed' }] } }],
        ['loop', 'For Each Subscriber', T.loop, 720, 200, { batchSize: 1 }],
        ['write', 'Personalize Email', T.gen, 960, 320, { prompt: 'Write a 3 sentence friendly weekly update email for {{ $json.name }} who is interested in {{ $json.interest }}. Mention our new automation templates. No subject line.', target: 'emailBody' }],
        ['send', 'Send Email', T.smtp, 1200, 320, { to: '{{ $json.email }}', subject: 'Your weekly automation tips', body: '{{ $json.emailBody }}' }, { settings: { continueOnFail: true } }],
        ['throttle', 'Throttle', T.wait, 1440, 320, { mode: 'interval', amount: 2, unit: 'seconds' }],
        ['count', 'Count Sent', T.aggregate, 960, 80, { operation: 'count', target: 'sent' }],
        ['report', 'Post Summary', T.slack, 1200, 80, { operation: 'postMessage', channel: '#marketing', text: 'Weekly campaign sent to {{ $json.sent }} subscribers.' }],
      ],
      [['cron', 'read'], ['read', 'active'], ['active', 'loop'], ['loop', 'write', 1], ['write', 'send'], ['send', 'throttle'], ['throttle', 'loop'], ['loop', 'count', 0], ['count', 'report']],
    ),
  },
  {
    name: 'Invoice Processing', category: 'Finance', icon: 'receipt', featured: true, tags: ['ai', 'extraction', 'approval', 'email'],
    description: 'Watch a mailbox for invoices, extract vendor, number, amount and due date with AI, require human approval above a threshold and store results in a data table.',
    definition: workflow(
      [
        ['mail', 'New Invoice Email', T.email, 0, 200, { mailbox: 'INBOX', pollMinutes: 5 }],
        ['extract', 'Extract Invoice Data', T.extract, 260, 200, { text: '{{ $json.subject }}\n{{ $json.text }}', attributes: [{ name: 'vendor', type: 'string', description: 'Company that issued the invoice', required: true }, { name: 'invoiceNumber', type: 'string', description: 'Invoice number', required: true }, { name: 'amount', type: 'number', description: 'Total amount due', required: true }, { name: 'currency', type: 'string', description: 'ISO currency code' }, { name: 'dueDate', type: 'string', description: 'Due date in YYYY-MM-DD' }] }],
        ['big', 'Above 1,000?', T.if, 520, 200, { conditions: { combinator: 'and', conditions: [{ left: '{{ $json.extracted.amount }}', operator: 'gt', right: '1000' }] } }],
        ['approve', 'Finance Approval', T.approval, 780, 100, { message: 'Approve invoice {{ $json.extracted.invoiceNumber }} from {{ $json.extracted.vendor }} for {{ $json.extracted.amount }} {{ $json.extracted.currency }}?' }],
        ['merge', 'Approved Invoices', T.merge, 1040, 200, { mode: 'append' }],
        ['store', 'Store Invoice', T.dataTable, 1280, 200, { operation: 'insert', tableId: '', data: '{ "vendor": "{{ $json.extracted.vendor }}", "number": "{{ $json.extracted.invoiceNumber }}", "amount": {{ $json.extracted.amount }}, "dueDate": "{{ $json.extracted.dueDate }}", "status": "approved" }' }],
        ['rejected', 'Notify Rejection', T.slack, 1040, 40, { operation: 'postMessage', channel: '#finance', text: 'Invoice {{ $json.extracted.invoiceNumber }} was rejected by {{ $json.approval.by }}.' }],
      ],
      [['mail', 'extract'], ['extract', 'big'], ['big', 'approve', 0], ['big', 'merge', 1, 1], ['approve', 'merge', 0, 0], ['approve', 'rejected', 1], ['merge', 'store']],
    ),
  },
  {
    name: 'WhatsApp Customer Support', category: 'Customer support', icon: 'message-circle', tags: ['whatsapp', 'ai agent', 'support'],
    description: 'Answer WhatsApp messages 24/7 with an AI agent that remembers each customer conversation and escalates when it cannot help.',
    definition: workflow(
      [
        ['in', 'WhatsApp Webhook', T.webhook, 0, 200, { methods: ['POST'] }],
        ['parse', 'Extract Message', T.set, 240, 200, { keepOnlySet: true, assignments: [{ name: 'phone', type: 'string', value: '{{ $json.body.entry[0].changes[0].value.messages[0].from }}' }, { name: 'message', type: 'string', value: '{{ $json.body.entry[0].changes[0].value.messages[0].text.body }}' }] }],
        ['has', 'Has Text?', T.if, 480, 200, { conditions: { combinator: 'and', conditions: [{ left: '{{ $json.message }}', operator: 'isNotEmpty' }] } }],
        ['agent', 'Support Agent', T.agent, 720, 140, { agentId: '', input: '{{ $json.message }}', sessionId: 'whatsapp-{{ $json.phone }}' }],
        ['reply', 'Send WhatsApp Reply', T.whatsapp, 960, 140, { operation: 'sendText', to: "{{ $('Extract Message').item.json.phone }}", text: '{{ $json.output }}' }],
      ],
      [['in', 'parse'], ['parse', 'has'], ['has', 'agent', 0], ['agent', 'reply']],
      { annotations: [note('n1', 'Point your WhatsApp Cloud API webhook to this workflow and pick an agent from AI Agents.', 0, 30)] },
    ),
  },
  {
    name: 'Social Media Automation', category: 'Marketing', icon: 'share-2', tags: ['content', 'ai', 'telegram', 'discord', 'approval'],
    description: 'Every morning, fetch your latest blog post, write a social post with AI, wait for human approval and publish it to Telegram and Discord.',
    definition: workflow(
      [
        ['cron', 'Every Day 8:00', T.schedule, 0, 200, { mode: 'cron', cron: '0 8 * * *' }],
        ['fetch', 'Fetch Latest Posts', T.http, 240, 200, { method: 'GET', url: 'https://your-blog.example.com/wp-json/wp/v2/posts?per_page=5' }],
        ['latest', 'Newest Post', T.sort, 480, 200, { field: 'date', order: 'desc', limit: 1 }],
        ['write', 'Write Social Post', T.gen, 720, 200, { prompt: 'Write an engaging social post (max 240 characters, 2 hashtags) announcing this article: "{{ $json.title.rendered }}" {{ $json.link }}', target: 'post' }],
        ['ok', 'Approve Post', T.approval, 960, 200, { message: 'Publish this post?\n\n{{ $json.post }}' }],
        ['tg', 'Post to Telegram', T.telegram, 1200, 120, { operation: 'sendMessage', chatId: '@your_channel', text: '{{ $json.post }}' }],
        ['dc', 'Post to Discord', T.discord, 1200, 280, { content: '{{ $json.post }}' }],
      ],
      [['cron', 'fetch'], ['fetch', 'latest'], ['latest', 'write'], ['write', 'ok'], ['ok', 'tg', 0], ['ok', 'dc', 0]],
    ),
  },
  {
    name: 'CRM Synchronization', category: 'Sales', icon: 'refresh-cw', tags: ['hubspot', 'salesforce', 'sync', 'error handling'],
    description: 'Hourly sync of new HubSpot contacts into Salesforce leads with field mapping, retries and an error handler that alerts the team.',
    definition: workflow(
      [
        ['cron', 'Every Hour', T.schedule, 0, 200, { mode: 'interval', intervalValue: 1, intervalUnit: 'hours' }],
        ['search', 'Recent HubSpot Contacts', T.hubspot, 240, 200, { operation: 'searchContacts', query: '', limit: 50 }],
        ['map', 'Map to Salesforce Lead', T.mapping, 480, 200, { mappings: [{ target: 'FirstName', source: '{{ $json.properties.firstname }}' }, { target: 'LastName', source: '{{ $json.properties.lastname }}', defaultValue: 'Unknown' }, { target: 'Email', source: '{{ $json.properties.email }}' }, { target: 'Company', source: '{{ $json.properties.company }}', defaultValue: 'Unknown' }, { target: 'LeadSource', source: 'HubSpot' }] }],
        ['create', 'Create Salesforce Lead', T.salesforce, 720, 200, { operation: 'create', sobject: 'Lead', fields: '{{ JSON.stringify($json) }}' }, { settings: { retry: { enabled: true, maxTries: 3, waitBetweenMs: 2000, backoff: 'exponential' } } }],
        ['err', 'On Error', T.error, 240, 420],
        ['alert', 'Alert Ops', T.slack, 480, 420, { operation: 'postMessage', channel: '#ops-alerts', text: ':warning: CRM sync failed at "{{ $json.node.name }}": {{ $json.error.message }}' }],
      ],
      [['cron', 'search'], ['search', 'map'], ['map', 'create'], ['err', 'alert']],
    ),
  },
  {
    name: 'AI Content Generation', category: 'Marketing', icon: 'pen-tool', featured: true, tags: ['ai', 'wordpress', 'notion', 'content'],
    description: 'Turn a topic into a researched outline and full blog article with AI, save it as a WordPress draft and log it in a Notion content calendar.',
    definition: workflow(
      [
        ['start', 'Topic', T.manual, 0, 200, { testData: '{ "topic": "How small businesses can automate invoicing", "audience": "small business owners", "tone": "practical" }' }],
        ['outline', 'Create Outline', T.gen, 240, 200, { prompt: 'Create a blog post outline (H2/H3 headings with one-line notes) about "{{ $json.topic }}" for {{ $json.audience }}. Tone: {{ $json.tone }}.', target: 'outline' }],
        ['article', 'Write Article', T.gen, 480, 200, { prompt: 'Write a 900-word article in HTML (h2, p, ul) following this outline:\n{{ $json.outline }}', target: 'html', maxTokens: 2500 }],
        ['wp', 'Save WordPress Draft', T.wordpress, 720, 120, { operation: 'createPost', title: "{{ $('Topic').item.json.topic }}", content: '{{ $json.html }}', status: 'draft' }],
        ['notion', 'Log in Notion', T.notion, 720, 300, { operation: 'createPage', databaseId: 'YOUR_DATABASE_ID', titleProperty: 'Name', title: "{{ $('Topic').item.json.topic }}", content: 'Draft created automatically by SimplyAI.' }],
      ],
      [['start', 'outline'], ['outline', 'article'], ['article', 'wp'], ['article', 'notion']],
    ),
  },
  {
    name: 'Document Processing', category: 'Operations', icon: 'file-text', tags: ['ai', 'summarization', 'google docs'],
    description: 'Receive documents through a webhook, summarize them, extract key entities and create a Google Doc report, returning the summary to the caller.',
    definition: workflow(
      [
        ['in', 'Document Webhook', T.webhook, 0, 200, { methods: ['POST'], responseMode: 'LAST_NODE' }],
        ['sum', 'Summarize', T.summarize, 240, 200, { text: '{{ $json.body.text }}', style: 'bullets', maxWords: 150 }],
        ['ent', 'Extract Entities', T.extract, 480, 200, { text: "{{ $('Document Webhook').item.json.body.text }}", attributes: [{ name: 'people', type: 'array', description: 'Names of people' }, { name: 'organizations', type: 'array', description: 'Company names' }, { name: 'dates', type: 'array', description: 'Important dates' }, { name: 'actionItems', type: 'array', description: 'Tasks to do' }] }],
        ['doc', 'Create Report Doc', T.docs, 720, 200, { operation: 'create', title: "Summary: {{ $('Document Webhook').item.json.body.title }}" }],
        ['append', 'Write Report', T.docs, 960, 200, { operation: 'append', documentId: '{{ $json.documentId }}', text: "Summary\n{{ $('Summarize').item.json.summary }}\n\nAction items\n{{ $('Extract Entities').item.json.extracted.actionItems }}" }],
        ['out', 'Response', T.set, 1200, 200, { keepOnlySet: true, assignments: [{ name: 'summary', type: 'string', value: "{{ $('Summarize').item.json.summary }}" }, { name: 'entities', type: 'json', value: "{{ JSON.stringify($('Extract Entities').item.json.extracted) }}" }, { name: 'documentId', type: 'string', value: "{{ $('Create Report Doc').item.json.documentId }}" }] }],
      ],
      [['in', 'sum'], ['sum', 'ent'], ['ent', 'doc'], ['doc', 'append'], ['append', 'out']],
    ),
  },
  {
    name: 'Sales Follow-up Automation', category: 'Sales', icon: 'calendar-check', tags: ['follow-up', 'gmail', 'data tables', 'ai'],
    description: 'Each weekday, find leads that have not heard from you in 3 days, write a personal follow-up with AI, send it from Gmail and update the lead record.',
    definition: workflow(
      [
        ['cron', 'Weekdays 9:30', T.schedule, 0, 200, { mode: 'cron', cron: '30 9 * * 1-5' }],
        ['find', 'Contacted Leads', T.dataTable, 240, 200, { operation: 'find', tableId: '', filterColumn: 'status', filterOperator: 'eq', filterValue: 'contacted', limit: 100 }],
        ['due', 'Older Than 3 Days', T.filter, 480, 200, { conditions: { combinator: 'and', conditions: [{ left: '{{ $json.lastContactedAt }}', operator: 'before', right: "{{ $date.add($now, -3, 'days') }}" }] } }],
        ['write', 'Write Follow-up', T.llm, 720, 200, { systemPrompt: 'You are a helpful sales rep. Write a short, warm follow-up email (max 90 words). No subject line.', prompt: 'Lead: {{ $json.name }} at {{ $json.company }}. Last topic: {{ $json.notes }}' }],
        ['send', 'Send via Gmail', T.gmail, 960, 200, { operation: 'send', to: "{{ $('Older Than 3 Days').item.json.email }}", subject: 'Quick follow-up', body: '{{ $json.response }}' }],
        ['update', 'Update Lead', T.dataTable, 1200, 200, { operation: 'update', tableId: '', filterColumn: 'email', filterOperator: 'eq', filterValue: "{{ $('Older Than 3 Days').item.json.email }}", data: '{ "status": "followed_up", "lastContactedAt": "{{ $now }}" }' }],
      ],
      [['cron', 'find'], ['find', 'due'], ['due', 'write', 0], ['write', 'send'], ['send', 'update']],
    ),
  },
];

export async function seedTemplates(db: PrismaClient): Promise<number> {
  for (const t of TEMPLATES) {
    const existing = await db.template.findFirst({ where: { name: t.name, visibility: 'PUBLIC', workspaceId: null } });
    const data = { name: t.name, description: t.description, category: t.category, tags: t.tags, icon: t.icon, featured: !!t.featured, visibility: 'PUBLIC' as const, definition: t.definition as unknown as Prisma.InputJsonValue };
    if (existing) await db.template.update({ where: { id: existing.id }, data });
    else await db.template.create({ data });
  }
  return TEMPLATES.length;
}
