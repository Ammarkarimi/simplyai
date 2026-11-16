'use client';
/** Inspector widgets: bound inputs, colors, icons and action lists. */
import * as React from 'react';
import { ArrowDown, ArrowUp, Braces, Plus, Trash2, Zap } from 'lucide-react';
import { uiId, UI_ACTION_TYPES, walkNodes, type AppDefinition, type UIAction, type UIActionType } from '@simplyai/shared';
import { LucideIcon } from '@/components/icons';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger, Switch } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { hasBinding, INPUT_TYPES, type AppRuntime } from './runtime';

export const RuntimeRef = React.createContext<AppRuntime | null>(null);

export function Row({ label, children, hint, className }: { label: React.ReactNode; children: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1', className)}>
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      {children}
      {hint ? <div className="text-[10.5px] leading-snug text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

/** Shows what a binding evaluates to right now. */
export function BindingPreview({ value, extra }: { value: unknown; extra?: Record<string, unknown> }) {
  const rt = React.useContext(RuntimeRef);
  if (!rt || !hasBinding(value)) return null;
  const r = rt.tryEvaluate(value, extra ?? { item: {}, index: 0, row: {}, value: '', data: null });
  let text: string;
  try {
    text = r.error ? r.error : r.value === undefined ? 'undefined' : typeof r.value === 'string' ? r.value : JSON.stringify(r.value);
  } catch {
    text = String(r.value);
  }
  return (
    <div className={cn('mt-1 truncate rounded px-1.5 py-0.5 font-mono text-[10.5px]', r.error ? 'bg-destructive/10 text-destructive' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400')} title={text}>
      {text.length > 140 ? `${text.slice(0, 140)}…` : text || '""'}
    </div>
  );
}

export function TextField({ value, onChange, placeholder, multiline, mono, rows = 3 }: { value: unknown; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; mono?: boolean; rows?: number }) {
  const v = value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  const cls = cn('h-8 text-xs', mono && 'font-mono');
  return (
    <div>
      {multiline ? <Textarea className={cn('min-h-0 text-xs', mono && 'font-mono')} rows={rows} value={v} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} spellCheck={!mono} /> : <Input className={cls} value={v} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
      <BindingPreview value={v} />
    </div>
  );
}

export function NumberField({ value, onChange, placeholder }: { value: unknown; onChange: (v: unknown) => void; placeholder?: string }) {
  return <TextField value={value} placeholder={placeholder} onChange={(s) => onChange(s === '' ? '' : hasBinding(s) || Number.isNaN(Number(s)) ? s : Number(s))} />;
}

export function BoolField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const bound = hasBinding(value);
  const [fx, setFx] = React.useState(bound);
  return (
    <div className="flex items-start gap-2">
      {fx ? <div className="flex-1"><TextField value={value} onChange={onChange} placeholder="{{ condition }}" mono /></div> : <Switch checked={value === true || value === 'true'} onCheckedChange={onChange} />}
      <FxToggle on={fx} onToggle={() => { setFx(!fx); if (fx) onChange(false); }} />
    </div>
  );
}

export function FxToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button type="button" title="Use an expression" onClick={onToggle} className={cn('ml-auto rounded border px-1 py-0.5 font-mono text-[10px] leading-none', on ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground')}>
      fx
    </button>
  );
}

export function SelectField({ value, onChange, options, allowFx = true, placeholder }: { value: unknown; onChange: (v: string) => void; options: Array<string | { label: string; value: string }>; allowFx?: boolean; placeholder?: string }) {
  const [fx, setFx] = React.useState(hasBinding(value));
  const opts = options.map((o) => (typeof o === 'string' ? { label: o, value: o } : o));
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        {fx ? <TextField value={value} onChange={onChange} mono placeholder="{{ expression }}" /> : (
          <Select className="h-8 text-xs" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
            {placeholder !== undefined || !opts.some((o) => o.value === String(value ?? '')) ? <option value="">{placeholder ?? '—'}</option> : null}
            {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        )}
      </div>
      {allowFx ? <FxToggle on={fx} onToggle={() => setFx(!fx)} /> : null}
    </div>
  );
}

export const SWATCHES = ['#7c3aed', '#8b5cf6', '#ec4899', '#ef4444', '#f97316', '#f59e0b', '#eab308', '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#18181b', '#52525b', '#a1a1aa', '#e4e4e7', '#ffffff', 'transparent'];
const THEME_SWATCHES = [['var(--app-primary)', 'Primary'], ['var(--app-accent)', 'Accent'], ['var(--app-text)', 'Text'], ['var(--app-muted)', 'Muted'], ['var(--app-surface)', 'Surface'], ['var(--app-bg)', 'Background'], ['var(--app-border)', 'Border']];

export function ColorField({ value, onChange, placeholder = 'inherit' }: { value: unknown; onChange: (v: string) => void; placeholder?: string }) {
  const v = typeof value === 'string' ? value : '';
  const hex = /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000';
  return (
    <div className="flex items-center gap-1.5">
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="h-8 w-8 shrink-0 rounded-md border shadow-sm" style={{ background: v || 'repeating-conic-gradient(#e4e4e7 0 25%, #fff 0 50%) 50%/8px 8px' }} aria-label="Pick color" />
        </PopoverTrigger>
        <PopoverContent className="w-64 space-y-3 p-3" align="start">
          <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} className="h-24 w-full cursor-pointer rounded border-0 bg-transparent p-0" />
          <div className="grid grid-cols-10 gap-1">
            {SWATCHES.map((c) => <button key={c} type="button" title={c} onClick={() => onChange(c)} className="h-5 w-5 rounded border" style={{ background: c === 'transparent' ? 'repeating-conic-gradient(#e4e4e7 0 25%, #fff 0 50%) 50%/8px 8px' : c }} />)}
          </div>
          <div className="space-y-1">
            <div className="text-[11px] font-medium text-muted-foreground">Theme colors</div>
            <div className="flex flex-wrap gap-1">
              {THEME_SWATCHES.map(([c, n]) => <button key={c} type="button" onClick={() => onChange(c!)} className="rounded border px-1.5 py-0.5 text-[10.5px] hover:bg-accent">{n}</button>)}
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <Input className="h-8 flex-1 font-mono text-xs" value={v} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export const ICONS = [
  'sparkles', 'star', 'heart', 'zap', 'rocket', 'flame', 'crown', 'gem', 'trophy', 'gift', 'party-popper', 'sun', 'moon', 'cloud', 'leaf', 'flower-2', 'globe', 'map-pin', 'compass', 'plane',
  'home', 'building-2', 'store', 'shopping-cart', 'shopping-bag', 'credit-card', 'wallet', 'dollar-sign', 'euro', 'badge-dollar-sign', 'piggy-bank', 'receipt', 'chart-line', 'chart-column', 'chart-pie', 'trending-up', 'trending-down', 'activity', 'gauge', 'target',
  'user', 'users', 'user-plus', 'circle-user', 'contact', 'briefcase', 'graduation-cap', 'smile', 'thumbs-up', 'hand-heart', 'message-circle', 'message-square', 'mail', 'send', 'phone', 'bell', 'megaphone', 'at-sign', 'share-2', 'link',
  'calendar', 'clock', 'timer', 'alarm-clock', 'hourglass', 'check', 'circle-check', 'x', 'circle-x', 'info', 'triangle-alert', 'shield-check', 'lock', 'key-round', 'eye', 'search', 'filter', 'settings', 'sliders-horizontal', 'wrench',
  'plus', 'minus', 'pencil', 'trash-2', 'copy', 'download', 'upload', 'refresh-cw', 'rotate-ccw', 'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'arrow-up-right', 'chevron-right', 'external-link', 'log-in', 'log-out', 'menu', 'more-horizontal',
  'file', 'file-text', 'folder', 'image', 'camera', 'video', 'music', 'headphones', 'mic', 'play', 'pause', 'book-open', 'bookmark', 'tag', 'package', 'truck', 'box', 'layers', 'layout-dashboard', 'layout-grid',
  'database', 'server', 'cpu', 'code', 'terminal', 'git-branch', 'bot', 'brain', 'wand-sparkles', 'lightbulb', 'puzzle', 'workflow', 'webhook', 'plug', 'wifi', 'battery-full', 'smartphone', 'monitor', 'laptop', 'tablet',
  'coffee', 'pizza', 'utensils', 'car', 'bike', 'dumbbell', 'stethoscope', 'pill', 'paw-print', 'palette', 'brush', 'pen-tool', 'scissors', 'umbrella', 'anchor', 'mountain', 'tent', 'ticket', 'flag', 'award',
];

export function IconField({ value, onChange }: { value: unknown; onChange: (v: string) => void }) {
  const [q, setQ] = React.useState('');
  const v = typeof value === 'string' ? value : '';
  const list = ICONS.filter((i) => i.includes(q.toLowerCase()));
  return (
    <div className="flex items-center gap-1.5">
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-background hover:bg-accent" aria-label="Pick icon">
            {v && !hasBinding(v) ? <LucideIcon name={v} className="h-4 w-4" /> : <Plus className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" align="start">
          <Input autoFocus className="mb-2 h-8 text-xs" placeholder="Search icons…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="grid max-h-60 grid-cols-8 gap-1 overflow-y-auto">
            <button type="button" title="None" onClick={() => onChange('')} className="flex h-7 w-7 items-center justify-center rounded text-[10px] text-muted-foreground hover:bg-accent">∅</button>
            {list.map((i) => (
              <button key={i} type="button" title={i} onClick={() => onChange(i)} className={cn('flex h-7 w-7 items-center justify-center rounded hover:bg-accent', v === i && 'bg-primary/15 text-primary')}>
                <LucideIcon name={i} className="h-4 w-4" />
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10.5px] text-muted-foreground">Any Lucide icon name can also be typed in the field.</p>
        </PopoverContent>
      </Popover>
      <Input className="h-8 flex-1 text-xs" value={v} placeholder="icon name" onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// ── Actions ───────────────────────────────────────────────

export const ACTION_LABELS: Record<UIActionType, { label: string; icon: string }> = {
  runQuery: { label: 'Run query', icon: 'play' },
  setState: { label: 'Set state', icon: 'variable' },
  navigate: { label: 'Go to page', icon: 'arrow-right' },
  openUrl: { label: 'Open URL', icon: 'external-link' },
  toast: { label: 'Show notification', icon: 'bell' },
  openModal: { label: 'Open modal', icon: 'app-window' },
  closeModal: { label: 'Close modal', icon: 'x' },
  setValue: { label: 'Set input value', icon: 'text-cursor-input' },
  resetInputs: { label: 'Reset inputs', icon: 'rotate-ccw' },
  copy: { label: 'Copy to clipboard', icon: 'copy' },
  scrollTo: { label: 'Scroll to component', icon: 'arrow-down-to-line' },
  download: { label: 'Download file', icon: 'download' },
};

function namesOf(def: AppDefinition, pred: (type: string) => boolean): string[] {
  const out: string[] = [];
  def.pages.forEach((p) => walkNodes(p.root, (n) => { if (pred(n.type)) out.push(n.name); }));
  return out;
}

function ActionFields({ action, def, update }: { action: UIAction; def: AppDefinition; update: (patch: Record<string, unknown>) => void }) {
  const a = action as Record<string, unknown>;
  switch (action.type) {
    case 'runQuery':
      return <Row label="Query"><SelectField allowFx={false} value={a.query} options={def.queries.map((q) => q.name)} placeholder="Choose a query" onChange={(v) => update({ query: v })} /></Row>;
    case 'setState':
      return (
        <>
          <Row label="State variable"><SelectField allowFx={false} value={a.key} options={def.state.map((s) => s.name)} placeholder="Choose a variable" onChange={(v) => update({ key: v })} /></Row>
          <Row label="Value" hint="JSON literal or {{ expression }}"><TextField value={a.value} onChange={(v) => update({ value: v })} mono placeholder="{{ state.count + 1 }}" /></Row>
        </>
      );
    case 'navigate':
      return <Row label="Page"><SelectField allowFx={false} value={a.page} options={def.pages.map((p) => ({ label: p.name, value: p.id }))} placeholder="Choose a page" onChange={(v) => update({ page: v })} /></Row>;
    case 'openUrl':
      return (
        <>
          <Row label="URL"><TextField value={a.url} onChange={(v) => update({ url: v })} placeholder="https://…" /></Row>
          <label className="flex items-center gap-2 text-xs"><Switch checked={!!a.newTab} onCheckedChange={(v) => update({ newTab: v })} />New tab</label>
        </>
      );
    case 'toast':
      return (
        <>
          <Row label="Message"><TextField value={a.message} onChange={(v) => update({ message: v })} placeholder="Saved!" /></Row>
          <Row label="Style"><SelectField allowFx={false} value={a.variant ?? 'success'} options={['success', 'info', 'warning', 'error']} onChange={(v) => update({ variant: v })} /></Row>
        </>
      );
    case 'openModal':
    case 'closeModal':
      return <Row label="Modal"><SelectField allowFx={false} value={a.modal} options={namesOf(def, (t) => t === 'modal')} placeholder="Choose a modal" onChange={(v) => update({ modal: v })} /></Row>;
    case 'setValue':
      return (
        <>
          <Row label="Input"><SelectField allowFx={false} value={a.component} options={namesOf(def, (t) => INPUT_TYPES.has(t))} placeholder="Choose an input" onChange={(v) => update({ component: v })} /></Row>
          <Row label="Value"><TextField value={a.value} onChange={(v) => update({ value: v })} mono /></Row>
        </>
      );
    case 'resetInputs':
      return <Row label="Inside (optional)" hint="Leave empty to reset every input"><SelectField allowFx={false} value={a.component} options={namesOf(def, (t) => ['form', 'container', 'card', 'modal', 'grid'].includes(t))} placeholder="All inputs" onChange={(v) => update({ component: v })} /></Row>;
    case 'copy':
      return <Row label="Text"><TextField value={a.text} onChange={(v) => update({ text: v })} /></Row>;
    case 'scrollTo':
      return <Row label="Component"><SelectField allowFx={false} value={a.target} options={namesOf(def, () => true)} placeholder="Choose a component" onChange={(v) => update({ target: v })} /></Row>;
    case 'download':
      return (
        <>
          <Row label="File name" hint="Use .csv to export an array of objects as CSV"><TextField value={a.filename} onChange={(v) => update({ filename: v })} placeholder="export.csv" /></Row>
          <Row label="Content"><TextField value={a.content} onChange={(v) => update({ content: v })} mono placeholder="{{ table1.data }}" /></Row>
        </>
      );
    default:
      return null;
  }
}

export function defaultAction(type: UIActionType, def: AppDefinition): UIAction {
  const base: UIAction = { id: uiId('a'), type };
  if (type === 'runQuery') base.query = def.queries[0]?.name ?? '';
  if (type === 'toast') Object.assign(base, { message: 'Done!', variant: 'success' });
  if (type === 'navigate') base.page = def.pages[0]?.id ?? '';
  if (type === 'setState') Object.assign(base, { key: def.state[0]?.name ?? '', value: '' });
  return base;
}

export function ActionList({ actions, onChange, def, emptyText = 'No actions yet' }: { actions: UIAction[] | undefined; onChange: (a: UIAction[]) => void; def: AppDefinition; emptyText?: string }) {
  const list = actions ?? [];
  const [open, setOpen] = React.useState<string | null>(null);
  const update = (i: number, patch: Record<string, unknown>) => onChange(list.map((a, j) => (j === i ? ({ ...a, ...patch } as UIAction) : a)));
  return (
    <div className="space-y-1.5">
      {!list.length ? <p className="text-[11px] text-muted-foreground">{emptyText}</p> : null}
      {list.map((a, i) => {
        const meta = ACTION_LABELS[a.type];
        const expanded = open === a.id;
        return (
          <div key={a.id} className={cn('rounded-md border bg-background', expanded && 'ring-1 ring-primary/40')}>
            <div className="flex items-center gap-1.5 px-2 py-1.5">
              <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs" onClick={() => setOpen(expanded ? null : a.id)}>
                <LucideIcon name={meta?.icon ?? 'zap'} className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="font-medium">{meta?.label ?? a.type}</span>
                <span className="truncate text-muted-foreground">{summary(a, def)}</span>
                {a.condition ? <Braces className="h-3 w-3 shrink-0 text-amber-500" /> : null}
              </button>
              <button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-30" disabled={i === 0} onClick={() => { const n = [...list]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; onChange(n); }}><ArrowUp className="h-3 w-3" /></button>
              <button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-30" disabled={i === list.length - 1} onClick={() => { const n = [...list]; [n[i + 1], n[i]] = [n[i]!, n[i + 1]!]; onChange(n); }}><ArrowDown className="h-3 w-3" /></button>
              <button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => onChange(list.filter((_, j) => j !== i))}><Trash2 className="h-3 w-3" /></button>
            </div>
            {expanded ? (
              <div className="space-y-2 border-t px-2 py-2">
                <Row label="Action"><SelectField allowFx={false} value={a.type} options={UI_ACTION_TYPES.map((t) => ({ label: ACTION_LABELS[t].label, value: t }))} onChange={(v) => update(i, { ...defaultAction(v as UIActionType, def), id: a.id })} /></Row>
                <ActionFields action={a} def={def} update={(p) => update(i, p)} />
                <Row label="Only when (optional)" hint="Skipped when the expression is falsy"><TextField value={a.condition ?? ''} onChange={(v) => update(i, { condition: v || undefined })} mono placeholder="{{ form1.data.email }}" /></Row>
              </div>
            ) : null}
          </div>
        );
      })}
      <AddAction def={def} onAdd={(a) => { onChange([...list, a]); setOpen(a.id); }} />
    </div>
  );
}

function summary(a: UIAction, def: AppDefinition): string {
  const r = a as Record<string, unknown>;
  if (a.type === 'navigate') return def.pages.find((p) => p.id === r.page)?.name ?? '';
  return String(r.query ?? r.key ?? r.modal ?? r.component ?? r.message ?? r.url ?? r.target ?? r.filename ?? '');
}

function AddAction({ def, onAdd }: { def: AppDefinition; onAdd: (a: UIAction) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary">
          <Zap className="h-3 w-3" />Add action
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        {UI_ACTION_TYPES.map((t) => (
          <button key={t} type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent" onClick={() => onAdd(defaultAction(t, def))}>
            <LucideIcon name={ACTION_LABELS[t].icon} className="h-3.5 w-3.5 text-primary" />{ACTION_LABELS[t].label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function Section({ title, children, defaultOpen = true, right }: { title: string; children: React.ReactNode; defaultOpen?: boolean; right?: React.ReactNode }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="border-b">
      <div className="flex items-center px-3 py-2">
        <button type="button" className="flex flex-1 items-center gap-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground" onClick={() => setOpen(!open)}>
          <span className={cn('inline-block transition-transform', open ? 'rotate-90' : '')}>›</span>{title}
        </button>
        {right}
      </div>
      {open ? <div className="space-y-3 px-3 pb-3">{children}</div> : null}
    </div>
  );
}
