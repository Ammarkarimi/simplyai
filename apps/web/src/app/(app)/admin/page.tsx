'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Activity, Building2, Cpu, Database, Flag, HeartPulse, Layers, Puzzle, RefreshCw, ScrollText, ShieldCheck, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Select } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorState, PageHeader, Skeleton, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { JsonView, Pagination, Stat, Table, TD, TH, THead, TR } from '@/components/ui/extras';
import { del, patch, post, type Page } from '@/lib/api';
import { useWorkspace, useWsQuery } from '@/lib/hooks';
import { formatDate, formatLimit, formatNumber, timeAgo } from '@/lib/utils';

function Overview() {
  const s = useWsQuery<Record<string, any>>(['admin', 'stats'], '/admin/stats', undefined, { refetchInterval: 30_000 });
  const h = useWsQuery<Record<string, any>>(['admin', 'health'], '/admin/health', undefined, { refetchInterval: 15_000 });
  if (!s.data || !h.data) return <Skeleton className="h-64" />;
  const d = s.data;
  const ok = (v: { ok: boolean }) => <Badge variant={v.ok ? 'success' : 'destructive'}>{v.ok ? 'healthy' : 'down'}</Badge>;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Users" value={formatNumber(d.users)} icon={<Users />} />
        <Stat label="Organizations" value={formatNumber(d.organizations)} icon={<Building2 />} sub={`${d.workspaces} workspaces`} />
        <Stat label="Workflows" value={formatNumber(d.workflows)} icon={<Layers />} sub={`${d.activeWorkflows} active`} />
        <Stat label="Executions (24h)" value={formatNumber(d.executions24h)} icon={<Activity />} sub={`${d.failed24h} failed · ${formatNumber(d.executions)} total`} trend={d.failed24h ? 'down' : null} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><HeartPulse className="h-4 w-4" />Platform health</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span>API</span><span className="flex items-center gap-2 text-xs text-muted-foreground">up {Math.round(h.data.api.uptimeSec / 60)}m · {h.data.api.memoryMb}MB · {h.data.api.node} {ok(h.data.api)}</span></div>
            <div className="flex justify-between"><span>PostgreSQL</span><span className="flex items-center gap-2 text-xs text-muted-foreground">{h.data.database.latencyMs}ms {ok(h.data.database)}</span></div>
            <div className="flex justify-between"><span>Redis</span><span className="flex items-center gap-2 text-xs text-muted-foreground">{h.data.redis.latencyMs}ms {ok(h.data.redis)}</span></div>
            <div className="flex justify-between"><span>Workers</span><span className="flex items-center gap-2 text-xs text-muted-foreground">{h.data.workers.count} online {ok(h.data.workers)}</span></div>
            <div className="flex justify-between"><span>Stuck executions (&gt;1h running)</span><Badge variant={h.data.stuckExecutions ? 'warning' : 'success'}>{h.data.stuckExecutions}</Badge></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Subscriptions & executions</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <div>{d.subscriptionsByPlan.map((p: { plan: string; count: number }) => <div key={p.plan} className="flex justify-between py-0.5"><span>{p.plan}</span><b>{p.count}</b></div>)}</div>
            <div>{Object.entries(d.executionsByStatus as Record<string, number>).map(([k, v]) => <div key={k} className="flex justify-between py-0.5"><span className="capitalize">{k.toLowerCase()}</span><b>{formatNumber(v)}</b></div>)}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function UsersTab() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useWsQuery<Page<any>>(['admin', 'users'], '/admin/users', { search, page });
  return (
    <div className="space-y-3">
      <Input placeholder="Search users…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      {!q.data ? <Skeleton className="h-64" /> : (
        <Card><Table><THead><tr><TH>User</TH><TH>Status</TH><TH className="hidden md:table-cell">Workspaces</TH><TH className="hidden md:table-cell">Last login</TH><TH>Admin</TH><TH /></tr></THead><tbody>
          {q.data.items.map((u) => (
            <TR key={u.id}>
              <TD><p className="font-medium">{u.name}</p><p className="text-xs text-muted-foreground">{u.email}{!u.emailVerifiedAt && ' · unverified'}</p></TD>
              <TD><Badge variant={u.status === 'ACTIVE' ? 'success' : 'destructive'}>{u.status.toLowerCase()}</Badge></TD>
              <TD className="hidden md:table-cell">{u._count.workspaceMembers}</TD>
              <TD className="hidden text-xs text-muted-foreground md:table-cell">{timeAgo(u.lastLoginAt)}</TD>
              <TD><Switch checked={u.isPlatformAdmin} onCheckedChange={async (v) => { try { await patch(`/admin/users/${u.id}`, { isPlatformAdmin: v }); void q.refetch(); } catch (e) { toast.error((e as Error).message); } }} /></TD>
              <TD><Button size="sm" variant="ghost" onClick={async () => { try { await patch(`/admin/users/${u.id}`, { status: u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' }); toast.success('User updated'); void q.refetch(); } catch (e) { toast.error((e as Error).message); } }}>{u.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}</Button></TD>
            </TR>
          ))}
        </tbody></Table><div className="px-4"><Pagination page={q.data.page} pageCount={q.data.pageCount} total={q.data.total} onPage={setPage} /></div></Card>
      )}
    </div>
  );
}

function OrgsTab() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useWsQuery<Page<any>>(['admin', 'orgs'], '/admin/organizations', { search, page });
  const ws = useWsQuery<Page<any>>(['admin', 'workspaces'], '/admin/workspaces', { search, page: 1, pageSize: 50 });
  const plans = useWsQuery<any[]>(['admin', 'plans'], '/admin/plans');
  return (
    <div className="space-y-4">
      <Input placeholder="Search…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      {!q.data ? <Skeleton className="h-64" /> : (
        <Card><CardHeader><CardTitle>Organizations</CardTitle></CardHeader><Table><THead><tr><TH>Organization</TH><TH>Plan</TH><TH className="hidden md:table-cell">Workspaces / members</TH><TH className="hidden md:table-cell">Usage this month</TH></tr></THead><tbody>
          {q.data.items.map((o) => (
            <TR key={o.id}>
              <TD><p className="font-medium">{o.name}</p><p className="text-xs text-muted-foreground">{o.slug} · {formatDate(o.createdAt, { dateStyle: 'medium' })}</p></TD>
              <TD><Select className="h-8 w-36 text-xs" value={o.plan} onChange={async (e) => { await patch(`/admin/organizations/${o.id}/plan`, { planKey: e.target.value }); toast.success('Plan changed'); void q.refetch(); }}>{plans.data?.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</Select></TD>
              <TD className="hidden md:table-cell text-sm">{o.workspaces} / {o.members}</TD>
              <TD className="hidden md:table-cell text-xs text-muted-foreground">{formatNumber(o.usage.EXECUTIONS ?? 0)} exec · {formatNumber(o.usage.TASKS ?? 0)} tasks · {formatNumber(o.usage.AI_TOKENS ?? 0)} tokens</TD>
            </TR>
          ))}
        </tbody></Table><div className="px-4"><Pagination page={q.data.page} pageCount={q.data.pageCount} total={q.data.total} onPage={setPage} /></div></Card>
      )}
      {ws.data && (
        <Card><CardHeader><CardTitle>Workspaces</CardTitle></CardHeader><Table><THead><tr><TH>Workspace</TH><TH>Organization</TH><TH>Members</TH><TH>Workflows</TH><TH>Executions</TH><TH>Credentials</TH></tr></THead><tbody>
          {ws.data.items.map((w) => <TR key={w.id}><TD className="font-medium">{w.name}</TD><TD className="text-sm text-muted-foreground">{w.organization.name}</TD><TD>{w._count.members}</TD><TD>{w._count.workflows}</TD><TD>{formatNumber(w._count.executions)}</TD><TD>{w._count.credentials}</TD></TR>)}
        </tbody></Table></Card>
      )}
    </div>
  );
}

const LIMIT_FIELDS = ['priceMonthlyCents', 'maxWorkflows', 'maxActiveWorkflows', 'monthlyExecutions', 'monthlyTasks', 'monthlyAiTokens', 'maxCredentials', 'maxMembers', 'maxWorkspaces', 'executionRetentionDays'] as const;

function PlansTab() {
  const q = useWsQuery<any[]>(['admin', 'plans'], '/admin/plans');
  const usage = useWsQuery<any>(['admin', 'usage'], '/admin/usage');
  const [edit, setEdit] = useState<any | null>(null);
  return (
    <div className="space-y-4">
      <Card><CardHeader><CardTitle>Plans & limits</CardTitle><CardDescription>-1 means unlimited. Changes apply immediately to quota checks.</CardDescription></CardHeader>
        <Table><THead><tr><TH>Plan</TH><TH>Price</TH><TH>Executions/mo</TH><TH>Workflows</TH><TH>Members</TH><TH>AI tokens/mo</TH><TH>Subscribers</TH><TH /></tr></THead><tbody>
          {q.data?.map((p) => <TR key={p.id}><TD className="font-medium">{p.name}{!p.isPublic && <Badge variant="secondary" className="ml-1">hidden</Badge>}</TD><TD>${(p.priceMonthlyCents / 100).toFixed(0)}</TD><TD>{formatLimit(p.monthlyExecutions)}</TD><TD>{formatLimit(p.maxWorkflows)}</TD><TD>{formatLimit(p.maxMembers)}</TD><TD>{formatLimit(p.monthlyAiTokens)}</TD><TD>{p._count.subscriptions}</TD><TD><Button size="sm" variant="ghost" onClick={() => setEdit(p)}>Edit</Button></TD></TR>)}
        </tbody></Table>
      </Card>
      {usage.data && (
        <Card><CardHeader><CardTitle>Usage this month</CardTitle><CardDescription>{formatNumber(usage.data.totals.EXECUTIONS)} executions · {formatNumber(usage.data.totals.TASKS)} tasks · {formatNumber(usage.data.totals.AI_TOKENS)} AI tokens</CardDescription></CardHeader>
          <Table><THead><tr><TH>Organization</TH><TH>Executions</TH><TH>Tasks</TH><TH>AI tokens</TH></tr></THead><tbody>
            {usage.data.organizations.map((o: any) => <TR key={o.id}><TD>{o.name}</TD><TD>{formatNumber(o.EXECUTIONS ?? 0)}</TD><TD>{formatNumber(o.TASKS ?? 0)}</TD><TD>{formatNumber(o.AI_TOKENS ?? 0)}</TD></TR>)}
          </tbody></Table>
        </Card>
      )}
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        {edit && (
          <DialogContent>
            <DialogHeader><DialogTitle>Edit {edit.name}</DialogTitle></DialogHeader>
            <form className="grid grid-cols-2 gap-3" onSubmit={async (e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
              const body: Record<string, unknown> = { name: f.name, stripePriceId: f.stripePriceId || null, isPublic: f.isPublic === 'on' };
              for (const k of LIMIT_FIELDS) body[k] = Number(f[k]);
              try { await patch(`/admin/plans/${edit.id}`, body); toast.success('Plan updated'); setEdit(null); void q.refetch(); } catch (err) { toast.error((err as Error).message); }
            }}>
              <Field label="Name"><Input name="name" defaultValue={edit.name} /></Field>
              <Field label="Stripe price id"><Input name="stripePriceId" defaultValue={edit.stripePriceId ?? ''} placeholder="price_…" /></Field>
              {LIMIT_FIELDS.map((k) => <Field key={k} label={k}><Input name={k} type="number" defaultValue={edit[k]} /></Field>)}
              <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" name="isPublic" defaultChecked={edit.isPublic} /> Visible on pricing page</label>
              <DialogFooter className="col-span-2"><Button type="submit">Save</Button></DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function InfraTab() {
  const queues = useWsQuery<Array<{ name: string; counts: Record<string, number>; schedulers: number }>>(['admin', 'queues'], '/admin/queues', undefined, { refetchInterval: 5000 });
  const workers = useWsQuery<any[]>(['admin', 'workers'], '/admin/workers', undefined, { refetchInterval: 5000 });
  const [failed, setFailed] = useState<{ name: string; jobs: any[] } | null>(null);
  return (
    <div className="space-y-4">
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Layers className="h-4 w-4" />Queues</CardTitle></CardHeader>
        <Table><THead><tr><TH>Queue</TH><TH>Waiting</TH><TH>Active</TH><TH>Delayed</TH><TH>Completed</TH><TH>Failed</TH><TH>Schedulers</TH><TH /></tr></THead><tbody>
          {queues.data?.map((q) => (
            <TR key={q.name}><TD className="font-mono text-sm">{q.name}</TD><TD>{q.counts.waiting}</TD><TD>{q.counts.active}</TD><TD>{q.counts.delayed}</TD><TD>{q.counts.completed}</TD><TD><Badge variant={q.counts.failed ? 'destructive' : 'secondary'}>{q.counts.failed}</Badge></TD><TD>{q.schedulers}</TD>
              <TD className="whitespace-nowrap"><Button size="sm" variant="ghost" onClick={async () => setFailed({ name: q.name, jobs: await (await import('@/lib/api')).get(`/admin/queues/${q.name}/failed`) })}>Inspect</Button><Button size="sm" variant="ghost" onClick={async () => { await post(`/admin/queues/${q.name}/retry-failed`); toast.success('Failed jobs retried'); void queues.refetch(); }}><RefreshCw /></Button><Button size="sm" variant="ghost" onClick={async () => { const r = await post<{ removed: number }>(`/admin/queues/${q.name}/clean`); toast.success(`Removed ${r.removed} jobs`); void queues.refetch(); }}><Trash2 /></Button></TD>
            </TR>
          ))}
        </tbody></Table>
      </Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Cpu className="h-4 w-4" />Workers</CardTitle><CardDescription>Heartbeats every 10s, expire after 30s.</CardDescription></CardHeader>
        <CardContent>{!workers.data?.length ? <p className="text-sm text-red-600">No workers are online. Start one with <code>pnpm dev:worker</code>.</p> : (
          <div className="grid gap-3 md:grid-cols-2">{workers.data.map((w) => (
            <div key={w.id} className="rounded-lg border p-3 text-sm"><p className="font-mono text-xs font-medium">{w.id}</p><p className="mt-1 text-xs text-muted-foreground">running {w.running}/{w.concurrency} · processed {w.processed} · failed {w.failed} · {w.memoryMb}MB · load {Number(w.load).toFixed(2)} · seen {timeAgo(w.at)}</p></div>
          ))}</div>
        )}</CardContent>
      </Card>
      <Dialog open={!!failed} onOpenChange={(o) => !o && setFailed(null)}>{failed && <DialogContent size="lg"><DialogHeader><DialogTitle>Failed jobs · {failed.name}</DialogTitle></DialogHeader><JsonView data={failed.jobs} maxHeight={500} /></DialogContent>}</Dialog>
    </div>
  );
}

function LogsTab() {
  const [kind, setKind] = useState<'logs' | 'audit'>('logs');
  const [level, setLevel] = useState('');
  const [page, setPage] = useState(1);
  const q = useWsQuery<Page<any>>(['admin', kind], kind === 'logs' ? '/admin/logs' : '/admin/audit', { page, level: kind === 'logs' ? level : undefined });
  return (
    <div className="space-y-3">
      <div className="flex gap-2"><Select className="w-40" value={kind} onChange={(e) => { setKind(e.target.value as 'logs'); setPage(1); }}><option value="logs">System logs</option><option value="audit">Audit log (all)</option></Select>{kind === 'logs' && <Select className="w-32" value={level} onChange={(e) => setLevel(e.target.value)}><option value="">All levels</option><option>error</option><option>warn</option><option>info</option></Select>}</div>
      {!q.data ? <Skeleton className="h-64" /> : q.data.items.length === 0 ? <p className="text-sm text-muted-foreground">No entries.</p> : (
        <Card><Table><THead><tr><TH>When</TH>{kind === 'logs' ? <><TH>Level</TH><TH>Source</TH><TH>Message</TH></> : <><TH>User</TH><TH>Workspace</TH><TH>Action</TH></>}</tr></THead><tbody>
          {q.data.items.map((l) => <TR key={l.id}><TD className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(l.createdAt)}</TD>{kind === 'logs' ? <><TD><Badge variant={l.level === 'error' ? 'destructive' : l.level === 'warn' ? 'warning' : 'secondary'}>{l.level}</Badge></TD><TD className="font-mono text-xs">{l.source}</TD><TD className="max-w-lg text-sm">{l.message}</TD></> : <><TD className="text-xs">{l.user?.email ?? 'system'}</TD><TD className="text-xs">{l.workspace?.name ?? '—'}</TD><TD className="text-sm">{l.action}</TD></>}</TR>)}
        </tbody></Table><div className="px-4"><Pagination page={q.data.page} pageCount={q.data.pageCount} total={q.data.total} onPage={setPage} /></div></Card>
      )}
    </div>
  );
}

function FlagsTab() {
  const flags = useWsQuery<any[]>(['admin', 'flags'], '/admin/flags');
  const integrations = useWsQuery<any[]>(['admin', 'integrations'], '/admin/integrations');
  const [form, setForm] = useState({ key: '', description: '', rolloutPercentage: 100 });
  const save = async (f: any) => { try { await post('/admin/flags', f); void flags.refetch(); } catch (e) { toast.error((e as Error).message); } };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Flag className="h-4 w-4" />Feature flags</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {flags.data?.map((f) => (
            <div key={f.key} className="flex items-center gap-3 rounded-lg border p-2.5">
              <div className="min-w-0 flex-1"><p className="font-mono text-xs font-medium">{f.key}</p><p className="text-xs text-muted-foreground">{f.description} · {f.rolloutPercentage}% rollout</p></div>
              <Switch checked={f.enabled} onCheckedChange={(v) => save({ ...f, enabled: v })} />
              <Button size="icon-sm" variant="ghost" aria-label="Delete flag" onClick={async () => { await del(`/admin/flags/${f.key}`); void flags.refetch(); }}><Trash2 /></Button>
            </div>
          ))}
          <form className="flex flex-wrap gap-2 border-t pt-3" onSubmit={(e) => { e.preventDefault(); void save({ ...form, enabled: false, workspaceIds: [] }); setForm({ key: '', description: '', rolloutPercentage: 100 }); }}>
            <Input className="w-40 font-mono text-xs" placeholder="flag.key" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} required />
            <Input className="flex-1" placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <Input className="w-20" type="number" min={0} max={100} value={form.rolloutPercentage} onChange={(e) => setForm({ ...form, rolloutPercentage: Number(e.target.value) })} />
            <Button type="submit">Add</Button>
          </form>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Puzzle className="h-4 w-4" />Integrations</CardTitle><CardDescription>Disabled integrations are hidden from the palette and marketplace.</CardDescription></CardHeader>
        <CardContent className="max-h-[480px] space-y-1 overflow-y-auto">
          {integrations.data?.map((i) => (
            <div key={i.key} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-muted"><span className="text-sm">{i.name} <span className="text-xs text-muted-foreground">· {i.category} · {i.nodes} nodes</span></span><Switch checked={i.enabled} onCheckedChange={async (v) => { await patch(`/admin/integrations/${i.key}`, { enabled: v }); void integrations.refetch(); }} /></div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminPage() {
  const { me } = useWorkspace();
  if (!me?.user.isPlatformAdmin) return <ErrorState error={new Error('The admin panel is only available to platform administrators.')} />;
  return (
    <>
      <PageHeader icon={<ShieldCheck />} title="Platform administration" description="Manage users, organizations, plans, infrastructure and feature flags across SimplyAI." />
      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap"><TabsTrigger value="overview"><HeartPulse />Overview</TabsTrigger><TabsTrigger value="users"><Users />Users</TabsTrigger><TabsTrigger value="orgs"><Building2 />Organizations</TabsTrigger><TabsTrigger value="plans"><Database />Plans & usage</TabsTrigger><TabsTrigger value="infra"><Cpu />Workers & queues</TabsTrigger><TabsTrigger value="logs"><ScrollText />Logs</TabsTrigger><TabsTrigger value="flags"><Flag />Flags & integrations</TabsTrigger></TabsList>
        <TabsContent value="overview"><Overview /></TabsContent>
        <TabsContent value="users"><UsersTab /></TabsContent>
        <TabsContent value="orgs"><OrgsTab /></TabsContent>
        <TabsContent value="plans"><PlansTab /></TabsContent>
        <TabsContent value="infra"><InfraTab /></TabsContent>
        <TabsContent value="logs"><LogsTab /></TabsContent>
        <TabsContent value="flags"><FlagsTab /></TabsContent>
      </Tabs>
    </>
  );
}
