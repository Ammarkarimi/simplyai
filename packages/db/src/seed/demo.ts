import type { Prisma, PrismaClient } from '@prisma/client';
import type { WorkflowDefinition } from '@simplyai/shared';
import { hashPassword } from '../password';
import { note, workflow } from './builder';

export const DEMO_EMAIL = 'admin@simplyai.dev';
export const DEMO_PASSWORD = 'SimplyAI-demo1';

const ORDERS = [
  { id: 1001, customer: 'Ada Lovelace', email: 'ada@example.com', items: [{ sku: 'PRO-PLAN', qty: 1, price: 79 }, { sku: 'ADDON-AI', qty: 2, price: 25 }] },
  { id: 1002, customer: 'Alan Turing', email: 'alan@example.com', items: [{ sku: 'STARTER', qty: 1, price: 24 }] },
  { id: 1003, customer: 'Grace Hopper', email: 'grace@example.com', items: [{ sku: 'BUSINESS', qty: 1, price: 299 }] },
];

function demoWorkflows(leadsTableId: string): Array<{ name: string; description: string; tags: string[]; definition: WorkflowDefinition }> {
  return [
    {
      name: 'Order Processing (demo)', tags: ['demo', 'orders'],
      description: 'Computes order totals in the code sandbox, routes high-value orders and aggregates revenue. Runs without any credentials.',
      definition: workflow(
        [
          ['t', 'New Orders', 'simplyai.manualTrigger', 0, 220, { testData: JSON.stringify(ORDERS, null, 2) }],
          ['total', 'Compute Totals', 'simplyai.code', 260, 220, { mode: 'each', code: 'const total = $json.items.reduce((s, i) => s + i.qty * i.price, 0);\nreturn { ...$json, total, itemCount: $json.items.length };' }],
          ['big', 'High Value?', 'simplyai.if', 520, 220, { conditions: { combinator: 'and', conditions: [{ left: '{{ $json.total }}', operator: 'gt', right: '100' }] } }],
          ['vip', 'Mark Priority', 'simplyai.set', 780, 120, { assignments: [{ name: 'priority', type: 'string', value: 'high' }, { name: 'note', type: 'string', value: 'Thank {{ $json.customer }} personally' }] }],
          ['std', 'Mark Standard', 'simplyai.set', 780, 320, { assignments: [{ name: 'priority', type: 'string', value: 'normal' }] }],
          ['merge', 'All Orders', 'simplyai.merge', 1040, 220, { mode: 'append' }],
          ['sum', 'Revenue', 'simplyai.aggregate', 1300, 220, { operation: 'sum', field: 'total', target: 'revenue' }],
        ],
        [['t', 'total'], ['total', 'big'], ['big', 'vip', 0], ['big', 'std', 1], ['vip', 'merge', 0, 0], ['std', 'merge', 0, 1], ['merge', 'sum']],
        { annotations: [note('a1', 'Click "Execute workflow" to watch each node run live. Open a node to inspect its input and output.', 0, 40, 360, 100)] },
      ),
    },
    {
      name: 'Lead Capture Webhook (demo)', tags: ['demo', 'webhook', 'data tables'],
      description: 'Receives leads over a webhook, normalizes them and stores them in the "Leads" data table, responding with the stored row.',
      definition: workflow(
        [
          ['hook', 'Incoming Lead', 'simplyai.webhookTrigger', 0, 200, { path: 'demo-leads', methods: ['POST'], responseMode: 'LAST_NODE' }],
          ['norm', 'Normalize', 'simplyai.set', 260, 200, { keepOnlySet: true, assignments: [{ name: 'name', type: 'string', value: '{{ $json.body.name }}' }, { name: 'email', type: 'string', value: '{{ ($json.body.email ?? "").toLowerCase().trim() }}' }, { name: 'company', type: 'string', value: '{{ $json.body.company ?? "" }}' }, { name: 'status', type: 'string', value: 'new' }] }],
          ['valid', 'Valid Email?', 'simplyai.if', 520, 200, { conditions: { combinator: 'and', conditions: [{ left: '{{ $json.email }}', operator: 'regex', right: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' }] } }],
          ['store', 'Save Lead', 'simplyai.dataTable', 780, 120, { operation: 'upsert', tableId: leadsTableId, matchColumn: 'email', data: '{{ JSON.stringify($json) }}' }],
          ['reject', 'Reject', 'simplyai.stop', 780, 300, { status: 'error', message: 'Invalid email address' }],
        ],
        [['hook', 'norm'], ['norm', 'valid'], ['valid', 'store', 0], ['valid', 'reject', 1]],
      ),
    },
    {
      name: 'Batch Processing Loop (demo)', tags: ['demo', 'loop'],
      description: 'Splits items into batches with Loop Over Items, waits between batches and collects the results.',
      definition: workflow(
        [
          ['t', 'Start', 'simplyai.manualTrigger', 0, 200, { testData: JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ id: i + 1, email: `user${i + 1}@example.com` }))) }],
          ['loop', 'Batches of 2', 'simplyai.loop', 260, 200, { batchSize: 2 }],
          ['work', 'Process Batch', 'simplyai.set', 520, 320, { assignments: [{ name: 'processedAt', type: 'string', value: '{{ $now }}' }, { name: 'domain', type: 'string', value: "{{ $json.email.split('@')[1] }}" }] }],
          ['pause', 'Pause 1s', 'simplyai.wait', 780, 320, { mode: 'interval', amount: 1, unit: 'seconds' }],
          ['done', 'Collect', 'simplyai.aggregate', 520, 100, { operation: 'collect', target: 'processed' }],
        ],
        [['t', 'loop'], ['loop', 'work', 1], ['work', 'pause'], ['pause', 'loop'], ['loop', 'done', 0]],
      ),
    },
    {
      name: 'GitHub Repo Digest (demo)', tags: ['demo', 'http', 'schedule'],
      description: 'Calls the public GitHub API and formats a digest. Activate it to run every day at 08:00 UTC.',
      definition: workflow(
        [
          ['cron', 'Daily 08:00', 'simplyai.scheduleTrigger', 0, 200, { mode: 'cron', cron: '0 8 * * *', timezone: 'UTC' }],
          ['manual', 'Run Now', 'simplyai.manualTrigger', 0, 360, {}],
          ['api', 'Get Repository', 'simplyai.httpRequest', 260, 280, { method: 'GET', url: 'https://api.github.com/repos/{{ $vars.GITHUB_REPO }}', headers: [{ key: 'accept', value: 'application/vnd.github+json' }] }, { settings: { retry: { enabled: true, maxTries: 3, waitBetweenMs: 1000 }, timeoutMs: 20000 } }],
          ['fmt', 'Format Digest', 'simplyai.text', 520, 280, { operation: 'template', text: '⭐ {{ $json.full_name }} has {{ $json.stargazers_count }} stars, {{ $json.open_issues_count }} open issues. Last push {{ $date.format($json.pushed_at, "YYYY-MM-DD HH:mm") }} UTC.', target: 'digest' }],
        ],
        [['cron', 'api'], ['manual', 'api'], ['api', 'fmt']],
      ),
    },
  ];
}

export async function seedDemo(db: PrismaClient) {
  const owner = await db.role.findFirstOrThrow({ where: { workspaceId: null, key: 'owner' } });
  const free = await db.plan.findUniqueOrThrow({ where: { key: 'professional' } });
  let user = await db.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (user) return { email: DEMO_EMAIL, created: false };
  user = await db.user.create({ data: { email: DEMO_EMAIL, name: 'Avery Admin', passwordHash: await hashPassword(DEMO_PASSWORD), emailVerifiedAt: new Date(), isPlatformAdmin: true } });
  const org = await db.organization.create({ data: { name: 'Acme Inc', slug: 'acme', members: { create: { userId: user.id, role: 'OWNER' } } } });
  await db.subscription.create({ data: { organizationId: org.id, planId: free.id, currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) } });
  const ws = await db.workspace.create({ data: { organizationId: org.id, name: 'Operations', slug: 'operations', description: 'Demo workspace', members: { create: { userId: user.id, roleId: owner.id } } } });
  const leads = await db.dataTable.create({
    data: {
      workspaceId: ws.id, name: 'Leads', description: 'Leads captured by the demo webhook',
      columns: { create: [{ name: 'name', type: 'TEXT', position: 0 }, { name: 'email', type: 'TEXT', position: 1 }, { name: 'company', type: 'TEXT', position: 2 }, { name: 'status', type: 'TEXT', position: 3 }] },
    },
  });
  await db.dataTableRow.createMany({
    data: [
      { tableId: leads.id, data: { name: 'Katherine Johnson', email: 'katherine@example.com', company: 'Orbital Co', status: 'contacted' } },
      { tableId: leads.id, data: { name: 'Margaret Hamilton', email: 'margaret@example.com', company: 'Apollo Labs', status: 'new' } },
    ],
  });
  await db.variable.createMany({
    data: [
      { scope: 'WORKSPACE', workspaceId: ws.id, key: 'COMPANY_NAME', value: 'Acme Inc', description: 'Used in email signatures' },
      { scope: 'WORKSPACE', workspaceId: ws.id, key: 'GITHUB_REPO', value: 'nodejs/node', description: 'Repository for the digest demo' },
      { scope: 'GLOBAL', organizationId: org.id, key: 'SUPPORT_EMAIL', value: 'support@acme.example', description: 'Organization-wide support address' },
    ],
  });
  for (const w of demoWorkflows(leads.id)) {
    const wf = await db.workflow.create({ data: { workspaceId: ws.id, name: w.name, description: w.description, tags: w.tags, createdById: user.id, meta: (w.definition.meta ?? {}) as Prisma.InputJsonValue } });
    await db.workflowNode.createMany({
      data: w.definition.nodes.map((n) => ({ workflowId: wf.id, nodeKey: n.id, name: n.name, type: n.type, positionX: n.position.x, positionY: n.position.y, parameters: n.parameters as Prisma.InputJsonValue, settings: (n.settings ?? {}) as Prisma.InputJsonValue })),
    });
    await db.workflowConnection.createMany({ data: w.definition.connections.map((c) => ({ workflowId: wf.id, sourceKey: c.source, sourceOutput: c.sourceOutput, targetKey: c.target, targetInput: c.targetInput })) });
    for (const n of w.definition.nodes.filter((x) => x.type === 'simplyai.webhookTrigger')) {
      await db.webhook.create({ data: { workspaceId: ws.id, workflowId: wf.id, nodeKey: n.id, path: String(n.parameters.path), methods: (n.parameters.methods as string[]) ?? ['POST'], responseMode: n.parameters.responseMode === 'LAST_NODE' ? 'LAST_NODE' : 'IMMEDIATE' } });
    }
  }
  await db.agent.create({
    data: {
      workspaceId: ws.id, name: 'Support Assistant', description: 'Answers product questions and can create tickets after approval.', createdById: user.id,
      systemPrompt: 'You are the support assistant for Acme Inc. Be concise and friendly. Use the calculator for math. Ask before creating tickets.',
      provider: 'openai', model: 'gpt-4o-mini', temperature: 0.3, maxTokens: 800,
      tools: [
        { id: 'calc', type: 'calculator', name: 'calculator', description: 'Evaluate arithmetic expressions', config: {}, requiresApproval: false },
        { id: 'time', type: 'datetime', name: 'current_time', description: 'Get the current date and time', config: {}, requiresApproval: false },
        { id: 'lead', type: 'dataTable', name: 'save_lead', description: 'Save a sales lead with name, email and company', config: { tableId: leads.id, operation: 'insert' }, requiresApproval: true },
      ],
    },
  });
  return { email: DEMO_EMAIL, password: DEMO_PASSWORD, workspaceId: ws.id, created: true };
}
