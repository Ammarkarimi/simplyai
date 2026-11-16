'use client';
/** Theme and app-wide settings. */
import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { FONT_OPTIONS, THEME_PRESETS, type AppTheme } from '@simplyai/shared';
import { Input, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ColorField, Row, Section } from './fields';
import { useBuilder } from './store';

const COLOR_KEYS: Array<[keyof AppTheme, string]> = [
  ['primary', 'Primary'], ['accent', 'Accent'], ['background', 'Page background'], ['surface', 'Surface (cards, inputs)'], ['text', 'Text'], ['mutedText', 'Muted text'], ['border', 'Borders'],
];

export function ThemePanel() {
  const def = useBuilder((s) => s.def)!;
  const change = useBuilder.getState().change;
  const t = def.theme;
  const setTheme = (patch: Partial<AppTheme>, key?: string) => change((d) => { Object.assign(d.theme, patch); }, key);
  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b p-3">
        <div className="text-xs font-semibold">Theme & app settings</div>
        <div className="text-[10.5px] text-muted-foreground">Colors and fonts are available everywhere as var(--app-primary), var(--app-font)…</div>
      </div>
      <Section title="Presets">
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(THEME_PRESETS).map(([key, p]) => (
            <button key={key} type="button" onClick={() => setTheme({ ...p })} className="group overflow-hidden rounded-lg border text-left transition hover:border-primary hover:shadow-md">
              <div className="flex h-12 items-end gap-1 p-2" style={{ background: p.background }}>
                <span className="h-5 w-5 rounded-full" style={{ background: p.primary }} />
                <span className="h-5 w-5 rounded-full" style={{ background: p.accent }} />
                <span className="ml-auto h-6 w-10 border" style={{ background: p.surface, borderColor: p.border, borderRadius: Math.min(p.radius, 10) }} />
              </div>
              <div className="flex items-center justify-between px-2 py-1 text-[11px] capitalize"><span style={{ fontFamily: p.headingFont }}>{key}</span>{p.mode === 'dark' ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}</div>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Colors">
        <div className="flex rounded-md border bg-muted/40 p-0.5">
          {(['light', 'dark'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setTheme({ mode: m })} className={cn('flex h-7 flex-1 items-center justify-center gap-1 rounded text-xs capitalize', t.mode === m ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground')}>
              {m === 'light' ? <Sun className="h-3 w-3" /> : <Moon className="h-3 w-3" />}{m}
            </button>
          ))}
        </div>
        {COLOR_KEYS.map(([k, label]) => <Row key={k} label={label}><ColorField value={t[k]} onChange={(v) => setTheme({ [k]: v } as Partial<AppTheme>, `theme:${k}`)} /></Row>)}
      </Section>
      <Section title="Typography & shape">
        <Row label="Body font"><Select className="h-8 text-xs" value={t.font} onChange={(e) => setTheme({ font: e.target.value })}>{FONT_OPTIONS.map((f) => <option key={f}>{f}</option>)}</Select></Row>
        <Row label="Heading font"><Select className="h-8 text-xs" value={t.headingFont} onChange={(e) => setTheme({ headingFont: e.target.value })}>{FONT_OPTIONS.map((f) => <option key={f}>{f}</option>)}</Select></Row>
        <Row label={`Corner radius · ${t.radius}px`}><input type="range" min={0} max={32} value={t.radius} onChange={(e) => setTheme({ radius: Number(e.target.value) }, 'theme:radius')} className="w-full accent-primary" /></Row>
      </Section>
      <Section title="Layout">
        <Row label="Navigation" hint="Automatic menu with links to every visible page">
          <div className="flex rounded-md border bg-muted/40 p-0.5">
            {(['none', 'top', 'side'] as const).map((n) => (
              <button key={n} type="button" onClick={() => change((d) => { d.settings.navigation = n; })} className={cn('h-7 flex-1 rounded text-xs capitalize', def.settings.navigation === n ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground')}>{n === 'none' ? 'None' : n === 'top' ? 'Top bar' : 'Sidebar'}</button>
            ))}
          </div>
        </Row>
        <Row label="Content max width (px)" hint="0 = full width"><Input className="h-8 text-xs" type="number" min={0} value={def.settings.maxWidth} onChange={(e) => change((d) => { d.settings.maxWidth = Math.max(0, Number(e.target.value) || 0); }, 'settings:maxWidth')} /></Row>
      </Section>
    </div>
  );
}
