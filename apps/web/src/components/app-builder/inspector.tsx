'use client';
/** Right panel: component properties, style, events and advanced settings, or the focused page/query/theme. */
import * as React from 'react';
import { Copy, Lock, Monitor, Smartphone, Tablet, Trash2, Unlock } from 'lucide-react';
import { IDENTIFIER_RE, RESERVED_NAMES, type UINode } from '@simplyai/shared';
import { LucideIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { metaFor, type FieldDef } from './catalog';
import { ActionList, BoolField, ColorField, IconField, NumberField, Row, Section, SelectField, TextField } from './fields';
import { QueryEditor } from './data-panel';
import { StylePanel } from './style-panel';
import { ThemePanel } from './theme-panel';
import { useBuilder, useCurrentPage, usedNames, useSelected } from './store';

type Tab = 'props' | 'style' | 'events' | 'advanced';

function PropField({ node, field }: { node: UINode; field: FieldDef }) {
  const def = useBuilder((s) => s.def)!;
  const update = useBuilder.getState().updateNode;
  const value = node.props[field.key];
  const set = (v: unknown) => update(node.id, (n) => { n.props[field.key] = v; }, `prop:${field.key}`);
  let input: React.ReactNode;
  switch (field.type) {
    case 'textarea':
      input = <TextField value={value} onChange={set} multiline placeholder={field.placeholder} rows={field.key === 'content' ? 8 : 3} />;
      break;
    case 'expression':
    case 'code':
      input = <TextField value={value} onChange={set} multiline mono placeholder={field.placeholder} rows={2} />;
      break;
    case 'number':
      input = <NumberField value={value} onChange={set} placeholder={field.placeholder} />;
      break;
    case 'boolean':
      input = <BoolField value={value} onChange={set} />;
      break;
    case 'select':
      input = <SelectField value={value} onChange={set} options={field.options ?? []} />;
      break;
    case 'color':
      input = <ColorField value={value} onChange={set} />;
      break;
    case 'icon':
      input = <IconField value={value} onChange={set} />;
      break;
    case 'page':
      input = <SelectField allowFx={false} value={value} onChange={set} options={def.pages.map((p) => ({ label: p.name, value: p.id }))} placeholder="None" />;
      break;
    default:
      input = <TextField value={value} onChange={set} placeholder={field.placeholder} />;
  }
  return field.type === 'boolean' ? (
    <div className="flex items-start justify-between gap-3">
      <div className="pt-0.5 text-xs">{field.label}</div>
      <div className={cn(typeof value === 'string' && value.includes('{{') ? 'flex-1' : '')}>{input}</div>
    </div>
  ) : <Row label={field.label} hint={field.help}>{input}</Row>;
}

function NameField({ node }: { node: UINode }) {
  const def = useBuilder((s) => s.def)!;
  const [v, setV] = React.useState(node.name);
  React.useEffect(() => setV(node.name), [node.name]);
  const taken = usedNames(def);
  taken.delete(node.name);
  const error = !IDENTIFIER_RE.test(v) ? 'Use letters, digits and _ (no spaces)' : RESERVED_NAMES.has(v) ? 'Reserved name' : taken.has(v) ? 'Already used' : null;
  return (
    <div>
      <Input
        className={cn('h-7 font-mono text-xs', error && 'border-destructive')}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { if (!error && v !== node.name) useBuilder.getState().updateNode(node.id, (n) => { n.name = v; }); else setV(node.name); }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      {error && v !== node.name ? <p className="mt-0.5 text-[10.5px] text-destructive">{error}</p> : null}
    </div>
  );
}

function JsonEditor({ node }: { node: UINode }) {
  const [text, setText] = React.useState(() => JSON.stringify(node, null, 2));
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => setText(JSON.stringify(node, null, 2)), [node]);
  return (
    <div className="space-y-2">
      <Textarea className="min-h-0 font-mono text-[10.5px]" rows={12} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
      <Button size="sm" variant="outline" className="h-7 w-full text-xs" onClick={() => {
        try {
          const parsed = JSON.parse(text) as UINode;
          if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string' || !parsed.props) throw new Error('A component needs type and props');
          useBuilder.getState().updateNode(node.id, (n) => { Object.keys(n).forEach((k) => delete (n as unknown as Record<string, unknown>)[k]); Object.assign(n, parsed, { id: node.id }); });
          setError(null);
        } catch (e) {
          setError((e as Error).message);
        }
      }}>Apply JSON</Button>
    </div>
  );
}

function NodeInspector({ node }: { node: UINode }) {
  const [tab, setTab] = React.useState<Tab>('props');
  const def = useBuilder((s) => s.def)!;
  const meta = metaFor(node.type);
  const update = useBuilder.getState().updateNode;
  const isRoot = node.type === 'page';
  const events = meta?.events ?? [];
  const eventCount = Object.values(node.events ?? {}).reduce((s, a) => s + a.length, 0);
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b p-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary"><LucideIcon name={meta?.icon ?? 'file'} className="h-3.5 w-3.5" /></span>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold">{isRoot ? 'Page body' : meta?.label ?? node.type}</div>
            <div className="truncate text-[10.5px] text-muted-foreground">{meta?.description ?? 'Root container of the page'}</div>
          </div>
          {!isRoot ? (
            <>
              <button type="button" title="Duplicate" className="rounded p-1 text-muted-foreground hover:bg-accent" onClick={() => useBuilder.getState().duplicate(node.id)}><Copy className="h-3.5 w-3.5" /></button>
              <button type="button" title="Delete" className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => useBuilder.getState().remove(node.id)}><Trash2 className="h-3.5 w-3.5" /></button>
            </>
          ) : null}
        </div>
        {!isRoot ? <NameField node={node} /> : null}
        {meta?.exposes ? <p className="text-[10.5px] text-muted-foreground">Use <code className="rounded bg-muted px-1">{`{{ ${node.name}${meta.exposes.split(',')[0]!.trim().split(' ')[0]} }}`}</code> · exposes {meta.exposes}</p> : null}
      </div>
      <div className="grid grid-cols-4 border-b text-[11px]">
        {(['props', 'style', 'events', 'advanced'] as Tab[]).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={cn('relative py-2 capitalize', tab === t ? 'font-semibold text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded after:bg-primary' : 'text-muted-foreground hover:text-foreground')}>
            {t}{t === 'events' && eventCount ? <span className="ml-1 rounded-full bg-primary/15 px-1 text-[9.5px] text-primary">{eventCount}</span> : null}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'props' ? (
          <div className="space-y-3 p-3">
            {meta?.fields.length ? meta.fields.map((f) => <PropField key={f.key} node={node} field={f} />) : <p className="text-xs text-muted-foreground">{isRoot ? 'The page body is the root container. Style it in the Style tab, or open Page settings for title and on-load actions.' : 'No properties.'}</p>}
            {node.type === 'list' ? <p className="rounded-md bg-muted/60 p-2 text-[11px] text-muted-foreground">Children of the list are repeated for every item. Inside them use <code>{'{{ item.field }}'}</code> and <code>{'{{ index }}'}</code>.</p> : null}
            {node.type === 'table' ? <p className="rounded-md bg-muted/60 p-2 text-[11px] text-muted-foreground">Bind rows to a query, e.g. <code>{'{{ getCustomers.data }}'}</code>. Clicking a row sets <code>{`${node.name}.selectedRow`}</code>.</p> : null}
            {node.type === 'form' ? <p className="rounded-md bg-muted/60 p-2 text-[11px] text-muted-foreground">On submit, <code>{`${node.name}.data`}</code> holds every input inside the form keyed by input name. Required inputs are validated first.</p> : null}
          </div>
        ) : tab === 'style' ? (
          <StylePanel node={node} />
        ) : tab === 'events' ? (
          <div>
            {events.length ? events.map((ev) => (
              <Section key={ev.key} title={ev.label}>
                <ActionList def={def} actions={node.events?.[ev.key]} onChange={(a) => update(node.id, (n) => { n.events = { ...(n.events ?? {}), [ev.key]: a }; if (!a.length) delete n.events[ev.key]; })} />
              </Section>
            )) : <p className="p-3 text-xs text-muted-foreground">This component has no events. Wrap it in a container to make it clickable.</p>}
            <p className="p-3 text-[10.5px] text-muted-foreground">Actions run in order. Values can use expressions; handlers receive extra variables such as <code>row</code>, <code>value</code>, <code>item</code> or <code>data</code>.</p>
          </div>
        ) : (
          <div>
            <Section title="Visibility">
              <Row label="Show when" hint="Hidden when the expression is falsy, e.g. {{ state.loggedIn }}"><TextField value={node.visible ?? ''} mono placeholder="{{ true }}" onChange={(v) => update(node.id, (n) => { if (v) n.visible = v; else delete n.visible; }, 'visible')} /></Row>
              <Row label="Hide on">
                <div className="flex gap-1">
                  {([['desktop', Monitor], ['tablet', Tablet], ['mobile', Smartphone]] as const).map(([bp, Icon]) => {
                    const on = node.hideOn?.includes(bp);
                    return (
                      <button key={bp} type="button" onClick={() => update(node.id, (n) => { const s = new Set(n.hideOn ?? []); if (on) s.delete(bp); else s.add(bp); n.hideOn = [...s]; if (!n.hideOn.length) delete n.hideOn; })} className={cn('flex flex-1 items-center justify-center gap-1 rounded-md border py-1 text-[11px] capitalize', on ? 'border-destructive/50 bg-destructive/10 text-destructive' : 'text-muted-foreground hover:text-foreground')}>
                        <Icon className="h-3 w-3" />{bp}
                      </button>
                    );
                  })}
                </div>
              </Row>
            </Section>
            {!isRoot ? (
              <Section title="Editing">
                <label className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5">{node.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}Lock position</span>
                  <Switch checked={!!node.locked} onCheckedChange={(v) => update(node.id, (n) => { if (v) n.locked = true; else delete n.locked; })} />
                </label>
                <Row label="Component id"><code className="block truncate rounded bg-muted px-2 py-1 text-[10.5px]">{node.id}</code></Row>
              </Section>
            ) : null}
            <Section title="JSON" defaultOpen={false}><JsonEditor node={node} /></Section>
          </div>
        )}
      </div>
    </div>
  );
}

function PageSettings() {
  const page = useCurrentPage();
  const def = useBuilder((s) => s.def)!;
  const change = useBuilder.getState().change;
  if (!page) return null;
  const setPage = (fn: (p: NonNullable<typeof page>) => void, key?: string) => change((d) => { const p = d.pages.find((x) => x.id === page.id); if (p) fn(p); }, key);
  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b p-3">
        <div className="text-xs font-semibold">Page settings</div>
        <div className="text-[10.5px] text-muted-foreground">{page.name}</div>
      </div>
      <Section title="General">
        <Row label="Name"><Input className="h-8 text-xs" value={page.name} onChange={(e) => setPage((p) => { p.name = e.target.value || 'Page'; }, 'page:name')} /></Row>
        <Row label="URL path" hint="Lowercase letters, digits and -"><Input className="h-8 font-mono text-xs" value={page.path} onChange={(e) => setPage((p) => { p.path = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+/, '').slice(0, 64) || 'page'; }, 'page:path')} /></Row>
        <Row label="Browser title"><Input className="h-8 text-xs" value={page.title ?? ''} placeholder={page.name} onChange={(e) => setPage((p) => { p.title = e.target.value || undefined; }, 'page:title')} /></Row>
        <label className="flex items-center justify-between text-xs">Hide from navigation<Switch checked={!!page.hidden} onCheckedChange={(v) => setPage((p) => { p.hidden = v || undefined; })} /></label>
      </Section>
      <div className="px-3 py-2"><Button variant="outline" size="sm" className="h-8 w-full text-xs" onClick={() => useBuilder.getState().select(page.root.id)}>Style the page body</Button></div>
      <Section title="When the page opens">
        <ActionList def={def} actions={page.onLoad} onChange={(a) => setPage((p) => { p.onLoad = a.length ? a : undefined; })} emptyText="Run queries, set state or show a message when visitors open this page." />
      </Section>
    </div>
  );
}

export function Inspector() {
  const focus = useBuilder((s) => s.focus);
  const sel = useSelected();
  const page = useCurrentPage();
  const def = useBuilder((s) => s.def);
  if (!def) return null;
  if (focus.kind === 'node' && sel) return <NodeInspector key={sel.node.id} node={sel.node} />;
  if (focus.kind === 'query') {
    const q = def.queries.find((x) => x.id === focus.id);
    if (q) return <QueryEditor key={q.id} query={q} />;
  }
  if (focus.kind === 'page' && page) return <PageSettings />;
  return <ThemePanel />;
}
