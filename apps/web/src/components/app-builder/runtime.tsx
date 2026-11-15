'use client';
/**
 * App runtime: evaluates bindings, holds component values, state and query
 * results, and executes actions. Shared by the builder canvas, the draft
 * preview and published apps.
 */
import * as React from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import { toast } from 'sonner';
import { evaluateExpression } from '@simplyai/engine/dist/expression';
import { allNodes, safeUrl, type AppDefinition, type AppQuery, type Breakpoint, type UIAction, type UINode } from '@simplyai/shared';

export type RuntimeMode = 'edit' | 'preview' | 'live';

export interface QueryState {
  data: unknown;
  meta?: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
  lastRunAt: string | null;
}

export interface RuntimeState {
  values: Record<string, unknown>;
  extras: Record<string, Record<string, unknown>>;
  state: Record<string, unknown>;
  queries: Record<string, QueryState>;
  modals: Record<string, boolean>;
  pageId: string;
  url: Record<string, string>;
}

export type QueryTransport = (query: AppQuery, args: Record<string, unknown>) => Promise<{ data: unknown; meta?: Record<string, unknown> }>;

export interface RuntimeOptions {
  def: AppDefinition;
  mode: RuntimeMode;
  transport: QueryTransport;
  user?: { name: string | null; email: string } | null;
  app?: { name: string; id?: string; slug?: string };
  initialPageId?: string;
  onNavigate?: (page: { id: string; path: string }) => void;
}

const TEMPLATE_RE = /\{\{([\s\S]+?)\}\}/g;
const SINGLE_RE = /^\s*\{\{([\s\S]+?)\}\}\s*$/;

function stringify(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return v instanceof Date ? v.toISOString() : JSON.stringify(v);
  return String(v);
}

export function hasBinding(v: unknown): v is string {
  return typeof v === 'string' && v.includes('{{') && v.includes('}}');
}

function parseLiteral(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export const INPUT_TYPES = new Set(['input', 'textarea', 'select', 'checkbox', 'switch', 'radio', 'date', 'slider', 'rating', 'color']);

function emptyValue(node: UINode): unknown {
  if (node.type === 'checkbox' || node.type === 'switch') return false;
  if (node.type === 'slider' || node.type === 'rating') return 0;
  return '';
}

/** Coerce a configured default into the value type of the input. */
function coerceDefault(node: UINode, v: unknown): unknown {
  if (v === undefined || v === null || v === '') return emptyValue(node);
  if (node.type === 'checkbox' || node.type === 'switch') return v === true || v === 'true';
  if (node.type === 'slider' || node.type === 'rating') return Number(v) || 0;
  if (node.type === 'input' && node.props.inputType === 'number') return v === '' ? '' : Number(v);
  return v;
}

export class AppRuntime {
  readonly store: StoreApi<RuntimeState>;
  def: AppDefinition;
  mode: RuntimeMode;
  private transport: QueryTransport;
  private user: RuntimeOptions['user'];
  private app: RuntimeOptions['app'];
  private onNavigate?: RuntimeOptions['onNavigate'];
  private nodes = new Map<string, UINode>();
  private resolving = new Set<string>();
  private runs = new Map<string, number>();
  private actionDepth = 0;
  listeners = new Set<() => void>();

  constructor(opts: RuntimeOptions) {
    this.def = opts.def;
    this.mode = opts.mode;
    this.transport = opts.transport;
    this.user = opts.user ?? null;
    this.app = opts.app;
    this.onNavigate = opts.onNavigate;
    this.index();
    const pageId = opts.initialPageId && opts.def.pages.some((p) => p.id === opts.initialPageId) ? opts.initialPageId : opts.def.pages[0]!.id;
    this.store = createStore<RuntimeState>(() => ({
      values: {},
      extras: {},
      state: Object.fromEntries(opts.def.state.map((s) => [s.name, parseLiteral(s.initial)])),
      queries: {},
      modals: {},
      pageId,
      url: typeof window === 'undefined' ? {} : Object.fromEntries(new URLSearchParams(window.location.search)),
    }));
  }

  private index() {
    this.nodes.clear();
    for (const n of allNodes(this.def)) this.nodes.set(n.name, n);
  }

  /** Called by the builder when the definition changes. */
  updateDefinition(def: AppDefinition) {
    const prevState = new Set(this.def.state.map((s) => `${s.name}=${s.initial}`));
    this.def = def;
    this.index();
    const s = this.store.getState();
    const patch: Partial<RuntimeState> = {};
    const nextState = { ...s.state };
    let changed = false;
    for (const v of def.state) {
      if (!(v.name in nextState) || !prevState.has(`${v.name}=${v.initial}`)) {
        nextState[v.name] = parseLiteral(v.initial);
        changed = true;
      }
    }
    if (changed) patch.state = nextState;
    if (!def.pages.some((p) => p.id === s.pageId)) patch.pageId = def.pages[0]!.id;
    if (Object.keys(patch).length) this.store.setState(patch);
  }

  get page() {
    const id = this.store.getState().pageId;
    return this.def.pages.find((p) => p.id === id) ?? this.def.pages[0]!;
  }

  // ── Values ──────────────────────────────────────────────

  valueOf(node: UINode): unknown {
    const values = this.store.getState().values;
    if (node.name in values) return values[node.name];
    if (this.resolving.has(node.name)) return emptyValue(node);
    this.resolving.add(node.name);
    try {
      return coerceDefault(node, this.evaluate(node.props.defaultValue));
    } finally {
      this.resolving.delete(node.name);
    }
  }

  setValue(name: string, value: unknown) {
    this.store.setState((s) => ({ values: { ...s.values, [name]: value } }));
  }

  setExtra(name: string, patch: Record<string, unknown>) {
    this.store.setState((s) => ({ extras: { ...s.extras, [name]: { ...s.extras[name], ...patch } } }));
  }

  resetValues(names?: string[]) {
    this.store.setState((s) => {
      if (!names) return { values: {} };
      const values = { ...s.values };
      for (const n of names) delete values[n];
      return { values };
    });
  }

  /** Values of the inputs inside a container, keyed by component name. */
  collect(node: UINode): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const visit = (n: UINode) => {
      if (INPUT_TYPES.has(n.type)) out[n.name] = this.valueOf(n);
      n.children?.forEach(visit);
    };
    node.children?.forEach(visit);
    return out;
  }

  /** Required inputs inside a container that are empty. */
  missingRequired(node: UINode): string[] {
    const missing: string[] = [];
    const visit = (n: UINode) => {
      if (INPUT_TYPES.has(n.type) && this.evaluate(n.props.required) === true) {
        const v = this.valueOf(n);
        if (v === '' || v === null || v === undefined || v === false) missing.push(String(this.evaluate(n.props.label) || n.name));
        else if (n.type === 'input' && n.props.inputType === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) missing.push(`${this.evaluate(n.props.label) || n.name} (invalid email)`);
      }
      n.children?.forEach(visit);
    };
    node.children?.forEach(visit);
    return missing;
  }

  // ── Expressions ─────────────────────────────────────────

  scope(extra: Record<string, unknown> = {}): Record<string, unknown> {
    const s = this.store.getState();
    const scope: Record<string, unknown> = {
      state: s.state,
      page: { id: this.page.id, name: this.page.name, path: this.page.path },
      user: this.user ?? null,
      url: s.url,
      app: { name: this.app?.name ?? '', mode: this.mode },
      theme: this.def.theme,
    };
    for (const q of this.def.queries) {
      const qs = s.queries[q.name];
      scope[q.name] = { data: qs?.data ?? null, meta: qs?.meta ?? null, loading: !!qs?.loading, error: qs?.error ?? null, lastRunAt: qs?.lastRunAt ?? null };
    }
    for (const [name, node] of this.nodes) {
      const rt = this;
      Object.defineProperty(scope, name, {
        enumerable: true,
        configurable: true,
        get() {
          const ex = s.extras[name] ?? {};
          if (node.type === 'form') return { ...ex, data: rt.collect(node) };
          if (node.type === 'modal') return { ...ex, open: !!s.modals[name] };
          if (INPUT_TYPES.has(node.type)) return { ...ex, value: rt.valueOf(node) };
          return { ...ex };
        },
      });
    }
    return Object.assign(scope, extra);
  }

  /** Resolve a prop value: plain values pass through, `{{ }}` bindings are evaluated. Errors yield undefined. */
  evaluate(value: unknown, extra?: Record<string, unknown>): unknown {
    if (!hasBinding(value)) return value;
    const ctx = this.scope(extra);
    const single = value.match(SINGLE_RE);
    if (single && !single[1]!.includes('}}')) return this.evalCode(single[1]!, ctx);
    return value.replace(TEMPLATE_RE, (_m, code: string) => stringify(this.evalCode(code, ctx)));
  }

  /** Evaluate and report the error (used by the builder's binding hints). */
  tryEvaluate(value: unknown, extra?: Record<string, unknown>): { value: unknown; error: string | null } {
    if (!hasBinding(value)) return { value, error: null };
    const ctx = this.scope(extra);
    try {
      const single = value.match(SINGLE_RE);
      if (single && !single[1]!.includes('}}')) return { value: evaluateExpression(single[1]!, ctx, { lenient: true }), error: null };
      return { value: value.replace(TEMPLATE_RE, (_m, code: string) => stringify(evaluateExpression(code, ctx, { lenient: true }))), error: null };
    } catch (err) {
      return { value: undefined, error: (err as Error).message };
    }
  }

  private evalCode(code: string, ctx: Record<string, unknown>): unknown {
    try {
      return evaluateExpression(code, ctx, { lenient: true });
    } catch {
      return undefined;
    }
  }

  evaluateDeep(value: unknown, extra?: Record<string, unknown>, depth = 0): unknown {
    if (depth > 10) return value;
    if (typeof value === 'string') return this.evaluate(value, extra);
    if (Array.isArray(value)) return value.map((v) => this.evaluateDeep(v, extra, depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.evaluateDeep(v, extra, depth + 1)]));
    return value;
  }

  bool(value: unknown, extra?: Record<string, unknown>, fallback = false): boolean {
    if (value === undefined || value === null || value === '') return fallback;
    const v = this.evaluate(value, extra);
    if (v === 'false') return false;
    return !!v;
  }

  // ── Queries ─────────────────────────────────────────────

  private setQuery(name: string, patch: Partial<QueryState>) {
    this.store.setState((s) => {
      const prev = s.queries[name] ?? { data: null, meta: null, loading: false, error: null, lastRunAt: null };
      return { queries: { ...s.queries, [name]: { ...prev, ...patch } } };
    });
  }

  private queryArgs(q: AppQuery, extra?: Record<string, unknown>): Record<string, unknown> {
    if (q.kind === 'workflow') {
      if (!q.payload?.trim()) return {};
      const v = this.evaluate(q.payload, extra);
      if (typeof v === 'string') {
        const parsed = parseLiteral(v);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { value: parsed };
      }
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : { value: v };
    }
    if (q.kind === 'dataTable') {
      const out: Record<string, unknown> = {};
      for (const [k, raw] of Object.entries(q.args ?? {})) {
        if (raw === undefined || raw === '') continue;
        let v = this.evaluate(raw, extra);
        if ((k === 'data' || k === 'filters') && typeof v === 'string') v = parseLiteral(v);
        out[k] = v;
      }
      return out;
    }
    return {};
  }

  async runQuery(nameOrId: string, extra?: Record<string, unknown>): Promise<boolean> {
    const q = this.def.queries.find((x) => x.name === nameOrId || x.id === nameOrId);
    if (!q) {
      toast.error(`Query "${nameOrId}" not found`);
      return false;
    }
    if (q.confirm && this.mode !== 'edit' && typeof window !== 'undefined' && !window.confirm(String(this.evaluate(q.confirm, extra)))) return false;
    const run = (this.runs.get(q.name) ?? 0) + 1;
    this.runs.set(q.name, run);
    this.setQuery(q.name, { loading: true, error: null });
    try {
      let data: unknown;
      let meta: Record<string, unknown> | undefined;
      if (q.kind === 'static') data = q.staticData ? parseLiteral(q.staticData) : null;
      else ({ data, meta } = await this.transport(q, this.queryArgs(q, extra)));
      if (q.transform?.trim()) {
        const t = this.tryEvaluate(q.transform, { ...extra, data, meta: meta ?? null });
        if (t.error) throw new Error(`Transform failed: ${t.error}`);
        data = t.value;
      }
      if (this.runs.get(q.name) !== run) return true;
      this.setQuery(q.name, { data, meta: meta ?? null, loading: false, error: null, lastRunAt: new Date().toISOString() });
      if (q.onSuccess?.length) await this.runActions(q.onSuccess, extra);
      return true;
    } catch (err) {
      const message = (err as Error).message || 'Query failed';
      if (this.runs.get(q.name) === run) this.setQuery(q.name, { loading: false, error: message, lastRunAt: new Date().toISOString() });
      if (q.onError?.length) await this.runActions(q.onError, extra);
      else if (this.mode !== 'edit') toast.error(`${q.name}: ${message}`);
      return false;
    }
  }

  async runOnLoad() {
    await Promise.all(this.def.queries.filter((q) => q.runOnLoad).map((q) => this.runQuery(q.name)));
  }

  async enterPage(pageId: string) {
    const page = this.def.pages.find((p) => p.id === pageId);
    if (page?.onLoad?.length && this.mode !== 'edit') await this.runActions(page.onLoad);
  }

  // ── Actions ─────────────────────────────────────────────

  navigate(target: string) {
    const page = this.def.pages.find((p) => p.id === target || p.path === target || p.name === target);
    if (!page) return toast.error(`Page "${target}" not found`);
    this.store.setState({ pageId: page.id, modals: {} });
    this.onNavigate?.(page);
    if (typeof window !== 'undefined') document.querySelector('[data-app-scroll]')?.scrollTo({ top: 0 });
    void this.enterPage(page.id);
  }

  async runActions(actions: UIAction[] | undefined, extra?: Record<string, unknown>): Promise<void> {
    if (!actions?.length || this.mode === 'edit') return;
    if (this.actionDepth > 20) {
      toast.error('Too many nested actions (possible loop)');
      return;
    }
    this.actionDepth++;
    try {
      for (const a of actions) {
        if (a.condition && !this.bool(a.condition, extra, true)) continue;
        await this.runAction(a, extra);
      }
    } finally {
      this.actionDepth--;
    }
  }

  private async runAction(a: UIAction, extra?: Record<string, unknown>) {
    const p = (k: string) => this.evaluate(a[k], extra);
    switch (a.type) {
      case 'runQuery':
        if (a.query) await this.runQuery(String(a.query), extra);
        return;
      case 'setState': {
        const key = String(a.key ?? '');
        if (!key) return;
        const raw = a.value;
        const v = hasBinding(raw) ? p('value') : typeof raw === 'string' ? parseLiteral(raw) : raw;
        this.store.setState((s) => ({ state: { ...s.state, [key]: v } }));
        return;
      }
      case 'navigate':
        if (a.page) this.navigate(String(a.page));
        return;
      case 'openUrl': {
        const url = safeUrl(p('url'));
        if (!url) return void toast.error('Blocked an invalid URL');
        if (a.newTab) window.open(url, '_blank', 'noopener,noreferrer');
        else window.location.href = url;
        return;
      }
      case 'toast': {
        const msg = stringify(p('message')) || 'Done';
        const variant = String(a.variant ?? 'success');
        if (variant === 'error') toast.error(msg);
        else if (variant === 'info') toast.info(msg);
        else if (variant === 'warning') toast.warning(msg);
        else toast.success(msg);
        return;
      }
      case 'openModal':
        if (a.modal) this.store.setState((s) => ({ modals: { ...s.modals, [String(a.modal)]: true } }));
        return;
      case 'closeModal':
        if (a.modal) this.store.setState((s) => ({ modals: { ...s.modals, [String(a.modal)]: false } }));
        return;
      case 'setValue':
        if (a.component) this.setValue(String(a.component), p('value'));
        return;
      case 'resetInputs': {
        const target = a.component ? this.nodes.get(String(a.component)) : null;
        this.resetValues(target ? Object.keys(this.collect(target)) : undefined);
        return;
      }
      case 'copy':
        await navigator.clipboard?.writeText(stringify(p('text'))).catch(() => undefined);
        toast.success('Copied to clipboard');
        return;
      case 'scrollTo': {
        const node = a.target ? this.nodes.get(String(a.target)) : null;
        if (node) document.querySelector(`[data-node-id="${CSS.escape(node.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      case 'download': {
        const content = p('content');
        const filename = String(p('filename') || 'export.json').replace(/[^\w.-]/g, '_');
        let text: string;
        let type = 'application/json';
        if (filename.endsWith('.csv') && Array.isArray(content)) {
          const rows = content as Record<string, unknown>[];
          const cols = [...new Set(rows.flatMap((r) => Object.keys(r ?? {})))];
          const esc = (v: unknown) => `"${stringify(v).replace(/"/g, '""')}"`;
          text = [cols.map(esc).join(','), ...rows.map((r) => cols.map((c) => esc(r?.[c])).join(','))].join('\n');
          type = 'text/csv';
        } else text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
        const url = URL.createObjectURL(new Blob([text], { type }));
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1_000);
        return;
      }
      default:
        return;
    }
  }
}

// ── React bindings ────────────────────────────────────────

const RuntimeContext = React.createContext<AppRuntime | null>(null);
export const RuntimeProvider = RuntimeContext.Provider;

export function useRuntime(): AppRuntime {
  const rt = React.useContext(RuntimeContext);
  if (!rt) throw new Error('useRuntime outside of an app');
  return rt;
}

/** Re-render on any runtime change and return the state. */
export function useRuntimeState(): RuntimeState {
  const rt = useRuntime();
  return useStore(rt.store);
}

/** Extra scope for repeated (list) children. */
export const ScopeContext = React.createContext<Record<string, unknown> | undefined>(undefined);
export const useExtraScope = () => React.useContext(ScopeContext);

export interface ViewContextValue {
  breakpoint: Breakpoint;
  selectedId?: string | null;
}
export const ViewContext = React.createContext<ViewContextValue>({ breakpoint: 'desktop' });
export const useView = () => React.useContext(ViewContext);

export function breakpointFor(width: number): Breakpoint {
  if (width <= 640) return 'mobile';
  if (width <= 1024) return 'tablet';
  return 'desktop';
}
