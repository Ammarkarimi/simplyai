'use client';
import Link from 'next/link';
import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Bot, Check, Loader2, MessageSquarePlus, Plus, Save, Send, ShieldAlert, Trash2, User, Wrench, X } from 'lucide-react';
import type { AgentTool } from '@simplyai/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Label, Select, Textarea } from '@/components/ui/input';
import { Skeleton, Switch } from '@/components/ui/misc';
import { CodeEditor } from '@/components/ui/code-editor';
import { useConfirm } from '@/components/ui/extras';
import { del, patch, post } from '@/lib/api';
import { useWorkspace, useWsQuery } from '@/lib/hooks';
import { useRealtime } from '@/lib/socket';
import { cn, timeAgo } from '@/lib/utils';

interface AgentForm {
  name: string; description: string; systemPrompt: string; provider: 'openai' | 'anthropic' | 'gemini' | 'custom'; model: string; credentialId: string | null;
  temperature: number; maxTokens: number; maxIterations: number; tools: AgentTool[]; knowledgeBaseIds: string[]; memoryEnabled: boolean; memoryWindow: number;
  inputFormat: 'text' | 'json'; outputFormat: 'text' | 'json'; outputSchema: Record<string, unknown> | null;
}
interface Message { id: string; role: string; content: string; toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> | null; toolName: string | null; toolCallId: string | null; approvalStatus: string | null; createdAt: string; tokensIn: number; tokensOut: number }
interface Conversation { id: string; title: string; status: string; updatedAt: string; messages?: Message[] }

const DEFAULT: AgentForm = {
  name: 'New agent', description: '', systemPrompt: 'You are a helpful assistant. Answer concisely and use tools when they help.', provider: 'openai', model: 'gpt-4o-mini', credentialId: null,
  temperature: 0.7, maxTokens: 1024, maxIterations: 6, tools: [], knowledgeBaseIds: [], memoryEnabled: true, memoryWindow: 20, inputFormat: 'text', outputFormat: 'text', outputSchema: null,
};
const CRED_TYPE: Record<string, string> = { openai: 'openAiApi', anthropic: 'anthropicApi', gemini: 'googleGeminiApi', custom: 'customLlmApi' };
const TOOL_TYPES: Array<{ type: AgentTool['type']; label: string; description: string }> = [
  { type: 'calculator', label: 'Calculator', description: 'Evaluate math expressions' },
  { type: 'datetime', label: 'Date & time', description: 'Current date and time' },
  { type: 'http', label: 'HTTP API', description: 'Call a REST endpoint' },
  { type: 'workflow', label: 'Run workflow', description: 'Execute a SimplyAI workflow' },
  { type: 'knowledge', label: 'Knowledge search', description: 'Search a knowledge base' },
  { type: 'dataTable', label: 'Data table', description: 'Find or insert rows' },
  { type: 'code', label: 'Code', description: 'Run JavaScript in the sandbox' },
  { type: 'webSearch', label: 'Web search', description: 'Query a SearXNG instance' },
];

function ToolEditor({ tool, onChange, onRemove }: { tool: AgentTool; onChange: (t: AgentTool) => void; onRemove: () => void }) {
  const wfs = useWsQuery<{ items: Array<{ id: string; name: string }> }>(['workflows', 'all'], '/workflows', { pageSize: 100 }, { enabled: tool.type === 'workflow' });
  const tables = useWsQuery<Array<{ id: string; name: string }>>(['data-tables'], '/data-tables', undefined, { enabled: tool.type === 'dataTable' });
  const kbs = useWsQuery<Array<{ id: string; name: string }>>(['knowledge-bases'], '/knowledge-bases', undefined, { enabled: tool.type === 'knowledge' });
  const cfg = tool.config as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => onChange({ ...tool, config: { ...cfg, ...patch } });
  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{TOOL_TYPES.find((t) => t.type === tool.type)?.label}</Badge>
        <Input className="h-8 font-mono text-xs" value={tool.name} onChange={(e) => onChange({ ...tool, name: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '_') })} aria-label="Tool name" />
        <Button size="icon-sm" variant="ghost" onClick={onRemove} aria-label="Remove tool"><Trash2 /></Button>
      </div>
      <Textarea rows={2} className="text-xs" value={tool.description} onChange={(e) => onChange({ ...tool, description: e.target.value })} placeholder="When should the agent use this tool?" />
      {tool.type === 'http' && (
        <div className="grid grid-cols-[100px_1fr] gap-2">
          <Select className="h-8 text-xs" value={String(cfg.method ?? 'GET')} onChange={(e) => set({ method: e.target.value })}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}</Select>
          <Input className="h-8 text-xs" placeholder="https://api.example.com/v1" value={String(cfg.url ?? '')} onChange={(e) => set({ url: e.target.value })} />
        </div>
      )}
      {tool.type === 'workflow' && <Select className="h-8 text-xs" value={String(cfg.workflowId ?? '')} onChange={(e) => set({ workflowId: e.target.value })}><option value="">Select workflow…</option>{wfs.data?.items.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>}
      {tool.type === 'knowledge' && <Select className="h-8 text-xs" value={String(cfg.knowledgeBaseId ?? '')} onChange={(e) => set({ knowledgeBaseId: e.target.value })}><option value="">Select knowledge base…</option>{kbs.data?.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</Select>}
      {tool.type === 'dataTable' && (
        <div className="grid grid-cols-2 gap-2">
          <Select className="h-8 text-xs" value={String(cfg.tableId ?? '')} onChange={(e) => set({ tableId: e.target.value })}><option value="">Select table…</option>{tables.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
          <Select className="h-8 text-xs" value={String(cfg.operation ?? 'find')} onChange={(e) => set({ operation: e.target.value })}><option value="find">Find rows</option><option value="insert">Insert row</option></Select>
        </div>
      )}
      {tool.type === 'code' && <CodeEditor minHeight={80} value={String(cfg.code ?? 'return { result: $json.input };')} onChange={(v) => set({ code: v })} />}
      {tool.type === 'webSearch' && <Input className="h-8 text-xs" placeholder="https://searx.example.com" value={String(cfg.searxngUrl ?? '')} onChange={(e) => set({ searxngUrl: e.target.value })} />}
      <label className="flex items-center gap-2 text-xs"><Switch checked={tool.requiresApproval} onCheckedChange={(v) => onChange({ ...tool, requiresApproval: v })} /> Require human approval before running</label>
    </div>
  );
}

function Playground({ agentId, ready }: { agentId: string; ready: boolean }) {
  const { workspace, can } = useWorkspace();
  const qc = useQueryClient();
  const convs = useWsQuery<Conversation[]>(['conversations', agentId], `/agents/${agentId}/conversations`);
  const [convId, setConvId] = useState<string | null>(null);
  const conv = useWsQuery<Conversation>(['conversation', convId], `/conversations/${convId}`, undefined, { enabled: !!convId });
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [live, setLive] = useState<string[]>([]);
  const end = useRef<HTMLDivElement>(null);
  useRealtime({ workspaceId: workspace?.id, conversationId: convId }, (e) => {
    if (e.type === 'agent.step') { setLive((l) => [...l, String(e.step.type === 'tool' ? `Used ${e.step.toolName}` : e.step.type === 'approval' ? `Waiting for approval: ${e.step.toolName}` : 'Thinking…')]); void conv.refetch(); }
  });
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [conv.data?.messages?.length, live.length]);
  const messages = conv.data?.messages ?? [];
  const pending = messages.find((m) => m.approvalStatus === 'pending');
  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    setLive([]);
    const msg = text;
    setText('');
    try {
      const r = await post<Conversation & { timedOut: boolean }>(`/agents/${agentId}/chat`, { conversationId: convId ?? undefined, message: msg });
      setConvId(r.id);
      qc.setQueryData([workspace?.id, 'conversation', r.id, null], r);
      void convs.refetch();
      if (r.timedOut) toast.info('The agent is still working; results will appear here.');
    } catch (e) {
      toast.error((e as Error).message);
      setText(msg);
    } finally {
      setSending(false);
    }
  };
  const decide = async (approved: boolean) => {
    if (!pending || !convId) return;
    const call = pending.toolCalls?.find((c) => !messages.some((m) => m.toolCallId === c.id));
    if (!call) return;
    setSending(true);
    try {
      const r = await post<Conversation>(`/conversations/${convId}/approve`, { toolCallId: call.id, approved });
      qc.setQueryData([workspace?.id, 'conversation', convId, null], r);
    } catch (e) { toast.error((e as Error).message); } finally { setSending(false); }
  };
  return (
    <Card className="flex h-[calc(100vh-140px)] min-h-[560px] flex-col">
      <div className="flex items-center gap-2 border-b p-3">
        <p className="text-sm font-semibold">Playground</p>
        <Select className="ml-auto h-8 w-56 text-xs" value={convId ?? ''} onChange={(e) => setConvId(e.target.value || null)}>
          <option value="">New conversation</option>
          {convs.data?.map((c) => <option key={c.id} value={c.id}>{c.title.slice(0, 40)} · {timeAgo(c.updatedAt)}</option>)}
        </Select>
        <Button size="icon-sm" variant="ghost" onClick={() => setConvId(null)} aria-label="New conversation"><MessageSquarePlus /></Button>
        {convId && <Button size="icon-sm" variant="ghost" aria-label="Delete conversation" onClick={async () => { await del(`/conversations/${convId}`); setConvId(null); void convs.refetch(); }}><Trash2 /></Button>}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4 scrollbar-thin">
        {!ready && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Save the agent with a model credential to start testing.</p>}
        {messages.length === 0 && ready && <div className="py-16 text-center text-sm text-muted-foreground"><Bot className="mx-auto mb-3 h-8 w-8 text-primary" />Send a message to test your agent. Tool calls and results show up inline.</div>}
        {messages.map((m) => {
          if (m.role === 'tool') return <div key={m.id} className="ml-10 rounded-lg border border-dashed bg-muted/40 p-2 text-xs"><p className="font-medium text-muted-foreground"><Wrench className="mr-1 inline h-3 w-3" />{m.toolName} result</p><pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px]">{m.content.slice(0, 1500)}</pre></div>;
          const isUser = m.role === 'user';
          return (
            <div key={m.id} className={cn('flex gap-2', isUser && 'flex-row-reverse')}>
              <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', isUser ? 'bg-slate-200' : 'brand-gradient text-white')}>{isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}</div>
              <div className={cn('max-w-[80%] space-y-1.5')}>
                {m.content && <div className={cn('whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm', isUser ? 'bg-primary text-white' : 'bg-muted')}>{m.content}</div>}
                {m.toolCalls?.map((c) => <div key={c.id} className="rounded-lg border bg-card px-2.5 py-1.5 font-mono text-[11px]"><span className="font-semibold text-primary">{c.name}</span>({JSON.stringify(c.arguments)}){m.approvalStatus && <Badge className="ml-2" variant={m.approvalStatus === 'approved' ? 'success' : m.approvalStatus === 'rejected' ? 'destructive' : 'warning'}>{m.approvalStatus}</Badge>}</div>)}
                {!isUser && (m.tokensIn > 0 || m.tokensOut > 0) && <p className="text-[10px] text-muted-foreground">{m.tokensIn + m.tokensOut} tokens</p>}
              </div>
            </div>
          );
        })}
        {sending && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />{live[live.length - 1] ?? 'Agent is working…'}</p>}
        {pending && conv.data?.status === 'awaiting_approval' && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-amber-900"><ShieldAlert className="h-4 w-4" /> The agent wants to run a tool that requires approval</p>
            {can('agent:run') && <div className="mt-2 flex gap-2"><Button size="sm" onClick={() => decide(true)} loading={sending}><Check /> Approve</Button><Button size="sm" variant="outline" onClick={() => decide(false)}><X /> Reject</Button></div>}
          </div>
        )}
        <div ref={end} />
      </div>
      <form className="flex gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <Textarea rows={1} className="min-h-[40px] resize-none" placeholder={ready ? 'Message the agent…' : 'Configure the agent first'} value={text} disabled={!ready || sending || !can('agent:run') || conv.data?.status === 'awaiting_approval'} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <Button type="submit" size="icon" className="h-10 w-10" disabled={!ready || sending || !text.trim()} aria-label="Send"><Send /></Button>
      </form>
    </Card>
  );
}

export default function AgentStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew = id === 'new';
  const router = useRouter();
  const { can } = useWorkspace();
  const canEdit = can('agent:manage');
  const q = useWsQuery<AgentForm & { id: string }>(['agent', id], `/agents/${id}`, undefined, { enabled: !isNew });
  const creds = useWsQuery<Array<{ id: string; name: string; type: string }>>(['credentials'], '/credentials');
  const kbs = useWsQuery<Array<{ id: string; name: string }>>(['knowledge-bases'], '/knowledge-bases');
  const providers = useWsQuery<Array<{ key: string; suggestedModels: string[] }>>(['ai-providers'], '/ai/providers');
  const [form, setForm] = useState<AgentForm>(DEFAULT);
  const [schemaText, setSchemaText] = useState('');
  const [saving, setSaving] = useState(false);
  const { confirm, dialog } = useConfirm();
  useEffect(() => {
    if (q.data) {
      const { id: _id, ...rest } = q.data as AgentForm & { id: string; credential?: unknown; knowledgeBases?: unknown };
      setForm({ ...DEFAULT, ...(rest as AgentForm), description: rest.description ?? '' });
      setSchemaText(rest.outputSchema ? JSON.stringify(rest.outputSchema, null, 2) : '');
    }
  }, [q.data]);
  const set = <K extends keyof AgentForm>(k: K, v: AgentForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    setSaving(true);
    try {
      let outputSchema: Record<string, unknown> | null = null;
      if (form.outputFormat === 'json' && schemaText.trim()) outputSchema = JSON.parse(schemaText);
      const body = { name: form.name, description: form.description || null, systemPrompt: form.systemPrompt, provider: form.provider, model: form.model, credentialId: form.credentialId || null, temperature: Number(form.temperature), maxTokens: Number(form.maxTokens), maxIterations: Number(form.maxIterations), tools: form.tools, knowledgeBaseIds: form.knowledgeBaseIds, memoryEnabled: form.memoryEnabled, memoryWindow: Number(form.memoryWindow), inputFormat: form.inputFormat, outputFormat: form.outputFormat, outputSchema };
      if (isNew) {
        const a = await post<{ id: string }>('/agents', body);
        toast.success('Agent created');
        router.replace(`/agents/${a.id}`);
      } else {
        await patch(`/agents/${id}`, body);
        toast.success('Agent saved');
        void q.refetch();
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  if (!isNew && !q.data) return <Skeleton className="h-[70vh]" />;
  const credOptions = creds.data?.filter((c) => c.type === CRED_TYPE[form.provider]) ?? [];
  const suggestions = providers.data?.find((p) => p.key === form.provider)?.suggestedModels ?? [];
  return (
    <>
      <div className="mb-5 flex items-center gap-3">
        <Link href="/agents"><Button variant="ghost" size="icon" aria-label="Back"><ArrowLeft /></Button></Link>
        <div className="brand-gradient flex h-10 w-10 items-center justify-center rounded-xl text-white"><Bot className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1"><h1 className="truncate text-xl font-semibold">{form.name || 'Agent'}</h1><p className="text-xs text-muted-foreground">{isNew ? 'New agent' : `Use in workflows with the AI Agent node · id ${id}`}</p></div>
        {!isNew && canEdit && <Button variant="ghost" onClick={async () => { if (await confirm({ title: 'Delete this agent?', destructive: true, confirmLabel: 'Delete' })) { await del(`/agents/${id}`); router.push('/agents'); } }}><Trash2 /></Button>}
        {canEdit && <Button onClick={save} loading={saving}><Save /> {isNew ? 'Create agent' : 'Save'}</Button>}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <fieldset disabled={!canEdit} className="space-y-5">
          <Card>
            <CardHeader><CardTitle>Identity & model</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name"><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
                <Field label="Description"><Input value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Provider"><Select value={form.provider} onChange={(e) => { set('provider', e.target.value as AgentForm['provider']); set('credentialId', null); }}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="gemini">Google Gemini</option><option value="custom">Custom endpoint</option></Select></Field>
                <Field label="Model"><Input list="model-suggestions" value={form.model} onChange={(e) => set('model', e.target.value)} /><datalist id="model-suggestions">{suggestions.map((m) => <option key={m} value={m} />)}</datalist></Field>
                <Field label="Credential" hint={credOptions.length === 0 ? <Link className="text-primary" href={`/credentials?new=${CRED_TYPE[form.provider]}`}>Add a {form.provider} key</Link> : undefined}>
                  <Select value={form.credentialId ?? ''} onChange={(e) => set('credentialId', e.target.value || null)}><option value="">Select…</option>{credOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={`Temperature · ${Number(form.temperature).toFixed(1)}`}><input type="range" min={0} max={2} step={0.1} value={form.temperature} onChange={(e) => set('temperature', Number(e.target.value))} className="w-full accent-violet-600" /></Field>
                <Field label="Max tokens"><Input type="number" value={form.maxTokens} onChange={(e) => set('maxTokens', Number(e.target.value))} /></Field>
                <Field label="Max tool iterations"><Input type="number" min={1} max={25} value={form.maxIterations} onChange={(e) => set('maxIterations', Number(e.target.value))} /></Field>
              </div>
              <Field label="System instructions"><Textarea rows={7} value={form.systemPrompt} onChange={(e) => set('systemPrompt', e.target.value)} /></Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle>Tools</CardTitle>
              <Select className="h-8 w-48 text-xs" value="" onChange={(e) => { const t = TOOL_TYPES.find((x) => x.type === e.target.value); if (t) set('tools', [...form.tools, { id: Math.random().toString(36).slice(2, 9), type: t.type, name: `${t.type}_${form.tools.length + 1}`, description: t.description, config: {}, requiresApproval: false }]); }}>
                <option value="">+ Add tool…</option>{TOOL_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </Select>
            </CardHeader>
            <CardContent className="space-y-3">
              {form.tools.length === 0 && <p className="text-sm text-muted-foreground">No tools. The agent will answer from its instructions and knowledge only.</p>}
              {form.tools.map((t, i) => <ToolEditor key={t.id} tool={t} onChange={(nt) => set('tools', form.tools.map((x, j) => (j === i ? nt : x)))} onRemove={() => set('tools', form.tools.filter((_, j) => j !== i))} />)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Knowledge & memory</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Knowledge bases</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {kbs.data?.length === 0 && <p className="text-xs text-muted-foreground">No knowledge bases yet. <Link className="text-primary" href="/agents?tab=knowledge">Create one</Link></p>}
                  {kbs.data?.map((k) => { const on = form.knowledgeBaseIds.includes(k.id); return <button type="button" key={k.id} onClick={() => set('knowledgeBaseIds', on ? form.knowledgeBaseIds.filter((x) => x !== k.id) : [...form.knowledgeBaseIds, k.id])} className={cn('rounded-lg border px-2.5 py-1 text-xs font-medium', on ? 'border-primary bg-accent text-accent-foreground' : 'text-muted-foreground')}>{k.name}</button>; })}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">Attached knowledge bases add a search_knowledge tool automatically.</p>
              </div>
              <div className="flex items-center justify-between"><div><Label>Conversation memory</Label><p className="text-[11px] text-muted-foreground">Remember previous messages of the same session</p></div><Switch checked={form.memoryEnabled} onCheckedChange={(v) => set('memoryEnabled', v)} /></div>
              {form.memoryEnabled && <Field label="Messages to remember"><Input type="number" min={0} max={200} value={form.memoryWindow} onChange={(e) => set('memoryWindow', Number(e.target.value))} /></Field>}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Input format"><Select value={form.inputFormat} onChange={(e) => set('inputFormat', e.target.value as 'text')}><option value="text">Text</option><option value="json">JSON</option></Select></Field>
                <Field label="Output format"><Select value={form.outputFormat} onChange={(e) => set('outputFormat', e.target.value as 'text')}><option value="text">Text</option><option value="json">JSON</option></Select></Field>
              </div>
              {form.outputFormat === 'json' && <Field label="Output JSON schema (optional)" hint="The response is parsed and validated against this schema"><CodeEditor language="json" minHeight={100} value={schemaText} onChange={setSchemaText} /></Field>}
            </CardContent>
          </Card>
        </fieldset>
        <div>{isNew ? <Card className="flex h-64 items-center justify-center p-6 text-center text-sm text-muted-foreground"><div><Plus className="mx-auto mb-2 h-6 w-6" />Create the agent to open the testing playground.</div></Card> : <Playground agentId={id} ready={!!q.data?.credentialId} />}</div>
      </div>
      {dialog}
    </>
  );
}
