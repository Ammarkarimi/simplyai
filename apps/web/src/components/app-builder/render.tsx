'use client';
/** Renders an app definition: components, theme, navigation, modals, responsive styles and animations. */
import * as React from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { safeUrl, sanitizeStyle, walkNodes, type AppDefinition, type Breakpoint, type UINode, type UIStyle } from '@simplyai/shared';
import { LucideIcon } from '@/components/icons';
import { CONTAINER_TYPES } from './catalog';
import { Markdown } from './markdown';
import { RuntimeProvider, ScopeContext, useExtraScope, useRuntime, useRuntimeState, useView, ViewContext, type AppRuntime, type RuntimeMode } from './runtime';

// ── Styles ────────────────────────────────────────────────

const kebab = (k: string) => (k.startsWith('Webkit') ? `-webkit-${k.slice(6)}` : k).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
const cssId = (id: string) => id.replace(/[^\w-]/g, '');

function toCss(style: Record<string, string | number>, important = false): string {
  return Object.entries(style)
    .map(([k, v]) => `${kebab(k)}:${typeof v === 'number' && !/^(opacity|zIndex|flexGrow|flexShrink|order|fontWeight|lineHeight)$/.test(k) ? `${v}px` : v}${important ? ' !important' : ''}`)
    .join(';');
}

function evalStyle(rt: AppRuntime, style: UIStyle | undefined, extra?: Record<string, unknown>): Record<string, string | number> {
  if (!style) return {};
  const resolved: UIStyle = {};
  for (const [k, v] of Object.entries(style)) {
    const r = rt.evaluate(v, extra);
    if (typeof r === 'string' || typeof r === 'number') resolved[k] = r;
  }
  return sanitizeStyle(resolved);
}

export function computeStyle(rt: AppRuntime, node: UINode, bp: Breakpoint, extra?: Record<string, unknown>): React.CSSProperties {
  const merged: Record<string, string | number> = {};
  const grid = node.type === 'grid';
  const cols = grid ? Math.max(1, Math.min(12, Number(rt.evaluate(node.props.columns, extra)) || 1)) : 0;
  if (grid) Object.assign(merged, { display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` });
  Object.assign(merged, evalStyle(rt, node.style, extra));
  if (bp !== 'desktop') {
    if (grid && cols > 2) merged.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
    Object.assign(merged, evalStyle(rt, node.tabletStyle, extra));
  }
  if (bp === 'mobile') {
    if (grid && rt.evaluate(node.props.stackOnMobile, extra) !== false) merged.gridTemplateColumns = 'minmax(0, 1fr)';
    Object.assign(merged, evalStyle(rt, node.mobileStyle, extra));
  }
  const a = node.animation;
  if (a && a.type !== 'none') {
    merged.animation = `sai-${a.type} ${a.durationMs ?? 600}ms ${a.type === 'bounce' || a.type === 'float' ? 'ease-in-out' : 'cubic-bezier(.2,.8,.2,1)'} ${a.delayMs ?? 0}ms ${a.loop || ['float', 'pulse', 'spin'].includes(a.type) ? 'infinite' : '1'} both`;
  }
  return merged as React.CSSProperties;
}

const TONES: Record<string, string> = { primary: 'var(--app-primary)', success: '#16a34a', warning: '#d97706', danger: '#dc2626', info: '#0284c7', neutral: 'var(--app-muted)', accent: 'var(--app-accent)' };
const toneColor = (t: unknown) => TONES[String(t)] ?? TONES.primary!;

export const RUNTIME_CSS = `
.sai-app{font-family:var(--app-font),system-ui,sans-serif;color:var(--app-text);background:var(--app-bg);-webkit-font-smoothing:antialiased;line-height:1.5;font-size:15px;min-height:100%}
.sai-app *,.sai-app *::before,.sai-app *::after{box-sizing:border-box}
.sai-app h1,.sai-app h2,.sai-app h3,.sai-app h4{font-family:var(--app-heading-font),var(--app-font),system-ui,sans-serif;margin:0;font-weight:700;line-height:1.15;letter-spacing:-0.015em}
.sai-app h1{font-size:2.4rem}.sai-app h2{font-size:1.75rem}.sai-app h3{font-size:1.3rem}.sai-app h4{font-size:1.08rem}
.sai-app p{margin:0}
.sai-page{display:flex;flex-direction:column;min-height:100%;width:100%;margin:0 auto}
.sai-box{display:flex;flex-direction:column;min-width:0}
.sai-card{display:flex;flex-direction:column;background:var(--app-surface);border:1px solid var(--app-border);border-radius:var(--app-radius);box-shadow:0 1px 2px rgba(0,0,0,.04),0 12px 32px -18px rgba(0,0,0,.18);min-width:0}
.sai-card-head{display:flex;flex-direction:column;gap:2px}
.sai-card-title{font-family:var(--app-heading-font),var(--app-font);font-weight:650;font-size:1.05rem}
.sai-muted{color:var(--app-muted);font-size:.875rem}
.sai-text{margin:0;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}
.sai-md{display:flex;flex-direction:column;gap:.65em;line-height:1.65}.sai-md ul,.sai-md ol{margin:0;padding-left:1.4em}.sai-md ul{list-style:disc}.sai-md ol{list-style:decimal}.sai-md h1,.sai-md h2,.sai-md h3{margin-top:.3em}
.sai-code{font-family:ui-monospace,monospace;font-size:.88em;background:color-mix(in srgb,var(--app-text) 8%,transparent);padding:.1em .35em;border-radius:6px}
.sai-pre{margin:0;padding:12px 14px;border-radius:calc(var(--app-radius)*.7);background:color-mix(in srgb,var(--app-text) 6%,transparent);overflow:auto;font-size:.85em}
.sai-quote{margin:0;padding-left:12px;border-left:3px solid var(--app-primary);color:var(--app-muted)}
.sai-hr{border:0;border-top:1px solid var(--app-border);margin:4px 0}
.sai-link{color:var(--app-primary);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.sai-btn{align-self:flex-start;display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid transparent;border-radius:calc(var(--app-radius)*.75);font-weight:600;font-family:inherit;cursor:pointer;transition:all .18s ease;white-space:nowrap;line-height:1;user-select:none}
.sai-btn:disabled{opacity:.55;cursor:not-allowed}
.sai-btn:not(:disabled):active{transform:scale(.97)}
.sai-btn-sm{height:32px;padding:0 12px;font-size:13px}.sai-btn-md{height:40px;padding:0 18px;font-size:14px}.sai-btn-lg{height:50px;padding:0 26px;font-size:16px}
.sai-btn-primary{background:var(--app-primary);color:#fff;box-shadow:0 6px 18px -8px var(--app-primary)}.sai-btn-primary:not(:disabled):hover{filter:brightness(1.08);box-shadow:0 10px 24px -8px var(--app-primary)}
.sai-btn-secondary{background:color-mix(in srgb,var(--app-primary) 12%,transparent);color:var(--app-primary)}.sai-btn-secondary:not(:disabled):hover{background:color-mix(in srgb,var(--app-primary) 20%,transparent)}
.sai-btn-outline{background:transparent;border-color:var(--app-border);color:var(--app-text)}.sai-btn-outline:not(:disabled):hover{border-color:var(--app-primary);color:var(--app-primary)}
.sai-btn-ghost{background:transparent;color:var(--app-text)}.sai-btn-ghost:not(:disabled):hover{background:color-mix(in srgb,var(--app-text) 7%,transparent)}
.sai-btn-danger{background:#dc2626;color:#fff}.sai-btn-danger:not(:disabled):hover{background:#b91c1c}
.sai-btn-gradient{background:linear-gradient(120deg,var(--app-primary),var(--app-accent));background-size:200% 100%;color:#fff;box-shadow:0 10px 26px -10px var(--app-primary)}.sai-btn-gradient:not(:disabled):hover{background-position:100% 0}
.sai-btn-glass{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.25);color:inherit;backdrop-filter:blur(10px)}.sai-btn-glass:not(:disabled):hover{background:rgba(255,255,255,.2)}
.sai-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.sai-label{font-size:13px;font-weight:550}
.sai-req{color:#dc2626;margin-left:2px}
.sai-help{font-size:12px;color:var(--app-muted)}
.sai-input{width:100%;height:40px;padding:0 12px;border:1px solid var(--app-border);border-radius:calc(var(--app-radius)*.65);background:var(--app-surface);color:var(--app-text);font:inherit;font-size:14px;outline:none;transition:border-color .15s,box-shadow .15s}
.sai-input:focus{border-color:var(--app-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--app-primary) 22%,transparent)}
.sai-input:disabled{opacity:.6}
textarea.sai-input{height:auto;padding:10px 12px;resize:vertical;line-height:1.5}
.sai-input-wrap{position:relative;display:flex;align-items:center}.sai-input-wrap>.sai-input-icon{position:absolute;left:11px;width:16px;height:16px;color:var(--app-muted);pointer-events:none}.sai-input-wrap>.sai-input.has-icon{padding-left:34px}
.sai-check{display:inline-flex;align-items:center;gap:10px;cursor:pointer;font-size:14px}
.sai-check input{width:18px;height:18px;accent-color:var(--app-primary);cursor:pointer}
.sai-switch{position:relative;width:42px;height:24px;border-radius:999px;background:var(--app-border);transition:background .2s;flex-shrink:0;border:0;padding:0;cursor:pointer}
.sai-switch[data-on=true]{background:var(--app-primary)}
.sai-switch::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:999px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .2s}
.sai-switch[data-on=true]::after{transform:translateX(18px)}
.sai-radios{display:flex;flex-direction:column;gap:8px}.sai-radios.inline{flex-direction:row;flex-wrap:wrap;gap:8px}
.sai-radio{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border:1px solid var(--app-border);border-radius:calc(var(--app-radius)*.65);cursor:pointer;font-size:14px;transition:all .15s;background:var(--app-surface)}
.sai-radio[data-on=true]{border-color:var(--app-primary);background:color-mix(in srgb,var(--app-primary) 10%,var(--app-surface));color:var(--app-primary);font-weight:600}
.sai-range{width:100%;accent-color:var(--app-primary)}
.sai-stars{display:flex;gap:4px}.sai-star{background:none;border:0;padding:0;cursor:pointer;color:#f59e0b;transition:transform .12s}.sai-star:hover{transform:scale(1.15)}
.sai-color{display:flex;align-items:center;gap:10px}.sai-color input[type=color]{width:42px;height:36px;border:1px solid var(--app-border);border-radius:10px;padding:2px;background:var(--app-surface);cursor:pointer}
.sai-table-wrap{display:flex;flex-direction:column;gap:10px;min-width:0}
.sai-table-scroll{overflow:auto;border:1px solid var(--app-border);border-radius:calc(var(--app-radius)*.75)}
.sai-table{width:100%;border-collapse:collapse;font-size:14px}
.sai-table th{text-align:left;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--app-muted);padding:10px 14px;border-bottom:1px solid var(--app-border);background:color-mix(in srgb,var(--app-text) 3%,var(--app-surface));cursor:pointer;white-space:nowrap;user-select:none}
.sai-table td{padding:11px 14px;border-bottom:1px solid var(--app-border);vertical-align:middle;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sai-table.compact td{padding:6px 12px}.sai-table tr:last-child td{border-bottom:0}
.sai-table.striped tbody tr:nth-child(even){background:color-mix(in srgb,var(--app-text) 2.5%,transparent)}
.sai-table tbody tr{transition:background .12s;cursor:pointer}.sai-table tbody tr:hover{background:color-mix(in srgb,var(--app-primary) 7%,transparent)}
.sai-table tbody tr[data-selected=true]{background:color-mix(in srgb,var(--app-primary) 13%,transparent)}
.sai-pager{display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--app-muted)}
.sai-pager button{background:none;border:1px solid var(--app-border);border-radius:8px;height:30px;padding:0 10px;color:var(--app-text);cursor:pointer}.sai-pager button:disabled{opacity:.4;cursor:default}
.sai-badge{display:inline-flex;align-items:center;gap:4px;width:fit-content;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600}
.sai-alert{display:flex;gap:12px;padding:14px 16px;border-radius:calc(var(--app-radius)*.75);border:1px solid}
.sai-alert-title{font-weight:650}
.sai-progress{height:10px;border-radius:999px;background:color-mix(in srgb,var(--app-text) 9%,transparent);overflow:hidden}
.sai-progress>div{height:100%;border-radius:999px;transition:width .5s cubic-bezier(.2,.8,.2,1)}
.sai-stat{display:flex;flex-direction:column;gap:8px;min-width:0}
.sai-stat-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.sai-stat-icon{display:flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:12px;background:color-mix(in srgb,var(--app-primary) 14%,transparent);color:var(--app-primary)}
.sai-stat-value{font-family:var(--app-heading-font),var(--app-font);font-size:1.9rem;font-weight:750;letter-spacing:-0.02em;line-height:1.1}
.sai-avatar{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;overflow:hidden;background:linear-gradient(135deg,var(--app-primary),var(--app-accent));color:#fff;font-weight:700;flex-shrink:0}
.sai-avatar img{width:100%;height:100%;object-fit:cover}
.sai-tabs-head{display:flex;gap:4px;border-bottom:1px solid var(--app-border);overflow-x:auto}
.sai-tab{background:none;border:0;padding:10px 14px;font:inherit;font-size:14px;font-weight:550;color:var(--app-muted);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap;transition:color .15s}
.sai-tab[data-on=true]{color:var(--app-primary);border-bottom-color:var(--app-primary)}
.sai-tabs-head.pills{border:0;gap:6px}.sai-tabs-head.pills .sai-tab{border-radius:999px;border:0;padding:8px 14px}.sai-tabs-head.pills .sai-tab[data-on=true]{background:var(--app-primary);color:#fff}
.sai-tabs-head.boxed{border:0;background:color-mix(in srgb,var(--app-text) 6%,transparent);padding:4px;border-radius:calc(var(--app-radius)*.75);width:fit-content}.sai-tabs-head.boxed .sai-tab{border:0;border-radius:calc(var(--app-radius)*.6);padding:7px 14px}.sai-tabs-head.boxed .sai-tab[data-on=true]{background:var(--app-surface);color:var(--app-text);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.sai-navbar{display:flex;align-items:center;justify-content:space-between;gap:16px;background:var(--app-surface);border-bottom:1px solid var(--app-border);flex-wrap:wrap}
.sai-navbar.sticky{position:sticky;top:0;z-index:20;backdrop-filter:blur(12px);background:color-mix(in srgb,var(--app-surface) 82%,transparent)}
.sai-brand{display:flex;align-items:center;gap:10px;font-weight:750;font-family:var(--app-heading-font),var(--app-font);font-size:1.1rem}
.sai-brand img{height:28px;width:auto}
.sai-navlinks{display:flex;gap:4px;flex-wrap:wrap}
.sai-navlink{background:none;border:0;font:inherit;font-size:14px;padding:7px 12px;border-radius:calc(var(--app-radius)*.6);color:var(--app-muted);cursor:pointer;font-weight:550;transition:all .15s;text-align:left;display:flex;align-items:center;gap:8px}
.sai-navlink:hover{color:var(--app-text);background:color-mix(in srgb,var(--app-text) 6%,transparent)}
.sai-navlink[data-on=true]{color:var(--app-primary);background:color-mix(in srgb,var(--app-primary) 11%,transparent)}
.sai-shell-side{display:flex;min-height:100%}
.sai-sidenav{width:232px;flex-shrink:0;border-right:1px solid var(--app-border);background:var(--app-surface);padding:18px 12px;display:flex;flex-direction:column;gap:18px}
.sai-sidenav .sai-navlinks{flex-direction:column}
.sai-shell-main{flex:1;min-width:0}
.sai-divider{display:flex;align-items:center;gap:12px;color:var(--app-muted);font-size:13px}.sai-divider::before,.sai-divider::after{content:"";flex:1;border-top:1px solid var(--app-border)}.sai-divider.plain::after{display:none}
.sai-media{display:block;max-width:100%;border:0;overflow:hidden}
.sai-modal-backdrop{position:fixed;inset:0;z-index:60;background:rgba(9,9,11,.55);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;animation:sai-fade .2s both}
.sai-modal{position:relative;max-height:calc(100vh - 32px);overflow:auto;width:100%;background:var(--app-surface);color:var(--app-text);border:1px solid var(--app-border);border-radius:calc(var(--app-radius)*1.3);box-shadow:0 30px 80px -20px rgba(0,0,0,.5);padding:22px;animation:sai-zoom .25s cubic-bezier(.2,.8,.2,1) both}
.sai-modal-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.sai-modal-head h3{font-size:1.15rem}
.sai-icon-btn{background:none;border:0;padding:6px;border-radius:8px;color:var(--app-muted);cursor:pointer;display:inline-flex}.sai-icon-btn:hover{background:color-mix(in srgb,var(--app-text) 7%,transparent);color:var(--app-text)}
.sai-empty-list{padding:28px;text-align:center;color:var(--app-muted);font-size:14px;border:1px dashed var(--app-border);border-radius:var(--app-radius)}
.sai-spin{animation:sai-spin 1s linear infinite}
@keyframes sai-fade{from{opacity:0}to{opacity:1}}
@keyframes sai-slideUp{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:none}}
@keyframes sai-slideDown{from{opacity:0;transform:translateY(-28px)}to{opacity:1;transform:none}}
@keyframes sai-slideLeft{from{opacity:0;transform:translateX(36px)}to{opacity:1;transform:none}}
@keyframes sai-slideRight{from{opacity:0;transform:translateX(-36px)}to{opacity:1;transform:none}}
@keyframes sai-zoom{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:none}}
@keyframes sai-bounce{0%{opacity:0;transform:scale(.3)}50%{opacity:1;transform:scale(1.06)}70%{transform:scale(.97)}100%{transform:none}}
@keyframes sai-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
@keyframes sai-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
@keyframes sai-spin{to{transform:rotate(360deg)}}
@keyframes sai-shake{0%,100%{transform:none}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}
.sai-edit [data-node-id]{cursor:default}
.sai-edit [data-node-id] :is(input,textarea,select,iframe,video){pointer-events:none}
.sai-edit .sai-drop-empty{min-height:72px;border:1.5px dashed color-mix(in srgb,var(--app-muted) 45%,transparent);border-radius:10px;display:flex;align-items:center;justify-content:center;color:var(--app-muted);font-size:12px;flex:1;pointer-events:none;gap:6px}
.sai-edit .sai-ghost{opacity:.35;outline:1px dashed var(--app-muted);outline-offset:2px}
.sai-edit .sai-modal-inline{border:1.5px dashed var(--app-primary);border-radius:calc(var(--app-radius)*1.2);padding:18px;background:var(--app-surface)}
.sai-edit .sai-modal-tag{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:var(--app-primary);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}
`;

// ── Helpers ───────────────────────────────────────────────

export function parseOptions(v: unknown): Array<{ label: string; value: string }> {
  if (Array.isArray(v)) {
    return v.slice(0, 1000).map((o) => {
      if (o && typeof o === 'object') {
        const r = o as Record<string, unknown>;
        const value = String(r.value ?? r.id ?? r.label ?? r.name ?? '');
        return { value, label: String(r.label ?? r.name ?? value) };
      }
      return { value: String(o), label: String(o) };
    });
  }
  if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim()).filter(Boolean).map((s) => ({ value: s, label: s }));
  return [];
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? '✓' : '—';
  if (typeof v === 'object') return v instanceof Date ? v.toISOString() : JSON.stringify(v);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? new Date(s).toLocaleString() : s;
}

function videoSrc(url: string): { kind: 'iframe' | 'video'; src: string } | null {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,20})/);
  if (yt) return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${yt[1]}` };
  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return { kind: 'iframe', src: `https://player.vimeo.com/video/${vimeo[1]}` };
  if (/^https:\/\/.+\.(mp4|webm|ogg)(\?.*)?$/i.test(url)) return { kind: 'video', src: url };
  return null;
}

function Icon({ name, size, className, style }: { name: string; size?: number; className?: string; style?: React.CSSProperties }) {
  return <span style={{ display: 'inline-flex', width: size, height: size, flexShrink: 0, ...style }} className={className}><LucideIcon name={name} className="h-full w-full" /></span>;
}

// ── Node rendering ────────────────────────────────────────

export interface RenderProps {
  node: UINode;
  /** resolved prop */
  p: (key: string) => unknown;
  attrs: { 'data-node-id'?: string; className: string; style: React.CSSProperties; draggable?: boolean };
  rt: AppRuntime;
  mode: RuntimeMode;
  extra?: Record<string, unknown>;
  children: React.ReactNode;
  fire: (event: string, extra?: Record<string, unknown>) => void;
}

const CopyContext = React.createContext(false);

export function RenderNode({ node }: { node: UINode }) {
  const rt = useRuntime();
  const rstate = useRuntimeState();
  const extra = useExtraScope();
  const inCopy = React.useContext(CopyContext);
  const { breakpoint } = useView();
  const mode = rt.mode;
  const edit = mode === 'edit';
  let ghost = false;
  if ((node.visible && !rt.bool(node.visible, extra, true)) || node.hideOn?.includes(breakpoint)) {
    if (!edit) return null;
    ghost = true;
  }
  if (node.type === 'modal' && !edit) return null;
  void rstate;
  const style = computeStyle(rt, node, breakpoint, extra);
  const cls = [`sai-n-${cssId(node.id)}`];
  if (ghost) cls.push('sai-ghost');
  const attrs: RenderProps['attrs'] = { className: cls.join(' '), style };
  if (!inCopy) {
    attrs['data-node-id'] = node.id;
    if (edit && !node.locked && node.type !== 'page') attrs.draggable = true;
  }
  const p = (key: string) => rt.evaluate(node.props[key], extra);
  const fire = (event: string, ev?: Record<string, unknown>) => {
    if (edit) return;
    void rt.runActions(node.events?.[event], { ...extra, ...ev });
  };
  const children = CONTAINER_TYPES.has(node.type) && node.type !== 'list' && node.type !== 'tabs' ? <Children node={node} /> : null;
  const Comp = RENDERERS[node.type] ?? Unknown;
  return <Comp node={node} p={p} attrs={attrs} rt={rt} mode={mode} extra={extra} fire={fire}>{children}</Comp>;
}

function Children({ node, hint }: { node: UINode; hint?: string }) {
  const rt = useRuntime();
  const kids = node.children ?? [];
  if (!kids.length && rt.mode === 'edit' && !React.useContext(CopyContext)) {
    return <div className="sai-drop-empty"><LucideIcon name="plus" className="h-3.5 w-3.5" />{hint ?? 'Drop components here'}</div>;
  }
  return <>{kids.map((c) => <RenderNode key={c.id} node={c} />)}</>;
}

type Renderer = (props: RenderProps) => React.ReactElement | null;

function Unknown({ node, attrs }: RenderProps) {
  return <div {...attrs}><span className="sai-muted">Unknown component “{node.type}”</span></div>;
}

const Page: Renderer = ({ attrs, children }) => <div {...attrs} className={`sai-page ${attrs.className}`}>{children}</div>;

const Container: Renderer = ({ node, attrs, children, fire }) => {
  const Tag = (['div', 'section', 'header', 'footer', 'main', 'aside', 'nav'].includes(String(node.props.tag)) ? node.props.tag : 'div') as 'div';
  return <Tag {...attrs} className={`sai-box ${attrs.className}`} onClick={node.events?.onClick?.length ? (e) => { e.stopPropagation(); fire('onClick'); } : undefined} style={{ ...attrs.style, cursor: node.events?.onClick?.length ? 'pointer' : attrs.style.cursor }}>{children}</Tag>;
};

const Grid: Renderer = ({ attrs, children }) => <div {...attrs} style={{ display: 'grid', gap: 16, ...attrs.style }}>{children}</div>;

const Card: Renderer = ({ node, p, attrs, children, fire }) => {
  const title = p('title');
  const subtitle = p('subtitle');
  return (
    <div {...attrs} className={`sai-card ${attrs.className}`} onClick={node.events?.onClick?.length ? (e) => { e.stopPropagation(); fire('onClick'); } : undefined}>
      {(title || subtitle) ? <div className="sai-card-head">{title ? <div className="sai-card-title">{String(title)}</div> : null}{subtitle ? <div className="sai-muted">{String(subtitle)}</div> : null}</div> : null}
      {children}
    </div>
  );
};

const Tabs: Renderer = ({ node, p, attrs, rt, fire }) => {
  const labels = String(p('tabs') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const kids = node.children ?? [];
  const active = Math.min(Number(rt.store.getState().extras[node.name]?.activeTab ?? 0), Math.max(0, kids.length - 1));
  const variant = String(p('variant') ?? 'underline');
  return (
    <div {...attrs} className={`sai-box ${attrs.className}`} style={{ gap: 12, ...attrs.style }}>
      <div className={`sai-tabs-head ${variant}`}>
        {kids.map((k, i) => (
          <button key={k.id} type="button" className="sai-tab" data-on={i === active} onClick={() => { rt.setExtra(node.name, { activeTab: i }); fire('onChange', { value: i }); }}>
            {labels[i] ?? `Tab ${i + 1}`}
          </button>
        ))}
      </div>
      {kids[active] ? <RenderNode key={kids[active]!.id} node={kids[active]!} /> : null}
    </div>
  );
};

const ModalInline: Renderer = ({ p, attrs, children }) => (
  <div {...attrs} className={`sai-modal-inline ${attrs.className}`} style={{ ...attrs.style, maxWidth: Number(p('width')) || 520 }}>
    <div className="sai-modal-tag"><LucideIcon name="app-window" className="h-3.5 w-3.5" />Modal · {String(p('title') ?? '')}</div>
    {children}
  </div>
);

const List: Renderer = ({ node, p, attrs, mode, extra, fire }) => {
  const raw = p('data');
  const items = Array.isArray(raw) ? raw.slice(0, 500) : [];
  const inCopy = React.useContext(CopyContext);
  const kids = node.children ?? [];
  if (!items.length) {
    if (mode === 'edit' && !inCopy) {
      return <div {...attrs} className={`sai-box ${attrs.className}`}><ScopeContext.Provider value={{ ...extra, item: {}, index: 0 }}><Children node={node} hint="Template: components repeat for every item" /></ScopeContext.Provider></div>;
    }
    return <div {...attrs} className={`sai-box ${attrs.className}`}><div className="sai-empty-list">{String(p('emptyText') ?? 'Nothing here yet')}</div></div>;
  }
  return (
    <div {...attrs} className={`sai-box ${attrs.className}`}>
      {items.map((item, index) => {
        const content = (
          <ScopeContext.Provider key={index} value={{ ...extra, item, index }}>
            {index === 0 && mode === 'edit' && !inCopy ? <Children node={node} /> : kids.map((c) => <RenderNode key={c.id} node={c} />)}
          </ScopeContext.Provider>
        );
        const wrapped = node.events?.onItemClick?.length ? (
          <div key={index} style={{ display: 'contents', cursor: 'pointer' }} onClick={() => fire('onItemClick', { item, index })}>{content}</div>
        ) : content;
        return index === 0 || mode !== 'edit' ? wrapped : <CopyContext.Provider key={index} value={true}>{wrapped}</CopyContext.Provider>;
      })}
    </div>
  );
};

const Form: Renderer = ({ node, p, attrs, children, rt, mode }) => {
  const [busy, setBusy] = React.useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (mode === 'edit') return;
    const missing = rt.missingRequired(node);
    if (missing.length) {
      const { toast } = await import('sonner');
      toast.error(`Please fill in: ${missing.join(', ')}`);
      return;
    }
    setBusy(true);
    try {
      await rt.runActions(node.events?.onSubmit, { data: rt.collect(node) });
      if (rt.bool(node.props.resetOnSubmit, undefined, true)) rt.resetValues(Object.keys(rt.collect(node)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form {...attrs} className={`sai-box ${attrs.className}`} onSubmit={submit} noValidate>
      {children}
      {rt.bool(node.props.showSubmit, undefined, true) ? (
        <button type="submit" className="sai-btn sai-btn-primary sai-btn-md" disabled={busy} style={{ alignSelf: 'flex-start' }}>
          {busy ? <Icon name="loader-circle" size={16} className="sai-spin" /> : null}{String(p('submitLabel') || 'Submit')}
        </button>
      ) : null}
    </form>
  );
};

const Divider: Renderer = ({ p, attrs }) => {
  const label = p('label');
  return <div {...attrs} className={`sai-divider ${label ? '' : 'plain'} ${attrs.className}`}>{label ? String(label) : null}</div>;
};

const Spacer: Renderer = ({ p, attrs }) => <div {...attrs} style={{ height: Number(p('height')) || 24, flexShrink: 0, ...attrs.style }} />;

const Heading: Renderer = ({ p, attrs }) => {
  const level = ['h1', 'h2', 'h3', 'h4'].includes(String(p('level'))) ? String(p('level')) : 'h2';
  const Tag = level as 'h2';
  return <Tag {...attrs}>{String(p('text') ?? '')}</Tag>;
};

const Text: Renderer = ({ node, p, attrs, fire }) => (
  <p {...attrs} className={`sai-text ${attrs.className}`} onClick={node.events?.onClick?.length ? () => fire('onClick') : undefined} style={{ ...attrs.style, cursor: node.events?.onClick?.length ? 'pointer' : undefined }}>
    {String(p('text') ?? '')}
  </p>
);

const MarkdownR: Renderer = ({ p, attrs }) => <div {...attrs} className={`sai-md ${attrs.className}`}><Markdown source={String(p('content') ?? '')} /></div>;

const Button: Renderer = ({ node, p, attrs, rt, mode }) => {
  const [busy, setBusy] = React.useState(false);
  const loading = busy || rt.bool(node.props.loadingWhen);
  const variant = String(p('variant') || 'primary');
  const size = ['sm', 'md', 'lg'].includes(String(p('size'))) ? String(p('size')) : 'md';
  const icon = p('icon') ? String(p('icon')) : '';
  const iconEl = loading ? <Icon name="loader-circle" size={size === 'lg' ? 18 : 16} className="sai-spin" /> : icon ? <Icon name={icon} size={size === 'lg' ? 18 : 16} /> : null;
  const right = rt.bool(node.props.iconRight);
  return (
    <button
      {...attrs}
      type="button"
      className={`sai-btn sai-btn-${variant} sai-btn-${size} ${attrs.className}`}
      style={{ ...(rt.bool(node.props.fullWidth) ? { width: '100%', alignSelf: 'stretch' } : {}), ...attrs.style }}
      disabled={mode !== 'edit' && (loading || rt.bool(node.props.disabled))}
      onClick={async () => {
        if (mode === 'edit' || !node.events?.onClick?.length) return;
        setBusy(true);
        try {
          await rt.runActions(node.events.onClick);
        } finally {
          setBusy(false);
        }
      }}
    >
      {!right && iconEl}{String(p('label') ?? '')}{right && iconEl}
    </button>
  );
};

const Link: Renderer = ({ node, p, attrs, rt, mode, fire }) => {
  const page = node.props.page ? String(node.props.page) : '';
  const href = page ? '#' : safeUrl(p('url')) ?? '#';
  const newTab = rt.bool(node.props.newTab);
  return (
    <a
      {...attrs}
      href={href}
      className={`sai-link ${attrs.className}`}
      target={!page && newTab ? '_blank' : undefined}
      rel="noopener noreferrer"
      onClick={(e) => {
        if (mode === 'edit') return void e.preventDefault();
        if (page) {
          e.preventDefault();
          rt.navigate(page);
        }
        fire('onClick');
      }}
    >
      {String(p('text') ?? '')}
    </a>
  );
};

function NavLinks({ rt, mode, vertical }: { rt: AppRuntime; mode: RuntimeMode; vertical?: boolean }) {
  const pageId = rt.store.getState().pageId;
  return (
    <div className="sai-navlinks" style={vertical ? { flexDirection: 'column' } : undefined}>
      {rt.def.pages.filter((pg) => !pg.hidden).map((pg) => (
        <button key={pg.id} type="button" className="sai-navlink" data-on={pg.id === pageId} onClick={() => mode !== 'edit' && rt.navigate(pg.id)}>{pg.name}</button>
      ))}
    </div>
  );
}

const Navbar: Renderer = ({ p, attrs, rt, mode, node }) => {
  const logo = safeUrl(p('logo'));
  return (
    <nav {...attrs} className={`sai-navbar ${rt.bool(node.props.sticky) ? 'sticky' : ''} ${attrs.className}`}>
      <div className="sai-brand">{logo ? <img src={logo} alt="" /> : null}{String(p('brand') ?? '')}</div>
      {rt.bool(node.props.showPages, undefined, true) ? <NavLinks rt={rt} mode={mode} /> : null}
    </nav>
  );
};

function FieldShell({ node, p, children, rt }: { node: UINode; p: RenderProps['p']; children: React.ReactNode; rt: AppRuntime }) {
  const label = p('label');
  const help = p('helperText');
  return (
    <>
      {label ? <span className="sai-label">{String(label)}{rt.bool(node.props.required) ? <span className="sai-req">*</span> : null}</span> : null}
      {children}
      {help ? <span className="sai-help">{String(help)}</span> : null}
    </>
  );
}

function useInput(node: UINode, rt: AppRuntime, fire: RenderProps['fire']) {
  const value = rt.valueOf(node);
  const set = (v: unknown) => {
    rt.setValue(node.name, v);
    fire('onChange', { value: v });
  };
  return { value, set, readOnly: rt.mode === 'edit', disabled: rt.mode !== 'edit' && rt.bool(node.props.disabled) };
}

const Input: Renderer = (props) => {
  const { node, p, attrs, rt, fire } = props;
  const { value, set, readOnly, disabled } = useInput(node, rt, fire);
  const type = String(p('inputType') || 'text');
  const icon = p('icon') ? String(p('icon')) : '';
  return (
    <label {...attrs} className={`sai-field ${attrs.className}`}>
      <FieldShell node={node} p={p} rt={rt}>
        <span className="sai-input-wrap">
          {icon ? <Icon name={icon} className="sai-input-icon" /> : null}
          <input
            className={`sai-input ${icon ? 'has-icon' : ''}`}
            type={['text', 'email', 'number', 'password', 'url', 'tel', 'search'].includes(type) ? type : 'text'}
            placeholder={String(p('placeholder') ?? '')}
            value={value === null || value === undefined ? '' : String(value)}
            readOnly={readOnly}
            tabIndex={readOnly ? -1 : undefined}
            disabled={disabled}
            onChange={(e) => set(type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && node.events?.onSubmit?.length) {
                e.preventDefault();
                fire('onSubmit', { value });
              }
            }}
          />
        </span>
      </FieldShell>
    </label>
  );
};

const TextArea: Renderer = ({ node, p, attrs, rt, fire }) => {
  const { value, set, readOnly, disabled } = useInput(node, rt, fire);
  return (
    <label {...attrs} className={`sai-field ${attrs.className}`}>
      <FieldShell node={node} p={p} rt={rt}>
        <textarea className="sai-input" rows={Number(p('rows')) || 4} placeholder={String(p('placeholder') ?? '')} value={String(value ?? '')} readOnly={readOnly} tabIndex={readOnly ? -1 : undefined} disabled={disabled} onChange={(e) => set(e.target.value)} />
      </FieldShell>
    </label>
  );
};

const SelectR: Renderer = ({ node, p, attrs, rt, fire }) => {
  const { value, set, readOnly, disabled } = useInput(node, rt, fire);
  const options = parseOptions(p('options'));
  return (
    <label {...attrs} className={`sai-field ${attrs.className}`}>
      <FieldShell node={node} p={p} rt={rt}>
        <select className="sai-input" value={String(value ?? '')} disabled={disabled || readOnly} onChange={(e) => set(e.target.value)}>
          <option value="">{String(p('placeholder') || 'Select…')}</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </FieldShell>
    </label>
  );
};

const Radio: Renderer = ({ node, p, attrs, rt, fire }) => {
  const { value, set, readOnly, disabled } = useInput(node, rt, fire);
  const options = parseOptions(p('options'));
  return (
    <div {...attrs} className={`sai-field ${attrs.className}`}>
      <FieldShell node={node} p={p} rt={rt}>
        <div className={`sai-radios ${rt.bool(node.props.inline) ? 'inline' : ''}`} role="radiogroup">
          {options.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={String(value) === o.value} className="sai-radio" data-on={String(value) === o.value} disabled={disabled} onClick={() => !readOnly && set(o.value)}>{o.label}</button>
          ))}
        </div>
      </FieldShell>
    </div>
  );
};

const Checkbox: Renderer = ({ node, p, attrs, rt, fire }) => {
  const { value, set, readOnly, disabled } = useInput(node, rt, fire);
  return (
    <label {...attrs} className={`sai-check ${attrs.className}`}>
      <input type="checkbox" checked={!!value} disabled={disabled} readOnly={readOnly} onChange={(e) => !readOnly && set(e.target.checked)} />
      <span>{String(p('label') ?? '')}{rt.bool(node.props.required) ? <span className="sai-req">*</span> : null}</span>
    </label>
  );
};

const SwitchR: Renderer = ({ node, p, attrs, rt, fire }) => {
  const { value, set, readOnly, disabled } = useInput(node, rt, fire);
  return (
    <div {...attrs} className={`sai-check ${attrs.className}`}>
      <button type="button" role="switch" aria-checked={!!value} className="sai-switch" data-on={!!value} disabled={disabled} onClick={() => !readOnly && set(!value)} />
      <span>{String(p('label') ?? '')}</span>
    </div>
  );
};

const DateR: Renderer = ({ node, p, attrs, rt, fire }) => {
  const { value, set, readOnly, disabled } = useInput(node, rt, fire);
  const time = rt.bool(node.props.includeTime);
  return (
    <label {...attrs} className={`sai-field ${attrs.className}`}>
      <FieldShell node={node} p={p} rt={rt}>
        <input className="sai-input" type={time ? 'datetime-local' : 'date'} value={String(value ?? '')} readOnly={readOnly} disabled={disabled} onChange={(e) => set(e.target.value)} />
      </FieldShell>
    </label>
  );
};

const Slider: Renderer = ({ node, p, attrs, rt, fire }) => {
  const { value, set, readOnly, disabled } = useInput(node, rt, fire);
  const label = p('label');
  return (
    <label {...attrs} className={`sai-field ${attrs.className}`}>
      {label || rt.bool(node.props.showValue, undefined, true) ? (
        <span className="sai-label" style={{ display: 'flex', justifyContent: 'space-between' }}><span>{String(label ?? '')}</span>{rt.bool(node.props.showValue, undefined, true) ? <span style={{ color: 'var(--app-primary)' }}>{String(value)}</span> : null}</span>
      ) : null}
      <input className="sai-range" type="range" min={Number(p('min')) || 0} max={Number(p('max')) || 100} step={Number(p('step')) || 1} value={Number(value) || 0} disabled={disabled || readOnly} onChange={(e) => set(Number(e.target.value))} />
    </label>
  );
};

const Rating: Renderer = ({ node, p, attrs, rt, fire }) => {
  const { value, set, readOnly, disabled } = useInput(node, rt, fire);
  const max = Math.min(10, Math.max(1, Number(p('max')) || 5));
  const label = p('label');
  return (
    <div {...attrs} className={`sai-field ${attrs.className}`}>
      {label ? <span className="sai-label">{String(label)}</span> : null}
      <div className="sai-stars">
        {Array.from({ length: max }, (_, i) => (
          <button key={i} type="button" className="sai-star" disabled={disabled} onClick={() => !readOnly && set(i + 1)} aria-label={`${i + 1} stars`}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill={i < Number(value) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" strokeLinejoin="round" /></svg>
          </button>
        ))}
      </div>
    </div>
  );
};

const ColorR: Renderer = ({ node, p, attrs, rt, fire }) => {
  const { value, set, readOnly, disabled } = useInput(node, rt, fire);
  const v = /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : '#000000';
  return (
    <label {...attrs} className={`sai-field ${attrs.className}`}>
      <FieldShell node={node} p={p} rt={rt}>
        <span className="sai-color"><input type="color" value={v} disabled={disabled || readOnly} onChange={(e) => set(e.target.value)} /><code className="sai-code">{v}</code></span>
      </FieldShell>
    </label>
  );
};

const Table: Renderer = ({ node, p, attrs, rt, mode, fire }) => {
  const raw = p('data');
  const rows = React.useMemo(() => (Array.isArray(raw) ? (raw as unknown[]).map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : { value: r })) : []), [raw]);
  const colProp = String(p('columns') ?? '').trim();
  const columns = React.useMemo(() => (colProp ? colProp.split(',').map((c) => c.trim()).filter(Boolean) : [...new Set(rows.slice(0, 50).flatMap((r) => Object.keys(r)))].filter((k) => k !== 'createdAt' && k !== 'updatedAt').slice(0, 12)), [colProp, rows]);
  const [search, setSearch] = React.useState('');
  const [sort, setSort] = React.useState<{ col: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = React.useState(0);
  const pageSize = Math.max(1, Math.min(500, Number(p('pageSize')) || 10));
  const filtered = React.useMemo(() => {
    let out = rows;
    if (search) {
      const s = search.toLowerCase();
      out = out.filter((r) => columns.some((c) => cellText(r[c]).toLowerCase().includes(s)));
    }
    if (sort) {
      out = [...out].sort((a, b) => {
        const x = a[sort.col];
        const y = b[sort.col];
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * sort.dir;
        return cellText(x).localeCompare(cellText(y), undefined, { numeric: true }) * sort.dir;
      });
    }
    return out;
  }, [rows, search, sort, columns]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * pageSize, (current + 1) * pageSize);
  const selected = rt.store.getState().extras[node.name]?.selectedRow;
  return (
    <div {...attrs} className={`sai-table-wrap ${attrs.className}`}>
      {rt.bool(node.props.searchable, undefined, true) ? (
        <span className="sai-input-wrap" style={{ maxWidth: 320 }}>
          <Icon name="search" className="sai-input-icon" />
          <input className="sai-input has-icon" placeholder="Search…" value={search} readOnly={mode === 'edit'} onChange={(e) => { setSearch(e.target.value); setPage(0); rt.setExtra(node.name, { searchText: e.target.value }); }} />
        </span>
      ) : null}
      <div className="sai-table-scroll">
        <table className={`sai-table ${rt.bool(node.props.striped) ? 'striped' : ''} ${rt.bool(node.props.compact) ? 'compact' : ''}`}>
          <thead>
            <tr>{columns.map((c) => <th key={c} onClick={() => setSort((s) => (s?.col === c ? (s.dir === 1 ? { col: c, dir: -1 } : null) : { col: c, dir: 1 }))}>{c}{sort?.col === c ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</th>)}</tr>
          </thead>
          <tbody>
            {visible.length ? visible.map((r, i) => (
              <tr key={String(r.id ?? i)} data-selected={selected === r} onClick={() => {
                if (mode === 'edit') return;
                rt.setExtra(node.name, { selectedRow: r, selectedIndex: current * pageSize + i });
                fire('onRowClick', { row: r });
              }}>
                {columns.map((c) => <td key={c} title={cellText(r[c])}>{cellText(r[c])}</td>)}
              </tr>
            )) : <tr><td colSpan={Math.max(1, columns.length)} style={{ textAlign: 'center', color: 'var(--app-muted)', padding: 28 }}>{String(p('emptyText') || 'No rows')}</td></tr>}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <div className="sai-pager">
          <span>{filtered.length} rows</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
            {current + 1} / {pages}
            <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</button>
          </span>
        </div>
      ) : null}
    </div>
  );
};

const DEFAULT_COLORS = ['var(--app-primary)', 'var(--app-accent)', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#14b8a6'];

function resolveColor(c: string, theme: AppDefinition['theme']): string {
  if (c === 'var(--app-primary)') return theme.primary;
  if (c === 'var(--app-accent)') return theme.accent;
  return c;
}

const ChartR: Renderer = ({ p, attrs, rt }) => {
  const raw = p('data');
  const data = Array.isArray(raw) ? (raw as Record<string, unknown>[]).slice(0, 1000) : [];
  const type = String(p('type') || 'bar');
  const xKey = String(p('xKey') || 'label');
  const yKeys = String(p('yKeys') || 'value').split(',').map((s) => s.trim()).filter(Boolean);
  const height = Math.max(120, Math.min(1200, Number(p('height')) || 260));
  const custom = String(p('colors') ?? '').split(',').map((s) => s.trim()).filter((c) => /^(#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\)|hsla?\([\d\s,.%deg]+\)|[a-z]+)$/i.test(c));
  const colors = (custom.length ? custom : DEFAULT_COLORS).map((c) => resolveColor(c, rt.def.theme));
  const grid = rt.bool(p('showGrid'), undefined, true);
  const legend = rt.bool(p('showLegend'));
  const curve = rt.bool(p('curved'), undefined, true) ? 'monotone' : 'linear';
  const stacked = rt.bool(p('stacked'));
  const axis = { stroke: rt.def.theme.mutedText, fontSize: 12, tickLine: false, axisLine: false } as const;
  const compact = (v: unknown) => (typeof v === 'number' ? new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(v) : String(v));
  const tooltip = <ChartTooltip contentStyle={{ background: rt.def.theme.surface, border: `1px solid ${rt.def.theme.border}`, borderRadius: 10, color: rt.def.theme.text, fontSize: 13 }} cursor={{ fill: `${rt.def.theme.primary}14` }} />;
  let chart: React.ReactElement;
  if (type === 'pie' || type === 'donut') {
    const key = yKeys[0] ?? 'value';
    chart = (
      <PieChart>
        {tooltip}
        {legend ? <Legend wrapperStyle={{ fontSize: 13 }} /> : null}
        <Pie data={data} dataKey={key} nameKey={xKey} innerRadius={type === 'donut' ? '58%' : 0} outerRadius="85%" paddingAngle={type === 'donut' ? 3 : 0} stroke="none" isAnimationActive>
          {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
        </Pie>
      </PieChart>
    );
  } else if (type === 'radial') {
    const key = yKeys[0] ?? 'value';
    const max = Math.max(1, ...data.map((d) => Number(d[key]) || 0));
    chart = (
      <RadialBarChart data={data.map((d, i) => ({ ...d, fill: colors[i % colors.length] }))} innerRadius="25%" outerRadius="100%" startAngle={90} endAngle={-270}>
        <PolarAngleAxis type="number" domain={[0, max]} tick={false} />
        {tooltip}
        {legend ? <Legend wrapperStyle={{ fontSize: 13 }} /> : null}
        <RadialBar dataKey={key} background cornerRadius={8} />
      </RadialBarChart>
    );
  } else {
    const Chart = type === 'line' ? LineChart : type === 'area' ? AreaChart : BarChart;
    chart = (
      <Chart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          {yKeys.map((k, i) => (
            <linearGradient key={k} id={`g-${k}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors[i % colors.length]} stopOpacity={0.45} />
              <stop offset="100%" stopColor={colors[i % colors.length]} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        {grid ? <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={rt.def.theme.border} /> : null}
        <XAxis dataKey={xKey} {...axis} />
        <YAxis {...axis} width={44} tickFormatter={compact} />
        {tooltip}
        {legend ? <Legend wrapperStyle={{ fontSize: 13 }} /> : null}
        {yKeys.map((k, i) => {
          const color = colors[i % colors.length];
          if (type === 'line') return <Line key={k} type={curve} dataKey={k} stroke={color} strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />;
          if (type === 'area') return <Area key={k} type={curve} dataKey={k} stroke={color} strokeWidth={2.5} fill={`url(#g-${k}-${i})`} stackId={stacked ? 's' : undefined} />;
          return <Bar key={k} dataKey={k} fill={color} radius={[6, 6, 0, 0]} stackId={stacked ? 's' : undefined} maxBarSize={48} />;
        })}
      </Chart>
    );
  }
  return (
    <div {...attrs} style={{ width: '100%', minWidth: 0, ...attrs.style }}>
      <ResponsiveContainer width="100%" height={height}>{chart}</ResponsiveContainer>
    </div>
  );
};

const Stat: Renderer = ({ p, attrs }) => {
  const trend = String(p('trend') || 'neutral');
  const icon = p('icon') ? String(p('icon')) : '';
  const change = p('change');
  const color = trend === 'up' ? '#16a34a' : trend === 'down' ? '#dc2626' : 'var(--app-muted)';
  return (
    <div {...attrs} className={`sai-stat ${attrs.className}`}>
      <div className="sai-stat-top"><span className="sai-muted" style={{ fontWeight: 550 }}>{String(p('label') ?? '')}</span>{icon ? <span className="sai-stat-icon"><Icon name={icon} size={18} /></span> : null}</div>
      <div className="sai-stat-value">{String(p('value') ?? '')}</div>
      {change ? <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600, color }}>{trend !== 'neutral' ? <Icon name={trend === 'up' ? 'trending-up' : 'trending-down'} size={14} /> : null}{String(change)}</div> : null}
    </div>
  );
};

const Progress: Renderer = ({ p, attrs, rt }) => {
  const max = Number(p('max')) || 100;
  const pct = Math.max(0, Math.min(100, ((Number(p('value')) || 0) / max) * 100));
  const label = p('label');
  const color = p('color') ? String(p('color')) : 'linear-gradient(90deg, var(--app-primary), var(--app-accent))';
  return (
    <div {...attrs} className={`sai-field ${attrs.className}`}>
      {label || rt.bool(p('showLabel'), undefined, true) ? <span className="sai-label" style={{ display: 'flex', justifyContent: 'space-between' }}><span>{String(label ?? '')}</span>{rt.bool(p('showLabel'), undefined, true) ? <span className="sai-muted">{Math.round(pct)}%</span> : null}</span> : null}
      <div className="sai-progress"><div style={{ width: `${pct}%`, background: color }} /></div>
    </div>
  );
};

const Badge: Renderer = ({ p, attrs }) => {
  const c = toneColor(p('tone'));
  return <span {...attrs} className={`sai-badge ${attrs.className}`} style={{ background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c, ...attrs.style }}>{String(p('text') ?? '')}</span>;
};

const ALERT_ICONS: Record<string, string> = { success: 'circle-check', warning: 'triangle-alert', danger: 'circle-x', info: 'info', primary: 'sparkles', neutral: 'info' };

const Alert: Renderer = ({ p, attrs }) => {
  const t = String(p('tone') || 'info');
  const c = toneColor(t);
  return (
    <div {...attrs} className={`sai-alert ${attrs.className}`} style={{ background: `color-mix(in srgb, ${c} 9%, var(--app-surface))`, borderColor: `color-mix(in srgb, ${c} 30%, transparent)`, ...attrs.style }}>
      <Icon name={ALERT_ICONS[t] ?? 'info'} size={20} style={{ color: c, marginTop: 1 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{p('title') ? <span className="sai-alert-title">{String(p('title'))}</span> : null}<span style={{ fontSize: 14 }}>{String(p('message') ?? '')}</span></div>
    </div>
  );
};

const ImageR: Renderer = ({ node, p, attrs, fire }) => {
  const src = safeUrl(p('src'));
  const fit = ['cover', 'contain', 'fill', 'none'].includes(String(p('fit'))) ? String(p('fit')) : 'cover';
  if (!src) return <div {...attrs} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--app-text) 6%, transparent)', minHeight: 120, ...attrs.style }}><Icon name="image" size={28} style={{ color: 'var(--app-muted)' }} /></div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...attrs} className={`sai-media ${attrs.className}`} src={src} alt={String(p('alt') ?? '')} style={{ objectFit: fit as 'cover', ...attrs.style, cursor: node.events?.onClick?.length ? 'pointer' : undefined }} onClick={() => fire('onClick')} draggable={attrs.draggable ?? false} loading="lazy" referrerPolicy="no-referrer" />;
};

const IconR: Renderer = ({ node, p, attrs, fire }) => {
  const size = Number(p('size')) || 24;
  return <span {...attrs} onClick={() => fire('onClick')} style={{ display: 'inline-flex', width: 'fit-content', cursor: node.events?.onClick?.length ? 'pointer' : undefined, ...attrs.style }}><Icon name={String(p('icon') || 'sparkles')} size={size} /></span>;
};

const Avatar: Renderer = ({ p, attrs }) => {
  const size = Number(p('size')) || 48;
  const src = safeUrl(p('src'));
  const name = String(p('name') ?? '');
  const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('');
  // eslint-disable-next-line @next/next/no-img-element
  return <span {...attrs} className={`sai-avatar ${attrs.className}`} style={{ width: size, height: size, fontSize: size * 0.38, ...attrs.style }} title={name}>{src ? <img src={src} alt={name} referrerPolicy="no-referrer" /> : ini || '?'}</span>;
};

const Video: Renderer = ({ p, attrs, rt }) => {
  const url = String(p('url') ?? '');
  const v = videoSrc(url);
  const autoplay = rt.bool(p('autoplay'));
  if (!v) return <div {...attrs} className={`sai-muted ${attrs.className}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--app-text) 6%, transparent)', ...attrs.style }}>Paste a YouTube, Vimeo or https MP4 link</div>;
  if (v.kind === 'video') return <video {...attrs} className={`sai-media ${attrs.className}`} src={v.src} controls autoPlay={autoplay} muted={autoplay} loop={autoplay} playsInline style={{ objectFit: 'cover', ...attrs.style }} />;
  return <iframe {...attrs} className={`sai-media ${attrs.className}`} src={`${v.src}${autoplay ? '?autoplay=1&mute=1' : ''}`} title="Video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups" referrerPolicy="strict-origin-when-cross-origin" />;
};

const Embed: Renderer = ({ p, attrs }) => {
  const url = String(p('url') ?? '');
  if (!/^https:\/\//i.test(url)) return <div {...attrs} className={`sai-muted ${attrs.className}`}>Enter an https:// URL to embed</div>;
  return <iframe {...attrs} className={`sai-media ${attrs.className}`} src={url} title="Embedded content" style={{ height: Number(p('height')) || 400, ...attrs.style }} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" loading="lazy" />;
};

const RENDERERS: Record<string, Renderer> = {
  page: Page, container: Container, grid: Grid, card: Card, tabs: Tabs, modal: ModalInline, list: List, form: Form, divider: Divider, spacer: Spacer,
  heading: Heading, text: Text, markdown: MarkdownR, button: Button, link: Link, navbar: Navbar,
  input: Input, textarea: TextArea, select: SelectR, radio: Radio, checkbox: Checkbox, switch: SwitchR, date: DateR, slider: Slider, rating: Rating, color: ColorR,
  table: Table, chart: ChartR, stat: Stat, progress: Progress, badge: Badge, alert: Alert,
  image: ImageR, icon: IconR, avatar: Avatar, video: Video, embed: Embed,
};

// ── Modals (live) ─────────────────────────────────────────

function ModalLayer({ node }: { node: UINode }) {
  const rt = useRuntime();
  const close = () => {
    rt.store.setState((s) => ({ modals: { ...s.modals, [node.name]: false } }));
    void rt.runActions(node.events?.onClose);
  };
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { breakpoint } = useView();
  const style = computeStyle(rt, node, breakpoint);
  return (
    <div className="sai-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && rt.bool(node.props.closeOnBackdrop, undefined, true) && close()}>
      <div className="sai-modal" role="dialog" aria-modal="true" style={{ maxWidth: Number(rt.evaluate(node.props.width)) || 520 }}>
        <div className="sai-modal-head"><h3>{String(rt.evaluate(node.props.title) ?? '')}</h3><button type="button" className="sai-icon-btn" onClick={close} aria-label="Close"><Icon name="x" size={18} /></button></div>
        <div className={`sai-box sai-n-${cssId(node.id)}`} style={style}>{(node.children ?? []).map((c) => <RenderNode key={c.id} node={c} />)}</div>
      </div>
    </div>
  );
}

// ── App view ──────────────────────────────────────────────

const loadedFonts = new Set<string>();
export function useFonts(fonts: string[]) {
  React.useEffect(() => {
    for (const f of fonts) {
      if (!f || f === 'system-ui' || loadedFonts.has(f) || !/^[\w\s-]{1,64}$/.test(f)) continue;
      loadedFonts.add(f);
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@300;400;500;600;700;800&display=swap`;
      document.head.appendChild(link);
    }
  }, [fonts.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function themeVars(theme: AppDefinition['theme']): React.CSSProperties {
  return {
    '--app-primary': theme.primary, '--app-accent': theme.accent, '--app-bg': theme.background, '--app-surface': theme.surface, '--app-text': theme.text,
    '--app-muted': theme.mutedText, '--app-border': theme.border, '--app-radius': `${theme.radius}px`, '--app-font': `'${theme.font}'`, '--app-heading-font': `'${theme.headingFont}'`,
    colorScheme: theme.mode,
  } as React.CSSProperties;
}

export function AppView({ runtime, breakpoint, className, fill = true }: { runtime: AppRuntime; breakpoint: Breakpoint; className?: string; fill?: boolean }) {
  const state = useStore(runtime);
  const def = runtime.def;
  useFonts([def.theme.font, def.theme.headingFont, ...(def.settings.customFonts ?? [])]);
  const page = def.pages.find((pg) => pg.id === state.pageId) ?? def.pages[0]!;
  const edit = runtime.mode === 'edit';
  const hoverCss = React.useMemo(() => {
    const rules: string[] = [];
    walkNodes(page.root, (n) => {
      if (n.hoverStyle && Object.keys(n.hoverStyle).length) {
        const css = toCss(sanitizeStyle(n.hoverStyle), true);
        if (css) rules.push(`.sai-n-${cssId(n.id)}:hover{${css}}`);
      }
    });
    return rules.join('\n');
  }, [page]);
  const modals: UINode[] = [];
  if (!edit) walkNodes(page.root, (n) => { if (n.type === 'modal' && state.modals[n.name]) modals.push(n); });
  const maxWidth = def.settings.maxWidth > 0 ? def.settings.maxWidth : undefined;
  const content = <div style={{ maxWidth, margin: '0 auto', width: '100%', minHeight: fill ? '100%' : undefined, display: 'flex', flexDirection: 'column' }}><RenderNode node={page.root} /></div>;
  const nav = def.settings.navigation;
  const brand = <div className="sai-brand">{appName(runtime)}</div>;
  return (
    <RuntimeContextBridge runtime={runtime}>
      <ViewContext.Provider value={{ breakpoint }}>
        <div className={`sai-app ${edit ? 'sai-edit' : ''} ${className ?? ''}`} style={{ ...themeVars(def.theme), height: fill ? '100%' : undefined }}>
          <style>{RUNTIME_CSS}</style>
          {hoverCss ? <style>{hoverCss}</style> : null}
          {nav === 'top' ? (
            <>
              <nav className="sai-navbar sticky" style={{ padding: '12px 24px' }}>{brand}<NavLinks rt={runtime} mode={runtime.mode} /></nav>
              {content}
            </>
          ) : nav === 'side' && breakpoint !== 'mobile' ? (
            <div className="sai-shell-side">
              <aside className="sai-sidenav">{brand}<NavLinks rt={runtime} mode={runtime.mode} vertical /></aside>
              <div className="sai-shell-main">{content}</div>
            </div>
          ) : nav === 'side' ? (
            <>
              <nav className="sai-navbar" style={{ padding: '12px 16px' }}>{brand}<NavLinks rt={runtime} mode={runtime.mode} /></nav>
              {content}
            </>
          ) : content}
          {modals.map((m) => <ModalLayer key={m.id} node={m} />)}
        </div>
      </ViewContext.Provider>
    </RuntimeContextBridge>
  );
}

function appName(rt: AppRuntime): string {
  const s = rt.scope();
  return String((s.app as { name?: string })?.name ?? '');
}

function useStore(rt: AppRuntime) {
  return React.useSyncExternalStore(rt.store.subscribe, rt.store.getState, rt.store.getState);
}

function RuntimeContextBridge({ runtime, children }: { runtime: AppRuntime; children: React.ReactNode }) {
  return <RuntimeProvider value={runtime}>{children}</RuntimeProvider>;
}
