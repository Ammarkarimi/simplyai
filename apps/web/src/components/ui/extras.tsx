'use client';
import * as React from 'react';
import { ChevronLeft, ChevronRight, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './dialog';
import { cn, copy } from '@/lib/utils';

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Confirm', destructive, loading, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: React.ReactNode; confirmLabel?: string; destructive?: boolean; loading?: boolean; onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant={destructive ? 'destructive' : 'default'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useConfirm() {
  const [state, setState] = React.useState<{ title: string; description?: React.ReactNode; confirmLabel?: string; destructive?: boolean; resolve: (v: boolean) => void } | null>(null);
  const confirm = React.useCallback((o: { title: string; description?: React.ReactNode; confirmLabel?: string; destructive?: boolean }) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const dialog = state ? (
    <ConfirmDialog open title={state.title} description={state.description} confirmLabel={state.confirmLabel} destructive={state.destructive}
      onOpenChange={(o) => { if (!o) { state.resolve(false); setState(null); } }}
      onConfirm={() => { state.resolve(true); setState(null); }} />
  ) : null;
  return { confirm, dialog };
}

export function Table({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full text-sm', className)} {...p} />
    </div>
  );
}
export const THead = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <thead className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground" {...p} />;
export const TH = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => <th className={cn('px-4 py-2.5 font-medium', className)} {...p} />;
export const TR = ({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) => <tr className={cn('border-b last:border-0 transition-colors hover:bg-muted/30', className)} {...p} />;
export const TD = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn('px-4 py-3 align-middle', className)} {...p} />;

export function Pagination({ page, pageCount, total, onPage }: { page: number; pageCount: number; total: number; onPage: (p: number) => void }) {
  if (pageCount <= 1) return <p className="px-1 py-3 text-xs text-muted-foreground">{total} result{total === 1 ? '' : 's'}</p>;
  return (
    <div className="flex items-center justify-between px-1 py-3 text-xs text-muted-foreground">
      <span>{total} results · page {page} of {pageCount}</span>
      <div className="flex gap-1">
        <Button size="icon-sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft /></Button>
        <Button size="icon-sm" variant="outline" disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight /></Button>
      </div>
    </div>
  );
}

export function CopyButton({ value, className, label }: { value: string; className?: string; label?: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <Button
      type="button" size={label ? 'sm' : 'icon-sm'} variant="ghost" className={className}
      onClick={async () => { await copy(value); setDone(true); toast.success('Copied to clipboard'); setTimeout(() => setDone(false), 1500); }}
      aria-label="Copy"
    >
      {done ? <Check className="text-emerald-600" /> : <Copy />}
      {label}
    </Button>
  );
}

export function CopyField({ value, className }: { value: string; className?: string }) {
  return (
    <div className={cn('flex items-center gap-1 rounded-lg border bg-muted/40 py-1 pl-3 pr-1 font-mono text-xs', className)}>
      <span className="flex-1 truncate">{value}</span>
      <CopyButton value={value} />
    </div>
  );
}

/** Collapsible JSON tree viewer. */
export function JsonView({ data, className, maxHeight = 420 }: { data: unknown; className?: string; maxHeight?: number }) {
  return (
    <div className={cn('overflow-auto rounded-lg border bg-slate-950 p-3 font-mono text-[12px] leading-relaxed text-slate-100 scrollbar-thin', className)} style={{ maxHeight }}>
      <JsonNode value={data} depth={0} />
    </div>
  );
}

function JsonNode({ value, depth, name }: { value: unknown; depth: number; name?: string }) {
  const [open, setOpen] = React.useState(depth < 2);
  const label = name !== undefined ? <span className="text-violet-300">{JSON.stringify(name)}: </span> : null;
  if (value === null || typeof value !== 'object') {
    const color = typeof value === 'string' ? 'text-emerald-300' : typeof value === 'number' ? 'text-amber-300' : typeof value === 'boolean' ? 'text-sky-300' : 'text-slate-400';
    const text = typeof value === 'string' && value.length > 2000 ? JSON.stringify(value.slice(0, 2000) + '…') : JSON.stringify(value);
    return <div className="whitespace-pre-wrap break-all">{label}<span className={color}>{text ?? 'undefined'}</span></div>;
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as object);
  const [o, c] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  return (
    <div>
      <button className="text-left hover:text-white" onClick={() => setOpen(!open)}>
        <span className="mr-1 inline-block w-3 text-slate-500">{open ? '▾' : '▸'}</span>{label}{o}{!open && <span className="text-slate-500"> {entries.length} {Array.isArray(value) ? 'items' : 'keys'} </span>}{!open && c}
      </button>
      {open && (
        <div className="ml-4 border-l border-slate-800 pl-2">
          {entries.slice(0, 500).map(([k, v]) => <JsonNode key={k} name={Array.isArray(value) ? undefined : k} value={v} depth={depth + 1} />)}
          {entries.length > 500 && <div className="text-slate-500">… {entries.length - 500} more</div>}
        </div>
      )}
      {open && <div>{c}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, icon, trend }: { label: string; value: React.ReactNode; sub?: React.ReactNode; icon?: React.ReactNode; trend?: 'up' | 'down' | null }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-soft">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        {icon && <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-primary [&_svg]:h-4 [&_svg]:w-4">{icon}</div>}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {sub && <p className={cn('mt-0.5 text-xs text-muted-foreground', trend === 'down' && 'text-red-600', trend === 'up' && 'text-emerald-600')}>{sub}</p>}
    </div>
  );
}
