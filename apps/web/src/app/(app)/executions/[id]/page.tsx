'use client';
import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Background, ReactFlow, ReactFlowProvider, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowLeft, CheckCircle2, CircleStop, Clock, ExternalLink, RotateCcw, ThumbsDown, ThumbsUp, XCircle } from 'lucide-react';
import type { WorkflowDefinition } from '@simplyai/shared';
import { Button } from '@/components/ui/button';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { ErrorState, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { JsonView } from '@/components/ui/extras';
import { nodeTypes } from '@/components/editor/nodes';
import { post } from '@/lib/api';
import { useAction, useNodeCatalog, useWorkspace, useWsQuery } from '@/lib/hooks';
import { useRealtime } from '@/lib/socket';
import { cn, formatDate, formatDuration } from '@/lib/utils';
import { useEditor } from '@/stores/editor';

interface NodeExec { id: string; nodeKey: string; nodeName: string; nodeType: string; status: string; runIndex: number; attempts: number; inputData: unknown; outputData: unknown; error: { message: string; stack?: string; description?: string; httpCode?: number; context?: unknown } | null; itemsIn: number; itemsOut: number; startedAt: string; finishedAt: string | null; durationMs: number | null }
interface Detail {
  id: string; status: string; mode: string; queuedAt: string; startedAt: string | null; finishedAt: string | null; durationMs: number | null; workflowId: string; workflow: { id: string; name: string };
  workflowSnapshot: WorkflowDefinition; inputData: unknown; outputData: unknown; error: { message: string; nodeName?: string; stack?: string } | null; retryOfId: string | null; parentExecutionId: string | null;
  createdBy: { name: string } | null; nodeExecutions: NodeExec[]; waiting: { kind: string; message?: string; until?: string; nodeId: string } | null; children: Array<{ id: string; status: string }>;
}

function simplify(ports: unknown): unknown {
  if (!Array.isArray(ports)) return ports;
  if (ports.length === 1 && Array.isArray(ports[0])) return (ports[0] as Array<{ json: unknown }>).map((i) => i?.json ?? i);
  return Object.fromEntries(ports.map((p, i) => [`port ${i}`, Array.isArray(p) ? p.map((x: { json: unknown }) => x?.json ?? x) : p]));
}

function Graph({ detail, selected, onSelect }: { detail: Detail; selected: string | null; onSelect: (key: string) => void }) {
  const catalog = useNodeCatalog();
  const status = useMemo(() => {
    const m: Record<string, { status: string; itemsOut: number; runs: number; error: unknown }> = {};
    for (const n of detail.nodeExecutions) m[n.nodeKey] = { status: n.status, itemsOut: n.itemsOut, runs: (m[n.nodeKey]?.runs ?? 0) + 1, error: n.error };
    return m;
  }, [detail.nodeExecutions]);
  // the shared node component reads run status and catalog from the editor store
  useEffect(() => {
    if (catalog.data) useEditor.getState().setCatalog(catalog.data);
    useEditor.setState({ runStatus: Object.fromEntries(Object.entries(status).map(([k, v]) => [k, { status: v.status as 'SUCCESS', itemsOut: v.itemsOut, runs: v.runs, error: v.error as { message: string } | null }])) });
  }, [catalog.data, status]);
  const nodes: Node[] = detail.workflowSnapshot.nodes.map((n) => ({ id: n.id, type: 'wf', position: n.position, selected: n.id === selected, data: { name: n.name, type: n.type, parameters: n.parameters, disabled: n.disabled, settings: n.settings } }));
  const edges: Edge[] = detail.workflowSnapshot.connections.map((c) => ({ id: `${c.source}-${c.sourceOutput}-${c.target}-${c.targetInput}`, source: c.source, target: c.target, sourceHandle: `out-${c.sourceOutput}`, targetHandle: `in-${c.targetInput}`, type: 'smoothstep', style: status[c.source]?.status === 'SUCCESS' && status[c.target] ? { stroke: '#7c3aed' } : undefined }));
  if (!catalog.data) return <Skeleton className="h-full" />;
  return (
    <ReactFlowProvider>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView nodesDraggable={false} nodesConnectable={false} onNodeClick={(_, n) => onSelect(n.id)} proOptions={{ hideAttribution: true }} minZoom={0.2} className="canvas-grid">
        <Background gap={18} size={1.2} color="#d6dbe4" />
      </ReactFlow>
    </ReactFlowProvider>
  );
}

export default function ExecutionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const { workspace, can } = useWorkspace();
  const q = useWsQuery<Detail>(['execution', id], `/executions/${id}`, undefined, { refetchInterval: false });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  useRealtime({ workspaceId: workspace?.id, executionId: id }, () => void qc.invalidateQueries({ queryKey: [workspace?.id, 'execution', id] }));
  const refresh = () => qc.invalidateQueries({ queryKey: [workspace?.id, 'execution', id] });
  const retry = useAction((latest: boolean) => post<{ executionId: string }>(`/executions/${id}/retry`, { useLatestVersion: latest }), { success: 'Retry started', onSuccess: (r) => router.push(`/executions/${r.executionId}`) });
  const cancel = useAction(() => post(`/executions/${id}/cancel`), { success: 'Cancellation requested', onSuccess: () => void refresh() });
  const approve = useAction((approved: boolean) => post(`/executions/${id}/approve`, { approved, comment }), { success: 'Decision recorded', onSuccess: () => void refresh() });

  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  if (!q.data) return <Skeleton className="h-[70vh]" />;
  const d = q.data;
  const runs = selectedKey ? d.nodeExecutions.filter((n) => n.nodeKey === selectedKey) : [];
  const run = runs.find((r) => r.id === selectedRun) ?? runs[runs.length - 1] ?? null;
  const t0 = d.startedAt ? new Date(d.startedAt).getTime() : 0;
  const total = Math.max(1, d.durationMs ?? (d.nodeExecutions.length ? Math.max(...d.nodeExecutions.map((n) => new Date(n.finishedAt ?? n.startedAt).getTime() - t0)) : 1));
  const active = ['QUEUED', 'RUNNING', 'WAITING'].includes(d.status);

  return (
    <>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link href="/executions"><Button variant="ghost" size="icon" aria-label="Back"><ArrowLeft /></Button></Link>
          <div>
            <div className="flex items-center gap-2"><h1 className="text-xl font-semibold">{d.workflow.name}</h1><StatusBadge status={d.status} /><Badge variant="secondary">{d.mode.toLowerCase()}</Badge></div>
            <p className="font-mono text-xs text-muted-foreground">{d.id}{d.createdBy && <span className="font-sans"> · started by {d.createdBy.name}</span>}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/workflows/${d.workflowId}`}><Button variant="outline"><ExternalLink /> Open workflow</Button></Link>
          {can('execution:manage') && active && <Button variant="destructive" onClick={() => cancel.mutate()} loading={cancel.isPending}><CircleStop /> Cancel</Button>}
          {can('execution:manage') && !active && <><Button variant="outline" onClick={() => retry.mutate(true)}>Retry with latest version</Button><Button onClick={() => retry.mutate(false)} loading={retry.isPending}><RotateCcw /> Retry</Button></>}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[['Started', formatDate(d.startedAt ?? d.queuedAt)], ['Finished', formatDate(d.finishedAt)], ['Duration', formatDuration(d.durationMs)], ['Nodes executed', `${d.nodeExecutions.length}`]].map(([k, v]) => (
          <div key={k} className="rounded-xl border bg-card p-3"><p className="text-xs text-muted-foreground">{k}</p><p className="mt-0.5 text-sm font-medium">{v}</p></div>
        ))}
      </div>

      {d.error && (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-red-800"><XCircle className="h-4 w-4" /> {d.error.nodeName ? `Failed at “${d.error.nodeName}”` : 'Execution failed'}</p>
          <p className="mt-1 text-red-700">{d.error.message}</p>
        </div>
      )}
      {d.waiting && d.status === 'WAITING' && (
        <Card className="mb-5 border-amber-200 bg-amber-50/60">
          <CardContent className="p-4">
            {d.waiting.kind === 'approval' ? (
              <div className="space-y-3">
                <p className="font-medium text-amber-900">Waiting for approval</p>
                <p className="whitespace-pre-wrap text-sm text-amber-900/90">{d.waiting.message}</p>
                {can('execution:manage') && (
                  <>
                    <Textarea placeholder="Optional comment (available as {{ $json.approval.comment }})" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} className="bg-white" />
                    <div className="flex gap-2"><Button onClick={() => approve.mutate(true)} loading={approve.isPending}><ThumbsUp /> Approve</Button><Button variant="outline" onClick={() => approve.mutate(false)}><ThumbsDown /> Reject</Button></div>
                  </>
                )}
              </div>
            ) : <p className="flex items-center gap-2 text-sm text-amber-900"><Clock className="h-4 w-4" /> Waiting until {formatDate(d.waiting.until)} — resumes automatically.</p>}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-5 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader><CardTitle>Execution graph</CardTitle></CardHeader>
          <CardContent className="h-[380px] p-0"><Graph detail={d} selected={selectedKey} onSelect={(k) => { setSelectedKey(k); setSelectedRun(null); }} /></CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
          <CardContent className="max-h-[380px] space-y-1 overflow-y-auto scrollbar-thin">
            {d.nodeExecutions.length === 0 && <p className="text-sm text-muted-foreground">No nodes have run yet.</p>}
            {d.nodeExecutions.map((n) => {
              const start = new Date(n.startedAt).getTime() - t0;
              const width = Math.max(2, ((n.durationMs ?? 0) / total) * 100);
              return (
                <button key={n.id} onClick={() => { setSelectedKey(n.nodeKey); setSelectedRun(n.id); }} className={cn('w-full rounded-lg px-2 py-1.5 text-left hover:bg-muted', run?.id === n.id && 'bg-accent')}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 font-medium">{n.status === 'SUCCESS' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : n.status === 'FAILED' ? <XCircle className="h-3.5 w-3.5 text-red-600" /> : <Clock className="h-3.5 w-3.5 text-amber-600" />}{n.nodeName}{n.runIndex > 0 && <span className="text-muted-foreground">#{n.runIndex + 1}</span>}</span>
                    <span className="text-muted-foreground">{formatDuration(n.durationMs)} · {n.itemsOut} items</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-muted"><div className={cn('h-full rounded-full', n.status === 'FAILED' ? 'bg-red-400' : 'brand-gradient')} style={{ marginLeft: `${Math.min(98, (start / total) * 100)}%`, width: `${Math.min(width, 100)}%` }} /></div>
                </button>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader><CardTitle>{run ? `${run.nodeName}${runs.length > 1 ? ` · run ${run.runIndex + 1} of ${runs.length}` : ''}` : 'Execution data'}</CardTitle></CardHeader>
        <CardContent>
          {run ? (
            <Tabs defaultValue={run.error ? 'error' : 'output'}>
              <TabsList><TabsTrigger value="output">Output ({run.itemsOut})</TabsTrigger><TabsTrigger value="input">Input ({run.itemsIn})</TabsTrigger>{run.error && <TabsTrigger value="error">Error</TabsTrigger>}</TabsList>
              <TabsContent value="output"><JsonView data={simplify(run.outputData)} /></TabsContent>
              <TabsContent value="input"><JsonView data={simplify(run.inputData)} /></TabsContent>
              {run.error && (
                <TabsContent value="error" className="space-y-3">
                  <p className="text-sm font-medium text-red-700">{run.error.message}{run.error.httpCode ? ` (HTTP ${run.error.httpCode})` : ''}</p>
                  {run.error.description && <p className="text-sm text-muted-foreground">{run.error.description}</p>}
                  {run.attempts > 1 && <p className="text-xs text-muted-foreground">Failed after {run.attempts} attempts.</p>}
                  {run.error.stack && <JsonView data={run.error.stack} maxHeight={240} />}
                  {Boolean(run.error.context) && <JsonView data={run.error.context} maxHeight={240} />}
                </TabsContent>
              )}
            </Tabs>
          ) : (
            <Tabs defaultValue="output">
              <TabsList><TabsTrigger value="output">Final output</TabsTrigger><TabsTrigger value="input">Trigger input</TabsTrigger></TabsList>
              <TabsContent value="output"><JsonView data={simplify(d.outputData ? [d.outputData] : null)} /></TabsContent>
              <TabsContent value="input"><JsonView data={simplify(d.inputData ? [d.inputData] : null)} /></TabsContent>
            </Tabs>
          )}
          <p className="mt-3 text-xs text-muted-foreground">Click a node in the graph or timeline to inspect its data. Secret values are redacted.</p>
        </CardContent>
      </Card>
      {d.children.length > 0 && <p className="mt-4 text-xs text-muted-foreground">Sub-workflow executions: {d.children.map((c) => <Link key={c.id} className="mr-2 text-primary" href={`/executions/${c.id}`}>{c.id.slice(-8)} ({c.status.toLowerCase()})</Link>)}</p>}
      {d.retryOfId && <p className="mt-2 text-xs text-muted-foreground">Retry of <Link className="text-primary" href={`/executions/${d.retryOfId}`}>{d.retryOfId}</Link></p>}
    </>
  );
}
