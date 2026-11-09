'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { BookOpen, Copy, Database, ExternalLink, Play, Power, Settings2, SlidersHorizontal, Trash2, X } from 'lucide-react';
import type { NodeDescription } from '@simplyai/shared';
import { Button } from '@/components/ui/button';
import { Field, Input, Label, Select, Textarea } from '@/components/ui/input';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { CopyField, JsonView } from '@/components/ui/extras';
import { CodeEditor } from '@/components/ui/code-editor';
import { NodeIcon } from '@/components/icons';
import { useWsQuery } from '@/lib/hooks';
import { formatDuration } from '@/lib/utils';
import { useEditor, type WfNodeData } from '@/stores/editor';
import { ExpressionHelp, ParamField } from './param-field';
import { nodeIssues } from './nodes';

interface WebhookInfo { nodeKey: string; path: string; kind: string; methods: string[]; active: boolean }

function Markdown({ text }: { text: string }) {
  const html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/`([^`]+)`/g, '<code class="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/^\* (.*)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/\n\n/g, '<br/><br/>');
  return <div className="text-[13px] leading-relaxed text-foreground/90" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function ConfigPanel({ nodeId, webhooks, onRunTo, canEdit, canRun }: { nodeId: string; webhooks: WebhookInfo[]; onRunTo: (id: string) => void; canEdit: boolean; canRun: boolean }) {
  const node = useEditor((s) => s.nodes.find((n) => n.id === nodeId));
  const desc = useEditor((s) => (node?.type === 'wf' ? s.catalog.get((node.data as WfNodeData).type) : undefined));
  const runData = useEditor((s) => s.runData[nodeId]);
  const runStatus = useEditor((s) => s.runStatus[nodeId]);
  const { updateNode, updateParams, removeNodes, duplicate, select, snapshot } = useEditor.getState();
  const [tab, setTab] = useState('params');
  const [runIdx, setRunIdx] = useState(0);
  if (!node || node.type !== 'wf') return null;
  const data = node.data as WfNodeData;
  if (!desc) return <div className="p-4 text-sm text-red-600">Unknown node type {data.type}</div>;
  const issues = nodeIssues(desc, data);
  const run = runData?.[Math.min(runIdx, (runData?.length ?? 1) - 1)];
  const webhook = webhooks.find((w) => w.nodeKey === nodeId);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-3 border-b p-4">
        <NodeIcon icon={desc.icon} color={desc.color} />
        <div className="min-w-0 flex-1">
          <input disabled={!canEdit} className="w-full rounded bg-transparent text-[15px] font-semibold outline-none focus:bg-muted/50" value={data.name} onFocus={snapshot} onChange={(e) => updateNode(nodeId, { name: e.target.value }, false)} aria-label="Node name" />
          <p className="text-xs text-muted-foreground">{desc.displayName} · {desc.description}</p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => select(null)} aria-label="Close panel"><X /></Button>
      </div>
      <div className="flex items-center gap-1.5 border-b px-4 py-2">
        {canRun && !desc.trigger && <Button size="sm" variant="soft" onClick={() => onRunTo(nodeId)}><Play /> Run to here</Button>}
        {canRun && desc.trigger && <Button size="sm" variant="soft" onClick={() => onRunTo(nodeId)}><Play /> Run from here</Button>}
        {canEdit && <Button size="sm" variant="ghost" onClick={() => updateNode(nodeId, { disabled: !data.disabled })}><Power /> {data.disabled ? 'Enable' : 'Disable'}</Button>}
        {canEdit && <Button size="sm" variant="ghost" onClick={() => duplicate([nodeId])} aria-label="Duplicate"><Copy /></Button>}
        {canEdit && <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => removeNodes([nodeId])} aria-label="Delete"><Trash2 /></Button>}
      </div>
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-4 mt-3 grid grid-cols-4">
          <TabsTrigger value="params"><SlidersHorizontal />Params</TabsTrigger>
          <TabsTrigger value="settings"><Settings2 />Settings</TabsTrigger>
          <TabsTrigger value="data"><Database />Data{runStatus && <span className={`h-1.5 w-1.5 rounded-full ${runStatus.status === 'FAILED' ? 'bg-red-500' : 'bg-emerald-500'}`} />}</TabsTrigger>
          <TabsTrigger value="docs"><BookOpen />Docs</TabsTrigger>
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 scrollbar-thin">
          <TabsContent value="params" className="space-y-4">
            {issues.length > 0 && <div className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">{issues.map((i) => <p key={i}>• {i}</p>)}</div>}
            {webhook && <WebhookUrls webhook={webhook} />}
            {desc.credentials && <CredentialPicker desc={desc} value={data.credentialId ?? null} onChange={(v) => updateNode(nodeId, { credentialId: v })} />}
            <fieldset disabled={!canEdit} className="space-y-4">
              {desc.properties.map((p) => (
                <ParamField key={p.name} prop={p} value={data.parameters[p.name]} params={data.parameters} onChange={(v) => updateParams(nodeId, { [p.name]: v })} />
              ))}
            </fieldset>
            <div className="pt-2"><ExpressionHelp /></div>
          </TabsContent>
          <TabsContent value="settings">
            <NodeSettings data={data} desc={desc} disabled={!canEdit} onChange={(patch) => updateNode(nodeId, patch)} />
          </TabsContent>
          <TabsContent value="data" className="space-y-3">
            {!runData?.length ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Run the workflow (or “Run to here”) to inspect this node&apos;s input and output.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={run!.status} />
                  <span className="text-xs text-muted-foreground">{formatDuration(run!.durationMs)}</span>
                  {runData.length > 1 && (
                    <Select className="ml-auto h-7 w-32 text-xs" value={runIdx} onChange={(e) => setRunIdx(Number(e.target.value))}>
                      {runData.map((r, i) => <option key={i} value={i}>Run {r.runIndex + 1}</option>)}
                    </Select>
                  )}
                </div>
                {Boolean(run!.error) && <div><Label>Error</Label><JsonView data={run!.error} className="mt-1.5 border-red-900" maxHeight={200} /></div>}
                <div><Label>Output</Label><JsonView data={simplify(run!.output)} className="mt-1.5" /></div>
                <div><Label>Input</Label><JsonView data={simplify(run!.input)} className="mt-1.5" maxHeight={260} /></div>
              </>
            )}
          </TabsContent>
          <TabsContent value="docs" className="space-y-4">
            <Markdown text={desc.docs ?? desc.description} />
            {desc.outputExample && <div><Label>Example output</Label><JsonView data={desc.outputExample} className="mt-1.5" maxHeight={240} /></div>}
            <div>
              <Label>Parameters</Label>
              <ul className="mt-2 space-y-1.5 text-xs">
                {desc.properties.filter((p) => p.type !== 'notice').map((p) => (
                  <li key={p.name}><code className="rounded bg-muted px-1">{p.name}</code> <span className="text-muted-foreground">({p.type}{p.required ? ', required' : ''})</span> {p.description}</li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-muted-foreground">Type: <code>{desc.type}</code> · v{desc.version}</p>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function simplify(ports: unknown): unknown {
  if (!Array.isArray(ports)) return ports;
  if (ports.length === 1) return (ports[0] as Array<{ json: unknown }>).map?.((i) => i.json) ?? ports[0];
  return Object.fromEntries(ports.map((p, i) => [`output ${i}`, Array.isArray(p) ? p.map((x: { json: unknown }) => x.json) : p]));
}

function WebhookUrls({ webhook }: { webhook: WebhookInfo }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const prod = webhook.kind === 'FORM' ? `${origin}/f/${webhook.path}` : webhook.kind === 'CHAT' ? `${origin}/c/${webhook.path}` : `${origin}/webhook/${webhook.path}`;
  const test = webhook.kind === 'FORM' ? `${prod}?test=1` : webhook.kind === 'CHAT' ? `${prod}?test=1` : `${origin}/webhook-test/${webhook.path}`;
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center justify-between"><Label>{webhook.kind === 'WEBHOOK' ? 'Webhook URLs' : webhook.kind === 'FORM' ? 'Form URLs' : 'Chat URLs'}</Label>{webhook.active ? <Badge variant="success">Live</Badge> : <Badge variant="secondary">Inactive</Badge>}</div>
      <p className="text-[11px] text-muted-foreground">Test (runs the saved draft)</p>
      <CopyField value={test} />
      <p className="text-[11px] text-muted-foreground">Production (requires an active workflow{webhook.kind === 'WEBHOOK' ? `, ${webhook.methods.join('/')}` : ''})</p>
      <CopyField value={prod} />
      {webhook.kind !== 'WEBHOOK' && <a href={test} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary">Open test page <ExternalLink className="h-3 w-3" /></a>}
      {webhook.kind === 'WEBHOOK' && <Link href="/webhooks" className="block text-xs text-primary">Configure authentication & responses →</Link>}
    </div>
  );
}

function CredentialPicker({ desc, value, onChange }: { desc: NodeDescription; value: string | null; onChange: (v: string | null) => void }) {
  const types = desc.credentials!.types;
  const q = useWsQuery<Array<{ id: string; name: string; type: string; typeName: string; status: string }>>(['credentials', types.join(',')], '/credentials', { type: types.join(',') });
  const list = useMemo(() => q.data ?? [], [q.data]);
  return (
    <Field label={<>Credential{desc.credentials!.required && <span className="text-red-500"> *</span>}</>} hint={<>Accepted: {types.join(', ')}. <Link href={`/credentials?new=${types[0]}`} target="_blank" className="text-primary">Create new</Link></>}>
      <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{desc.credentials!.required ? 'Select a credential…' : 'No authentication'}</option>
        {list.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.typeName}){c.status !== 'ACTIVE' ? ` · ${c.status.toLowerCase()}` : ''}</option>)}
      </Select>
    </Field>
  );
}

function NodeSettings({ data, desc, disabled, onChange }: { data: WfNodeData; desc: NodeDescription; disabled: boolean; onChange: (p: Partial<WfNodeData>) => void }) {
  const s = data.settings ?? {};
  const set = (patch: Partial<NonNullable<WfNodeData['settings']>>) => onChange({ settings: { ...s, ...patch } });
  const retry = s.retry ?? { enabled: false, maxTries: 3, waitBetweenMs: 1000, backoff: 'fixed' as const };
  return (
    <fieldset disabled={disabled} className="space-y-4">
      <Toggle label="Retry on failure" hint="Re-run the node when it throws an error" checked={retry.enabled} onChange={(v) => set({ retry: { ...retry, enabled: v } })} />
      {retry.enabled && (
        <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3">
          <Field label="Max tries"><Input type="number" min={1} max={10} value={retry.maxTries} onChange={(e) => set({ retry: { ...retry, maxTries: Number(e.target.value) } })} /></Field>
          <Field label="Wait (ms)"><Input type="number" min={0} value={retry.waitBetweenMs} onChange={(e) => set({ retry: { ...retry, waitBetweenMs: Number(e.target.value) } })} /></Field>
          <Field label="Backoff"><Select value={retry.backoff ?? 'fixed'} onChange={(e) => set({ retry: { ...retry, backoff: e.target.value as 'fixed' } })}><option value="fixed">Fixed</option><option value="exponential">Exponential</option></Select></Field>
        </div>
      )}
      <Field label="Timeout (ms)" hint="0 = no timeout"><Input type="number" min={0} value={s.timeoutMs ?? 0} onChange={(e) => set({ timeoutMs: Number(e.target.value) || undefined })} /></Field>
      {!desc.trigger && <Toggle label="Continue on fail" hint="Pass the error as data instead of stopping the workflow" checked={!!s.continueOnFail} onChange={(v) => set({ continueOnFail: v })} />}
      {s.continueOnFail && <Toggle label="Route errors to an extra “error” output" checked={!!s.errorOutput} onChange={(v) => set({ errorOutput: v })} />}
      <Toggle label="Always output data" hint="Emit an empty item when the node returns nothing" checked={!!s.alwaysOutputData} onChange={(v) => set({ alwaysOutputData: v })} />
      {!desc.trigger && <Toggle label="Execute once" hint="Only process the first input item" checked={!!s.executeOnce} onChange={(v) => set({ executeOnce: v })} />}
      <Field label="Notes" hint="Shown on the canvas"><Textarea rows={3} value={data.notes ?? ''} onChange={(e) => onChange({ notes: e.target.value })} /></Field>
      <Field label="Parameters (JSON)" hint="Advanced: edit the raw configuration">
        <CodeEditor language="json" minHeight={120} value={JSON.stringify(data.parameters, null, 2)} onChange={(v) => { try { onChange({ parameters: JSON.parse(v) }); } catch { /* wait for valid JSON */ } }} />
      </Field>
    </fieldset>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div><Label>{label}</Label>{hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}</div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
