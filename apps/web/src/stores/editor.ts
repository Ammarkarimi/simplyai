'use client';
import { create } from 'zustand';
import { addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type Edge, type EdgeChange, type Node, type NodeChange } from '@xyflow/react';
import type { NodeDescription, NodeSettings, WorkflowDefinition, WorkflowNodeDef } from '@simplyai/shared';

export interface WfNodeData extends Record<string, unknown> {
  name: string;
  type: string;
  parameters: Record<string, unknown>;
  credentialId?: string | null;
  disabled?: boolean;
  notes?: string | null;
  settings?: NodeSettings;
}
export interface NoteData extends Record<string, unknown> { text: string; color?: string }
export interface GroupData extends Record<string, unknown> { label: string; color?: string }

export type FlowNode = Node<WfNodeData, 'wf'> | Node<NoteData, 'note'> | Node<GroupData, 'group'>;

export interface NodeRunInfo {
  status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'WAITING' | 'CANCELLED' | 'SKIPPED';
  itemsOut?: number;
  durationMs?: number;
  error?: { message: string } | null;
  runs?: number;
}

export interface NodeRunData {
  input: unknown;
  output: unknown;
  error: unknown;
  status: string;
  durationMs: number | null;
  runIndex: number;
}

interface Snapshot { nodes: FlowNode[]; edges: Edge[] }

interface EditorState {
  workflowId: string | null;
  name: string;
  settings: WorkflowDefinition['settings'];
  nodes: FlowNode[];
  edges: Edge[];
  selectedId: string | null;
  dirty: boolean;
  past: Snapshot[];
  future: Snapshot[];
  catalog: Map<string, NodeDescription>;
  runStatus: Record<string, NodeRunInfo>;
  runData: Record<string, NodeRunData[]>;
  executionId: string | null;
  executionStatus: string | null;
  load(id: string, name: string, def: WorkflowDefinition, catalog: NodeDescription[]): void;
  setCatalog(catalog: NodeDescription[]): void;
  setName(name: string): void;
  setSettings(s: WorkflowDefinition['settings']): void;
  onNodesChange(changes: NodeChange<FlowNode>[]): void;
  onEdgesChange(changes: EdgeChange[]): void;
  onConnect(c: Connection): void;
  snapshot(): void;
  undo(): void;
  redo(): void;
  select(id: string | null): void;
  addNode(desc: NodeDescription, position: { x: number; y: number }, connectFrom?: { nodeId: string; handle: string }): string;
  addNote(position: { x: number; y: number }): void;
  groupSelection(): void;
  updateNode(id: string, patch: Partial<WfNodeData>, snapshot?: boolean): void;
  updateParams(id: string, patch: Record<string, unknown>): void;
  updateNote(id: string, patch: Partial<NoteData & GroupData>): void;
  removeNodes(ids: string[]): void;
  duplicate(ids: string[]): void;
  paste(data: { nodes: FlowNode[]; edges: Edge[] }, offset?: { x: number; y: number }): void;
  markSaved(): void;
  resetRun(executionId: string | null): void;
  setRunStatus(nodeId: string, info: NodeRunInfo): void;
  setExecutionStatus(s: string | null): void;
  setRunData(data: Record<string, NodeRunData[]>): void;
  toDefinition(): WorkflowDefinition;
}

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));

function uniqueName(base: string, nodes: FlowNode[]): string {
  const names = new Set(nodes.filter((n) => n.type === 'wf').map((n) => (n.data as WfNodeData).name));
  if (!names.has(base)) return base;
  for (let i = 1; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

function defaultsFor(desc: NodeDescription): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of desc.properties) if (p.default !== undefined && p.type !== 'notice') out[p.name] = structuredClone(p.default);
  return out;
}

export const useEditor = create<EditorState>()((set, get) => ({
  workflowId: null,
  name: '',
  settings: {},
  nodes: [],
  edges: [],
  selectedId: null,
  dirty: false,
  past: [],
  future: [],
  catalog: new Map(),
  runStatus: {},
  runData: {},
  executionId: null,
  executionStatus: null,

  load(id, name, def, catalog) {
    const nodes: FlowNode[] = [
      ...(def.meta?.groups ?? []).map((g) => ({ id: `group-${g.id}`, type: 'group' as const, position: g.position, data: { label: g.label, color: g.color }, style: { width: g.width, height: g.height }, zIndex: -1, selectable: true })),
      ...def.nodes.map((n) => ({ id: n.id, type: 'wf' as const, position: n.position, data: { name: n.name, type: n.type, parameters: n.parameters ?? {}, credentialId: n.credentialId ?? null, disabled: !!n.disabled, notes: n.notes ?? null, settings: n.settings ?? {} } })),
      ...(def.meta?.annotations ?? []).map((a) => ({ id: `note-${a.id}`, type: 'note' as const, position: a.position, data: { text: a.text, color: a.color }, style: { width: a.width ?? 260, height: a.height ?? 120 } })),
    ];
    const edges: Edge[] = def.connections.map((c) => ({ id: `e-${c.source}-${c.sourceOutput}-${c.target}-${c.targetInput}`, source: c.source, target: c.target, sourceHandle: `out-${c.sourceOutput}`, targetHandle: `in-${c.targetInput}` }));
    set({ workflowId: id, name, settings: def.settings ?? {}, nodes, edges, dirty: false, past: [], future: [], selectedId: null, catalog: new Map(catalog.map((c) => [c.type, c])), runStatus: {}, runData: {}, executionId: null, executionStatus: null });
  },
  setCatalog(catalog) {
    set({ catalog: new Map(catalog.map((c) => [c.type, c])) });
  },
  setName(name) {
    set({ name, dirty: true });
  },
  setSettings(settings) {
    set({ settings, dirty: true });
  },
  onNodesChange(changes) {
    const structural = changes.some((c) => c.type === 'remove' || c.type === 'add');
    if (structural) get().snapshot();
    const moved = changes.some((c) => c.type === 'position' && c.dragging === false);
    const dims = changes.some((c) => c.type === 'dimensions' && (c as { resizing?: boolean }).resizing === false);
    set((s) => {
      const removed = changes.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id);
      return {
        nodes: applyNodeChanges(changes, s.nodes),
        edges: removed.length ? s.edges.filter((e) => !removed.includes(e.source) && !removed.includes(e.target)) : s.edges,
        selectedId: removed.includes(s.selectedId ?? '') ? null : s.selectedId,
        dirty: s.dirty || structural || moved || dims,
      };
    });
  },
  onEdgesChange(changes) {
    if (changes.some((c) => c.type === 'remove')) get().snapshot();
    set((s) => ({ edges: applyEdgeChanges(changes, s.edges), dirty: s.dirty || changes.some((c) => c.type === 'remove') }));
  },
  onConnect(c) {
    if (!c.source || !c.target || c.source === c.target) return;
    get().snapshot();
    set((s) => ({ edges: addEdge({ ...c, id: `e-${c.source}-${c.sourceHandle}-${c.target}-${c.targetHandle}` }, s.edges), dirty: true }));
  },
  snapshot() {
    set((s) => ({ past: [...s.past.slice(-60), { nodes: s.nodes, edges: s.edges }], future: [] }));
  },
  undo() {
    const { past, nodes, edges } = get();
    const prev = past[past.length - 1];
    if (!prev) return;
    set((s) => ({ past: past.slice(0, -1), future: [{ nodes, edges }, ...s.future], nodes: prev.nodes, edges: prev.edges, dirty: true }));
  },
  redo() {
    const { future, nodes, edges } = get();
    const next = future[0];
    if (!next) return;
    set((s) => ({ future: future.slice(1), past: [...s.past, { nodes, edges }], nodes: next.nodes, edges: next.edges, dirty: true }));
  },
  select(id) {
    set({ selectedId: id });
  },
  addNode(desc, position, connectFrom) {
    get().snapshot();
    const id = uid();
    const node: FlowNode = { id, type: 'wf', position, data: { name: uniqueName(desc.displayName, get().nodes), type: desc.type, parameters: defaultsFor(desc), credentialId: null, disabled: false, settings: {} } };
    set((s) => ({
      nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), { ...node, selected: true }],
      edges: connectFrom && desc.inputs.length ? [...s.edges, { id: `e-${connectFrom.nodeId}-${connectFrom.handle}-${id}-in-0`, source: connectFrom.nodeId, sourceHandle: connectFrom.handle, target: id, targetHandle: 'in-0' }] : s.edges,
      selectedId: id,
      dirty: true,
    }));
    return id;
  },
  addNote(position) {
    get().snapshot();
    set((s) => ({ nodes: [...s.nodes, { id: `note-${uid()}`, type: 'note', position, data: { text: 'Double-click to edit this note', color: 'yellow' }, style: { width: 260, height: 120 } }], dirty: true }));
  },
  groupSelection() {
    const sel = get().nodes.filter((n) => n.selected && n.type === 'wf');
    if (!sel.length) return;
    get().snapshot();
    const xs = sel.map((n) => n.position.x), ys = sel.map((n) => n.position.y);
    const pad = 40;
    const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad - 24;
    const w = Math.max(...sel.map((n) => n.position.x + (n.measured?.width ?? 220))) - x + pad;
    const h = Math.max(...sel.map((n) => n.position.y + (n.measured?.height ?? 64))) - y + pad;
    set((s) => ({ nodes: [{ id: `group-${uid()}`, type: 'group', position: { x, y }, data: { label: 'Group', color: 'violet' }, style: { width: w, height: h }, zIndex: -1 }, ...s.nodes], dirty: true }));
  },
  updateNode(id, patch, snapshot = true) {
    if (snapshot) get().snapshot();
    set((s) => ({ nodes: s.nodes.map((n) => (n.id === id && n.type === 'wf' ? { ...n, data: { ...(n.data as WfNodeData), ...patch } } : n)) as FlowNode[], dirty: true }));
  },
  updateParams(id, patch) {
    set((s) => ({ nodes: s.nodes.map((n) => (n.id === id && n.type === 'wf' ? { ...n, data: { ...(n.data as WfNodeData), parameters: { ...(n.data as WfNodeData).parameters, ...patch } } } : n)) as FlowNode[], dirty: true }));
  },
  updateNote(id, patch) {
    set((s) => ({ nodes: s.nodes.map((n) => (n.id === id && n.type !== 'wf' ? { ...n, data: { ...n.data, ...patch } } : n)) as FlowNode[], dirty: true }));
  },
  removeNodes(ids) {
    get().snapshot();
    set((s) => ({ nodes: s.nodes.filter((n) => !ids.includes(n.id)), edges: s.edges.filter((e) => !ids.includes(e.source) && !ids.includes(e.target)), selectedId: ids.includes(s.selectedId ?? '') ? null : s.selectedId, dirty: true }));
  },
  duplicate(ids) {
    const nodes = get().nodes.filter((n) => ids.includes(n.id));
    const edges = get().edges.filter((e) => ids.includes(e.source) && ids.includes(e.target));
    get().paste({ nodes, edges }, { x: 40, y: 40 });
  },
  paste(data, offset = { x: 60, y: 60 }) {
    if (!data.nodes.length) return;
    get().snapshot();
    const map = new Map<string, string>();
    const existing = [...get().nodes];
    const nodes = data.nodes.map((n) => {
      const id = n.type === 'wf' ? uid() : `${n.type}-${uid()}`;
      map.set(n.id, id);
      const copy = structuredClone({ ...n, selected: true, id, position: { x: n.position.x + offset.x, y: n.position.y + offset.y } }) as FlowNode;
      if (copy.type === 'wf') {
        const d = copy.data as WfNodeData;
        d.name = uniqueName(d.name, existing);
        if (typeof d.parameters.path === 'string') d.parameters.path = '';
        existing.push(copy);
      }
      return copy;
    });
    const edges = data.edges.filter((e) => map.has(e.source) && map.has(e.target)).map((e) => ({ ...e, id: `e-${uid()}`, source: map.get(e.source)!, target: map.get(e.target)!, selected: false }));
    set((s) => ({ nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), ...nodes], edges: [...s.edges, ...edges], dirty: true }));
  },
  markSaved() {
    set({ dirty: false });
  },
  resetRun(executionId) {
    set({ runStatus: {}, runData: {}, executionId, executionStatus: executionId ? 'QUEUED' : null });
  },
  setRunStatus(nodeId, info) {
    set((s) => ({ runStatus: { ...s.runStatus, [nodeId]: { ...info, runs: (s.runStatus[nodeId]?.runs ?? 0) + (info.status === 'RUNNING' ? 1 : 0) } } }));
  },
  setExecutionStatus(executionStatus) {
    set({ executionStatus });
  },
  setRunData(runData) {
    set({ runData });
  },
  toDefinition() {
    const { nodes, edges, settings } = get();
    const wf = nodes.filter((n): n is Node<WfNodeData, 'wf'> => n.type === 'wf');
    const ids = new Set(wf.map((n) => n.id));
    const defNodes: WorkflowNodeDef[] = wf.map((n) => ({
      id: n.id, name: n.data.name, type: n.data.type, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      parameters: n.data.parameters, credentialId: n.data.credentialId ?? null, disabled: !!n.data.disabled, notes: n.data.notes ?? null, settings: n.data.settings ?? {},
    }));
    return {
      nodes: defNodes,
      connections: edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ source: e.source, target: e.target, sourceOutput: Number(String(e.sourceHandle ?? 'out-0').split('-')[1] ?? 0), targetInput: Number(String(e.targetHandle ?? 'in-0').split('-')[1] ?? 0) })),
      settings: settings ?? {},
      meta: {
        annotations: nodes.filter((n) => n.type === 'note').map((n) => ({ id: n.id.replace(/^note-/, ''), text: (n.data as NoteData).text, color: (n.data as NoteData).color, position: n.position, width: Number(n.measured?.width ?? n.style?.width ?? 260), height: Number(n.measured?.height ?? n.style?.height ?? 120) })),
        groups: nodes.filter((n) => n.type === 'group').map((n) => ({ id: n.id.replace(/^group-/, ''), label: (n.data as GroupData).label, color: (n.data as GroupData).color, position: n.position, width: Number(n.measured?.width ?? n.style?.width ?? 300), height: Number(n.measured?.height ?? n.style?.height ?? 200) })),
      },
    };
  },
}));
