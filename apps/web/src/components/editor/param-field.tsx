'use client';
import Link from 'next/link';
import { Braces, Info, Plus, Trash2 } from 'lucide-react';
import { isPropertyVisible, type NodeProperty } from '@simplyai/shared';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Switch, Tooltip } from '@/components/ui/misc';
import { CodeEditor } from '@/components/ui/code-editor';
import { useWsQuery } from '@/lib/hooks';
import { cn } from '@/lib/utils';

const OPERATORS = [
  ['equals', 'is equal to'], ['notEquals', 'is not equal to'], ['contains', 'contains'], ['notContains', 'does not contain'], ['startsWith', 'starts with'], ['endsWith', 'ends with'],
  ['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'], ['isEmpty', 'is empty'], ['isNotEmpty', 'is not empty'], ['isTrue', 'is true'], ['isFalse', 'is false'], ['regex', 'matches regex'], ['before', 'is before'], ['after', 'is after'],
];
const UNARY = new Set(['isEmpty', 'isNotEmpty', 'isTrue', 'isFalse']);
const CRON_PRESETS = [['Every 5 minutes', '*/5 * * * *'], ['Hourly', '0 * * * *'], ['Daily 9:00', '0 9 * * *'], ['Weekdays 9:00', '0 9 * * 1-5'], ['Mondays 8:00', '0 8 * * 1'], ['1st of month', '0 0 1 * *']];

function isExpr(v: unknown) {
  return typeof v === 'string' && v.includes('{{');
}

function ResourceSelect({ path, value, onChange, label, emptyHref }: { path: string; value: string; onChange: (v: string) => void; label: string; emptyHref: string }) {
  const q = useWsQuery<Array<{ id: string; name: string }> | { items: Array<{ id: string; name: string }> }>([path], path, path === '/workflows' ? { pageSize: 100 } : undefined);
  const list = Array.isArray(q.data) ? q.data : q.data?.items ?? [];
  return (
    <div className="space-y-1">
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select {label}…</option>
        {list.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </Select>
      {q.data && list.length === 0 && <p className="text-xs text-muted-foreground">No {label}s yet. <Link className="text-primary" href={emptyHref}>Create one</Link></p>}
    </div>
  );
}

export function ParamField({ prop, value, onChange, params }: { prop: NodeProperty; value: unknown; onChange: (v: unknown) => void; params: Record<string, unknown> }) {
  if (!isPropertyVisible(prop, params)) return null;
  if (prop.type === 'notice') return <div className="flex gap-2 rounded-lg bg-sky-50 p-3 text-xs text-sky-800"><Info className="h-4 w-4 shrink-0" />{prop.displayName}</div>;
  const label = (
    <div className="flex items-center justify-between">
      <Label>{prop.displayName}{prop.required && <span className="text-red-500"> *</span>}</Label>
      {isExpr(value) && <span className="flex items-center gap-1 rounded bg-violet-100 px-1.5 text-[10px] font-medium text-violet-700"><Braces className="h-3 w-3" />expression</span>}
    </div>
  );
  const hint = prop.description ? <p className="text-[11px] leading-snug text-muted-foreground">{prop.description}</p> : null;
  const str = value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  let control: React.ReactNode;
  switch (prop.type) {
    case 'string':
      control = <Input value={str} placeholder={prop.placeholder} type={prop.password && !isExpr(value) ? 'password' : 'text'} onChange={(e) => onChange(e.target.value)} className={cn(isExpr(value) && 'font-mono text-xs')} />;
      break;
    case 'text':
      control = <Textarea value={str} rows={prop.rows ?? 3} placeholder={prop.placeholder} onChange={(e) => onChange(e.target.value)} className={cn(isExpr(value) && 'font-mono text-xs')} />;
      break;
    case 'number':
      control = <Input value={str} inputMode="decimal" placeholder={prop.placeholder} onChange={(e) => onChange(e.target.value === '' ? '' : isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value))} />;
      break;
    case 'boolean':
      return (
        <div className="flex items-center justify-between gap-3 py-1">
          <div><Label>{prop.displayName}</Label>{hint}</div>
          <Switch checked={value === true || value === 'true'} onCheckedChange={(c) => onChange(c)} />
        </div>
      );
    case 'options':
      control = (
        <Select value={String(value ?? '')} onChange={(e) => { const o = prop.options?.find((x) => String(x.value) === e.target.value); onChange(o ? o.value : e.target.value); }}>
          {!prop.required && <option value="">—</option>}
          {prop.options?.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.name}</option>)}
        </Select>
      );
      break;
    case 'multiOptions': {
      const arr = Array.isArray(value) ? (value as unknown[]) : [];
      control = (
        <div className="flex flex-wrap gap-1.5">
          {prop.options?.map((o) => {
            const on = arr.includes(o.value);
            return <button key={String(o.value)} type="button" onClick={() => onChange(on ? arr.filter((x) => x !== o.value) : [...arr, o.value])} className={cn('rounded-md border px-2 py-1 text-xs font-medium', on ? 'border-primary bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted')}>{o.name}</button>;
          })}
        </div>
      );
      break;
    }
    case 'json':
    case 'code':
      control = <CodeEditor value={str} onChange={(v) => onChange(v)} language={prop.type === 'json' ? (isExpr(value) ? 'text' : 'json') : prop.language ?? 'javascript'} minHeight={prop.type === 'code' ? 160 : 80} />;
      break;
    case 'cron':
      control = (
        <div className="space-y-1.5">
          <Input value={str} className="font-mono" onChange={(e) => onChange(e.target.value)} placeholder="* * * * *" />
          <div className="flex flex-wrap gap-1">{CRON_PRESETS.map(([l, c]) => <button type="button" key={c} onClick={() => onChange(c)} className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted">{l}</button>)}</div>
        </div>
      );
      break;
    case 'keyValue': {
      const rows = Array.isArray(value) ? (value as Array<{ key: string; value: string }>) : [];
      control = (
        <div className="space-y-1.5">
          {rows.map((r, i) => (
            <div key={i} className="flex gap-1.5">
              <Input placeholder="Key" value={r.key ?? ''} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
              <Input placeholder="Value" value={r.value ?? ''} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
              <Button type="button" variant="ghost" size="icon" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 /></Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, { key: '', value: '' }])}><Plus /> Add</Button>
        </div>
      );
      break;
    }
    case 'fixedCollection': {
      const rows = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
      const blank = Object.fromEntries((prop.fields ?? []).map((f) => [f.name, f.default ?? '']));
      control = (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="relative space-y-2 rounded-lg border bg-muted/30 p-2.5 pr-9">
              <Button type="button" variant="ghost" size="icon-sm" className="absolute right-1 top-1" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 /></Button>
              {(prop.fields ?? []).map((f) => (
                <ParamField key={f.name} prop={{ ...f, required: false }} value={r[f.name]} params={r} onChange={(v) => onChange(rows.map((x, j) => (j === i ? { ...x, [f.name]: v } : x)))} />
              ))}
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, blank])}><Plus /> Add {prop.displayName.replace(/s$/, '').toLowerCase()}</Button>
        </div>
      );
      break;
    }
    case 'conditions': {
      const group = (value && typeof value === 'object' ? value : { combinator: 'and', conditions: [] }) as { combinator: 'and' | 'or'; conditions: Array<{ left: string; operator: string; right?: string }> };
      const set = (patch: Partial<typeof group>) => onChange({ ...group, ...patch });
      control = (
        <div className="space-y-2">
          {group.conditions.map((c, i) => (
            <div key={i} className="space-y-1.5 rounded-lg border bg-muted/30 p-2">
              {i > 0 && <span className="text-[10px] font-semibold uppercase text-muted-foreground">{group.combinator}</span>}
              <Input placeholder="Value, e.g. {{ $json.status }}" className="font-mono text-xs" value={c.left ?? ''} onChange={(e) => set({ conditions: group.conditions.map((x, j) => (j === i ? { ...x, left: e.target.value } : x)) })} />
              <div className="flex gap-1.5">
                <Select className="w-40 shrink-0" value={c.operator} onChange={(e) => set({ conditions: group.conditions.map((x, j) => (j === i ? { ...x, operator: e.target.value } : x)) })}>
                  {OPERATORS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Select>
                {!UNARY.has(c.operator) && <Input placeholder="Compare to" value={c.right ?? ''} onChange={(e) => set({ conditions: group.conditions.map((x, j) => (j === i ? { ...x, right: e.target.value } : x)) })} />}
                <Button type="button" variant="ghost" size="icon" onClick={() => set({ conditions: group.conditions.filter((_, j) => j !== i) })} aria-label="Remove condition"><Trash2 /></Button>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => set({ conditions: [...group.conditions, { left: '', operator: 'equals', right: '' }] })}><Plus /> Condition</Button>
            {group.conditions.length > 1 && (
              <Select className="h-8 w-28" value={group.combinator} onChange={(e) => set({ combinator: e.target.value as 'and' | 'or' })}><option value="and">Match all</option><option value="or">Match any</option></Select>
            )}
          </div>
        </div>
      );
      break;
    }
    case 'workflow':
      control = <ResourceSelect path="/workflows" value={String(value ?? '')} onChange={onChange} label="workflow" emptyHref="/workflows" />;
      break;
    case 'agent':
      control = <ResourceSelect path="/agents" value={String(value ?? '')} onChange={onChange} label="agent" emptyHref="/agents/new" />;
      break;
    case 'dataTable':
      control = <ResourceSelect path="/data-tables" value={String(value ?? '')} onChange={onChange} label="table" emptyHref="/data-tables" />;
      break;
    case 'knowledgeBase':
      control = <ResourceSelect path="/knowledge-bases" value={String(value ?? '')} onChange={onChange} label="knowledge base" emptyHref="/agents?tab=knowledge" />;
      break;
    default:
      control = <Input value={str} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <div className="space-y-1.5">
      {label}
      {control}
      {hint}
    </div>
  );
}

export function ExpressionHelp() {
  return (
    <Tooltip content="Use {{ }} to insert data: {{ $json.field }}, {{ $('Node name').item.json.id }}, {{ $vars.NAME }}, {{ $secrets.KEY }}, {{ $now }}">
      <span className="inline-flex cursor-help items-center gap-1 text-[11px] text-muted-foreground"><Braces className="h-3 w-3" /> Expressions</span>
    </Tooltip>
  );
}
