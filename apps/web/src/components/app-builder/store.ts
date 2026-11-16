'use client';
/** Builder state: the draft definition, selection, history and view settings. */
import { create } from 'zustand';
import { RESERVED_NAMES, uiId, walkNodes, type AppDefinition, type Breakpoint, type UINode, type UIPage } from '@simplyai/shared';

export type StyleTarget = 'style' | 'hoverStyle' | 'tabletStyle' | 'mobileStyle';
export type LeftTab = 'insert' | 'layers' | 'pages' | 'data';
export type Focus = { kind: 'node' } | { kind: 'query'; id: string } | { kind: 'page' } | { kind: 'theme' } | { kind: 'state' };

// ── Tree helpers (operate on mutable drafts) ──────────────

export interface Located {
  node: UINode;
  parent: UINode | null;
  index: number;
  page: UIPage;
}

export function locate(def: AppDefinition, id: string): Located | null {
  for (const page of def.pages) {
    let found: Located | null = null;
    walkNodes(page.root, (n, parent) => {
      if (!found && n.id === id) found = { node: n, parent, index: parent?.children?.indexOf(n) ?? 0, page };
    });
    if (found) return found;
  }
  return null;
}

export function isDescendant(ancestor: UINode, id: string): boolean {
  let hit = false;
  walkNodes(ancestor, (n) => {
    if (n.id === id) hit = true;
  });
  return hit;
}

export function usedNames(def: AppDefinition): Set<string> {
  const names = new Set<string>(def.queries.map((q) => q.name));
  def.pages.forEach((p) => walkNodes(p.root, (n) => names.add(n.name)));
  return names;
}

export function uniqueName(base: string, taken: Set<string>): string {
  const clean = base.replace(/[^A-Za-z0-9_$]/g, '').replace(/^[^A-Za-z_$]+/, '') || 'item';
  const stem = clean.replace(/\d+$/, '') || clean;
  for (let i = 1; i < 100_000; i++) {
    const name = `${stem}${i}`;
    if (!taken.has(name) && !RESERVED_NAMES.has(name)) {
      taken.add(name);
      return name;
    }
  }
  return `${stem}_${Date.now()}`;
}

/** Deep copy with fresh ids and unique names (paste, duplicate, blocks, palette). */
export function cloneFresh(node: UINode, taken: Set<string>): UINode {
  const copy = structuredClone(node);
  walkNodes(copy, (n) => {
    n.id = uiId('n');
    n.name = uniqueName(n.name || n.type, taken);
    for (const actions of Object.values(n.events ?? {})) actions.forEach((a) => (a.id = uiId('a')));
  });
  return copy;
}

// ── Store ─────────────────────────────────────────────────

interface BuilderState {
  def: AppDefinition | null;
  pageId: string;
  selectedId: string | null;
  hoverId: string | null;
  breakpoint: Breakpoint;
  zoom: number;
  styleTarget: StyleTarget;
  leftTab: LeftTab;
  focus: Focus;
  preview: boolean;
  revision: number;
  past: AppDefinition[];
  future: AppDefinition[];
  lastKey: string | null;
  lastAt: number;
  clipboard: UINode | null;

  load(def: AppDefinition): void;
  change(fn: (draft: AppDefinition) => void, key?: string): void;
  undo(): void;
  redo(): void;
  select(id: string | null): void;
  setHover(id: string | null): void;
  setPage(id: string): void;
  set(patch: Partial<Pick<BuilderState, 'breakpoint' | 'zoom' | 'styleTarget' | 'leftTab' | 'focus' | 'preview' | 'selectedId'>>): void;
  insert(parentId: string, index: number, node: UINode): void;
  move(id: string, parentId: string, index: number): void;
  remove(id: string): void;
  duplicate(id: string): void;
  updateNode(id: string, fn: (n: UINode) => void, key?: string): void;
  copy(id: string): void;
  paste(): void;
}

const HISTORY = 100;

export const useBuilder = create<BuilderState>((set, get) => ({
  def: null,
  pageId: '',
  selectedId: null,
  hoverId: null,
  breakpoint: 'desktop',
  zoom: 1,
  styleTarget: 'style',
  leftTab: 'insert',
  focus: { kind: 'theme' },
  preview: false,
  revision: 0,
  past: [],
  future: [],
  lastKey: null,
  lastAt: 0,
  clipboard: null,

  load(def) {
    set({ def, pageId: def.pages[0]!.id, selectedId: null, past: [], future: [], revision: 0, focus: { kind: 'theme' } });
  },

  change(fn, key) {
    const { def, past, lastKey, lastAt } = get();
    if (!def) return;
    const next = structuredClone(def);
    fn(next);
    const now = Date.now();
    const coalesce = key && key === lastKey && now - lastAt < 800;
    set({
      def: next,
      past: coalesce ? past : [...past.slice(-HISTORY + 1), def],
      future: [],
      lastKey: key ?? null,
      lastAt: now,
      revision: get().revision + 1,
    });
  },

  undo() {
    const { past, def, future } = get();
    if (!past.length || !def) return;
    const prev = past[past.length - 1]!;
    set({ def: prev, past: past.slice(0, -1), future: [def, ...future].slice(0, HISTORY), lastKey: null, revision: get().revision + 1 });
    fixSelection();
  },

  redo() {
    const { past, def, future } = get();
    if (!future.length || !def) return;
    const next = future[0]!;
    set({ def: next, past: [...past, def].slice(-HISTORY), future: future.slice(1), lastKey: null, revision: get().revision + 1 });
    fixSelection();
  },

  select(id) {
    set({ selectedId: id, ...(id ? { focus: { kind: 'node' } as Focus } : {}) });
  },

  setHover(id) {
    if (get().hoverId !== id) set({ hoverId: id });
  },

  setPage(id) {
    set({ pageId: id, selectedId: null, focus: { kind: 'page' } });
  },

  set(patch) {
    set(patch);
  },

  insert(parentId, index, node) {
    get().change((d) => {
      const target = locate(d, parentId);
      if (!target) return;
      target.node.children ??= [];
      target.node.children.splice(Math.max(0, Math.min(index, target.node.children.length)), 0, node);
    });
    set({ selectedId: node.id, focus: { kind: 'node' } });
  },

  move(id, parentId, index) {
    get().change((d) => {
      const from = locate(d, id);
      const to = locate(d, parentId);
      if (!from?.parent || !to || from.node.id === parentId || isDescendant(from.node, parentId)) return;
      const siblings = from.parent.children!;
      siblings.splice(from.index, 1);
      let i = index;
      if (from.parent.id === to.node.id && from.index < index) i -= 1;
      to.node.children ??= [];
      to.node.children.splice(Math.max(0, Math.min(i, to.node.children.length)), 0, from.node);
    });
  },

  remove(id) {
    const def = get().def;
    const loc = def && locate(def, id);
    if (!loc?.parent) return;
    get().change((d) => {
      const l = locate(d, id);
      l?.parent?.children?.splice(l.index, 1);
    });
    set({ selectedId: loc.parent.type === 'page' ? null : loc.parent.id });
  },

  duplicate(id) {
    const def = get().def;
    const loc = def && locate(def, id);
    if (!def || !loc?.parent) return;
    const copy = cloneFresh(loc.node, usedNames(def));
    get().insert(loc.parent.id, loc.index + 1, copy);
  },

  updateNode(id, fn, key) {
    get().change((d) => {
      const l = locate(d, id);
      if (l) fn(l.node);
    }, key ? `${id}:${key}` : undefined);
  },

  copy(id) {
    const def = get().def;
    const loc = def && locate(def, id);
    if (loc && loc.node.type !== 'page') set({ clipboard: structuredClone(loc.node) });
  },

  paste() {
    const { clipboard, def, selectedId, pageId } = get();
    if (!clipboard || !def) return;
    const node = cloneFresh(clipboard, usedNames(def));
    const sel = selectedId ? locate(def, selectedId) : null;
    const page = def.pages.find((p) => p.id === pageId) ?? def.pages[0]!;
    if (sel && isContainerType(sel.node.type) && sel.node.type !== 'tabs') get().insert(sel.node.id, sel.node.children?.length ?? 0, node);
    else if (sel?.parent) get().insert(sel.parent.id, sel.index + 1, node);
    else get().insert(page.root.id, page.root.children?.length ?? 0, node);
  },
}));

function fixSelection() {
  const { def, selectedId, pageId } = useBuilder.getState();
  if (!def) return;
  if (!def.pages.some((p) => p.id === pageId)) useBuilder.setState({ pageId: def.pages[0]!.id });
  if (selectedId && !locate(def, selectedId)) useBuilder.setState({ selectedId: null });
}

const CONTAINERS = new Set(['page', 'container', 'grid', 'card', 'tabs', 'modal', 'list', 'form']);
export const isContainerType = (t: string) => CONTAINERS.has(t);

export function useCurrentPage(): UIPage | null {
  const def = useBuilder((s) => s.def);
  const pageId = useBuilder((s) => s.pageId);
  return def?.pages.find((p) => p.id === pageId) ?? def?.pages[0] ?? null;
}

export function useSelected(): Located | null {
  const def = useBuilder((s) => s.def);
  const id = useBuilder((s) => s.selectedId);
  return def && id ? locate(def, id) : null;
}
