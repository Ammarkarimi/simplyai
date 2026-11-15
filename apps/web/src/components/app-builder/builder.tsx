'use client';
/** The UI builder: top bar, panels, canvas, autosave, shortcuts, publishing and sharing. */
import * as React from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Check, CloudOff, ExternalLink, Eye, Globe, History, Loader2, Lock, Monitor, Palette, Pencil, Redo2, Rocket, Smartphone, Tablet, Undo2 } from 'lucide-react';
import type { AppDefinition, AppQuery, Breakpoint } from '@simplyai/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CopyField } from '@/components/ui/extras';
import { Field, Input, Select } from '@/components/ui/input';
import { Spinner, Tooltip } from '@/components/ui/misc';
import { api, patch, post } from '@/lib/api';
import { useWorkspace, useWsQuery } from '@/lib/hooks';
import { cn, timeAgo } from '@/lib/utils';
import { Canvas } from './canvas';
import { RuntimeRef } from './fields';
import { Inspector } from './inspector';
import { LeftPanel } from './left-panel';
import { AppRuntime } from './runtime';
import { locate, useBuilder } from './store';

export interface AppRecord {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  icon: string;
  color: string;
  access: 'PRIVATE' | 'PUBLIC';
  definition: AppDefinition;
  publishedAt: string | null;
  updatedAt: string;
  publishedVersion: { id: string; version: number; createdAt: string } | null;
}

export function builderTransport(appId: string) {
  return async (query: AppQuery, args: Record<string, unknown>) => post<{ data: unknown; meta?: Record<string, unknown> }>(`/apps/${appId}/queries/${encodeURIComponent(query.id)}/run`, { args, query });
}

type SaveState = 'saved' | 'saving' | 'dirty' | 'error';

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || !!t.closest('.cm-editor'));
}

export function AppBuilder({ appId }: { appId: string }) {
  const app = useWsQuery<AppRecord>(['app', appId], `/apps/${appId}`, undefined, { staleTime: Infinity });
  const { can } = useWorkspace();
  const def = useBuilder((s) => s.def);
  const revision = useBuilder((s) => s.revision);
  const [runtime, setRuntime] = React.useState<AppRuntime | null>(null);
  const [save, setSave] = React.useState<SaveState>('saved');
  const [meta, setMeta] = React.useState<AppRecord | null>(null);
  const savedRevision = React.useRef(0);
  const loadedFor = React.useRef<string | null>(null);

  // Load the app once
  React.useEffect(() => {
    if (!app.data || loadedFor.current === app.data.id) return;
    loadedFor.current = app.data.id;
    setMeta(app.data);
    useBuilder.getState().load(app.data.definition);
    savedRevision.current = 0;
    const rt = new AppRuntime({ def: app.data.definition, mode: 'edit', transport: builderTransport(app.data.id), app: { name: app.data.name, id: app.data.id } });
    setRuntime(rt);
    void rt.runOnLoad();
  }, [app.data]);

  // Keep the runtime in sync with edits
  React.useEffect(() => {
    if (runtime && def) runtime.updateDefinition(def);
  }, [def, runtime]);

  // Autosave
  React.useEffect(() => {
    if (!def || revision === savedRevision.current || !can('app:manage')) return;
    setSave('dirty');
    const rev = revision;
    const t = setTimeout(async () => {
      setSave('saving');
      try {
        await patch(`/apps/${appId}`, { definition: def });
        savedRevision.current = rev;
        setSave(useBuilder.getState().revision === rev ? 'saved' : 'dirty');
      } catch (e) {
        setSave('error');
        toast.error(`Could not save: ${(e as Error).message}`);
      }
    }, 900);
    return () => clearTimeout(t);
  }, [def, revision, appId, can]);

  // Warn before leaving with unsaved changes
  React.useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (useBuilder.getState().revision !== savedRevision.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, []);

  // Keyboard shortcuts
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useBuilder.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z' && !isTyping(e)) {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y' && !isTyping(e)) {
        e.preventDefault();
        s.redo();
        return;
      }
      if (isTyping(e) || s.preview) return;
      if (mod && e.key.toLowerCase() === 'c' && s.selectedId) {
        if (window.getSelection()?.toString()) return;
        s.copy(s.selectedId);
        toast.success('Component copied');
      } else if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        s.paste();
      } else if (mod && e.key.toLowerCase() === 'd' && s.selectedId) {
        e.preventDefault();
        s.duplicate(s.selectedId);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedId) {
        e.preventDefault();
        s.remove(s.selectedId);
      } else if (e.key === 'Escape' && s.selectedId && s.def) {
        const loc = locate(s.def, s.selectedId);
        s.select(loc?.parent && loc.parent.type !== 'page' ? loc.parent.id : null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (app.isLoading || !def || !runtime || !meta) {
    return <div className="flex h-screen items-center justify-center">{app.error ? <p className="text-sm text-muted-foreground">{(app.error as Error).message}</p> : <Spinner className="h-6 w-6" />}</div>;
  }

  return (
    <RuntimeRef.Provider value={runtime}>
      <div className="flex h-screen flex-col overflow-hidden bg-background">
        <TopBar app={meta} setApp={setMeta} save={save} />
        <div className="flex min-h-0 flex-1">
          <PreviewAware><div className="shrink-0 border-r bg-card"><LeftPanel /></div></PreviewAware>
          <Canvas runtime={runtime} />
          <PreviewAware>
            <div className="w-[320px] shrink-0 border-l bg-card"><Inspector /></div>
          </PreviewAware>
        </div>
      </div>
    </RuntimeRef.Provider>
  );
}

function PreviewAware({ children }: { children: React.ReactNode }) {
  const preview = useBuilder((s) => s.preview);
  return preview ? null : <>{children}</>;
}

const BPS: Array<{ key: Breakpoint; icon: React.ElementType; label: string }> = [
  { key: 'desktop', icon: Monitor, label: 'Desktop' },
  { key: 'tablet', icon: Tablet, label: 'Tablet (768px)' },
  { key: 'mobile', icon: Smartphone, label: 'Mobile (390px)' },
];

function TopBar({ app, setApp, save }: { app: AppRecord; setApp: (a: AppRecord) => void; save: SaveState }) {
  const breakpoint = useBuilder((s) => s.breakpoint);
  const zoom = useBuilder((s) => s.zoom);
  const preview = useBuilder((s) => s.preview);
  const canUndo = useBuilder((s) => s.past.length > 0);
  const canRedo = useBuilder((s) => s.future.length > 0);
  const [name, setName] = React.useState(app.name);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);
  const qc = useQueryClient();
  const { set } = useBuilder.getState();
  const rename = async () => {
    if (!name.trim() || name === app.name) return setName(app.name);
    const updated = await patch<AppRecord>(`/apps/${app.id}`, { name: name.trim() }).catch((e: Error) => { toast.error(e.message); return null; });
    if (updated) setApp({ ...app, name: updated.name });
    void qc.invalidateQueries({ predicate: (q) => q.queryKey.includes('apps') });
  };
  const liveUrl = typeof window === 'undefined' ? '' : `${window.location.origin}/a/${app.slug}`;
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-2">
      <Tooltip content="Back to apps"><Link href="/apps" className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"><ArrowLeft className="h-4 w-4" /></Link></Tooltip>
      <span className="flex h-7 w-7 items-center justify-center rounded-md text-white" style={{ background: app.color }}><Palette className="h-3.5 w-3.5" /></span>
      <input className="w-44 rounded bg-transparent px-1 py-0.5 text-sm font-semibold outline-none hover:bg-accent focus:bg-accent" value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {save === 'saving' ? <><Loader2 className="h-3 w-3 animate-spin" />Saving…</> : save === 'dirty' ? <>Unsaved</> : save === 'error' ? <span className="flex items-center gap-1 text-destructive"><CloudOff className="h-3 w-3" />Not saved</span> : <><Check className="h-3 w-3 text-emerald-500" />Saved</>}
      </span>
      <div className="ml-2 flex items-center">
        <Tooltip content="Undo (Ctrl+Z)"><button type="button" disabled={!canUndo} onClick={() => useBuilder.getState().undo()} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-30"><Undo2 className="h-4 w-4" /></button></Tooltip>
        <Tooltip content="Redo (Ctrl+Shift+Z)"><button type="button" disabled={!canRedo} onClick={() => useBuilder.getState().redo()} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-30"><Redo2 className="h-4 w-4" /></button></Tooltip>
      </div>

      <div className="mx-auto flex items-center gap-2">
        <div className="flex rounded-lg border bg-muted/40 p-0.5">
          {BPS.map((b) => (
            <Tooltip key={b.key} content={b.label}>
              <button type="button" onClick={() => set({ breakpoint: b.key, styleTarget: b.key === 'desktop' ? 'style' : b.key === 'tablet' ? 'tabletStyle' : 'mobileStyle' })} className={cn('rounded-md px-2.5 py-1', breakpoint === b.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                <b.icon className="h-4 w-4" />
              </button>
            </Tooltip>
          ))}
        </div>
        <Select className="h-8 w-20 text-xs" value={String(zoom)} onChange={(e) => set({ zoom: Number(e.target.value) })}>
          {[0.5, 0.75, 1, 1.25].map((z) => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
        </Select>
        <div className="flex rounded-lg border bg-muted/40 p-0.5">
          <button type="button" onClick={() => set({ preview: false })} className={cn('flex items-center gap-1 rounded-md px-2.5 py-1 text-xs', !preview ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground')}><Pencil className="h-3.5 w-3.5" />Edit</button>
          <button type="button" onClick={() => set({ preview: true, selectedId: null })} className={cn('flex items-center gap-1 rounded-md px-2.5 py-1 text-xs', preview ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground')}><Eye className="h-3.5 w-3.5" />Preview</button>
        </div>
      </div>

      <Tooltip content="Theme & app settings"><Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => set({ focus: { kind: 'theme' }, selectedId: null, preview: false })}><Palette className="h-3.5 w-3.5" />Theme</Button></Tooltip>
      <Tooltip content="Open the draft in a new tab"><a href={`/apps/${app.id}/preview`} target="_blank" rel="noreferrer" className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"><ExternalLink className="h-4 w-4" /></a></Tooltip>
      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setShareOpen(true)}>{app.access === 'PUBLIC' ? <Globe className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}Share</Button>
      <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setPublishOpen(true)}><Rocket className="h-3.5 w-3.5" />Publish</Button>
      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} app={app} setApp={setApp} liveUrl={liveUrl} />
      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} app={app} setApp={setApp} liveUrl={liveUrl} />
    </header>
  );
}

function PublishDialog({ open, onOpenChange, app, setApp, liveUrl }: { open: boolean; onOpenChange: (o: boolean) => void; app: AppRecord; setApp: (a: AppRecord) => void; liveUrl: string }) {
  const [message, setMessage] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const versions = useWsQuery<Array<{ id: string; version: number; message: string | null; createdAt: string }>>(['app', app.id, 'versions'], `/apps/${app.id}/versions`, undefined, { enabled: open });
  const publish = async () => {
    setBusy(true);
    try {
      const def = useBuilder.getState().def;
      await patch(`/apps/${app.id}`, { definition: def });
      const updated = await post<AppRecord>(`/apps/${app.id}/publish`, { message: message || undefined });
      setApp({ ...app, publishedAt: updated.publishedAt, publishedVersion: updated.publishedVersion });
      setMessage('');
      void versions.refetch();
      toast.success(`Published version ${updated.publishedVersion?.version}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const restore = async (id: string, version: number) => {
    if (!window.confirm(`Replace the current draft with version ${version}?`)) return;
    const updated = await post<AppRecord>(`/apps/${app.id}/versions/${id}/restore`).catch((e: Error) => { toast.error(e.message); return null; });
    if (updated) {
      useBuilder.getState().load(updated.definition);
      toast.success(`Draft restored from version ${version}`);
      onOpenChange(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Publish app</DialogTitle>
          <DialogDescription>Publishing snapshots the current draft. Visitors always see the latest published version; you can keep editing the draft safely.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {app.publishedVersion ? (
            <div className="flex items-center gap-2 rounded-lg border bg-emerald-500/5 p-3 text-sm">
              <Globe className="h-4 w-4 text-emerald-600" />
              <span className="flex-1">Version {app.publishedVersion.version} is live · {timeAgo(app.publishedVersion.createdAt)}</span>
              <a href={liveUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline">Open</a>
            </div>
          ) : <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">This app has never been published.</p>}
          <Field label="What changed? (optional)"><Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="New pricing section" /></Field>
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><History className="h-3.5 w-3.5" />Version history</div>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {versions.data?.length ? versions.data.map((v) => (
                <div key={v.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                  <span className="font-semibold">v{v.version}</span>
                  <span className="flex-1 truncate text-muted-foreground">{v.message ?? '—'}</span>
                  <span className="text-muted-foreground">{timeAgo(v.createdAt)}</span>
                  <button type="button" className="text-primary hover:underline" onClick={() => restore(v.id, v.version)}>Restore</button>
                </div>
              )) : <p className="text-xs text-muted-foreground">{versions.isLoading ? 'Loading…' : 'No versions yet.'}</p>}
            </div>
          </div>
        </div>
        <DialogFooter>
          {app.publishedVersion ? <Button variant="ghost" onClick={async () => { const u = await post<AppRecord>(`/apps/${app.id}/unpublish`).catch((e: Error) => { toast.error(e.message); return null; }); if (u) { setApp({ ...app, publishedAt: null, publishedVersion: null }); toast.success('App unpublished'); } }}>Unpublish</Button> : null}
          <Button onClick={publish} loading={busy}><Rocket className="h-4 w-4" />Publish{app.publishedVersion ? ` v${app.publishedVersion.version + 1}` : ''}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShareDialog({ open, onOpenChange, app, setApp, liveUrl }: { open: boolean; onOpenChange: (o: boolean) => void; app: AppRecord; setApp: (a: AppRecord) => void; liveUrl: string }) {
  const [slug, setSlug] = React.useState(app.slug);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setSlug(app.slug), [app.slug, open]);
  const update = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const u = await api<AppRecord>(`/apps/${app.id}`, { method: 'PATCH', body });
      setApp({ ...app, slug: u.slug, access: u.access });
      toast.success('Sharing settings saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Share app</DialogTitle>
          <DialogDescription>Choose who can open the published app.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {(['PRIVATE', 'PUBLIC'] as const).map((a) => (
              <button key={a} type="button" disabled={busy} onClick={() => a !== app.access && update({ access: a })} className={cn('rounded-xl border p-3 text-left transition', app.access === a ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:border-primary/50')}>
                <div className="flex items-center gap-2 text-sm font-medium">{a === 'PRIVATE' ? <Lock className="h-4 w-4" /> : <Globe className="h-4 w-4" />}{a === 'PRIVATE' ? 'Workspace members' : 'Anyone with the link'}</div>
                <p className="mt-1 text-xs text-muted-foreground">{a === 'PRIVATE' ? 'People must sign in and belong to this workspace.' : 'No sign-in. Great for landing pages, forms and portals.'}</p>
              </button>
            ))}
          </div>
          {app.access === 'PUBLIC' ? <p className="rounded-md bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">Public visitors can run every query of the published app (with the arguments the app sends). Avoid exposing write queries on sensitive tables.</p> : null}
          <Field label="App URL" hint="Lowercase letters, digits and -">
            <div className="flex gap-2">
              <div className="flex flex-1 items-center rounded-md border bg-muted/40 pl-3 text-sm text-muted-foreground">/a/<input className="h-9 flex-1 bg-transparent pr-2 text-foreground outline-none" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} /></div>
              <Button variant="outline" disabled={busy || slug === app.slug} onClick={() => update({ slug })}>Save</Button>
            </div>
          </Field>
          {app.publishedVersion ? <CopyField value={liveUrl} /> : <p className="text-xs text-muted-foreground">Publish the app to make this link work.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
