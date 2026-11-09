'use client';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Activity, RefreshCw, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/misc';
import { Pagination, Table, TD, TH, THead, TR, useConfirm } from '@/components/ui/extras';
import { post, type Page } from '@/lib/api';
import { useAction, useWorkspace, useWsQuery } from '@/lib/hooks';
import { useRealtime } from '@/lib/socket';
import { formatDate, formatDuration, timeAgo } from '@/lib/utils';

interface Row { id: string; workflowId: string; mode: string; status: string; queuedAt: string; durationMs: number | null; error: { message?: string } | null; workflow: { name: string }; retryOfId: string | null }

const STATUSES = ['', 'QUEUED', 'RUNNING', 'WAITING', 'SUCCESS', 'FAILED', 'CANCELLED'];

function ExecutionsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { workspace, can } = useWorkspace();
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [workflowId, setWorkflowId] = useState(params.get('workflowId') ?? '');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useWsQuery<Page<Row>>(['executions'], '/executions', { status, workflowId, search, page, pageSize: 25 });
  const counts = useWsQuery<Record<string, number>>(['executions', 'counts'], '/executions/counts');
  const workflows = useWsQuery<{ items: Array<{ id: string; name: string }> }>(['workflows', 'all'], '/workflows', { pageSize: 100 });
  const { confirm, dialog } = useConfirm();
  useRealtime({ workspaceId: workspace?.id }, (e) => {
    if (e.type === 'execution.finished' || e.type === 'execution.started' || e.type === 'execution.waiting') {
      void qc.invalidateQueries({ queryKey: [workspace?.id, 'executions'] });
    }
  });
  const cleanup = useAction((days: number) => post<{ deleted: number }>('/executions/bulk-delete', { olderThanDays: days }), { invalidate: [['executions']], success: (r) => `Deleted ${r.deleted} executions` });
  const retry = useAction((id: string) => post<{ executionId: string }>(`/executions/${id}/retry`, {}), { invalidate: [['executions']], success: 'Retry queued' });

  return (
    <>
      <PageHeader icon={<Activity />} title="Executions" description="Every workflow run with node-level detail. Updates live."
        actions={<>
          <Button variant="outline" onClick={() => q.refetch()}><RefreshCw /> Refresh</Button>
          {can('execution:manage') && <Button variant="outline" onClick={async () => { if (await confirm({ title: 'Delete finished executions older than 7 days?', confirmLabel: 'Delete', destructive: true })) cleanup.mutate(7); }}><Trash2 /> Clean up</Button>}
        </>}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button key={s || 'all'} onClick={() => { setStatus(s); setPage(1); }} className={`rounded-full border px-3 py-1 text-xs font-medium ${status === s ? 'border-primary bg-accent text-accent-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}>
            {s ? s[0] + s.slice(1).toLowerCase() : 'All'}{s && counts.data?.[s] ? <span className="ml-1 opacity-70">{counts.data[s]}</span> : null}
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search by workflow name or execution id…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div>
        <Select className="sm:w-64" value={workflowId} onChange={(e) => { setWorkflowId(e.target.value); setPage(1); }}><option value="">All workflows</option>{workflows.data?.items.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
      </div>
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : !q.data ? <Skeleton className="h-96" /> : q.data.items.length === 0 ? (
        <EmptyState icon={<Activity />} title="No executions" description="Run a workflow from the editor, or activate it so triggers start executions." />
      ) : (
        <Card>
          <Table>
            <THead><tr><TH>Workflow</TH><TH>Status</TH><TH className="hidden md:table-cell">Mode</TH><TH className="hidden sm:table-cell">Started</TH><TH className="hidden md:table-cell">Duration</TH><TH /></tr></THead>
            <tbody>
              {q.data.items.map((e) => (
                <TR key={e.id} className="cursor-pointer" onClick={() => router.push(`/executions/${e.id}`)}>
                  <TD><p className="font-medium">{e.workflow.name}</p><p className="font-mono text-[11px] text-muted-foreground">{e.id}</p>{e.error?.message && <p className="mt-0.5 max-w-md truncate text-xs text-red-600">{e.error.message}</p>}</TD>
                  <TD><StatusBadge status={e.status} /></TD>
                  <TD className="hidden md:table-cell"><Badge variant="secondary">{e.mode.toLowerCase()}</Badge>{e.retryOfId && <Badge variant="outline" className="ml-1">retry</Badge>}</TD>
                  <TD className="hidden sm:table-cell"><span title={formatDate(e.queuedAt)} className="text-xs text-muted-foreground">{timeAgo(e.queuedAt)}</span></TD>
                  <TD className="hidden text-xs text-muted-foreground md:table-cell">{formatDuration(e.durationMs)}</TD>
                  <TD onClick={(ev) => ev.stopPropagation()}>{can('execution:manage') && ['SUCCESS', 'FAILED', 'CANCELLED'].includes(e.status) && <Button size="sm" variant="ghost" onClick={() => retry.mutate(e.id)}>Retry</Button>}<Link href={`/workflows/${e.workflowId}`}><Button size="sm" variant="ghost">Open</Button></Link></TD>
                </TR>
              ))}
            </tbody>
          </Table>
          <div className="px-4"><Pagination page={q.data.page} pageCount={q.data.pageCount} total={q.data.total} onPage={setPage} /></div>
        </Card>
      )}
      {dialog}
    </>
  );
}

export default function ExecutionsPage() {
  return <Suspense><ExecutionsInner /></Suspense>;
}
