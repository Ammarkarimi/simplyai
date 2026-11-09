'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LogOut, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Field, Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useWorkspace } from '@/lib/hooks';
import { timeAgo } from '@/lib/utils';

export default function ProfileSettings() {
  const { me } = useWorkspace();
  const qc = useQueryClient();
  const [busy, setBusy] = useState('');
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api<Array<{ id: string; ip: string | null; userAgent: string | null; lastSeenAt: string; current: boolean }>>('/auth/sessions', { workspace: null }) });
  if (!me) return null;
  return (
    <>
      <Card>
        <form onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy('profile');
          try { const r = await api('/auth/profile', { method: 'PATCH', workspace: null, body: { name: f.get('name'), avatarUrl: f.get('avatarUrl') || null } }); qc.setQueryData(['me'], r); toast.success('Profile updated'); } catch (err) { toast.error((err as Error).message); } finally { setBusy(''); }
        }}>
          <CardHeader><CardTitle>Profile</CardTitle><CardDescription>{me.user.email} {me.user.emailVerified ? <Badge variant="success">verified</Badge> : <Badge variant="warning">unverified</Badge>}</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><Input name="name" defaultValue={me.user.name} required /></Field>
            <Field label="Avatar URL"><Input name="avatarUrl" type="url" defaultValue={me.user.avatarUrl ?? ''} placeholder="https://…" /></Field>
          </CardContent>
          <CardFooter><Button loading={busy === 'profile'}>Save profile</Button></CardFooter>
        </form>
      </Card>
      <Card>
        <form onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy('pw');
          try { await api('/auth/change-password', { method: 'POST', workspace: null, body: { currentPassword: f.get('currentPassword') || undefined, newPassword: f.get('newPassword') } }); toast.success('Password changed'); (e.target as HTMLFormElement).reset(); } catch (err) { toast.error((err as Error).message); } finally { setBusy(''); }
        }}>
          <CardHeader><CardTitle>{me.user.hasPassword ? 'Change password' : 'Set a password'}</CardTitle><CardDescription>{me.user.hasPassword ? 'Use at least 8 characters with letters and numbers.' : 'You signed up with Google. Add a password to also sign in with email.'}</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {me.user.hasPassword && <Field label="Current password"><Input name="currentPassword" type="password" autoComplete="current-password" required /></Field>}
            <Field label="New password"><Input name="newPassword" type="password" autoComplete="new-password" required minLength={8} /></Field>
          </CardContent>
          <CardFooter><Button loading={busy === 'pw'}>Update password</Button></CardFooter>
        </form>
      </Card>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0"><div><CardTitle>Active sessions</CardTitle><CardDescription>Devices signed in to your account</CardDescription></div>
          <Button variant="outline" size="sm" onClick={async () => { const r = await api<{ revoked: number }>('/auth/sessions/revoke-others', { method: 'POST', workspace: null, body: {} }); toast.success(`Signed out ${r.revoked} other session(s)`); void sessions.refetch(); }}><LogOut /> Sign out other sessions</Button>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">{sessions.data?.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2.5 text-sm"><Monitor className="h-4 w-4 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="truncate">{s.userAgent ?? 'Unknown device'}</p><p className="text-xs text-muted-foreground">{s.ip} · active {timeAgo(s.lastSeenAt)}</p></div>{s.current && <Badge variant="success">This device</Badge>}</li>
          ))}</ul>
        </CardContent>
      </Card>
    </>
  );
}
