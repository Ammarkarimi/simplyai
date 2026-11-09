'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ExternalLink, Plug, Puzzle, Search, Zap } from 'lucide-react';
import type { IntegrationDescription } from '@simplyai/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, ErrorState, PageHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { JsonView } from '@/components/ui/extras';
import { IntegrationLogo } from '@/components/icons';
import { useCredentialTypes, useWorkspace, useWsQuery } from '@/lib/hooks';
import { CredentialDialog } from '../credentials/credential-form';

interface IntegrationRow extends IntegrationDescription {
  connections: number;
  authKinds: string[];
  nodes: Array<{ type: string; displayName: string; description: string; trigger: boolean; operations: string[]; docs: string | null; outputExample: Record<string, unknown> | null; properties: Array<{ name: string; displayName: string; type: string; required: boolean }> }>;
}

export default function IntegrationsPage() {
  const router = useRouter();
  const { can } = useWorkspace();
  const q = useWsQuery<IntegrationRow[]>(['integrations'], '/integrations');
  const types = useCredentialTypes();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [open, setOpen] = useState<IntegrationRow | null>(null);
  const [connect, setConnect] = useState<string | null>(null);
  const categories = useMemo(() => ['All', ...new Set((q.data ?? []).map((i) => i.category))], [q.data]);
  const list = (q.data ?? []).filter((i) => (category === 'All' || i.category === category) && `${i.name} ${i.description}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <PageHeader icon={<Puzzle />} title="Integrations" description={`${q.data?.length ?? '…'} apps and services you can automate. Connect an account, then use its nodes in any workflow.`} />
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative lg:w-80"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search integrations…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="flex flex-wrap gap-1.5">{categories.map((c) => <button key={c} onClick={() => setCategory(c)} className={`rounded-full border px-3 py-1 text-xs font-medium ${category === c ? 'border-primary bg-accent text-accent-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}>{c}</button>)}</div>
      </div>
      {q.error ? <ErrorState error={q.error} /> : !q.data ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-40" />)}</div> : list.length === 0 ? <EmptyState icon={<Search />} title="No integrations found" /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {list.map((i) => (
            <Card key={i.key} className="group flex cursor-pointer flex-col p-4 transition-all hover:-translate-y-0.5 hover:shadow-lift" onClick={() => setOpen(i)}>
              <div className="flex items-start justify-between">
                <IntegrationLogo integrationKey={i.key} name={i.name} color={i.color} size="lg" />
                {i.connections > 0 ? <Badge variant="success"><CheckCircle2 className="h-3 w-3" />{i.connections} connected</Badge> : i.credentialTypes.length === 0 ? <Badge variant="secondary">No auth needed</Badge> : null}
              </div>
              <p className="mt-3 font-semibold">{i.name}</p>
              <p className="mt-1 line-clamp-2 flex-1 text-xs text-muted-foreground">{i.description}</p>
              <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                <Badge variant="outline">{i.category}</Badge>
                {i.triggers.length > 0 && <span className="flex items-center gap-1"><Zap className="h-3 w-3" />{i.triggers.length} trigger{i.triggers.length > 1 ? 's' : ''}</span>}
                <span>{i.actions.length} action{i.actions.length === 1 ? '' : 's'}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        {open && (
          <DialogContent size="lg">
            <DialogHeader>
              <div className="flex items-center gap-3"><IntegrationLogo integrationKey={open.key} name={open.name} color={open.color} size="lg" /><div><DialogTitle>{open.name}</DialogTitle><DialogDescription>{open.description}</DialogDescription></div></div>
            </DialogHeader>
            <div className="mb-4 flex flex-wrap gap-2">
              {can('credential:manage') && open.credentialTypes.map((t) => {
                const ct = types.data?.find((x) => x.type === t);
                return <Button key={t} onClick={() => setConnect(t)}><Plug /> Connect {ct?.displayName ?? t}</Button>;
              })}
              {open.connections > 0 && <Button variant="outline" onClick={() => router.push('/credentials')}>Manage connections</Button>}
              {open.website && <a href={open.website} target="_blank" rel="noreferrer"><Button variant="ghost"><ExternalLink /> Website</Button></a>}
            </div>
            <Tabs defaultValue="nodes">
              <TabsList><TabsTrigger value="nodes">Triggers & actions</TabsTrigger><TabsTrigger value="auth">Authentication</TabsTrigger></TabsList>
              <TabsContent value="nodes" className="space-y-3">
                {open.nodes.map((n) => (
                  <details key={n.type} className="rounded-lg border p-3">
                    <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">{n.trigger ? <Badge variant="info">Trigger</Badge> : <Badge variant="secondary">Action</Badge>}{n.displayName}<span className="font-normal text-muted-foreground">— {n.description}</span></summary>
                    <div className="mt-3 space-y-3 text-xs">
                      {n.operations.length > 0 && <div><p className="mb-1 font-medium">Operations</p><div className="flex flex-wrap gap-1">{n.operations.map((o) => <Badge key={o} variant="outline">{o}</Badge>)}</div></div>}
                      <div><p className="mb-1 font-medium">Input schema</p><ul className="grid gap-1 sm:grid-cols-2">{n.properties.map((p) => <li key={p.name}><code className="rounded bg-muted px-1">{p.name}</code> <span className="text-muted-foreground">{p.type}{p.required ? ' · required' : ''}</span></li>)}</ul></div>
                      {n.outputExample && <div><p className="mb-1 font-medium">Output example</p><JsonView data={n.outputExample} maxHeight={180} /></div>}
                      {n.docs && <p className="whitespace-pre-wrap text-muted-foreground">{n.docs.replace(/\*\*/g, '')}</p>}
                    </div>
                  </details>
                ))}
              </TabsContent>
              <TabsContent value="auth" className="space-y-3 text-sm">
                {open.credentialTypes.length === 0 ? <p className="text-muted-foreground">No credentials required.</p> : open.credentialTypes.map((t) => {
                  const ct = types.data?.find((x) => x.type === t);
                  return (
                    <div key={t} className="rounded-lg border p-3">
                      <p className="font-medium">{ct?.displayName ?? t} <Badge variant="outline" className="ml-1">{ct?.authKind}</Badge></p>
                      {ct?.description && <p className="mt-1 text-xs text-muted-foreground">{ct.description}</p>}
                      <p className="mt-2 text-xs text-muted-foreground">Fields: {ct?.properties.map((p) => p.displayName).join(', ')}</p>
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground">Errors from the provider API (status code and message) are shown on the failing node in the execution debugger; enable retries or “continue on fail” in node settings to handle them.</p>
              </TabsContent>
            </Tabs>
          </DialogContent>
        )}
      </Dialog>
      {connect && types.data && <CredentialDialog open onOpenChange={(o) => !o && setConnect(null)} types={types.data} initialType={connect} onSaved={() => { void q.refetch(); }} />}
    </>
  );
}
