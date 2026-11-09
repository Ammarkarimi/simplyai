'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bell, Bot, Check, ChevronsUpDown, LogOut, Menu, Plus, Settings, User, Workflow, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/menu';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Logo } from '@/components/icons';
import { api, post } from '@/lib/api';
import { useWorkspace } from '@/lib/hooks';
import { initials } from '@/lib/utils';
import { useWorkspaceStore } from '@/stores/workspace';
import { SidebarNav } from './sidebar';

export function Topbar() {
  const { me, workspace, can } = useWorkspace();
  const setWorkspace = useWorkspaceStore((s) => s.setWorkspace);
  const qc = useQueryClient();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [busy, setBusy] = useState(false);

  const switchTo = (id: string) => {
    setWorkspace(id);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    router.push('/overview');
  };
  const logout = async () => {
    await api('/auth/logout', { method: 'POST', body: {}, workspace: null }).catch(() => undefined);
    qc.clear();
    router.push('/login');
  };
  const quickCreate = async () => {
    try {
      const wf = await post<{ id: string }>('/workflows', { name: 'Untitled workflow' });
      router.push(`/workflows/${wf.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const manageableOrgs = me?.organizations.filter((o) => o.role !== 'MEMBER') ?? [];

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card/80 px-4 backdrop-blur sm:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobile(true)} aria-label="Open menu"><Menu /></Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
            <div className="brand-gradient flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold text-white">{workspace?.name.slice(0, 1)}</div>
            <span className="max-w-[160px] truncate font-medium">{workspace?.name}</span>
            <span className="hidden text-xs text-muted-foreground sm:inline">· {workspace?.role.name}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {me?.workspaces.map((w) => (
            <DropdownMenuItem key={w.id} onSelect={() => switchTo(w.id)}>
              <div className="flex h-5 w-5 items-center justify-center rounded bg-muted text-[10px] font-semibold">{w.name.slice(0, 1)}</div>
              <span className="flex-1 truncate">{w.name}</span>
              {w.id === workspace?.id && <Check className="!text-primary" />}
            </DropdownMenuItem>
          ))}
          {manageableOrgs.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setCreating(true)}><Plus /> New workspace</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex items-center gap-2">
        {can('workflow:create') && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm"><Plus /> <span className="hidden sm:inline">Create</span></Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={quickCreate}><Workflow /> New workflow</DropdownMenuItem>
              {can('agent:manage') && <DropdownMenuItem onSelect={() => router.push('/agents/new')}><Bot /> New AI agent</DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => router.push('/templates')}><Plus /> From template</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Link href="/executions?status=FAILED"><Button variant="ghost" size="icon" aria-label="Failed executions"><Bell /></Button></Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 text-xs font-semibold text-white" aria-label="Account menu">
              {me?.user.avatarUrl ? <img src={me.user.avatarUrl} alt="" className="h-full w-full object-cover" /> : initials(me?.user.name ?? '')}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-60">
            <div className="px-2.5 py-2">
              <p className="truncate text-sm font-medium">{me?.user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{me?.user.email}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => router.push('/settings')}><User /> Profile</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => router.push('/settings/workspace')}><Settings /> Workspace settings</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={logout}><LogOut /> Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent size="sm">
          <DialogHeader><DialogTitle>New workspace</DialogTitle></DialogHeader>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              try {
                const ws = await api<{ id: string }>('/auth/workspaces', { method: 'POST', workspace: null, body: { name: f.get('name'), organizationId: f.get('organizationId') } });
                await qc.invalidateQueries({ queryKey: ['me'] });
                setCreating(false);
                switchTo(ws.id);
                toast.success('Workspace created');
              } catch (err) {
                toast.error((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Name"><Input name="name" required maxLength={80} placeholder="Marketing" /></Field>
            {manageableOrgs.length > 1 && (
              <Field label="Organization"><Select name="organizationId">{manageableOrgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></Field>
            )}
            {manageableOrgs.length === 1 && <input type="hidden" name="organizationId" value={manageableOrgs[0]!.id} />}
            <DialogFooter><Button type="submit" loading={busy}>Create workspace</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {mobile && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobile(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-card shadow-xl animate-fade-in">
            <div className="flex h-14 items-center justify-between border-b px-4"><Logo /><Button variant="ghost" size="icon" onClick={() => setMobile(false)} aria-label="Close menu"><X /></Button></div>
            <SidebarNav onNavigate={() => setMobile(false)} />
          </div>
        </div>
      )}
    </header>
  );
}

export function VerifyBanner() {
  const { me } = useWorkspace();
  const [sent, setSent] = useState(false);
  if (!me || me.user.emailVerified) return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-center text-xs text-amber-800">
      Please verify your email address ({me.user.email}).{' '}
      <button className="font-medium underline" disabled={sent} onClick={async () => { await api('/auth/resend-verification', { method: 'POST', body: {}, workspace: null }).catch((e: Error) => toast.error(e.message)); setSent(true); toast.success('Verification email sent'); }}>
        {sent ? 'Sent' : 'Resend link'}
      </button>
    </div>
  );
}
