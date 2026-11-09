'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { Activity, AlertTriangle, Bot, CheckCircle2, Clock, Gauge, Plus, Workflow, XCircle, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/misc';
import { Stat } from '@/components/ui/extras';
import { useWorkspace, useWsQuery } from '@/lib/hooks';
import { post } from '@/lib/api';
import { formatDuration, formatNumber, prettyAction, timeAgo } from '@/lib/utils';
import { toast } from 'sonner';

interface Dashboard {
  workflows: { total: number; active: number };
  executions: { total: number; success: number; failed: number; cancelled: number; running: number; successRate: number | null; avgDurationMs: number | null };
  agents: number;
  credentials: number;
  chart: Array<{ date: string; success: number; failed: number; other: number }>;
  topWorkflows: Array<{ workflowId: string; name: string; active: boolean; executions: number }>;
  recentErrors: Array<{ id: string; workflow: { id: string; name: string }; at: string; message: string; nodeName: string | null }>;
  recentActivity: Array<{ id: string; action: string; user: string; at: string }>;
}

const RANGES = [{ label: '7 days', days: 7 }, { label: '14 days', days: 14 }, { label: '30 days', days: 30 }, { label: '90 days', days: 90 }];

export default function OverviewPage() {
  const { me, can } = useWorkspace();
  const router = useRouter();
  const [days, setDays] = useState(14);
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const q = useWsQuery<Dashboard>(['dashboard', days], '/dashboard', { from }, { refetchInterval: 30_000 });
  const d = q.data;
  const create = async () => {
    try {
      const wf = await post<{ id: string }>('/workflows', { name: 'Untitled workflow' });
      router.push(`/workflows/${wf.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <>
      <PageHeader
        title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${me?.user.name.split(' ')[0] ?? ''}`}
        description="Here is how your automations are performing."
        actions={
          <>
            <div className="flex rounded-lg border bg-card p-0.5">
              {RANGES.map((r) => (
                <button key={r.days} onClick={() => setDays(r.days)} className={`rounded-md px-2.5 py-1 text-xs font-medium ${days === r.days ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{r.label}</button>
              ))}
            </div>
            {can('agent:manage') && <Button variant="outline" onClick={() => router.push('/agents/new')}><Bot /> New agent</Button>}
            {can('workflow:create') && <Button onClick={create}><Plus /> New workflow</Button>}
          </>
        }
      />
      {q.error && <ErrorState error={q.error} retry={() => q.refetch()} />}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        {!d ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[104px]" />) : (
          <>
            <Stat label="Workflows" value={formatNumber(d.workflows.total)} icon={<Workflow />} />
            <Stat label="Active" value={formatNumber(d.workflows.active)} icon={<Zap />} sub={`${d.workflows.total ? Math.round((d.workflows.active / d.workflows.total) * 100) : 0}% of workflows`} />
            <Stat label="Executions" value={formatNumber(d.executions.total)} icon={<Activity />} sub={`${d.executions.running} in progress`} />
            <Stat label="Successful" value={formatNumber(d.executions.success)} icon={<CheckCircle2 />} />
            <Stat label="Failed" value={formatNumber(d.executions.failed)} icon={<XCircle />} trend={d.executions.failed ? 'down' : null} sub={d.executions.failed ? 'Needs attention' : 'All good'} />
            <Stat label="Success rate" value={d.executions.successRate === null ? '—' : `${d.executions.successRate}%`} icon={<Gauge />} sub={`avg ${formatDuration(d.executions.avgDurationMs)}`} />
          </>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Executions over time</CardTitle>
            <CardDescription>Successful and failed runs per day</CardDescription>
          </CardHeader>
          <CardContent className="h-[280px]">
            {!d ? <Skeleton className="h-full" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={d.chart} margin={{ left: -20, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="gs" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7c3aed" stopOpacity={0.35} /><stop offset="100%" stopColor="#7c3aed" stopOpacity={0} /></linearGradient>
                    <linearGradient id="gf" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ef4444" stopOpacity={0.3} /><stop offset="100%" stopColor="#ef4444" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef0f4" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(5)} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <RTooltip contentStyle={{ borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 12 }} />
                  <Area type="monotone" dataKey="success" name="Success" stroke="#7c3aed" strokeWidth={2} fill="url(#gs)" />
                  <Area type="monotone" dataKey="failed" name="Failed" stroke="#ef4444" strokeWidth={2} fill="url(#gf)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Most executed</CardTitle><CardDescription>In the selected period</CardDescription></CardHeader>
          <CardContent>
            {!d ? <Skeleton className="h-48" /> : d.topWorkflows.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No executions yet.</p> : (
              <ul className="space-y-3">
                {d.topWorkflows.map((w) => {
                  const max = d.topWorkflows[0]!.executions;
                  return (
                    <li key={w.workflowId}>
                      <Link href={`/workflows/${w.workflowId}`} className="flex items-center justify-between text-sm hover:text-primary">
                        <span className="truncate font-medium">{w.name}</span>
                        <span className="text-xs text-muted-foreground">{formatNumber(w.executions)}</span>
                      </Link>
                      <div className="mt-1.5 h-1.5 rounded-full bg-muted"><div className="brand-gradient h-full rounded-full" style={{ width: `${(w.executions / max) * 100}%` }} /></div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div><CardTitle>Recent errors</CardTitle><CardDescription>Failed executions to investigate</CardDescription></div>
            <Link href="/executions?status=FAILED"><Button variant="ghost" size="sm">View all</Button></Link>
          </CardHeader>
          <CardContent>
            {!d ? <Skeleton className="h-40" /> : d.recentErrors.length === 0 ? (
              <EmptyState className="py-8" icon={<CheckCircle2 />} title="No failures" description="Every execution in this period succeeded." />
            ) : (
              <ul className="divide-y">
                {d.recentErrors.map((e) => (
                  <li key={e.id}>
                    <Link href={`/executions/${e.id}`} className="flex items-start gap-3 py-3 hover:bg-muted/30">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{e.workflow.name}{e.nodeName && <span className="font-normal text-muted-foreground"> · {e.nodeName}</span>}</p>
                        <p className="truncate text-xs text-muted-foreground">{e.message}</p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(e.at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
          <CardContent>
            {!d ? <Skeleton className="h-40" /> : d.recentActivity.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No activity yet.</p> : (
              <ul className="space-y-3">
                {d.recentActivity.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 text-sm">
                    <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1"><p className="truncate"><span className="font-medium">{a.user}</span> · {prettyAction(a.action)}</p><p className="text-xs text-muted-foreground">{timeAgo(a.at)}</p></div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      {d && d.workflows.total === 0 && (
        <EmptyState className="mt-6" icon={<Workflow />} title="Build your first automation" description="Start from a blank canvas or install one of the ready-made templates." action={<div className="flex gap-2"><Button onClick={create}><Plus /> Blank workflow</Button><Link href="/templates"><Button variant="outline">Browse templates</Button></Link></div>} />
      )}
      {d && <div className="mt-6 flex flex-wrap gap-2 text-xs text-muted-foreground"><Badge variant="secondary">{d.agents} AI agents</Badge><Badge variant="secondary">{d.credentials} credentials</Badge></div>}
    </>
  );
}
