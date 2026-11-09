'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type FinalConnectionState, type OnConnectEnd } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft, Boxes, CircleStop, History, Loader2, PanelLeft, Play, Redo2, Rocket, Save, Settings, StickyNote, Undo2,
} from 'lucide-react';
import type { NodeDescription, RealtimeEvent, WorkflowDefinition } from '@simplyai/shared';
import { Button } from '@/components/ui/button';
import { StatusBadge, Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd, Spinner, Switch, Tooltip } from '@/components/ui/misc';
import { api, get, patch, post } from '@/lib/api';
import { useNodeCatalog, useWorkspace, useWsQuery } from '@/lib/hooks';
import { useRealtime } from '@/lib/socket';
import { cn, formatDuration } from '@/lib/utils';
import { useEditor, type FlowNode, type NodeRunData } from '@/stores/editor';
import { nodeTypes } from './nodes';
import { Palette } from './palette';
import { ConfigPanel } from './config-panel';
import { PublishDialog, VersionsDialog, WorkflowSettingsDialog } from './dialogs';

interface WorkflowDetail {
  id: string; name: string; active: boolean; definition: WorkflowDefinition; workspaceId: string;
  webhooks: Array<{ nodeKey: string; path: string; kind: string; methods: string[]; active: boolean }>;
  activeVersion: { id: string; version: number } | null; versionCounter: number;
}

interface ExecutionDetail { id: string; status: string; durationMs: number | null; error: { message: string; nodeName?: string } | null; nodeExecutions: Array<{ nodeKey: string; status: string; runIndex: number; inputData: unknown; outputData: unknown; error: unknown; durationMs: number | null; itemsOut: number }> }

const FINISHED = new Set(['SUCCESS', 'FAILED', 'CANCELLED', 'WAITING']);

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || !!t.closest('.cm-editor'));
}

function EditorInner({ workflowId }: { workflowId: string }) {
  const qc = useQueryClient();
  const { workspace, can } = useWorkspace();
  const canEdit = can('workflow:update');
  const canRun = can('workflow:execute');
  const catalog = useNodeCatalog();
  const detail = useWsQuery<WorkflowDetail>(['workflow', workflowId], `/workflows/${workflowId}`, undefined, { staleTime: Infinity });
  const store = useEditor();
  const { nodes, edges, selectedId, dirty, name, executionId, executionStatus } = store;
  const flow = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const loadedFor = useRef<string | null>(null);
  const clipboard = useRef<{ nodes: FlowNode[]; edges: Edge[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [showPalette, setShowPalette] = useState(true);
  const [dialog, setDialog] = useState<'versions' | 'publish' | 'settings' | null>(null);
  const [quickAdd, setQuickAdd] = useState<{ position: { x: number; y: number }; from?: { nodeId: string; handle: string } } | null>(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    if (detail.data && catalog.data && loadedFor.current !== `${workflowId}:${detail.dataUpdatedAt}`) {
      loadedFor.current = `${workflowId}:${detail.dataUpdatedAt}`;
      store.load(workflowId, detail.data.name, detail.data.definition, catalog.data);
      setTimeout(() => flow.fitView({ padding: 0.25, maxZoom: 1.1 }), 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data, detail.dataUpdatedAt, catalog.data, workflowId]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (useEditor.getState().dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const save = useCallback(async (silent = false) => {
    if (!canEdit) return false;
    setSaving(true);
    try {
      const s = useEditor.getState();
      const updated = await patch<WorkflowDetail>(`/workflows/${workflowId}`, { name: s.name.trim() || 'Untitled workflow', definition: s.toDefinition() });
      useEditor.getState().markSaved();
      qc.setQueryData([workspace?.id, 'workflow', workflowId, null], updated);
      if (!silent) toast.success('Workflow saved');
      return true;
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
      return false;
    } finally {
      setSaving(false);
    }
  }, [canEdit, workflowId, qc, workspace?.id]);

  const loadRunData = useCallback(async (exId: string) => {
    const ex = await get<ExecutionDetail>(`/executions/${exId}`);
    const map: Record<string, NodeRunData[]> = {};
    for (const n of ex.nodeExecutions) {
      (map[n.nodeKey] ??= []).push({ input: n.inputData, output: n.outputData, error: n.error, status: n.status, durationMs: n.durationMs, runIndex: n.runIndex });
      useEditor.getState().setRunStatus(n.nodeKey, { status: n.status as 'SUCCESS', itemsOut: n.itemsOut, durationMs: n.durationMs ?? undefined, error: n.error as { message: string } | null });
    }
    useEditor.getState().setRunData(map);
    useEditor.getState().setExecutionStatus(ex.status);
    return ex;
  }, []);

  useRealtime({ workspaceId: workspace?.id, executionId }, (e: RealtimeEvent) => {
    const st = useEditor.getState();
    if (e.type === 'node.started') st.setRunStatus(e.nodeId, { status: 'RUNNING' });
    if (e.type === 'node.finished') st.setRunStatus(e.nodeId, { status: e.status, itemsOut: e.itemsOut, durationMs: e.durationMs, error: e.error ?? null });
    if (e.type === 'execution.started') st.setExecutionStatus('RUNNING');
    if (e.type === 'execution.finished' || e.type === 'execution.waiting') void loadRunData(e.executionId);
  });

  // Polling fallback while an execution is in flight
  useEffect(() => {
    if (!executionId || (executionStatus && FINISHED.has(executionStatus))) return;
    const t = setInterval(() => void loadRunData(executionId).catch(() => undefined), 2000);
    return () => clearInterval(t);
  }, [executionId, executionStatus, loadRunData]);

  useEffect(() => {
    if (executionStatus && FINISHED.has(executionStatus)) setRunning(false);
    if (executionStatus === 'FAILED') toast.error('Execution failed – open the red node to inspect the error');
    if (executionStatus === 'SUCCESS') toast.success('Execution finished successfully');
    if (executionStatus === 'WAITING') toast.info('Execution is waiting (wait or approval step)');
  }, [executionStatus]);

  const execute = useCallback(async (opts: { destinationNodeId?: string; triggerNodeId?: string } = {}) => {
    if (!canRun) return;
    if (useEditor.getState().dirty && canEdit && !(await save(true))) return;
    setRunning(true);
    try {
      const r = await post<{ executionId: string }>(`/workflows/${workflowId}/run`, { definition: useEditor.getState().toDefinition(), ...opts });
      useEditor.getState().resetRun(r.executionId);
    } catch (e) {
      setRunning(false);
      toast.error((e as Error).message);
    }
  }, [canRun, canEdit, save, workflowId]);

  const runTo = useCallback((id: string) => {
    const desc = useEditor.getState().catalog.get((useEditor.getState().nodes.find((n) => n.id === id)?.data as { type: string }).type);
    void execute(desc?.trigger ? { triggerNodeId: id } : { destinationNodeId: id });
  }, [execute]);

  const cancel = async () => {
    if (!executionId) return;
    await post(`/executions/${executionId}/cancel`).catch((e: Error) => toast.error(e.message));
  };

  const publish = async (message: string, activate: boolean) => {
    if (dirty && !(await save(true))) return;
    try {
      const r = await post<{ version: { version: number }; validation: { warnings: string[] } }>(`/workflows/${workflowId}/publish`, { message, activate });
      toast.success(`Published v${r.version.version}${activate ? ' and activated' : ''}`);
      r.validation.warnings.forEach((w) => toast.warning(w));
      await detail.refetch();
    } catch (e) {
      toast.error((e as Error).message);
      throw e;
    }
  };

  const toggleActive = async (on: boolean) => {
    if (on && dirty && !(await save(true))) return;
    setToggling(true);
    try {
      await post(`/workflows/${workflowId}/${on ? 'activate' : 'deactivate'}`);
      toast.success(on ? 'Workflow activated – triggers are live' : 'Workflow deactivated');
      await detail.refetch();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setToggling(false);
    }
  };

  const addAt = useCallback((desc: NodeDescription, position?: { x: number; y: number }, from?: { nodeId: string; handle: string }) => {
    if (!canEdit) return;
    let pos = position;
    if (!pos) {
      const rect = wrapper.current?.getBoundingClientRect();
      pos = flow.screenToFlowPosition({ x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2 - 115, y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2 - 30 });
      const sel = useEditor.getState().nodes.find((n) => n.id === useEditor.getState().selectedId && n.type === 'wf');
      if (sel && !desc.trigger) {
        pos = { x: sel.position.x + 300, y: sel.position.y };
        from = { nodeId: sel.id, handle: 'out-0' };
      }
    }
    useEditor.getState().addNode(desc, pos, from);
  }, [canEdit, flow]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('application/simplyai-node');
    const desc = catalog.data?.find((n) => n.type === type);
    if (desc) addAt(desc, flow.screenToFlowPosition({ x: e.clientX - 115, y: e.clientY - 30 }));
  };

  const onConnectEnd: OnConnectEnd = (event, state: FinalConnectionState) => {
    if (state.isValid || !state.fromNode || state.fromHandle?.type !== 'source' || !canEdit) return;
    const pt = 'changedTouches' in event ? event.changedTouches[0]! : (event as MouseEvent);
    setQuickAdd({ position: flow.screenToFlowPosition({ x: pt.clientX, y: pt.clientY - 30 }), from: { nodeId: state.fromNode.id, handle: state.fromHandle.id ?? 'out-0' } });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); return; }
      if (isTyping(e) || !mod) return;
      const st = useEditor.getState();
      const sel = st.nodes.filter((n) => n.selected).map((n) => n.id);
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); st.undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); st.redo(); }
      else if (k === 'c' && sel.length) { clipboard.current = { nodes: st.nodes.filter((n) => sel.includes(n.id)), edges: st.edges.filter((ed) => sel.includes(ed.source) && sel.includes(ed.target)) }; void navigator.clipboard?.writeText(JSON.stringify({ simplyai: 1, ...clipboard.current })).catch(() => undefined); toast.success(`Copied ${sel.length} node${sel.length > 1 ? 's' : ''}`); }
      else if (k === 'v' && canEdit) {
        e.preventDefault();
        void navigator.clipboard?.readText().then((t) => { try { const d = JSON.parse(t); if (d.simplyai) return st.paste(d); } catch { /* not ours */ } if (clipboard.current) st.paste(clipboard.current); }).catch(() => clipboard.current && st.paste(clipboard.current));
      }
      else if (k === 'd' && sel.length && canEdit) { e.preventDefault(); st.duplicate(sel); }
      else if (k === 'g' && canEdit) { e.preventDefault(); st.groupSelection(); }
      else if (k === 'enter') { e.preventDefault(); void execute(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, execute, canEdit]);

  const flowNodes = useMemo(() => nodes, [nodes]);
  const active = !!detail.data?.active;

  if (detail.error) return <div className="p-10 text-center text-sm text-red-600">{detail.error.message} · <Link href="/workflows" className="underline">Back to workflows</Link></div>;
  if (!detail.data || !catalog.data) return <div className="flex h-screen items-center justify-center"><Spinner className="h-6 w-6" /></div>;

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3">
        <Tooltip content="Back to workflows"><Link href="/workflows"><Button variant="ghost" size="icon" aria-label="Back"><ArrowLeft /></Button></Link></Tooltip>
        <Button variant="ghost" size="icon" onClick={() => setShowPalette(!showPalette)} aria-label="Toggle node panel"><PanelLeft /></Button>
        <input className="min-w-0 max-w-[280px] flex-1 rounded-md bg-transparent px-2 py-1 text-[15px] font-semibold outline-none hover:bg-muted focus:bg-muted" value={name} disabled={!canEdit} onChange={(e) => store.setName(e.target.value)} aria-label="Workflow name" />
        <span className="hidden text-xs text-muted-foreground md:inline">{saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        {detail.data.activeVersion && <Badge variant="secondary" className="hidden md:inline-flex">v{detail.data.activeVersion.version} live</Badge>}
        <div className="ml-auto flex items-center gap-1">
          {canEdit && (
            <>
              <Tooltip content={<>Undo <Kbd>⌘Z</Kbd></>}><Button variant="ghost" size="icon" onClick={store.undo} disabled={!store.past.length} aria-label="Undo"><Undo2 /></Button></Tooltip>
              <Tooltip content={<>Redo <Kbd>⌘⇧Z</Kbd></>}><Button variant="ghost" size="icon" onClick={store.redo} disabled={!store.future.length} aria-label="Redo"><Redo2 /></Button></Tooltip>
              <Tooltip content="Add sticky note"><Button variant="ghost" size="icon" onClick={() => { const r = wrapper.current?.getBoundingClientRect(); store.addNote(flow.screenToFlowPosition({ x: (r?.left ?? 0) + 80, y: (r?.top ?? 0) + 80 })); }} aria-label="Add note"><StickyNote /></Button></Tooltip>
              <Tooltip content={<>Group selected nodes <Kbd>⌘G</Kbd></>}><Button variant="ghost" size="icon" onClick={store.groupSelection} aria-label="Group"><Boxes /></Button></Tooltip>
            </>
          )}
          <Tooltip content="Version history"><Button variant="ghost" size="icon" onClick={() => setDialog('versions')} aria-label="Versions"><History /></Button></Tooltip>
          <Tooltip content="Workflow settings"><Button variant="ghost" size="icon" onClick={() => setDialog('settings')} aria-label="Settings" disabled={!canEdit}><Settings /></Button></Tooltip>
          <div className="mx-2 hidden h-6 w-px bg-border sm:block" />
          {can('workflow:activate') && (
            <label className="hidden items-center gap-2 text-xs font-medium sm:flex">
              {toggling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Switch checked={active} onCheckedChange={toggleActive} aria-label="Active" />}
              <span className={active ? 'text-emerald-600' : 'text-muted-foreground'}>{active ? 'Active' : 'Inactive'}</span>
            </label>
          )}
          {canEdit && <Button variant="outline" size="sm" onClick={() => save()} loading={saving} disabled={!dirty}><Save /> Save</Button>}
          {canEdit && <Button variant="outline" size="sm" onClick={() => setDialog('publish')}><Rocket /> Publish</Button>}
          {canRun && (running ? (
            <Button size="sm" variant="destructive" onClick={cancel}><CircleStop /> Stop</Button>
          ) : (
            <Button size="sm" onClick={() => execute()}><Play /> Execute</Button>
          ))}
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {showPalette && canEdit && <aside className="w-72 shrink-0 border-r bg-card"><Palette catalog={catalog.data} onAdd={(d) => addAt(d)} onAddNote={() => store.addNote(flow.screenToFlowPosition({ x: 400, y: 200 }))} /></aside>}
        <div ref={wrapper} className="relative min-w-0 flex-1" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }} onDrop={onDrop}>
          <ReactFlow
            nodes={flowNodes}
            edges={edges.map((e) => ({ ...e, animated: running && useEditor.getState().runStatus[e.source]?.status === 'SUCCESS' }))}
            nodeTypes={nodeTypes}
            onNodesChange={canEdit ? store.onNodesChange : (c) => store.onNodesChange(c.filter((x) => x.type === 'select' || x.type === 'dimensions'))}
            onEdgesChange={canEdit ? store.onEdgesChange : undefined}
            onConnect={canEdit ? store.onConnect : undefined}
            onConnectEnd={onConnectEnd}
            onNodeClick={(_, n) => store.select(n.type === 'wf' ? n.id : null)}
            onNodeDoubleClick={(_, n) => n.type === 'wf' && store.select(n.id)}
            onPaneClick={() => store.select(null)}
            onNodeDragStart={() => store.snapshot()}
            nodesDraggable={canEdit}
            nodesConnectable={canEdit}
            deleteKeyCode={canEdit ? ['Backspace', 'Delete'] : null}
            multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
            selectionOnDrag={false}
            panOnScroll
            fitView
            minZoom={0.15}
            maxZoom={2}
            defaultEdgeOptions={{ type: 'smoothstep', interactionWidth: 20 }}
            proOptions={{ hideAttribution: true }}
            className="canvas-grid"
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} color="#cbd5e1" />
            <MiniMap pannable zoomable nodeColor={(n) => (n.type === 'note' ? '#fde68a' : n.type === 'group' ? '#ede9fe' : '#a78bfa')} className="!bg-card" />
            <Controls showInteractive={false} />
          </ReactFlow>
          {nodes.filter((n) => n.type === 'wf').length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="pointer-events-auto rounded-2xl border bg-card p-6 text-center shadow-soft">
                <p className="font-semibold">Start with a trigger</p>
                <p className="mt-1 text-sm text-muted-foreground">Drag a node from the left panel or pick a trigger.</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {catalog.data.filter((n) => ['manual', 'webhook', 'schedule', 'form'].includes(n.trigger ?? '')).map((n) => <Button key={n.type} size="sm" variant="outline" onClick={() => addAt(n, { x: 100, y: 200 })}>{n.displayName}</Button>)}
                </div>
              </div>
            </div>
          )}
          {executionId && (
            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border bg-card px-4 py-2 text-xs shadow-lg">
              {executionStatus && <StatusBadge status={executionStatus} />}
              <span className="text-muted-foreground">Execution {executionId.slice(-8)}</span>
              <Link href={`/executions/${executionId}`} className="font-medium text-primary">Details</Link>
              <button className="text-muted-foreground hover:text-foreground" onClick={() => { useEditor.getState().resetRun(null); setRunning(false); }}>Clear</button>
            </div>
          )}
          <div className="absolute right-3 top-3 hidden rounded-lg border bg-card/90 px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur lg:block">
            <Kbd>⌘S</Kbd> save · <Kbd>⌘↵</Kbd> run · <Kbd>⌘C</Kbd>/<Kbd>⌘V</Kbd> copy/paste · <Kbd>⌫</Kbd> delete
          </div>
        </div>
        {selectedId && (
          <aside className={cn('w-[420px] shrink-0 border-l bg-card animate-fade-in')}>
            <ConfigPanel nodeId={selectedId} webhooks={detail.data.webhooks} onRunTo={runTo} canEdit={canEdit} canRun={canRun} />
          </aside>
        )}
      </div>
      <VersionsDialog workflowId={workflowId} open={dialog === 'versions'} onOpenChange={(o) => setDialog(o ? 'versions' : null)} onRestored={() => detail.refetch()} canEdit={canEdit} />
      <PublishDialog open={dialog === 'publish'} onOpenChange={(o) => setDialog(o ? 'publish' : null)} onPublish={publish} active={active} />
      <WorkflowSettingsDialog open={dialog === 'settings'} onOpenChange={(o) => setDialog(o ? 'settings' : null)} workflowId={workflowId} />
      <Dialog open={!!quickAdd} onOpenChange={(o) => !o && setQuickAdd(null)}>
        <DialogContent size="sm" className="h-[70vh] p-0">
          <DialogHeader className="px-4 pt-4"><DialogTitle>Add a connected node</DialogTitle></DialogHeader>
          <div className="h-[calc(70vh-60px)]">
            <Palette catalog={catalog.data.filter((n) => n.inputs.length > 0)} onAdd={(d) => { if (quickAdd) addAt(d, quickAdd.position, quickAdd.from); setQuickAdd(null); }} onAddNote={() => setQuickAdd(null)} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function WorkflowEditor({ workflowId }: { workflowId: string }) {
  return (
    <ReactFlowProvider>
      <EditorInner workflowId={workflowId} />
    </ReactFlowProvider>
  );
}

export { formatDuration, api };
