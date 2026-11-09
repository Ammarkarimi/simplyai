'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Table2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/misc';
import { post } from '@/lib/api';
import { useWorkspace, useWsQuery } from '@/lib/hooks';
import { formatNumber, timeAgo } from '@/lib/utils';

interface TableRow { id: string; name: string; description: string | null; rowCount: number; updatedAt: string; columns: Array<{ id: string; name: string; type: string }> }
const TYPES = ['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'JSON'];

export default function DataTablesPage() {
  const router = useRouter();
  const { can } = useWorkspace();
  const q = useWsQuery<TableRow[]>(['data-tables'], '/data-tables');
  const [open, setOpen] = useState(false);
  const [cols, setCols] = useState([{ name: 'name', type: 'TEXT' }, { name: 'email', type: 'TEXT' }]);
  return (
    <>
      <PageHeader icon={<Table2 />} title="Data Tables" description="Lightweight tables for storing workflow data — read and write them with the Data Table node or agent tools."
        actions={can('datatable:manage') && <Button onClick={() => setOpen(true)}><Plus /> New table</Button>} />
      {q.error ? <ErrorState error={q.error} /> : !q.data ? <Skeleton className="h-40" /> : q.data.length === 0 ? (
        <EmptyState icon={<Table2 />} title="No tables" description="Create a table to persist leads, orders, logs or any structured data." action={can('datatable:manage') && <Button onClick={() => setOpen(true)}><Plus /> New table</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((t) => (
            <Link key={t.id} href={`/data-tables/${t.id}`}>
              <Card className="h-full p-4 hover:shadow-lift">
                <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-primary"><Table2 className="h-5 w-5" /></div><div><p className="font-semibold">{t.name}</p><p className="text-xs text-muted-foreground">{formatNumber(t.rowCount)} rows · updated {timeAgo(t.updatedAt)}</p></div></div>
                {t.description && <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{t.description}</p>}
                <div className="mt-3 flex flex-wrap gap-1">{t.columns.slice(0, 8).map((c) => <Badge key={c.id} variant="secondary">{c.name}</Badge>)}</div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New data table</DialogTitle><DialogDescription>You can add or remove columns later.</DialogDescription></DialogHeader>
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              const t = await post<{ id: string }>('/data-tables', { name: f.get('name'), description: f.get('description') || null, columns: cols.filter((c) => c.name.trim()) });
              toast.success('Table created');
              router.push(`/data-tables/${t.id}`);
            } catch (err) { toast.error((err as Error).message); }
          }}>
            <Field label="Name"><Input name="name" required placeholder="Leads" /></Field>
            <Field label="Description"><Textarea name="description" rows={2} /></Field>
            <div className="space-y-2">
              <p className="text-[13px] font-medium">Columns</p>
              {cols.map((c, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={c.name} onChange={(e) => setCols(cols.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="column_name" />
                  <Select className="w-36" value={c.type} onChange={(e) => setCols(cols.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>{TYPES.map((t) => <option key={t}>{t}</option>)}</Select>
                  <Button type="button" variant="ghost" size="icon" onClick={() => setCols(cols.filter((_, j) => j !== i))} aria-label="Remove column"><Trash2 /></Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setCols([...cols, { name: '', type: 'TEXT' }])}><Plus /> Column</Button>
            </div>
            <DialogFooter><Button type="submit">Create table</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
