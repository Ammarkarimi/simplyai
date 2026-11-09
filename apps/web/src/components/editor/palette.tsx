'use client';
import { useMemo, useState } from 'react';
import { ChevronDown, Search, StickyNote } from 'lucide-react';
import { NODE_CATEGORIES, type NodeDescription } from '@simplyai/shared';
import { Input } from '@/components/ui/input';
import { NodeIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

export function Palette({ catalog, onAdd, onAddNote }: { catalog: NodeDescription[]; onAdd: (d: NodeDescription) => void; onAddNote: () => void }) {
  const [search, setSearch] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({ business: true, communication: true, developer: true });
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? catalog.filter((n) => `${n.displayName} ${n.description} ${n.subcategory ?? ''} ${n.integration ?? ''}`.toLowerCase().includes(s)) : catalog;
  }, [catalog, search]);
  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input autoFocus placeholder="Search nodes…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
        {NODE_CATEGORIES.map((cat) => {
          const items = filtered.filter((n) => n.category === cat.key);
          if (!items.length) return null;
          const isClosed = !search && closed[cat.key];
          return (
            <div key={cat.key} className="mb-1">
              <button className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted" onClick={() => setClosed((c) => ({ ...c, [cat.key]: !isClosed }))}>
                {cat.label} <span className="flex items-center gap-1 font-normal normal-case">{items.length}<ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isClosed && '-rotate-90')} /></span>
              </button>
              {!isClosed && items.map((n) => (
                <button
                  key={n.type}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('application/simplyai-node', n.type); e.dataTransfer.effectAllowed = 'move'; }}
                  onClick={() => onAdd(n)}
                  className="flex w-full cursor-grab items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent active:cursor-grabbing"
                  title={n.description}
                >
                  <NodeIcon icon={n.icon} color={n.color} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{n.displayName}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{n.description}</p>
                  </div>
                </button>
              ))}
            </div>
          );
        })}
        {!filtered.length && <p className="p-4 text-center text-sm text-muted-foreground">No nodes match “{search}”.</p>}
        <button onClick={onAddNote} className="mt-2 flex w-full items-center gap-2.5 rounded-lg border border-dashed px-2 py-2 text-[13px] text-muted-foreground hover:bg-muted"><StickyNote className="h-4 w-4" /> Add sticky note</button>
      </div>
    </div>
  );
}
