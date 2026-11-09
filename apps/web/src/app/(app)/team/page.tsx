'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Mail, MoreHorizontal, Plus, ShieldCheck, Trash2, UserMinus, Users } from 'lucide-react';
import { PERMISSIONS } from '@simplyai/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Select } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorState, PageHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { CopyField, Table, TD, TH, THead, TR, useConfirm } from '@/components/ui/extras';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/menu';
import { del, patch, post } from '@/lib/api';
import { useWorkspace, useWsQuery } from '@/lib/hooks';
import { initials, timeAgo } from '@/lib/utils';

interface Member { id: string; joinedAt: string; user: { id: string; name: string; email: string; avatarUrl: string | null; lastLoginAt: string | null }; role: { id: string; key: string; name: string; rank: number } }
interface Invitation { id: string; email: string; role: { key: string; name: string }; invitedBy: string; expiresAt: string; expired: boolean }
interface Role { id: string; key: string; name: string; description: string | null; permissions: string[]; isSystem: boolean; rank: number; workspaceId: string | null }

export default function TeamPage() {
  const { me, can } = useWorkspace();
  const members = useWsQuery<Member[]>(['members'], '/team/members');
  const invites = useWsQuery<Invitation[]>(['invitations'], '/team/invitations');
  const roles = useWsQuery<Role[]>(['roles'], '/team/roles');
  const [inviting, setInviting] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [roleDialog, setRoleDialog] = useState(false);
  const [perms, setPerms] = useState<string[]>([]);
  const { confirm, dialog } = useConfirm();
  const manage = can('members:manage');
  return (
    <>
      <PageHeader icon={<Users />} title="Team Management" description="Invite teammates and control what they can do with role-based access control." actions={manage && <Button onClick={() => { setInviting(true); setInviteUrl(null); }}><Plus /> Invite member</Button>} />
      <Tabs defaultValue="members">
        <TabsList><TabsTrigger value="members">Members {members.data && `(${members.data.length})`}</TabsTrigger><TabsTrigger value="invitations">Invitations {invites.data?.length ? `(${invites.data.length})` : ''}</TabsTrigger><TabsTrigger value="roles">Roles & permissions</TabsTrigger></TabsList>
        <TabsContent value="members">
          {members.error ? <ErrorState error={members.error} /> : !members.data ? <Skeleton className="h-48" /> : (
            <Card><Table><THead><tr><TH>Member</TH><TH>Role</TH><TH className="hidden md:table-cell">Last active</TH><TH className="hidden md:table-cell">Joined</TH><TH className="w-10" /></tr></THead><tbody>
              {members.data.map((m) => (
                <TR key={m.id}>
                  <TD><div className="flex items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 text-xs font-semibold text-white">{initials(m.user.name)}</div><div><p className="font-medium">{m.user.name}{m.user.id === me?.user.id && <span className="text-muted-foreground"> (you)</span>}</p><p className="text-xs text-muted-foreground">{m.user.email}</p></div></div></TD>
                  <TD><Badge variant={m.role.key === 'owner' ? 'default' : 'secondary'}>{m.role.name}</Badge></TD>
                  <TD className="hidden text-xs text-muted-foreground md:table-cell">{timeAgo(m.user.lastLoginAt)}</TD>
                  <TD className="hidden text-xs text-muted-foreground md:table-cell">{timeAgo(m.joinedAt)}</TD>
                  <TD>
                    {(manage || m.user.id === me?.user.id) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Member actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent>
                          {manage && <><DropdownMenuLabel>Change role</DropdownMenuLabel>{roles.data?.map((r) => <DropdownMenuItem key={r.id} disabled={r.key === m.role.key} onSelect={async () => { try { await patch(`/team/members/${m.user.id}`, { roleKey: r.key }); toast.success(`${m.user.name} is now ${r.name}`); void members.refetch(); } catch (e) { toast.error((e as Error).message); } }}><ShieldCheck />{r.name}</DropdownMenuItem>)}<DropdownMenuSeparator /></>}
                          <DropdownMenuItem destructive onSelect={async () => { if (await confirm({ title: m.user.id === me?.user.id ? 'Leave this workspace?' : `Remove ${m.user.name}?`, destructive: true, confirmLabel: 'Remove' })) { try { await del(`/team/members/${m.user.id}`); toast.success('Member removed'); void members.refetch(); } catch (e) { toast.error((e as Error).message); } } }}><UserMinus />{m.user.id === me?.user.id ? 'Leave workspace' : 'Remove'}</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TD>
                </TR>
              ))}
            </tbody></Table></Card>
          )}
        </TabsContent>
        <TabsContent value="invitations">
          {!invites.data ? <Skeleton className="h-32" /> : invites.data.length === 0 ? <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No pending invitations.</p> : (
            <Card><Table><THead><tr><TH>Email</TH><TH>Role</TH><TH>Invited by</TH><TH>Expires</TH><TH /></tr></THead><tbody>
              {invites.data.map((i) => (
                <TR key={i.id}><TD className="font-medium">{i.email}</TD><TD><Badge variant="secondary">{i.role.name}</Badge></TD><TD className="text-sm text-muted-foreground">{i.invitedBy}</TD><TD>{i.expired ? <Badge variant="destructive">Expired</Badge> : <span className="text-xs text-muted-foreground">{new Date(i.expiresAt).toLocaleDateString()}</span>}</TD>
                  <TD>{manage && <Button size="icon-sm" variant="ghost" aria-label="Revoke" onClick={async () => { await del(`/team/invitations/${i.id}`); void invites.refetch(); }}><Trash2 /></Button>}</TD></TR>
              ))}
            </tbody></Table></Card>
          )}
        </TabsContent>
        <TabsContent value="roles" className="space-y-4">
          {manage && <div className="flex justify-end"><Button variant="outline" onClick={() => { setPerms([]); setRoleDialog(true); }}><Plus /> Custom role</Button></div>}
          <div className="grid gap-4 md:grid-cols-2">
            {roles.data?.map((r) => (
              <Card key={r.id}>
                <CardHeader className="flex-row items-start justify-between space-y-0"><div><CardTitle>{r.name}</CardTitle><CardDescription>{r.description}</CardDescription></div>{r.isSystem ? <Badge variant="secondary">System</Badge> : manage && <Button size="icon-sm" variant="ghost" aria-label="Delete role" onClick={async () => { try { await del(`/team/roles/${r.id}`); void roles.refetch(); } catch (e) { toast.error((e as Error).message); } }}><Trash2 /></Button>}</CardHeader>
                <CardContent><div className="flex flex-wrap gap-1">{r.permissions.map((p) => <Badge key={p} variant="outline" className="font-mono text-[10px]">{p}</Badge>)}</div></CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
      <Dialog open={inviting} onOpenChange={setInviting}>
        <DialogContent size="sm">
          <DialogHeader><DialogTitle>Invite a teammate</DialogTitle><DialogDescription>They will receive an email with a link valid for 7 days.</DialogDescription></DialogHeader>
          {inviteUrl ? (
            <div className="space-y-3"><p className="text-sm">Invitation created. Share this link if email delivery is not configured:</p><CopyField value={inviteUrl} /><DialogFooter><Button onClick={() => setInviting(false)}>Done</Button></DialogFooter></div>
          ) : (
            <form className="space-y-4" onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                const r = await post<{ inviteUrl: string; emailSent: boolean }>('/team/invitations', { email: f.get('email'), roleKey: f.get('roleKey') });
                toast.success(r.emailSent ? 'Invitation sent' : 'Invitation created');
                setInviteUrl(r.inviteUrl);
                void invites.refetch();
              } catch (err) { toast.error((err as Error).message); }
            }}>
              <Field label="Email"><Input name="email" type="email" required placeholder="teammate@company.com" /></Field>
              <Field label="Role"><Select name="roleKey" defaultValue="editor">{roles.data?.filter((r) => r.key !== 'owner' || me?.workspaces.find((w) => w.role.key === 'owner')).map((r) => <option key={r.id} value={r.key}>{r.name} — {r.description}</option>)}</Select></Field>
              <DialogFooter><Button type="submit"><Mail /> Send invitation</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={roleDialog} onOpenChange={setRoleDialog}>
        <DialogContent size="lg">
          <DialogHeader><DialogTitle>Custom role</DialogTitle><DialogDescription>Custom roles can only include permissions you already have.</DialogDescription></DialogHeader>
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try { await post('/team/roles', { key: f.get('key'), name: f.get('name'), description: f.get('description') || undefined, permissions: perms }); toast.success('Role created'); setRoleDialog(false); void roles.refetch(); } catch (err) { toast.error((err as Error).message); }
          }}>
            <div className="grid grid-cols-2 gap-3"><Field label="Name"><Input name="name" required placeholder="Analyst" /></Field><Field label="Key"><Input name="key" required pattern="[a-z0-9_-]{2,40}" placeholder="analyst" /></Field></div>
            <Field label="Description"><Input name="description" /></Field>
            <div className="grid max-h-64 grid-cols-2 gap-1.5 overflow-y-auto rounded-lg border p-3 sm:grid-cols-3">
              {PERMISSIONS.map((p) => <label key={p} className="flex items-center gap-2 font-mono text-[11px]"><input type="checkbox" checked={perms.includes(p)} onChange={(e) => setPerms(e.target.checked ? [...perms, p] : perms.filter((x) => x !== p))} />{p}</label>)}
            </div>
            <DialogFooter><Button type="submit" disabled={!perms.length}>Create role</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
