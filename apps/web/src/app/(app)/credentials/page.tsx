'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, Link2, Link2Off, MoreHorizontal, Pencil, Plus, Search, ShieldCheck, Trash2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/misc';
import { Table, TD, TH, THead, TR, useConfirm } from '@/components/ui/extras';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/menu';
import { IntegrationLogo } from '@/components/icons';
import { del, post } from '@/lib/api';
import { useCredentialTypes, useWorkspace, useWsQuery } from '@/lib/hooks';
import { timeAgo } from '@/lib/utils';
import { CredentialDialog, type CredentialRow } from './credential-form';

function CredentialsInner() {
  const params = useSearchParams();
  const qc = useQueryClient();
  const { workspace, can } = useWorkspace();
  const q = useWsQuery<CredentialRow[]>(['credentials'], '/credentials');
  const types = useCredentialTypes();
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<{ type?: string; existing?: CredentialRow | null } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const refresh = () => qc.invalidateQueries({ queryKey: [workspace?.id, 'credentials'] });

  useEffect(() => {
    const t = params.get('new');
    if (t && types.data) setDialog({ type: t });
    if (params.get('oauth') === 'success') toast.success('Account connected');
    if (params.get('oauth') === 'error') toast.error(`Connection failed: ${params.get('message') ?? 'unknown error'}`);
  }, [params, types.data]);

  const test = async (c: CredentialRow) => {
    setTesting(c.id);
    try {
      const r = await post<{ ok: boolean; message: string }>(`/credentials/${c.id}/test`);
      r.ok ? toast.success(r.message) : toast.error(r.message);
      void refresh();
    } finally {
      setTesting(null);
    }
  };
  const connect = async (c: CredentialRow) => {
    try {
      const { url } = await post<{ url: string }>(`/credentials/${c.id}/oauth2/authorize`);
      window.location.href = url;
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const rows = (q.data ?? []).filter((c) => `${c.name} ${c.typeName}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <PageHeader icon={<KeyRound />} title="Credentials" description="API keys, OAuth connections and database logins used by your nodes."
        actions={can('credential:manage') && <Button onClick={() => setDialog({})} disabled={!types.data}><Plus /> New credential</Button>} />
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search credentials…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <p className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex"><ShieldCheck className="h-4 w-4 text-emerald-600" />Encrypted at rest · isolated per workspace</p>
      </div>
      {q.error ? <ErrorState error={q.error} /> : !q.data ? <Skeleton className="h-64" /> : rows.length === 0 ? (
        <EmptyState icon={<KeyRound />} title="No credentials" description="Connect your first app to use it in workflows and agents." action={can('credential:manage') && <Button onClick={() => setDialog({})}><Plus /> New credential</Button>} />
      ) : (
        <Card>
          <Table>
            <THead><tr><TH>Name</TH><TH className="hidden md:table-cell">Type</TH><TH>Status</TH><TH className="hidden lg:table-cell">Used by</TH><TH className="hidden sm:table-cell">Updated</TH><TH className="w-10" /></tr></THead>
            <tbody>
              {rows.map((c) => (
                <TR key={c.id}>
                  <TD><div className="flex items-center gap-3"><IntegrationLogo integrationKey={c.integration ?? c.type} name={c.typeName} color="#7c3aed" size="sm" /><div><p className="font-medium">{c.name}</p><p className="text-xs text-muted-foreground md:hidden">{c.typeName}</p></div></div></TD>
                  <TD className="hidden md:table-cell text-sm text-muted-foreground">{c.typeName}</TD>
                  <TD>
                    {c.status === 'ACTIVE' && c.connected ? <Badge variant="success">Connected</Badge> : c.status === 'PENDING_OAUTH' || !c.connected ? <Badge variant="warning">Not connected</Badge> : <Badge variant="destructive" title={c.statusMessage ?? ''}>Error</Badge>}
                    {c.statusMessage && c.status === 'ERROR' && <p className="mt-1 max-w-xs truncate text-xs text-red-600">{c.statusMessage}</p>}
                  </TD>
                  <TD className="hidden text-xs text-muted-foreground lg:table-cell">{c.usedByNodes ?? 0} nodes</TD>
                  <TD className="hidden text-xs text-muted-foreground sm:table-cell">{timeAgo(c.updatedAt)}</TD>
                  <TD>
                    {can('credential:manage') && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Actions" disabled={testing === c.id}><MoreHorizontal /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => test(c)}><Zap /> Test connection</DropdownMenuItem>
                          {c.authKind === 'oauth2' && <DropdownMenuItem onSelect={() => connect(c)}><Link2 /> {c.connected ? 'Reconnect' : 'Connect account'}</DropdownMenuItem>}
                          {c.authKind === 'oauth2' && c.connected && <DropdownMenuItem onSelect={async () => { await post(`/credentials/${c.id}/oauth2/revoke`); toast.success('Disconnected'); void refresh(); }}><Link2Off /> Revoke connection</DropdownMenuItem>}
                          <DropdownMenuItem onSelect={() => setDialog({ existing: c })}><Pencil /> Edit</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem destructive onSelect={async () => {
                            if (!(await confirm({ title: `Delete “${c.name}”?`, description: c.usedByNodes ? `${c.usedByNodes} node(s) use this credential and will stop working.` : 'This cannot be undone.', confirmLabel: 'Delete', destructive: true }))) return;
                            try { await del(`/credentials/${c.id}`, { force: true }); toast.success('Credential deleted'); void refresh(); } catch (e) { toast.error((e as Error).message); }
                          }}><Trash2 /> Delete</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {dialog && types.data && <CredentialDialog open onOpenChange={(o) => !o && setDialog(null)} types={types.data} initialType={dialog.type} existing={dialog.existing} onSaved={() => void refresh()} />}
      {confirmDialog}
    </>
  );
}

export default function CredentialsPage() {
  return <Suspense><CredentialsInner /></Suspense>;
}
