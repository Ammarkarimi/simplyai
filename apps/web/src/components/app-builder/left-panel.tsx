'use client';
/** Left panel: insert components & blocks, layers tree, pages and data. */
import * as React from 'react';
import { ChevronRight, Database, EyeOff, FileText, Home, Layers, Lock, Plus, PlusSquare, Search, Trash2 } from 'lucide-react';
import { emptyPage, uiId, type UINode } from '@simplyai/shared';
import { LucideIcon } from '@/components/icons';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { BLOCKS, CATEGORIES, COMPONENTS, metaFor } from './catalog';
import { buildFromPayload, setDragPayload, type DragPayload } from './canvas';
import { DataPanel } from './data-panel';
import { isContainerType, isDescendant, locate, useBuilder, useCurrentPage, type LeftTab } from './store';

/** Click to append to the selected container (or the page). */
function appendFromPayload(p: DragPayload) {
  const { def, selectedId, pageId, insert } = useBuilder.getState();
  if (!def) return;
  const node = buildFromPayload(p, def);
  if (!node) return;
  const sel = selectedId ? locate(def, selectedId) : null;
  const page = def.pages.find((x) => x.id === pageId) ?? def.pages[0]!;
  if (sel && isContainerType(sel.node.type) && sel.node.type !== 'tabs') insert(sel.node.id, sel.node.children?.length ?? 0, node);
  else if (sel?.parent) insert(sel.parent.id, sel.index + 1, node);
  else insert(page.root.id, page.root.children?.length ?? 0, node);
}

function InsertPanel() {
  const [q, setQ] = React.useState('');
  const [view, setView] = React.useState<'components' | 'blocks'>('components');
  const query = q.trim().toLowerCase();
  const list = COMPONENTS.filter((c) => !query || `${c.label} ${c.type} ${c.keywords ?? ''} ${c.category}`.toLowerCase().includes(query));
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b p-2">
        <div className="relative">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input className="h-8 pl-7 text-xs" placeholder="Search components…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-md bg-muted/50 p-0.5 text-[11px]">
          {(['components', 'blocks'] as const).map((v) => <button key={v} type="button" onClick={() => setView(v)} className={cn('rounded py-1 capitalize', view === v ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground')}>{v}</button>)}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {view === 'components' ? (
          CATEGORIES.map((cat) => {
            const items = list.filter((c) => c.category === cat);
            if (!items.length) return null;
            return (
              <div key={cat} className="mb-3">
                <div className="mb-1.5 px-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{cat}</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {items.map((c) => (
                    <button
                      key={c.type}
                      type="button"
                      draggable
                      title={`${c.description} — drag onto the canvas or click to add`}
                      onDragStart={(e) => { setDragPayload({ kind: 'new', type: c.type }); e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', c.type); }}
                      onDragEnd={() => setDragPayload(null)}
                      onClick={() => appendFromPayload({ kind: 'new', type: c.type })}
                      className="group flex cursor-grab flex-col items-center gap-1 rounded-lg border bg-background px-1 py-2 text-center transition hover:-translate-y-0.5 hover:border-primary hover:shadow-md active:cursor-grabbing"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground transition group-hover:bg-primary/10 group-hover:text-primary"><LucideIcon name={c.icon} className="h-4 w-4" /></span>
                      <span className="line-clamp-2 text-[10.5px] leading-tight">{c.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        ) : (
          <div className="space-y-1.5">
            {BLOCKS.map((b) => (
              <button
                key={b.key}
                type="button"
                draggable
                onDragStart={(e) => { setDragPayload({ kind: 'block', key: b.key }); e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', b.key); }}
                onDragEnd={() => setDragPayload(null)}
                onClick={() => appendFromPayload({ kind: 'block', key: b.key })}
                className="flex w-full cursor-grab items-center gap-2.5 rounded-lg border bg-background p-2 text-left transition hover:border-primary hover:shadow-md"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-gradient-to-br from-primary/20 to-pink-500/20 text-primary"><LucideIcon name={b.icon} className="h-4 w-4" /></span>
                <span className="text-xs font-medium">{b.label}</span>
              </button>
            ))}
            <p className="px-1 pt-2 text-[10.5px] text-muted-foreground">Blocks are ready-made sections. Drag one in and customize everything.</p>
          </div>
        )}
      </div>
      <p className="border-t p-2 text-[10.5px] text-muted-foreground">Tip: click to add into the selected container. Ctrl+C / Ctrl+V copies components, Ctrl+Z undoes.</p>
    </div>
  );
}

function LayerRow({ node, depth, dragging, setDragging }: { node: UINode; depth: number; dragging: string | null; setDragging: (id: string | null) => void }) {
  const selectedId = useBuilder((s) => s.selectedId);
  const hoverId = useBuilder((s) => s.hoverId);
  const [open, setOpen] = React.useState(true);
  const [dropPos, setDropPos] = React.useState<'before' | 'after' | 'inside' | null>(null);
  const meta = metaFor(node.type);
  const kids = node.children ?? [];
  const isRoot = node.type === 'page';
  const container = isContainerType(node.type);
  return (
    <div>
      <div
        draggable={!isRoot && !node.locked}
        onDragStart={(e) => { e.stopPropagation(); setDragging(node.id); setDragPayload({ kind: 'move', id: node.id }); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', node.id); }}
        onDragEnd={() => { setDragging(null); setDragPayload(null); setDropPos(null); }}
        onDragOver={(e) => {
          if (!dragging || dragging === node.id) return;
          const def = useBuilder.getState().def!;
          const moving = locate(def, dragging);
          if (moving && isDescendant(moving.node, node.id)) return;
          e.preventDefault();
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          const y = (e.clientY - r.top) / r.height;
          setDropPos(isRoot ? 'inside' : container && y > 0.3 && y < 0.7 ? 'inside' : y < 0.5 ? 'before' : 'after');
        }}
        onDragLeave={() => setDropPos(null)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const { def, move } = useBuilder.getState();
          const pos = dropPos;
          setDropPos(null);
          if (!dragging || !def || !pos) return;
          if (pos === 'inside') move(dragging, node.id, node.children?.length ?? 0);
          else {
            const loc = locate(def, node.id);
            if (loc?.parent) move(dragging, loc.parent.id, loc.index + (pos === 'after' ? 1 : 0));
          }
          setDragging(null);
        }}
        onClick={() => (isRoot ? useBuilder.getState().set({ focus: { kind: 'page' } }) : useBuilder.getState().select(node.id))}
        onMouseEnter={() => useBuilder.getState().setHover(node.id)}
        onMouseLeave={() => useBuilder.getState().setHover(null)}
        className={cn(
          'group relative flex h-7 cursor-pointer items-center gap-1 rounded pr-1 text-xs',
          selectedId === node.id ? 'bg-primary/15 text-primary' : hoverId === node.id ? 'bg-accent' : 'hover:bg-accent/60',
          dropPos === 'inside' && 'ring-2 ring-inset ring-primary',
          dragging === node.id && 'opacity-40',
        )}
        style={{ paddingLeft: 4 + depth * 12 }}
      >
        {dropPos === 'before' ? <span className="absolute inset-x-1 top-0 h-0.5 rounded bg-primary" /> : null}
        {dropPos === 'after' ? <span className="absolute inset-x-1 bottom-0 h-0.5 rounded bg-primary" /> : null}
        {kids.length ? (
          <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>
            <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
          </button>
        ) : <span className="w-4" />}
        <LucideIcon name={isRoot ? 'file' : meta?.icon ?? 'square'} className="h-3.5 w-3.5 shrink-0 opacity-70" />
        <span className={cn('flex-1 truncate', isRoot && 'font-medium')}>{isRoot ? 'Page body' : node.name}</span>
        {node.visible || node.hideOn?.length ? <EyeOff className="h-3 w-3 text-muted-foreground" /> : null}
        {node.locked ? <Lock className="h-3 w-3 text-muted-foreground" /> : null}
        {!isRoot ? (
          <button type="button" title="Delete" className="hidden rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:block" onClick={(e) => { e.stopPropagation(); useBuilder.getState().remove(node.id); }}><Trash2 className="h-3 w-3" /></button>
        ) : null}
      </div>
      {open && kids.map((k) => <LayerRow key={k.id} node={k} depth={depth + 1} dragging={dragging} setDragging={setDragging} />)}
    </div>
  );
}

function LayersPanel() {
  const page = useCurrentPage();
  const [dragging, setDragging] = React.useState<string | null>(null);
  if (!page) return null;
  return (
    <div className="h-full overflow-y-auto p-2">
      <LayerRow node={page.root} depth={0} dragging={dragging} setDragging={setDragging} />
      <p className="mt-3 px-1 text-[10.5px] text-muted-foreground">Drag layers to reorder or nest them. Drop on the middle of a container to move inside.</p>
    </div>
  );
}

function PagesPanel() {
  const def = useBuilder((s) => s.def)!;
  const pageId = useBuilder((s) => s.pageId);
  const { change, setPage } = useBuilder.getState();
  const add = () => {
    let n = def.pages.length + 1;
    while (def.pages.some((p) => p.path === `page-${n}`)) n++;
    const page = emptyPage(`Page ${n}`, `page-${n}`);
    const taken = new Set<string>();
    def.pages.forEach((p) => taken.add(p.root.name));
    page.root.name = `page${n}Page`;
    if (taken.has(page.root.name)) page.root.name = `page${n}_${uiId('p').slice(-4)}`;
    change((d) => { d.pages.push(page); });
    setPage(page.id);
  };
  return (
    <div className="h-full overflow-y-auto p-2">
      <div className="space-y-1">
        {def.pages.map((p, i) => (
          <div key={p.id} onClick={() => setPage(p.id)} className={cn('group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs', p.id === pageId ? 'bg-primary/10 text-primary' : 'hover:bg-accent')}>
            {i === 0 ? <Home className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
            <span className="flex-1 truncate">{p.name}</span>
            <span className="font-mono text-[10px] text-muted-foreground">/{p.path}</span>
            {p.hidden ? <EyeOff className="h-3 w-3 text-muted-foreground" /> : null}
            {i > 0 ? <button type="button" title="Make home page" className="hidden rounded p-0.5 text-muted-foreground hover:text-foreground group-hover:block" onClick={(e) => { e.stopPropagation(); change((d) => { const [pg] = d.pages.splice(i, 1); d.pages.unshift(pg!); }); }}><Home className="h-3 w-3" /></button> : null}
            {def.pages.length > 1 ? <button type="button" title="Delete page" className="hidden rounded p-0.5 text-muted-foreground hover:text-destructive group-hover:block" onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete page "${p.name}"?`)) { change((d) => { d.pages = d.pages.filter((x) => x.id !== p.id); }); setPage(def.pages.find((x) => x.id !== p.id)!.id); } }}><Trash2 className="h-3 w-3" /></button> : null}
          </div>
        ))}
      </div>
      <button type="button" onClick={add} className="mt-2 flex w-full items-center justify-center gap-1 rounded-md border border-dashed py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"><Plus className="h-3 w-3" />Add page</button>
      <p className="mt-3 px-1 text-[10.5px] text-muted-foreground">The first page is the home page. Link pages with the Go to page action, a Link or the automatic navigation (Theme → Navigation).</p>
    </div>
  );
}

const TABS: Array<{ key: LeftTab; icon: React.ElementType; label: string }> = [
  { key: 'insert', icon: PlusSquare, label: 'Insert' },
  { key: 'layers', icon: Layers, label: 'Layers' },
  { key: 'pages', icon: FileText, label: 'Pages' },
  { key: 'data', icon: Database, label: 'Data' },
];

export function LeftPanel() {
  const tab = useBuilder((s) => s.leftTab);
  return (
    <div className="flex h-full">
      <div className="flex w-12 flex-col items-center gap-1 border-r bg-muted/30 py-2">
        {TABS.map((t) => (
          <button key={t.key} type="button" title={t.label} onClick={() => useBuilder.getState().set({ leftTab: t.key })} className={cn('flex w-10 flex-col items-center gap-0.5 rounded-md py-1.5 text-[9.5px]', tab === t.key ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground')}>
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>
      <div className="w-60 min-w-0">
        {tab === 'insert' ? <InsertPanel /> : tab === 'layers' ? <LayersPanel /> : tab === 'pages' ? <PagesPanel /> : <DataPanel />}
      </div>
    </div>
  );
}
