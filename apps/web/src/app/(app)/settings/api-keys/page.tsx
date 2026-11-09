'use client';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Field, Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/misc';
import { CopyField, Table, TD, TH, THead, TR, useConfirm } from '@/components/ui/extras';
import { del, post } from '@/lib/api';
import { useWorkspace, useWsQuery } from '@/lib/hooks';
import { formatDate, timeAgo } from '@/lib/utils';

interface Key { id: string; name: string; prefix: string; scopes: string[]; rateLimitPerMinute: number; lastUsedAt: string | null; expiresAt: string | null; revokedAt: string | null; active: boolean; createdAt: string; createdBy: { name: string } | null }

export default function ApiKeysPage() {
  const { can } = useWorkspace();
  const q = useWsQuery<{ scopes: Array<{ key: string; description: string }>; keys: Key[] }>(['api-keys'], '/api-keys', undefined, { enabled: can('apikey:manage') });
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [scopes, setScopes] = useState<string[]>(['workflows:read', 'workflows:execute', 'executions:read']);
  const { confirm, dialog } = useConfirm();
  if (!can('apikey:manage')) return <ErrorState error={new Error('Only workspace admins can manage API keys.')} />;
  return (
    <>
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div><CardTitle>API keys</CardTitle><CardDescription>Authenticate to the public REST API with <code className="rounded bg-muted px-1">Authorization: Bearer sai_…</code>. See the <Link href="/docs#api" className="text-primary">API documentation</Link>.</CardDescription></div>
          <Button onClick={() => { setOpen(true); setCreated(null); }}><Plus /> New key</Button>
        </CardHeader>
        <CardContent>
          {!q.data ? <Skeleton className="h-32" /> : q.data.keys.length === 0 ? <EmptyState icon={<KeyRound />} title="No API keys" /> : (
            <Table><THead><tr><TH>Name</TH><TH>Scopes</TH><TH className="hidden md:table-cell">Rate limit</TH><TH className="hidden md:table-cell">Last used</TH><TH>Status</TH><TH /></tr></THead><tbody>
              {q.data.keys.map((k) => (
                <TR key={k.id}>
                  <TD><p className="font-medium">{k.name}</p><p className="font-mono text-xs text-muted-foreground">{k.prefix}…</p></TD>
                  <TD><div className="flex max-w-xs flex-wrap gap-1">{k.scopes.map((s) => <Badge key={s} variant="outline" className="font-mono text-[10px]">{s}</Badge>)}</div></TD>
                  <TD className="hidden text-xs md:table-cell">{k.rateLimitPerMinute}/min</TD>
                  <TD className="hidden text-xs text-muted-foreground md:table-cell">{timeAgo(k.lastUsedAt)}</TD>
                  <TD>{k.revokedAt ? <Badge variant="secondary">Revoked</Badge> : !k.active ? <Badge variant="destructive">Expired</Badge> : <Badge variant="success">Active</Badge>}{k.expiresAt && k.active && <p className="mt-1 text-[10px] text-muted-foreground">expires {formatDate(k.expiresAt, { dateStyle: 'medium' })}</p>}</TD>
                  <TD>{!k.revokedAt && <Button size="icon-sm" variant="ghost" aria-label="Revoke" onClick={async () => { if (await confirm({ title: `Revoke ${k.name}?`, description: 'Applications using this key will stop working immediately.', destructive: true, confirmLabel: 'Revoke' })) { await del(`/api-keys/${k.id}`); void q.refetch(); } }}><Trash2 /></Button>}</TD>
                </TR>
              ))}
            </tbody></Table>
          )}
        </CardContent>
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{created ? 'Copy your API key' : 'New API key'}</DialogTitle><DialogDescription>{created ? 'This is the only time the key is shown. Store it securely.' : 'Grant only the scopes your integration needs.'}</DialogDescription></DialogHeader>
          {created ? (<><CopyField value={created} /><DialogFooter><Button onClick={() => setOpen(false)}>Done</Button></DialogFooter></>) : (
            <form className="space-y-4" onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                const r = await post<{ key: string }>('/api-keys', { name: f.get('name'), scopes, rateLimitPerMinute: Number(f.get('rate')), expiresInDays: f.get('expires') ? Number(f.get('expires')) : null });
                setCreated(r.key);
                void q.refetch();
              } catch (err) { toast.error((err as Error).message); }
            }}>
              <Field label="Name"><Input name="name" required placeholder="CI pipeline" /></Field>
              <div className="space-y-2">
                <p className="text-[13px] font-medium">Scopes</p>
                {q.data?.scopes.map((s) => <label key={s.key} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={scopes.includes(s.key)} onChange={(e) => setScopes(e.target.checked ? [...scopes, s.key] : scopes.filter((x) => x !== s.key))} /><span><code className="text-xs">{s.key}</code><span className="block text-xs text-muted-foreground">{s.description}</span></span></label>)}
              </div>
              <div className="grid grid-cols-2 gap-3"><Field label="Requests per minute"><Input name="rate" type="number" min={1} max={10000} defaultValue={120} /></Field><Field label="Expires in (days)" hint="Empty = never"><Input name="expires" type="number" min={1} /></Field></div>
              <DialogFooter><Button type="submit" disabled={!scopes.length}>Create key</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
