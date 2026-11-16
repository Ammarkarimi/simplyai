'use client';
/** Visual style editor: layout, size, spacing, typography, background, border, effects, position, motion and custom CSS. */
import * as React from 'react';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDown, ArrowRight, Monitor, MousePointer2, Plus, Smartphone, Tablet, Trash2 } from 'lucide-react';
import { ALLOWED_STYLE_PROPS, FONT_OPTIONS, type UINode, type UIStyle } from '@simplyai/shared';
import { Input, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ColorField, Row, Section } from './fields';
import { isContainerType, useBuilder, type StyleTarget } from './store';

interface Ctx {
  node: UINode;
  target: StyleTarget;
  get(prop: string): string;
  inherited(prop: string): string;
  set(prop: string, value: string | number | undefined): void;
  setMany(patch: Record<string, string | number | undefined>): void;
}
const StyleCtx = React.createContext<Ctx | null>(null);
const useStyle = () => React.useContext(StyleCtx)!;

function SI({ prop, label, placeholder, className }: { prop: string; label?: string; placeholder?: string; className?: string }) {
  const s = useStyle();
  return (
    <label className={cn('flex min-w-0 items-center gap-1 rounded-md border bg-background pl-2 focus-within:ring-1 focus-within:ring-primary', className)}>
      {label ? <span className="shrink-0 text-[10.5px] font-medium text-muted-foreground">{label}</span> : null}
      <input className="h-7 w-full min-w-0 bg-transparent px-1 text-xs outline-none" value={s.get(prop)} placeholder={s.inherited(prop) || placeholder || 'auto'} onChange={(e) => s.set(prop, e.target.value)} />
    </label>
  );
}

function Seg({ prop, options }: { prop: string; options: Array<{ value: string; label: React.ReactNode; title?: string }> }) {
  const s = useStyle();
  const cur = s.get(prop) || s.inherited(prop);
  return (
    <div className="flex rounded-md border bg-muted/40 p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" title={o.title ?? o.value} onClick={() => s.set(prop, cur === o.value ? undefined : o.value)} className={cn('flex h-6 flex-1 items-center justify-center rounded text-[11px]', cur === o.value ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SSelect({ prop, options, placeholder = 'Default' }: { prop: string; options: Array<string | { label: string; value: string }>; placeholder?: string }) {
  const s = useStyle();
  return (
    <Select className="h-7 text-xs" value={s.get(prop)} onChange={(e) => s.set(prop, e.target.value || undefined)}>
      <option value="">{s.inherited(prop) ? `${placeholder} (${s.inherited(prop)})` : placeholder}</option>
      {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
    </Select>
  );
}

function SColor({ prop }: { prop: string }) {
  const s = useStyle();
  return <ColorField value={s.get(prop)} placeholder={s.inherited(prop) || 'inherit'} onChange={(v) => s.set(prop, v)} />;
}

function Chips({ prop, values }: { prop: string; values: string[] }) {
  const s = useStyle();
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((v) => <button key={v} type="button" onClick={() => s.set(prop, v)} className={cn('rounded border px-1.5 py-0.5 text-[10.5px] hover:border-primary hover:text-primary', s.get(prop) === v && 'border-primary bg-primary/10 text-primary')}>{v}</button>)}
    </div>
  );
}

/** Four-sided shorthand (padding, margin) edited per side. */
function BoxSides({ prop, label }: { prop: 'padding' | 'margin'; label: string }) {
  const s = useStyle();
  const raw = s.get(prop) || '';
  const parts = raw.trim() ? raw.trim().split(/\s+/) : [];
  const sides = parts.length === 1 ? [parts[0], parts[0], parts[0], parts[0]] : parts.length === 2 ? [parts[0], parts[1], parts[0], parts[1]] : parts.length === 3 ? [parts[0], parts[1], parts[2], parts[1]] : [parts[0], parts[1], parts[2], parts[3]];
  const setSide = (i: number, v: string) => {
    const next = sides.map((x, j) => (j === i ? v : x || '0'));
    const norm = next.map((x) => (/^\d+(\.\d+)?$/.test(x || '') ? `${x}px` : x || '0'));
    s.set(prop, norm.every((x) => x === norm[0]) ? norm[0] : norm.join(' '));
  };
  return (
    <Row label={label}>
      <div className="grid grid-cols-[1fr_auto] items-start gap-2">
        <div className="relative grid grid-cols-3 grid-rows-3 gap-1 rounded-md border border-dashed p-1">
          {[['T', 0, 'col-start-2 row-start-1'], ['L', 3, 'col-start-1 row-start-2'], ['R', 1, 'col-start-3 row-start-2'], ['B', 2, 'col-start-2 row-start-3']].map(([l, i, pos]) => (
            <input key={String(l)} className={cn('h-6 w-full min-w-0 rounded border bg-background text-center text-[11px] outline-none focus:ring-1 focus:ring-primary', String(pos))} placeholder={String(l)} value={sides[Number(i)] ?? ''} onChange={(e) => setSide(Number(i), e.target.value)} />
          ))}
          <span className="col-start-2 row-start-2 flex items-center justify-center text-[9px] uppercase text-muted-foreground">{prop}</span>
        </div>
        <div className="w-20 space-y-1">
          <SI prop={prop} placeholder="all" />
          <Chips prop={prop} values={['0', '8px', '16px', '24px']} />
        </div>
      </div>
    </Row>
  );
}

const SHADOWS: Array<[string, string]> = [
  ['None', 'none'],
  ['Soft', '0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.04)'],
  ['Medium', '0 10px 24px -8px rgba(0,0,0,.18)'],
  ['Large', '0 24px 48px -16px rgba(0,0,0,.28)'],
  ['Float', '0 40px 80px -24px rgba(0,0,0,.45)'],
  ['Glow', '0 0 0 1px color-mix(in srgb, var(--app-primary) 40%, transparent), 0 12px 40px -6px var(--app-primary)'],
  ['Neon', '0 0 8px var(--app-accent), 0 0 24px var(--app-accent), 0 0 48px color-mix(in srgb, var(--app-accent) 60%, transparent)'],
  ['Inset', 'inset 0 2px 6px rgba(0,0,0,.15)'],
  ['Brutal', '6px 6px 0 0 var(--app-text)'],
];

const GRADIENTS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
  'linear-gradient(120deg, #f6d365 0%, #fda085 100%)',
  'conic-gradient(from 180deg at 50% 50%, #7c3aed, #ec4899, #f59e0b, #22d3ee, #7c3aed)',
  'radial-gradient(circle at 20% 20%, #a78bfa 0%, transparent 40%), radial-gradient(circle at 80% 0%, #f472b6 0%, transparent 40%), #0b0b14',
  'linear-gradient(135deg, var(--app-primary), var(--app-accent))',
  'linear-gradient(180deg, rgba(255,255,255,.14), rgba(255,255,255,.04))',
  'repeating-linear-gradient(45deg, #fafafa 0 10px, #f4f4f5 10px 20px)',
];

function GradientBuilder() {
  const s = useStyle();
  const [from, setFrom] = React.useState('#7c3aed');
  const [to, setTo] = React.useState('#ec4899');
  const [angle, setAngle] = React.useState(135);
  const [kind, setKind] = React.useState<'linear' | 'radial'>('linear');
  const apply = (f = from, t = to, a = angle, k = kind) => s.set('background', k === 'linear' ? `linear-gradient(${a}deg, ${f} 0%, ${t} 100%)` : `radial-gradient(circle at center, ${f} 0%, ${t} 100%)`);
  return (
    <div className="space-y-2 rounded-md border p-2">
      <div className="grid grid-cols-6 gap-1">
        {GRADIENTS.map((g) => <button key={g} type="button" title={g} onClick={() => s.set('background', g)} className="h-6 rounded border" style={{ background: g.replace(/var\(--app-primary\)/g, '#7c3aed').replace(/var\(--app-accent\)/g, '#ec4899') }} />)}
      </div>
      <div className="flex items-center gap-1.5">
        <input type="color" value={from} onChange={(e) => { setFrom(e.target.value); apply(e.target.value); }} className="h-7 w-9 cursor-pointer rounded border bg-transparent p-0.5" />
        <input type="color" value={to} onChange={(e) => { setTo(e.target.value); apply(from, e.target.value); }} className="h-7 w-9 cursor-pointer rounded border bg-transparent p-0.5" />
        <Select className="h-7 flex-1 text-xs" value={kind} onChange={(e) => { const k = e.target.value as 'linear'; setKind(k); apply(from, to, angle, k); }}><option value="linear">Linear</option><option value="radial">Radial</option></Select>
      </div>
      {kind === 'linear' ? <label className="flex items-center gap-2 text-[11px] text-muted-foreground">Angle<input type="range" min={0} max={360} value={angle} onChange={(e) => { setAngle(Number(e.target.value)); apply(from, to, Number(e.target.value)); }} className="flex-1 accent-primary" />{angle}°</label> : null}
    </div>
  );
}

function Transform() {
  const s = useStyle();
  const raw = s.get('transform');
  const read = (fn: string, d: number) => {
    const m = raw.match(new RegExp(`${fn}\\((-?[\\d.]+)`));
    return m ? Number(m[1]) : d;
  };
  const write = (patch: Record<string, number>) => {
    const v = { rotate: read('rotate', 0), scale: read('scale', 1), translateX: read('translateX', 0), translateY: read('translateY', 0), skewX: read('skewX', 0), ...patch };
    const parts = [v.rotate ? `rotate(${v.rotate}deg)` : '', v.scale !== 1 ? `scale(${v.scale})` : '', v.translateX ? `translateX(${v.translateX}px)` : '', v.translateY ? `translateY(${v.translateY}px)` : '', v.skewX ? `skewX(${v.skewX}deg)` : ''].filter(Boolean);
    s.set('transform', parts.join(' ') || undefined);
  };
  const slider = (label: string, fn: string, min: number, max: number, step: number, d: number, unit: string) => (
    <label className="grid grid-cols-[64px_1fr_44px] items-center gap-2 text-[11px] text-muted-foreground">
      {label}
      <input type="range" min={min} max={max} step={step} value={read(fn, d)} onChange={(e) => write({ [fn]: Number(e.target.value) })} className="accent-primary" />
      <span className="text-right tabular-nums">{read(fn, d)}{unit}</span>
    </label>
  );
  return (
    <div className="space-y-1.5">
      {slider('Rotate', 'rotate', -180, 180, 1, 0, '°')}
      {slider('Scale', 'scale', 0.5, 1.5, 0.01, 1, '')}
      {slider('Move X', 'translateX', -100, 100, 1, 0, 'px')}
      {slider('Move Y', 'translateY', -100, 100, 1, 0, 'px')}
      {slider('Skew', 'skewX', -30, 30, 1, 0, '°')}
    </div>
  );
}

function Slider({ prop, min, max, step, unit = '', fmt }: { prop: string; min: number; max: number; step: number; unit?: string; fmt?: (n: number) => string }) {
  const s = useStyle();
  const raw = s.get(prop) || s.inherited(prop);
  const num = parseFloat(raw.replace(/^blur\(/, '')) || (prop === 'opacity' && !raw ? 1 : 0);
  return (
    <div className="flex items-center gap-2">
      <input type="range" min={min} max={max} step={step} value={num} onChange={(e) => s.set(prop, fmt ? fmt(Number(e.target.value)) : `${e.target.value}${unit}`)} className="flex-1 accent-primary" />
      <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">{num}{unit}</span>
    </div>
  );
}

function CustomCss() {
  const s = useStyle();
  const style = (s.node[s.target] ?? {}) as UIStyle;
  const [k, setK] = React.useState('');
  const [v, setV] = React.useState('');
  const entries = Object.entries(style);
  return (
    <div className="space-y-1.5">
      {entries.map(([key, val]) => (
        <div key={key} className="flex items-center gap-1">
          <code className="w-28 truncate text-[10.5px] text-muted-foreground" title={key}>{key}</code>
          <Input className="h-7 flex-1 font-mono text-[11px]" value={String(val)} onChange={(e) => s.set(key, e.target.value)} />
          <button type="button" className="rounded p-1 text-muted-foreground hover:text-destructive" onClick={() => s.set(key, undefined)}><Trash2 className="h-3 w-3" /></button>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <Input className="h-7 w-28 font-mono text-[11px]" list="sai-css-props" placeholder="property" value={k} onChange={(e) => setK(e.target.value)} />
        <Input className="h-7 flex-1 font-mono text-[11px]" placeholder="value" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && k && ALLOWED_STYLE_PROPS.has(k)) { s.set(k, v); setK(''); setV(''); } }} />
        <button type="button" disabled={!k || !ALLOWED_STYLE_PROPS.has(k)} className="rounded p-1 text-primary disabled:opacity-30" onClick={() => { s.set(k, v); setK(''); setV(''); }}><Plus className="h-3.5 w-3.5" /></button>
      </div>
      <datalist id="sai-css-props">{[...ALLOWED_STYLE_PROPS].map((p) => <option key={p} value={p} />)}</datalist>
      <p className="text-[10.5px] text-muted-foreground">camelCase CSS properties. Values may use {'{{ expressions }}'} and theme variables like var(--app-primary).</p>
    </div>
  );
}

function Motion() {
  const s = useStyle();
  const a = s.node.animation ?? { type: 'none' as const };
  const update = useBuilder.getState().updateNode;
  const set = (patch: Partial<NonNullable<UINode['animation']>>) => update(s.node.id, (n) => { n.animation = { ...(n.animation ?? { type: 'none' }), ...patch } as UINode['animation']; if (n.animation?.type === 'none') delete n.animation; }, 'animation');
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-1">
        {['none', 'fade', 'slideUp', 'slideDown', 'slideLeft', 'slideRight', 'zoom', 'bounce', 'pulse', 'float', 'spin', 'shake'].map((t) => (
          <button key={t} type="button" onClick={() => set({ type: t as 'fade' })} className={cn('rounded border px-1 py-1 text-[10.5px]', a.type === t ? 'border-primary bg-primary/10 font-medium text-primary' : 'hover:border-primary/50')}>{t}</button>
        ))}
      </div>
      {a.type !== 'none' ? (
        <div className="grid grid-cols-2 gap-2">
          <Row label="Duration (ms)"><Input className="h-7 text-xs" type="number" value={a.durationMs ?? 600} onChange={(e) => set({ durationMs: Number(e.target.value) })} /></Row>
          <Row label="Delay (ms)"><Input className="h-7 text-xs" type="number" value={a.delayMs ?? 0} onChange={(e) => set({ delayMs: Number(e.target.value) })} /></Row>
          <label className="col-span-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={!!a.loop} onChange={(e) => set({ loop: e.target.checked })} className="accent-primary" />Repeat forever</label>
        </div>
      ) : null}
      <p className="text-[10.5px] text-muted-foreground">Entrance animations play when the component appears. Use the Hover state above for hover effects.</p>
    </div>
  );
}

const TARGETS: Array<{ value: StyleTarget; label: string; icon: React.ReactNode }> = [
  { value: 'style', label: 'Default', icon: <Monitor className="h-3 w-3" /> },
  { value: 'hoverStyle', label: 'Hover', icon: <MousePointer2 className="h-3 w-3" /> },
  { value: 'tabletStyle', label: 'Tablet', icon: <Tablet className="h-3 w-3" /> },
  { value: 'mobileStyle', label: 'Mobile', icon: <Smartphone className="h-3 w-3" /> },
];

export function StylePanel({ node }: { node: UINode }) {
  const target = useBuilder((s) => s.styleTarget);
  const update = useBuilder.getState().updateNode;
  const ctx: Ctx = {
    node,
    target,
    get: (prop) => {
      const v = (node[target] as UIStyle | undefined)?.[prop];
      return v === undefined ? '' : String(v);
    },
    inherited: (prop) => {
      if (target === 'style') return '';
      const chain: StyleTarget[] = target === 'mobileStyle' ? ['tabletStyle', 'style'] : ['style'];
      for (const t of chain) {
        const v = (node[t] as UIStyle | undefined)?.[prop];
        if (v !== undefined && v !== '') return String(v);
      }
      return '';
    },
    set: (prop, value) => ctx.setMany({ [prop]: value }),
    setMany: (patch) => update(node.id, (n) => {
      const st = { ...((n[target] as UIStyle | undefined) ?? {}) };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === '') delete st[k];
        else st[k] = v;
      }
      if (Object.keys(st).length) (n as unknown as Record<string, unknown>)[target] = st;
      else delete n[target];
    }, `style:${target}:${Object.keys(patch).join(',')}`),
  };
  const container = isContainerType(node.type);
  const display = ctx.get('display') || ctx.inherited('display') || (container && node.type !== 'grid' ? 'flex' : '');
  return (
    <StyleCtx.Provider value={ctx}>
      <div className="sticky top-0 z-10 border-b bg-card px-3 py-2">
        <div className="grid grid-cols-4 gap-1 rounded-md bg-muted/50 p-0.5">
          {TARGETS.map((t) => {
            const has = node[t.value] && Object.keys(node[t.value]!).length > 0;
            return (
              <button key={t.value} type="button" onClick={() => useBuilder.getState().set({ styleTarget: t.value, ...(t.value === 'tabletStyle' ? { breakpoint: 'tablet' } : t.value === 'mobileStyle' ? { breakpoint: 'mobile' } : t.value === 'style' ? { breakpoint: 'desktop' } : {}) })} className={cn('relative flex items-center justify-center gap-1 rounded py-1 text-[10.5px]', target === t.value ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                {t.icon}{t.label}
                {has ? <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-primary" /> : null}
              </button>
            );
          })}
        </div>
        {target !== 'style' ? <p className="mt-1.5 text-[10.5px] text-muted-foreground">{target === 'hoverStyle' ? 'Applied while the pointer is over the component.' : `Overrides for ${target === 'tabletStyle' ? 'tablets and phones' : 'phones'}; empty fields inherit.`}</p> : null}
      </div>

      <Section title="Layout">
        {container || display ? (
          <>
            <Seg prop="display" options={[{ value: 'flex', label: 'Flex' }, { value: 'grid', label: 'Grid' }, { value: 'block', label: 'Block' }, { value: 'none', label: 'Hidden' }]} />
            {display === 'flex' || (container && !display) ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Row label="Direction"><Seg prop="flexDirection" options={[{ value: 'column', label: <ArrowDown className="h-3 w-3" />, title: 'Vertical' }, { value: 'row', label: <ArrowRight className="h-3 w-3" />, title: 'Horizontal' }]} /></Row>
                  <Row label="Wrap"><Seg prop="flexWrap" options={[{ value: 'nowrap', label: 'No' }, { value: 'wrap', label: 'Yes' }]} /></Row>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Row label="Justify"><SSelect prop="justifyContent" options={['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly']} /></Row>
                  <Row label="Align"><SSelect prop="alignItems" options={['stretch', 'flex-start', 'center', 'flex-end', 'baseline']} /></Row>
                </div>
              </>
            ) : null}
            {display === 'grid' || node.type === 'grid' ? <Row label="Columns template" hint="e.g. 2fr 1fr or repeat(auto-fill, minmax(220px, 1fr))"><SI prop="gridTemplateColumns" /></Row> : null}
            <div className="grid grid-cols-2 gap-2"><SI prop="gap" label="Gap" /><SI prop="rowGap" label="Row" /></div>
          </>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <Row label="Align self"><SSelect prop="alignSelf" options={['auto', 'stretch', 'flex-start', 'center', 'flex-end']} /></Row>
          <Row label="Grow / span"><SI prop="flex" placeholder="e.g. 1" /></Row>
        </div>
        {node.type !== 'page' ? <Row label="Grid span (inside a grid)"><Chips prop="gridColumn" values={['auto', 'span 2', 'span 3', '1 / -1']} /></Row> : null}
      </Section>

      <Section title="Size">
        <div className="grid grid-cols-2 gap-2">
          <SI prop="width" label="W" /><SI prop="height" label="H" />
          <SI prop="minWidth" label="Min W" /><SI prop="minHeight" label="Min H" />
          <SI prop="maxWidth" label="Max W" /><SI prop="maxHeight" label="Max H" />
        </div>
        <Chips prop="width" values={['auto', '100%', 'fit-content', '50%', '320px']} />
        <Row label="Aspect ratio"><Chips prop="aspectRatio" values={['1 / 1', '4 / 3', '16 / 9', '3 / 4']} /></Row>
      </Section>

      <Section title="Spacing">
        <BoxSides prop="padding" label="Padding" />
        <BoxSides prop="margin" label="Margin" />
        <Chips prop="margin" values={['0 auto']} />
      </Section>

      <Section title="Typography">
        <Row label="Font">
          <SSelect prop="fontFamily" placeholder="Theme font" options={[{ label: 'Heading font', value: 'var(--app-heading-font)' }, ...FONT_OPTIONS.map((f) => ({ label: f, value: `'${f}'` }))]} />
        </Row>
        <div className="grid grid-cols-2 gap-2">
          <SI prop="fontSize" label="Size" />
          <SSelect prop="fontWeight" placeholder="Weight" options={['300', '400', '500', '600', '700', '800', '900']} />
          <SI prop="lineHeight" label="Line" />
          <SI prop="letterSpacing" label="Spacing" />
        </div>
        <Chips prop="fontSize" values={['12px', '14px', '16px', '20px', '28px', '40px', '64px']} />
        <Seg prop="textAlign" options={[{ value: 'left', label: <AlignLeft className="h-3 w-3" /> }, { value: 'center', label: <AlignCenter className="h-3 w-3" /> }, { value: 'right', label: <AlignRight className="h-3 w-3" /> }, { value: 'justify', label: <AlignJustify className="h-3 w-3" /> }]} />
        <div className="grid grid-cols-2 gap-2">
          <SSelect prop="textTransform" placeholder="Case" options={['none', 'uppercase', 'lowercase', 'capitalize']} />
          <SSelect prop="textDecoration" placeholder="Decoration" options={['none', 'underline', 'line-through', 'overline']} />
        </div>
        <Row label="Color"><SColor prop="color" /></Row>
        <Row label="Text effect">
          <div className="flex flex-wrap gap-1">
            {[['None', undefined], ['Soft', '0 2px 8px rgba(0,0,0,.25)'], ['Glow', '0 0 12px var(--app-primary)'], ['Neon', '0 0 4px #fff, 0 0 12px var(--app-accent), 0 0 32px var(--app-accent)'], ['3D', '2px 2px 0 var(--app-accent), 4px 4px 0 var(--app-primary)']].map(([l, v]) => (
              <button key={String(l)} type="button" onClick={() => ctx.set('textShadow', v)} className="rounded border px-1.5 py-0.5 text-[10.5px] hover:border-primary hover:text-primary">{l}</button>
            ))}
            <button type="button" onClick={() => ctx.setMany({ background: ctx.get('background') || 'linear-gradient(90deg, var(--app-primary), var(--app-accent))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' })} className="rounded border px-1.5 py-0.5 text-[10.5px] hover:border-primary hover:text-primary">Gradient text</button>
            <button type="button" onClick={() => ctx.setMany({ WebkitBackgroundClip: undefined, WebkitTextFillColor: undefined })} className="rounded border px-1.5 py-0.5 text-[10.5px] text-muted-foreground hover:text-foreground">Clear</button>
          </div>
        </Row>
      </Section>

      <Section title="Background">
        <Row label="Color"><SColor prop="backgroundColor" /></Row>
        <Row label="Gradient / fill" hint="Any CSS background; overrides the color"><SI prop="background" placeholder="none" /></Row>
        <GradientBuilder />
        <Row label="Image URL">
          <Input className="h-7 text-xs" placeholder="https://…" value={(ctx.get('backgroundImage').match(/url\(["']?(.*?)["']?\)/) ?? [])[1] ?? ''} onChange={(e) => ctx.setMany({ backgroundImage: e.target.value ? `url("${e.target.value}")` : undefined, backgroundSize: e.target.value ? ctx.get('backgroundSize') || 'cover' : undefined, backgroundPosition: e.target.value ? ctx.get('backgroundPosition') || 'center' : undefined })} />
        </Row>
        <div className="grid grid-cols-2 gap-2">
          <SSelect prop="backgroundSize" placeholder="Size" options={['cover', 'contain', 'auto', '200% 200%']} />
          <SSelect prop="backgroundAttachment" placeholder="Scroll" options={['scroll', 'fixed']} />
        </div>
      </Section>

      <Section title="Border" defaultOpen={false}>
        <div className="grid grid-cols-3 gap-2">
          <SI prop="borderWidth" label="W" />
          <SSelect prop="borderStyle" placeholder="Style" options={['solid', 'dashed', 'dotted', 'double', 'none']} />
          <SI prop="borderRadius" label="R" />
        </div>
        <Chips prop="borderRadius" values={['0', '6px', '12px', '20px', '32px', '999px', 'var(--app-radius)']} />
        <Row label="Color"><SColor prop="borderColor" /></Row>
        <Row label="Outline"><SI prop="outline" placeholder="2px solid var(--app-primary)" /></Row>
      </Section>

      <Section title="Effects" defaultOpen={false}>
        <Row label="Shadow">
          <div className="grid grid-cols-3 gap-1">
            {SHADOWS.map(([l, v]) => <button key={l} type="button" onClick={() => ctx.set('boxShadow', v === 'none' ? undefined : v)} className={cn('rounded border px-1 py-1 text-[10.5px] hover:border-primary', ctx.get('boxShadow') === v && 'border-primary bg-primary/10 text-primary')}>{l}</button>)}
          </div>
        </Row>
        <SI prop="boxShadow" label="Custom" placeholder="none" />
        <Row label="Opacity"><Slider prop="opacity" min={0} max={1} step={0.05} fmt={(n) => String(n)} /></Row>
        <Row label="Blur"><Slider prop="filter" min={0} max={20} step={1} unit="px" fmt={(n) => (n ? `blur(${n}px)` : '')} /></Row>
        <Row label="Glass (backdrop blur)" hint="Combine with a semi-transparent background">
          <Chips prop="backdropFilter" values={['blur(6px)', 'blur(12px)', 'blur(20px) saturate(160%)']} />
        </Row>
        <Row label="Transform"><Transform /></Row>
        <div className="grid grid-cols-2 gap-2">
          <Row label="Transition"><SSelect prop="transition" placeholder="None" options={[{ label: 'Smooth', value: 'all .2s ease' }, { label: 'Slow', value: 'all .5s ease' }, { label: 'Bouncy', value: 'all .45s cubic-bezier(.34,1.56,.64,1)' }]} /></Row>
          <Row label="Cursor"><SSelect prop="cursor" options={['pointer', 'default', 'grab', 'text', 'not-allowed']} /></Row>
          <Row label="Overflow"><SSelect prop="overflow" options={['visible', 'hidden', 'auto', 'clip']} /></Row>
          <Row label="Blend"><SSelect prop="mixBlendMode" options={['normal', 'multiply', 'screen', 'overlay', 'difference', 'luminosity']} /></Row>
        </div>
        <Row label="Clip shape"><Chips prop="clipPath" values={['circle(50%)', 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)', 'polygon(0 0, 100% 0, 100% 85%, 0 100%)']} /></Row>
      </Section>

      <Section title="Position" defaultOpen={false}>
        <Seg prop="position" options={[{ value: 'static', label: 'Static' }, { value: 'relative', label: 'Relative' }, { value: 'absolute', label: 'Absolute' }, { value: 'sticky', label: 'Sticky' }]} />
        <div className="grid grid-cols-2 gap-2"><SI prop="top" label="T" /><SI prop="right" label="R" /><SI prop="bottom" label="B" /><SI prop="left" label="L" /></div>
        <SI prop="zIndex" label="Z-index" />
      </Section>

      <Section title="Motion" defaultOpen={false}>
        <Motion />
      </Section>

      <Section title="Custom CSS" defaultOpen={false}>
        <CustomCss />
      </Section>
    </StyleCtx.Provider>
  );
}
