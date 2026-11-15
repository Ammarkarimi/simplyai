'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AppWindow, Copy, ExternalLink, Globe, Lock, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { APP_TEMPLATES, type AppDefinition } from '@simplyai/shared';
import { AppView } from '@/components/app-builder/render';
import { AppRuntime } from '@/components/app-builder/runtime';
import { LucideIcon } from '@/components/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useConfirm } from '@/components/ui/extras';
import { Field, Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/menu';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/misc';
import { del, post } from '@/lib/api';
import { useAction, useWorkspace, useWsQuery } from '@/lib/hooks';
import { cn, timeAgo } from '@/lib/utils';

interface AppRow { id: string; name: string; description: string | null; slug: string; icon: string; color: string; access: 'PRIVATE' | 'PUBLIC'; publishedAt: string | null; updatedAt: string; publishedVersion: { version: number } | null }

/** Live, non-interactive miniature of an app definition. */
function Thumbnail({ def, scale = 0.28 }: { def: AppDefinition; scale?: number }) {
  const rt = React.useMemo(() => {
    const r = new AppRuntime({ def, mode: 'edit', transport: async () => ({ data: null }) });
    void r.runOnLoad();
    return r;
  }, [def]);
  return (
    <div className="pointer-events-none relative h-40 overflow-hidden rounded-t-xl border-b" style={{ background: def.theme.background }} aria-hidden>
      <div style={{ width: `${100 / scale}%`, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <div className="[&_.sai-drop-empty]:hidden"><AppView runtime={rt} breakpoint="desktop" fill={false} className="sai-thumb" /></div>
      </div>
    </div>
  );
}

function NewAppDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [template, setTemplate] = React.useState('dashboard');
  const defs = React.useMemo(() => Object.fromEntries(APP_TEMPLATES.map((t) => [t.key, t.build()])), []);
  const create = useAction((v: { name: string; template: string }) => post<{ id: string }>('/apps', v), { invalidate: [['apps']], onSuccess: (a) => router.push(`/apps/${a.id}`) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Create an app</DialogTitle>
          <DialogDescription>Start from a template or a blank canvas. Everything — layout, colors, fonts, data and behaviour — stays editable.</DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); create.mutate({ name: name.trim() || APP_TEMPLATES.find((t) => t.key === template)!.name, template }); }}>
          <Field label="App name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={APP_TEMPLATES.find((t) => t.key === template)?.name} maxLength={100} /></Field>
          <div className="grid max-h-[52vh] gap-3 overflow-y-auto p-0.5 sm:grid-cols-2 lg:grid-cols-3">
            {APP_TEMPLATES.map((t) => (
              <button key={t.key} type="button" onClick={() => setTemplate(t.key)} className={cn('overflow-hidden rounded-xl border text-left transition hover:shadow-lift', template === t.key ? 'border-primary ring-2 ring-primary' : '')}>
                <Thumbnail def={defs[t.key]!} />
                <div className="flex items-start gap-2.5 p-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: t.color }}><LucideIcon name={t.icon} className="h-4 w-4" /></span>
                  <span><span className="block text-sm font-medium">{t.name}</span><span className="block text-xs text-muted-foreground">{t.description}</span></span>
                </div>
              </button>
            ))}
          </div>
          <DialogFooter><Button type="submit" loading={create.isPending}><Plus />Create app</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function AppsPage() {
  const { can } = useWorkspace();
  const q = useWsQuery<AppRow[]>(['apps'], '/apps');
  const [open, setOpen] = React.useState(false);
  const { confirm, dialog } = useConfirm();
  const duplicate = useAction((id: string) => post(`/apps/${id}/duplicate`), { invalidate: [['apps']], success: 'App duplicated' });
  const remove = useAction((id: string) => del(`/apps/${id}`), { invalidate: [['apps']], success: 'App deleted' });
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return (
    <>
      <PageHeader icon={<AppWindow />} title="App Builder" description="Design internal tools, dashboards, portals and landing pages with drag & drop, then connect them to workflows and data tables."
        actions={can('app:manage') && <Button onClick={() => setOpen(true)}><Plus /> New app</Button>} />
      {q.error ? <ErrorState error={q.error as Error} /> : !q.data ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><Skeleton className="h-48" /><Skeleton className="h-48" /><Skeleton className="h-48" /></div> : q.data.length === 0 ? (
        <EmptyState icon={<AppWindow />} title="No apps yet" description="Build a UI on top of your automations: admin panels, customer portals, forms, dashboards or AI chat apps." action={can('app:manage') && <Button onClick={() => setOpen(true)}><Plus /> Create your first app</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((a) => (
            <Card key={a.id} className="group flex flex-col p-4 transition hover:shadow-lift">
              <div className="flex items-start gap-3">
                <Link href={`/apps/${a.id}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ background: `linear-gradient(135deg, ${a.color}, ${a.color}bb)` }}><LucideIcon name={a.icon} className="h-5 w-5" /></Link>
                <div className="min-w-0 flex-1">
                  <Link href={`/apps/${a.id}`} className="block truncate font-semibold hover:underline">{a.name}</Link>
                  <p className="text-xs text-muted-foreground">Edited {timeAgo(a.updatedAt)}</p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem asChild><Link href={`/apps/${a.id}`}><Pencil className="h-4 w-4" />Edit</Link></DropdownMenuItem>
                    {a.publishedVersion ? <DropdownMenuItem asChild><a href={`/a/${a.slug}`} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />Open live app</a></DropdownMenuItem> : null}
                    {can('app:manage') ? <DropdownMenuItem onClick={() => duplicate.mutate(a.id)}><Copy className="h-4 w-4" />Duplicate</DropdownMenuItem> : null}
                    {can('app:manage') ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem destructive onClick={async () => { if (await confirm({ title: `Delete "${a.name}"?`, description: 'The app, its versions and its public link are removed permanently.', confirmLabel: 'Delete', destructive: true })) remove.mutate(a.id); }}><Trash2 className="h-4 w-4" />Delete</DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {a.description ? <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{a.description}</p> : null}
              <div className="mt-auto flex items-center gap-2 pt-4">
                {a.publishedVersion ? <Badge variant="success">Live · v{a.publishedVersion.version}</Badge> : <Badge variant="secondary">Draft</Badge>}
                <Badge variant="outline" className="gap-1">{a.access === 'PUBLIC' ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}{a.access === 'PUBLIC' ? 'Public' : 'Members'}</Badge>
                {a.publishedVersion ? <button type="button" className="ml-auto truncate text-xs text-muted-foreground hover:text-foreground" onClick={() => { void navigator.clipboard.writeText(`${origin}/a/${a.slug}`); toast.success('Link copied'); }}>/a/{a.slug}</button> : null}
              </div>
            </Card>
          ))}
        </div>
      )}
      <NewAppDialog open={open} onOpenChange={setOpen} />
      {dialog}
    </>
  );
}
