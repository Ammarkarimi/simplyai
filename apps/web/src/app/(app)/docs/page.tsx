'use client';
import { useMemo, useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import { NODE_CATEGORIES } from '@simplyai/shared';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/misc';
import { NodeIcon } from '@/components/icons';
import { useNodeCatalog } from '@/lib/hooks';
import { cn } from '@/lib/utils';

const Code = ({ children }: { children: string }) => <pre className="my-3 overflow-x-auto rounded-lg bg-slate-950 p-4 font-mono text-[12px] leading-relaxed text-slate-100">{children}</pre>;
const H2 = ({ id, children }: { id: string; children: React.ReactNode }) => <h2 id={id} className="mb-3 mt-10 scroll-mt-20 text-xl font-semibold first:mt-0">{children}</h2>;
const P = ({ children }: { children: React.ReactNode }) => <p className="my-2 text-[14px] leading-relaxed text-foreground/85">{children}</p>;
const C = ({ children }: { children: React.ReactNode }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">{children}</code>;

const SECTIONS = [
  ['getting-started', 'Getting started'], ['concepts', 'Core concepts'], ['expressions', 'Expressions'], ['triggers', 'Triggers'], ['flow', 'Branching, loops & waits'],
  ['errors', 'Error handling & retries'], ['ai', 'AI agents & RAG'], ['webhooks', 'Webhooks'], ['api', 'Public REST API'], ['auth', 'Authentication & roles'],
  ['sdk', 'Custom nodes (SDK)'], ['security', 'Security'], ['nodes', 'Node reference'],
] as const;

function NodeReference() {
  const catalog = useNodeCatalog();
  const [q, setQ] = useState('');
  const list = useMemo(() => (catalog.data ?? []).filter((n) => `${n.displayName} ${n.type} ${n.description}`.toLowerCase().includes(q.toLowerCase())), [catalog.data, q]);
  return (
    <>
      <div className="relative my-3"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder={`Search ${catalog.data?.length ?? ''} nodes…`} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {NODE_CATEGORIES.map((cat) => {
        const items = list.filter((n) => n.category === cat.key);
        if (!items.length) return null;
        return (
          <div key={cat.key} className="mb-6">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{cat.label}</h3>
            <div className="space-y-2">
              {items.map((n) => (
                <details key={n.type} className="rounded-lg border bg-card p-3">
                  <summary className="flex cursor-pointer items-center gap-3"><NodeIcon icon={n.icon} color={n.color} size="sm" /><span className="font-medium">{n.displayName}</span><span className="hidden text-sm text-muted-foreground sm:inline">{n.description}</span><code className="ml-auto hidden font-mono text-[11px] text-muted-foreground md:inline">{n.type}</code></summary>
                  <div className="mt-3 space-y-2 text-sm">
                    {n.docs && <p className="whitespace-pre-wrap text-muted-foreground">{n.docs.replace(/\*\*/g, '')}</p>}
                    <p className="text-xs">Inputs: {n.inputs.map((i) => i.label ?? i.name).join(', ') || 'none (trigger)'} · Outputs: {n.dynamicOutputs ? `one per ${n.dynamicOutputs.parameter} entry${n.dynamicOutputs.fallback ? ' + fallback' : ''}` : n.outputs.map((o) => o.label ?? o.name).join(', ') || 'none'}</p>
                    {n.credentials && <p className="text-xs">Credentials: {n.credentials.types.map((t) => <Badge key={t} variant="outline" className="mr-1">{t}</Badge>)}</p>}
                    <table className="w-full text-xs"><tbody>{n.properties.filter((p) => p.type !== 'notice').map((p) => <tr key={p.name} className="border-t"><td className="py-1 pr-3 font-mono">{p.name}</td><td className="py-1 pr-3 text-muted-foreground">{p.type}{p.required ? ' · required' : ''}</td><td className="py-1">{p.description ?? p.displayName}</td></tr>)}</tbody></table>
                  </div>
                </details>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

export default function DocsPage() {
  const [active, setActive] = useState('getting-started');
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://your-simplyai';
  return (
    <>
      <PageHeader icon={<BookOpen />} title="Documentation" description="Everything you need to build, run and extend automations on SimplyAI." />
      <div className="flex gap-8">
        <nav className="sticky top-20 hidden h-fit w-52 shrink-0 space-y-0.5 lg:block">
          {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`} onClick={() => setActive(id)} className={cn('block rounded-md px-2.5 py-1.5 text-sm', active === id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground')}>{label}</a>)}
        </nav>
        <Card className="min-w-0 flex-1 p-6 lg:p-10">
          <H2 id="getting-started">Getting started</H2>
          <P>1. Create a workflow (or install a template). 2. Drag a <b>trigger</b> onto the canvas. 3. Add nodes and connect outputs to inputs. 4. Press <b>Execute</b> to run the draft and inspect each node&apos;s data. 5. <b>Publish</b> to create a version, then toggle <b>Active</b> so schedules, webhooks, forms and other triggers fire automatically.</P>
          <P>Credentials for third-party apps live in <b>Credentials</b>; nodes reference them by name and never see other workspaces&apos; secrets.</P>

          <H2 id="concepts">Core concepts</H2>
          <P><b>Items.</b> Data flows between nodes as a list of items, each <C>{'{ json: {...}, binary?: {...} }'}</C>. Most nodes run once per input item.</P>
          <P><b>Draft vs. versions.</b> The editor saves a draft. Publishing creates an immutable version; active triggers always run the published version. Each execution stores the exact definition it ran.</P>
          <P><b>Executions.</b> Every run is persisted with node-level inputs, outputs, errors, durations and retries. Statuses: queued, running, waiting, successful, failed, cancelled.</P>

          <H2 id="expressions">Expressions</H2>
          <P>Any parameter can contain <C>{'{{ expression }}'}</C>. A field that is a single expression keeps the raw type (object, number…); mixed text is interpolated.</P>
          <Code>{`{{ $json.email }}                       current item field
{{ $('HTTP Request').item.json.id }}    output of another node
{{ $input.all().length }}                all input items
{{ $vars.API_URL }}  {{ $secrets.TOKEN }}  variables and secrets
{{ $now }}  {{ $today }}  {{ $date.add($now, 3, 'days') }}
{{ $json.items.map(i => i.price).reduce((a, b) => a + b, 0) }}
{{ $json.status === 'paid' ? 'ok' : 'pending' }}
{{ $date.format($json.createdAt, 'YYYY-MM-DD HH:mm', 'Europe/Berlin') }}`}</Code>
          <P>Expressions run in a safe interpreter: no access to <C>process</C>, <C>require</C>, prototypes or the network. Use the <b>Code</b> node for custom logic.</P>

          <H2 id="triggers">Triggers</H2>
          <P><b>Manual</b> (editor/API) · <b>Schedule</b> (interval or cron with timezone) · <b>Webhook</b> (unique URL, any method, auth, request history) · <b>Form</b> (hosted form at <C>/f/&lt;path&gt;</C>) · <b>Chat</b> (hosted chat at <C>/c/&lt;path&gt;</C>, last node replies) · <b>Email (IMAP)</b> and <b>Database</b> polling triggers that only emit new items · <b>App Event</b> (emitted via API, the Emit App Event node, or system events <C>system.execution.failed</C> / <C>system.execution.succeeded</C>) · <b>Error Handler</b>.</P>

          <H2 id="flow">Branching, loops & waits</H2>
          <P><b>If / Switch / Filter</b> route items. Nodes run when every upstream branch has finished; skipped branches don&apos;t block a <b>Merge</b>. Independent branches run in parallel (configurable per workflow).</P>
          <P><b>Loop Over Items</b>: connect the <i>Loop</i> output to your body and the end of the body back into the Loop node; collected results leave through <i>Done</i>. <b>Wait</b> pauses for a duration or until a date — long waits persist and survive restarts. <b>Human Approval</b> pauses until someone approves on the execution page or via <C>POST /executions/:id/approve</C>. <b>Execute Sub-workflow</b> calls another workflow and returns its last node output.</P>

          <H2 id="errors">Error handling & retries</H2>
          <P>Node settings offer <b>retry on failure</b> (max tries, delay, exponential backoff), <b>timeout</b>, <b>continue on fail</b> (errors become data, optionally on a dedicated error output), <b>always output data</b> and <b>execute once</b>. Add an <b>Error Handler</b> node to run cleanup or alerts in the same workflow, or choose an <b>error workflow</b> in workflow settings. Failed executions can be retried with the same or the latest version.</P>

          <H2 id="ai">AI agents & RAG</H2>
          <P>Create agents in <b>AI Agents</b>: choose OpenAI, Anthropic, Gemini or any OpenAI-compatible endpoint, write instructions, add tools (HTTP, workflows, knowledge search, data tables, code, calculator, date/time, web search) and attach knowledge bases. Tools can require human approval. Test in the playground, then use the <b>AI Agent</b> node with a session id for conversation memory.</P>
          <P>Knowledge bases chunk and embed uploaded documents (PDF, Markdown, text, CSV, JSON, HTML). The <b>Vector Search</b> and <b>RAG</b> nodes retrieve the most similar chunks and answer with citations.</P>

          <H2 id="webhooks">Webhooks</H2>
          <P>Each Webhook Trigger gets a test URL (runs the saved draft) and a production URL (active version). Configure header token, basic auth or HMAC signatures in <b>Webhooks</b>. Signature check example for senders:</P>
          <Code>{`const signature = 'sha256=' + crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
await fetch('${origin}/webhook/<path>', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-simplyai-signature': signature },
  body: rawBody,
});`}</Code>
          <P>Set <i>Respond</i> to “when last node finishes” to return the workflow output synchronously (30s timeout, then 202 with the execution id).</P>

          <H2 id="api">Public REST API</H2>
          <P>Create a key in <b>Settings → API keys</b>, pick scopes and a rate limit. The OpenAPI specification is available at <a className="text-primary" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">/api/v1/openapi.json</a>.</P>
          <Code>{`# list workflows
curl -H "Authorization: Bearer sai_…" ${origin}/api/v1/workflows

# run a workflow with input data
curl -X POST -H "Authorization: Bearer sai_…" -H "content-type: application/json" \\
  -d '{"inputData": {"email": "ada@example.com"}}' ${origin}/api/v1/workflows/<id>/run

# check the execution
curl -H "Authorization: Bearer sai_…" ${origin}/api/v1/executions/<executionId>

# emit an app event
curl -X POST -H "Authorization: Bearer sai_…" -H "content-type: application/json" \\
  -d '{"event": "customer.created", "payload": {"id": 42}}' ${origin}/api/v1/events`}</Code>
          <P>Responses include <C>x-ratelimit-limit</C> and <C>x-ratelimit-remaining</C>; exceeding the limit returns 429. Plan quota violations return 402.</P>

          <H2 id="auth">Authentication & roles</H2>
          <P>Users sign in with email/password (Argon2id) or Google. Sessions are HttpOnly cookies with CSRF protection. Roles: <b>Owner</b> (everything incl. billing), <b>Admin</b> (members, API keys, settings), <b>Editor</b> (build workflows, agents, credentials), <b>Operator</b> (run, activate, monitor), <b>Viewer</b> (read-only). Admins can define custom roles from the permission catalog.</P>

          <H2 id="sdk">Custom nodes (SDK)</H2>
          <P>Nodes are plain objects created with <C>defineNode</C> from <C>@simplyai/sdk</C>. The engine never needs to change: register a bundle with the registry.</P>
          <Code>{`import { defineNode, defineCredentialType } from '@simplyai/sdk';

export const acmeApi = defineCredentialType({
  type: 'acmeApi', displayName: 'Acme', authKind: 'apiKey', testable: true,
  properties: [{ name: 'apiKey', displayName: 'API key', type: 'string', password: true, required: true }],
  authenticate: (d) => ({ headers: { authorization: \`Bearer \${d.apiKey}\` }, baseUrl: 'https://api.acme.com/v1' }),
  test: async (d, http) => { await http({ url: 'https://api.acme.com/v1/me', headers: { authorization: \`Bearer \${d.apiKey}\` } }); },
});

export const acmeCreateTicket = defineNode({
  type: 'acme.createTicket', version: 1, displayName: 'Acme: Create ticket', description: 'Create a ticket in Acme',
  category: 'business', icon: 'ticket', color: '#0ea5e9', inputs: [{ name: 'main' }], outputs: [{ name: 'main' }],
  credentials: { types: ['acmeApi'], required: true },
  properties: [{ name: 'title', displayName: 'Title', type: 'string', required: true, default: '{{ $json.subject }}' }],
  async execute(ctx) {
    const out = [];
    for (let i = 0; i < ctx.getInputItems().length; i++) {
      const res = await ctx.httpWithAuth({ url: '/tickets', method: 'POST', body: { title: ctx.getParam('title', i) } });
      out.push({ json: res.body });
    }
    return [out];
  },
});

// apps/worker & apps/api: getRegistry().use({ nodes: [acmeCreateTicket], credentials: [acmeApi] })`}</Code>
          <P>Unit test nodes with <C>testNode(def, {'{ parameters, inputs, credential }'})</C> from the SDK, or run whole workflows with <C>WorkflowEngine</C> from <C>@simplyai/engine</C>.</P>

          <H2 id="security">Security</H2>
          <P>Secrets are encrypted with AES-256-GCM bound to the workspace, never returned by the API and redacted from execution logs. Outbound HTTP from nodes blocks private, loopback and cloud metadata addresses (SSRF). Code runs in a separate process with no environment, no <C>require</C>, no eval, and CPU, memory and output limits. All mutations are audited.</P>

          <H2 id="nodes">Node reference</H2>
          <NodeReference />
        </Card>
      </div>
    </>
  );
}
