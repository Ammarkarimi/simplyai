'use client';
/** Builder canvas: renders the page in edit mode with selection, hover and drag & drop. */
import * as React from 'react';
import { ArrowDown, ArrowUp, ArrowUpLeft, Copy, GripVertical, Trash2 } from 'lucide-react';
import { BREAKPOINT_WIDTH, type AppDefinition, type UINode } from '@simplyai/shared';
import { LucideIcon } from '@/components/icons';
import { BLOCKS, metaFor, mk } from './catalog';
import { AppView } from './render';
import type { AppRuntime } from './runtime';
import { cloneFresh, isContainerType, isDescendant, locate, useBuilder, usedNames } from './store';

export type DragPayload = { kind: 'new'; type: string } | { kind: 'block'; key: string } | { kind: 'move'; id: string };

let dragPayload: DragPayload | null = null;
export function setDragPayload(p: DragPayload | null) {
  dragPayload = p;
}
export function getDragPayload() {
  return dragPayload;
}

export function buildFromPayload(p: DragPayload, def: AppDefinition): UINode | null {
  const taken = usedNames(def);
  if (p.kind === 'new') return cloneFresh(mk(p.type), taken);
  if (p.kind === 'block') {
    const block = BLOCKS.find((b) => b.key === p.key);
    return block ? cloneFresh(block.build(), taken) : null;
  }
  return null;
}

interface Drop {
  parentId: string;
  index: number;
  line: { x: number; y: number; w: number; h: number; box?: boolean };
}

const byId = (frame: HTMLElement, id: string) => frame.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);

function layoutOf(el: HTMLElement): 'row' | 'column' | 'grid' {
  const cs = getComputedStyle(el);
  if (cs.display.includes('grid')) return 'grid';
  if (cs.display.includes('flex') && cs.flexDirection.startsWith('row')) return 'row';
  return 'column';
}

/** Where a drop at (x, y) lands inside a container. */
function indexInside(frame: HTMLElement, container: UINode, el: HTMLElement, x: number, y: number): { index: number; line: Drop['line'] } {
  const kids = (container.children ?? []).map((c) => ({ c, el: byId(frame, c.id) })).filter((k): k is { c: UINode; el: HTMLElement } => !!k.el);
  const layout = layoutOf(el);
  const crect = el.getBoundingClientRect();
  if (!kids.length) return { index: 0, line: { x: crect.left + 4, y: crect.top + 4, w: crect.width - 8, h: crect.height - 8, box: true } };
  let index = kids.length;
  for (let i = 0; i < kids.length; i++) {
    const r = kids[i]!.el.getBoundingClientRect();
    if (layout === 'row' ? x < r.left + r.width / 2 : layout === 'column' ? y < r.top + r.height / 2 : y < r.top || (y <= r.bottom && x < r.left + r.width / 2)) {
      index = i;
      break;
    }
  }
  const realIndex = index < kids.length ? (container.children ?? []).indexOf(kids[index]!.c) : (container.children ?? []).length;
  const ref = kids[Math.min(index, kids.length - 1)]!.el.getBoundingClientRect();
  const after = index >= kids.length;
  const line = layout === 'column'
    ? { x: ref.left, y: (after ? ref.bottom : ref.top) - 1.5, w: ref.width, h: 3 }
    : { x: (after ? ref.right : ref.left) - 1.5, y: ref.top, w: 3, h: ref.height };
  return { index: realIndex, line };
}

function computeDrop(frame: HTMLElement, def: AppDefinition, pageRoot: UINode, target: EventTarget | null, x: number, y: number, moving: string | null): Drop | null {
  let el = (target as Element | null)?.closest?.('[data-node-id]') as HTMLElement | null;
  if (!el || !frame.contains(el)) el = byId(frame, pageRoot.id);
  if (!el) return null;
  let loc = locate(def, el.dataset.nodeId!);
  if (!loc) return null;
  if (moving) {
    const m = locate(def, moving);
    if (m && (m.node.id === loc.node.id || isDescendant(m.node, loc.node.id))) {
      if (!m.parent) return null;
      loc = locate(def, m.parent.id);
      el = loc ? byId(frame, loc.node.id) : null;
      if (!loc || !el) return null;
    }
  }
  const node = loc.node;
  const rect = el.getBoundingClientRect();
  const container = isContainerType(node.type) && node.type !== 'tabs';
  if (container) {
    const edge = Math.min(10, rect.height / 4);
    const nearEdge = loc.parent && (y < rect.top + edge || y > rect.bottom - edge);
    if (!nearEdge) {
      const r = indexInside(frame, node, el, x, y);
      return { parentId: node.id, ...r };
    }
  }
  if (!loc.parent) return null;
  const parentEl = byId(frame, loc.parent.id);
  const layout = parentEl ? layoutOf(parentEl) : 'column';
  const after = layout === 'row' ? x > rect.left + rect.width / 2 : y > rect.top + rect.height / 2;
  const line = layout === 'row'
    ? { x: (after ? rect.right : rect.left) - 1.5, y: rect.top, w: 3, h: rect.height }
    : { x: rect.left, y: (after ? rect.bottom : rect.top) - 1.5, w: rect.width, h: 3 };
  return { parentId: loc.parent.id, index: loc.index + (after ? 1 : 0), line };
}

function useRect(frame: React.RefObject<HTMLDivElement | null>, host: React.RefObject<HTMLDivElement | null>, id: string | null) {
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  React.useEffect(() => {
    if (!id) return setRect(null);
    let raf = 0;
    let prev = '';
    const tick = () => {
      const el = frame.current && byId(frame.current, id);
      const h = host.current?.getBoundingClientRect();
      if (el && h) {
        const r = el.getBoundingClientRect();
        const next = new DOMRect(r.left - h.left + host.current!.scrollLeft, r.top - h.top + host.current!.scrollTop, r.width, r.height);
        const key = `${next.x}|${next.y}|${next.width}|${next.height}`;
        if (key !== prev) {
          prev = key;
          setRect(next);
        }
      } else if (prev) {
        prev = '';
        setRect(null);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [id, frame, host]);
  return rect;
}

export function Canvas({ runtime }: { runtime: AppRuntime }) {
  const def = useBuilder((s) => s.def)!;
  const pageId = useBuilder((s) => s.pageId);
  const selectedId = useBuilder((s) => s.selectedId);
  const hoverId = useBuilder((s) => s.hoverId);
  const breakpoint = useBuilder((s) => s.breakpoint);
  const zoom = useBuilder((s) => s.zoom);
  const preview = useBuilder((s) => s.preview);
  const { select, setHover, insert, move } = useBuilder.getState();
  const host = React.useRef<HTMLDivElement>(null);
  const frame = React.useRef<HTMLDivElement>(null);
  const [drop, setDrop] = React.useState<Drop | null>(null);
  const page = def.pages.find((p) => p.id === pageId) ?? def.pages[0]!;
  const selRect = useRect(frame, host, preview ? null : selectedId);
  const hoverRect = useRect(frame, host, preview || hoverId === selectedId ? null : hoverId);
  const selected = selectedId ? locate(def, selectedId) : null;
  const hovered = hoverId ? locate(def, hoverId) : null;

  React.useEffect(() => {
    runtime.mode = preview ? 'preview' : 'edit';
    runtime.store.setState({ pageId: page.id });
    if (preview) void runtime.enterPage(page.id);
  }, [preview, page.id, runtime]);

  const toHost = (r: Drop['line']) => {
    const h = host.current!.getBoundingClientRect();
    return { left: r.x - h.left + host.current!.scrollLeft, top: r.y - h.top + host.current!.scrollTop, width: r.w, height: r.h };
  };

  const width = breakpoint === 'desktop' ? '100%' : BREAKPOINT_WIDTH[breakpoint];

  return (
    <div
      ref={host}
      className="relative flex-1 overflow-auto bg-[radial-gradient(circle,_hsl(var(--border))_1px,_transparent_1px)] [background-size:18px_18px]"
      onMouseDown={(e) => {
        if (!preview && e.target === e.currentTarget) select(null);
      }}
    >
      <div className="flex min-h-full justify-center p-6" style={{ paddingBottom: 120 }}>
        <div
          ref={frame}
          className="relative rounded-xl bg-background shadow-[0_20px_60px_-24px_rgba(0,0,0,0.35)] ring-1 ring-border transition-[width] duration-300"
          style={{ width, maxWidth: breakpoint === 'desktop' ? 1440 : undefined, minHeight: 'calc(100vh - 160px)', zoom, overflow: 'clip' }}
          onClickCapture={(e) => {
            if (preview) return;
            const el = (e.target as Element).closest('[data-node-id]') as HTMLElement | null;
            const tab = (e.target as Element).closest('.sai-tab');
            if (!tab) {
              e.preventDefault();
              e.stopPropagation();
            }
            select(el?.dataset.nodeId === page.root.id ? null : (el?.dataset.nodeId ?? null));
            if (el?.dataset.nodeId === page.root.id) useBuilder.getState().set({ focus: { kind: 'page' } });
          }}
          onMouseOver={(e) => {
            if (preview) return;
            const el = (e.target as Element).closest('[data-node-id]') as HTMLElement | null;
            setHover(el?.dataset.nodeId ?? null);
          }}
          onMouseLeave={() => setHover(null)}
          onDragStart={(e) => {
            if (preview) return;
            const el = (e.target as Element).closest?.('[data-node-id]') as HTMLElement | null;
            if (!el || el.dataset.nodeId === page.root.id) return;
            e.stopPropagation();
            setDragPayload({ kind: 'move', id: el.dataset.nodeId! });
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', el.dataset.nodeId!);
            select(el.dataset.nodeId!);
          }}
          onDragOver={(e) => {
            const p = getDragPayload();
            if (preview || !p || !frame.current) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = p.kind === 'move' ? 'move' : 'copy';
            setDrop(computeDrop(frame.current, def, page.root, e.target, e.clientX, e.clientY, p.kind === 'move' ? p.id : null));
          }}
          onDragLeave={(e) => {
            if (!frame.current?.contains(e.relatedTarget as Node)) setDrop(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            const p = getDragPayload();
            const d = drop ?? (frame.current ? computeDrop(frame.current, def, page.root, e.target, e.clientX, e.clientY, p?.kind === 'move' ? p.id : null) : null);
            setDrop(null);
            setDragPayload(null);
            if (!p || !d) return;
            if (p.kind === 'move') move(p.id, d.parentId, d.index);
            else {
              const node = buildFromPayload(p, def);
              if (node) insert(d.parentId, d.index, node);
            }
          }}
          onDragEnd={() => {
            setDrop(null);
            setDragPayload(null);
          }}
        >
          <AppView runtime={runtime} breakpoint={breakpoint} fill={false} />
        </div>
      </div>

      {!preview && hoverRect && hovered ? (
        <div className="pointer-events-none absolute z-10 rounded-sm border border-dashed border-primary/70" style={{ left: hoverRect.x, top: hoverRect.y, width: hoverRect.width, height: hoverRect.height }}>
          <span className="absolute -top-5 left-0 rounded bg-primary/80 px-1.5 py-0.5 text-[10px] font-medium text-white">{hovered.node.name}</span>
        </div>
      ) : null}

      {!preview && selRect && selected ? (
        <div className="pointer-events-none absolute z-20 rounded-sm ring-2 ring-primary" style={{ left: selRect.x, top: selRect.y, width: selRect.width, height: selRect.height }}>
          <div className={`pointer-events-auto absolute left-0 flex items-center gap-0.5 rounded-md bg-primary px-1 py-0.5 text-white shadow-lg ${selRect.y < 30 ? 'top-full mt-1' : '-top-7'}`}>
            <span
              className="flex cursor-grab items-center gap-1 px-1 text-[11px] font-medium"
              draggable={!!selected.parent && !selected.node.locked}
              onDragStart={(e) => {
                setDragPayload({ kind: 'move', id: selected.node.id });
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', selected.node.id);
              }}
              onDragEnd={() => {
                setDrop(null);
                setDragPayload(null);
              }}
            >
              <GripVertical className="h-3 w-3 opacity-70" />
              <LucideIcon name={metaFor(selected.node.type)?.icon ?? 'square'} className="h-3 w-3" />
              {selected.node.name}
            </span>
            {selected.parent ? (
              <>
                <ToolbarButton title="Select parent (Esc)" onClick={() => select(selected.parent!.type === 'page' ? null : selected.parent!.id)}><ArrowUpLeft className="h-3 w-3" /></ToolbarButton>
                <ToolbarButton title="Move up" disabled={selected.index === 0} onClick={() => move(selected.node.id, selected.parent!.id, selected.index - 1)}><ArrowUp className="h-3 w-3" /></ToolbarButton>
                <ToolbarButton title="Move down" disabled={selected.index >= (selected.parent.children?.length ?? 1) - 1} onClick={() => move(selected.node.id, selected.parent!.id, selected.index + 2)}><ArrowDown className="h-3 w-3" /></ToolbarButton>
                <ToolbarButton title="Duplicate (Ctrl+D)" onClick={() => useBuilder.getState().duplicate(selected.node.id)}><Copy className="h-3 w-3" /></ToolbarButton>
                <ToolbarButton title="Delete (Del)" onClick={() => useBuilder.getState().remove(selected.node.id)}><Trash2 className="h-3 w-3" /></ToolbarButton>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {drop && host.current ? (
        <div className={`pointer-events-none absolute z-30 ${drop.line.box ? 'rounded-lg border-2 border-dashed border-primary bg-primary/10' : 'rounded-full bg-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.25)]'}`} style={toHost(drop.line)} />
      ) : null}
    </div>
  );
}

function ToolbarButton({ children, title, onClick, disabled }: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" title={title} disabled={disabled} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onClick(); }} className="rounded p-1 hover:bg-white/20 disabled:opacity-40">
      {children}
    </button>
  );
}
