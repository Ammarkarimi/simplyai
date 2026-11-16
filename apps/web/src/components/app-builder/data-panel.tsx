'use client';
/** Queries (workflow, data table, static) and state variables. */
import * as React from 'react';
import Link from 'next/link';
import { Database, FileJson, Loader2, Play, Plus, Trash2, Variable, Workflow } from 'lucide-react';
import { IDENTIFIER_RE, RESERVED_NAMES, uiId, type AppQuery, type AppQueryKind, type DataTableOperation } from '@simplyai/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { JsonView } from '@/components/ui/extras';
import { Popover, PopoverContent, PopoverTrigger, Switch } from '@/components/ui/misc';
import { useWsQuery } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { ActionList, Row, RuntimeRef, Section, SelectField, TextField } from './fields';
import { useBuilder, usedNames, uniqueName } from './store';
import type { QueryState } from './runtime';

const KIND_META: Record<AppQueryKind, { label: string; icon: React.ElementType; color: string; description: string }> = {
  workflow: { label: 'Workflow', icon: Workflow, color: 'text-violet-500', description: 'Run a workflow with an App Trigger and get its output' },
  dataTable: { label: 'Data table', icon: Database, color: 'text-sky-500', description: 'List, get, insert, update or delete rows' },
  static: { label: 'Static data', icon: FileJson, color: 'text-amber-500', description: 'JSON you type in, or a step that only runs actions' },
};

function useQueryState(name: string): QueryState | undefined {
  const rt = React.useContext(RuntimeRef);
  return React.useSyncExternalStore(
    (cb) => rt?.store.subscribe(cb) ?? (() => undefined),
    () => rt?.store.getState().queries[name],
    () => undefined,
  );
}

export function DataPanel() {
  const def = useBuilder((s) => s.def)!;
  const focus = useBuilder((s) => s.focus);
  const { change, set } = useBuilder.getState();
  const rt = React.useContext(RuntimeRef);
  const state = React.useSyncExternalStore((cb) => rt?.store.subscribe(cb) ?? (() => undefined), () => rt?.store.getState().state, () => undefined);
  const addQuery = (kind: AppQueryKind) => {
    const name = uniqueName(kind === 'workflow' ? 'runWorkflow' : kind === 'dataTable' ? 'getRows' : 'data', usedNames(def));
    const q: AppQuery = { id: uiId('q'), name, kind, ...(kind === 'dataTable' ? { operation: 'list', args: { pageSize: '100' }, runOnLoad: true } : kind === 'static' ? { staticData: '[\n  { "label": "A", "value": 10 },\n  { "label": "B", "value": 20 }\n]', runOnLoad: true } : { payload: '{{ ({ }) }}' }) };
    change((d) => { d.queries.push(q); });
    set({ focus: { kind: 'query', id: q.id } });
  };
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Section title={`Queries · ${def.queries.length}`} right={
        <Popover>
          <PopoverTrigger asChild><button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="New query"><Plus className="h-3.5 w-3.5" /></button></PopoverTrigger>
          <PopoverContent className="w-64 p-1" align="end">
            {(Object.keys(KIND_META) as AppQueryKind[]).map((k) => {
              const m = KIND_META[k];
              return (
                <button key={k} type="button" onClick={() => addQuery(k)} className="flex w-full items-start gap-2 rounded px-2 py-2 text-left hover:bg-accent">
                  <m.icon className={cn('mt-0.5 h-4 w-4', m.color)} />
                  <span><span className="block text-xs font-medium">{m.label}</span><span className="block text-[10.5px] text-muted-foreground">{m.description}</span></span>
                </button>
              );
            })}
          </PopoverContent>
        </Popover>
      }>
        {!def.queries.length ? <p className="text-[11px] text-muted-foreground">Queries load and change data. Reference results with <code>{'{{ queryName.data }}'}</code>.</p> : null}
        <div className="space-y-1">
          {def.queries.map((q) => <QueryRow key={q.id} q={q} active={focus.kind === 'query' && focus.id === q.id} />)}
        </div>
      </Section>
      <Section title={`State · ${def.state.length}`} right={
        <button type="button" title="New variable" className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => change((d) => { d.state.push({ name: uniqueName('variable', new Set(d.state.map((s) => s.name).concat([...usedNames(d)]))), initial: '""' }); })}><Plus className="h-3.5 w-3.5" /></button>
      }>
        {!def.state.length ? <p className="text-[11px] text-muted-foreground">Variables shared by the whole app. Read with <code>{'{{ state.name }}'}</code>, change with the Set state action.</p> : null}
        {def.state.map((v, i) => (
          <div key={i} className="space-y-1 rounded-md border p-2">
            <div className="flex items-center gap-1">
              <Variable className="h-3.5 w-3.5 text-emerald-500" />
              <Input className={cn('h-7 flex-1 font-mono text-xs', (!IDENTIFIER_RE.test(v.name) || RESERVED_NAMES.has(v.name)) && 'border-destructive')} value={v.name} onChange={(e) => change((d) => { d.state[i]!.name = e.target.value.replace(/\s/g, ''); }, `state:${i}:name`)} />
              <button type="button" className="rounded p-1 text-muted-foreground hover:text-destructive" onClick={() => change((d) => { d.state.splice(i, 1); })}><Trash2 className="h-3 w-3" /></button>
            </div>
            <Row label="Initial value (JSON)"><Input className="h-7 font-mono text-[11px]" value={v.initial} onChange={(e) => change((d) => { d.state[i]!.initial = e.target.value; }, `state:${i}:initial`)} /></Row>
            <div className="truncate font-mono text-[10.5px] text-muted-foreground" title={JSON.stringify(state?.[v.name])}>now: {JSON.stringify(state?.[v.name]) ?? 'undefined'}</div>
          </div>
        ))}
      </Section>
    </div>
  );
}

function QueryRow({ q, active }: { q: AppQuery; active: boolean }) {
  const qs = useQueryState(q.name);
  const m = KIND_META[q.kind];
  return (
    <button type="button" onClick={() => useBuilder.getState().set({ focus: { kind: 'query', id: q.id } })} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs', active ? 'bg-primary/10 text-primary' : 'hover:bg-accent')}>
      <m.icon className={cn('h-3.5 w-3.5 shrink-0', m.color)} />
      <span className="flex-1 truncate font-mono">{q.name}</span>
      {qs?.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : qs?.error ? <span className="h-1.5 w-1.5 rounded-full bg-destructive" title={qs.error} /> : qs?.lastRunAt ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> : null}
      {q.runOnLoad ? <span className="rounded bg-muted px-1 text-[9.5px] text-muted-foreground">auto</span> : null}
    </button>
  );
}

const OP_ARGS: Record<DataTableOperation, Array<{ key: string; label: string; placeholder: string; multiline?: boolean }>> = {
  list: [
    { key: 'search', label: 'Search text', placeholder: '{{ searchInput.value }}' },
    { key: 'filters', label: 'Exact filters (JSON object)', placeholder: '{{ ({ status: statusSelect.value }) }}' },
    { key: 'sort', label: 'Sort by column', placeholder: 'createdAt' },
    { key: 'order', label: 'Order (asc / desc)', placeholder: 'desc' },
    { key: 'pageSize', label: 'Rows (max 500)', placeholder: '100' },
    { key: 'page', label: 'Page', placeholder: '1' },
  ],
  get: [{ key: 'rowId', label: 'Row id', placeholder: '{{ table1.selectedRow.id }}' }],
  insert: [{ key: 'data', label: 'Row data', placeholder: '{{ form1.data }}', multiline: true }],
  update: [{ key: 'rowId', label: 'Row id', placeholder: '{{ table1.selectedRow.id }}' }, { key: 'data', label: 'Changes', placeholder: '{{ ({ status: "Done" }) }}', multiline: true }],
  delete: [{ key: 'rowId', label: 'Row id', placeholder: '{{ table1.selectedRow.id }}' }],
};

export function QueryEditor({ query }: { query: AppQuery }) {
  const def = useBuilder((s) => s.def)!;
  const change = useBuilder.getState().change;
  const rt = React.useContext(RuntimeRef);
  const qs = useQueryState(query.name);
  const workflows = useWsQuery<{ items: Array<{ id: string; name: string; active: boolean }> }>(['workflows', 'app-picker'], '/workflows', { pageSize: 100 }, { enabled: query.kind === 'workflow' });
  const tables = useWsQuery<Array<{ id: string; name: string; columns: Array<{ name: string }> }>>(['data-tables'], '/data-tables', undefined, { enabled: query.kind === 'dataTable' });
  const [name, setName] = React.useState(query.name);
  React.useEffect(() => setName(query.name), [query.name]);
  const set = (fn: (q: AppQuery) => void, key?: string) => change((d) => { const q = d.queries.find((x) => x.id === query.id); if (q) fn(q); }, key ? `q:${query.id}:${key}` : undefined);
  const taken = usedNames(def);
  taken.delete(query.name);
  const nameError = !IDENTIFIER_RE.test(name) ? 'Use letters, digits and _' : RESERVED_NAMES.has(name) ? 'Reserved name' : taken.has(name) ? 'Already used' : null;
  const m = KIND_META[query.kind];
  const table = tables.data?.find((t) => t.id === query.tableId);
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b p-3">
        <div className="flex items-center gap-2">
          <m.icon className={cn('h-4 w-4', m.color)} />
          <span className="text-xs font-semibold">{m.label} query</span>
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" className="h-7 gap-1 text-xs" disabled={!rt || qs?.loading} onClick={() => rt && void rt.runQuery(query.name)}>
              {qs?.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}Run
            </Button>
            <button type="button" title="Delete query" className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => { change((d) => { d.queries = d.queries.filter((q) => q.id !== query.id); }); useBuilder.getState().set({ focus: { kind: 'theme' } }); }}><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </div>
        <Input className={cn('h-7 font-mono text-xs', nameError && name !== query.name && 'border-destructive')} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => { if (!nameError && name !== query.name) set((q) => { q.name = name; }); else setName(query.name); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      </div>
      <div className="flex-1 overflow-y-auto">
        <Section title="Source">
          {query.kind === 'workflow' ? (
            <>
              <Row label="Workflow" hint={<>The workflow needs an <b>App Trigger</b>. The builder runs its saved draft; published apps run the active version. <Link href="/workflows" className="text-primary underline" target="_blank">Open workflows</Link></>}>
                <SelectField allowFx={false} value={query.workflowId} placeholder={workflows.isLoading ? 'Loading…' : 'Choose a workflow'} options={(workflows.data?.items ?? []).map((w) => ({ label: `${w.name}${w.active ? '' : ' (inactive)'}`, value: w.id }))} onChange={(v) => set((q) => { q.workflowId = v || undefined; })} />
              </Row>
              <Row label="Payload" hint="Becomes the App Trigger output item. Write an object expression, e.g. {{ ({ email: emailInput.value }) }}, or JSON text with bindings.">
                <TextField value={query.payload ?? ''} multiline mono rows={4} onChange={(v) => set((q) => { q.payload = v; }, 'payload')} />
              </Row>
            </>
          ) : query.kind === 'dataTable' ? (
            <>
              <Row label="Data table" hint={<Link href="/data-tables" className="text-primary underline" target="_blank">Manage data tables</Link>}>
                <SelectField allowFx={false} value={query.tableId} placeholder={tables.isLoading ? 'Loading…' : 'Choose a table'} options={(tables.data ?? []).map((t) => ({ label: t.name, value: t.id }))} onChange={(v) => set((q) => { q.tableId = v || undefined; })} />
              </Row>
              {table ? <p className="text-[10.5px] text-muted-foreground">Columns: {table.columns.map((c) => c.name).join(', ') || '—'}</p> : null}
              <Row label="Operation">
                <div className="grid grid-cols-5 gap-1">
                  {(['list', 'get', 'insert', 'update', 'delete'] as DataTableOperation[]).map((op) => (
                    <button key={op} type="button" onClick={() => set((q) => { q.operation = op; if (op !== 'list') q.runOnLoad = false; })} className={cn('rounded border py-1 text-[11px] capitalize', (query.operation ?? 'list') === op ? 'border-primary bg-primary/10 font-medium text-primary' : 'hover:border-primary/50')}>{op}</button>
                  ))}
                </div>
              </Row>
              {OP_ARGS[query.operation ?? 'list'].map((a) => (
                <Row key={a.key} label={a.label}>
                  <TextField value={query.args?.[a.key] ?? ''} placeholder={a.placeholder} mono={a.multiline} multiline={a.multiline} onChange={(v) => set((q) => { q.args = { ...(q.args ?? {}), [a.key]: v }; if (!v) delete q.args[a.key]; }, `arg:${a.key}`)} />
                </Row>
              ))}
              {query.operation && query.operation !== 'list' && query.operation !== 'get' ? <p className="rounded-md bg-amber-500/10 p-2 text-[10.5px] text-amber-700 dark:text-amber-400">In a public app anyone with the link can trigger this {query.operation}. Use a private app or a workflow with your own checks for sensitive data.</p> : null}
            </>
          ) : (
            <Row label="JSON" hint="Leave as null to use the query only as a sequence of actions">
              <TextField value={query.staticData ?? ''} multiline mono rows={8} onChange={(v) => set((q) => { q.staticData = v; }, 'static')} />
            </Row>
          )}
        </Section>
        <Section title="Behaviour">
          <label className="flex items-center justify-between text-xs">Run when the app loads<Switch checked={!!query.runOnLoad} onCheckedChange={(v) => set((q) => { q.runOnLoad = v || undefined; })} /></label>
          <Row label="Transform result" hint="Expression applied to the result; the raw result is data"><TextField value={query.transform ?? ''} mono placeholder="{{ data.filter((r) => r.active) }}" onChange={(v) => set((q) => { q.transform = v || undefined; }, 'transform')} /></Row>
          <Row label="Ask for confirmation"><TextField value={query.confirm ?? ''} placeholder="Delete this customer?" onChange={(v) => set((q) => { q.confirm = v || undefined; }, 'confirm')} /></Row>
        </Section>
        <Section title="On success" defaultOpen={!!query.onSuccess?.length}>
          <ActionList def={def} actions={query.onSuccess} onChange={(a) => set((q) => { q.onSuccess = a.length ? a : undefined; })} emptyText="e.g. refresh another query, close a modal, show a notification" />
        </Section>
        <Section title="On error" defaultOpen={!!query.onError?.length}>
          <ActionList def={def} actions={query.onError} onChange={(a) => set((q) => { q.onError = a.length ? a : undefined; })} emptyText="Without actions, errors show a notification" />
        </Section>
        <Section title="Last result">
          {qs?.error ? <p className="rounded-md bg-destructive/10 p-2 font-mono text-[11px] text-destructive">{qs.error}</p> : null}
          {qs?.lastRunAt ? <JsonView data={qs.data} maxHeight={260} className="text-[11px]" /> : <p className="text-[11px] text-muted-foreground">Not run yet. Use <b>Run</b> to test it.</p>}
          {qs?.meta ? <p className="text-[10.5px] text-muted-foreground">meta: {JSON.stringify(qs.meta)}</p> : null}
        </Section>
      </div>
    </div>
  );
}
