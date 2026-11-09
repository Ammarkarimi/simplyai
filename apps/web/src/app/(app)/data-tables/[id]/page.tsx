'use client';
import Link from 'next/link';
import { use, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Columns3, Download, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Select } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/misc';
import { Pagination, Table, TD, TH, THead, TR, useConfirm } from '@/components/ui/extras';
import { api, del, patch, post, type Page } from '@/lib/api';
import { useWorkspace, useWsQuery } from '@/lib/hooks';
import { download, timeAgo } from '@/lib/utils';

interface Column { id: string; name: string; type: string }
interface TableDetail { id: string; name: string; description: string | null; columns: Column[] }
interface Row { id: string; data: Record<string, unknown>; createdAt: string; updatedAt: string }

function display(v: unknown) {
  if (v === null || v === undefined) return <span className="text-muted-foreground">—</span>;
  if (typeof v === 'boolean') return <Badge variant={v ? 'success' : 'secondary'}>{String(v)}</Badge>;
  if (typeof v === 'object') return <span className="font-mono text-xs">{JSON.stringify(v).slice(0, 80)}</span>;
  return String(v);
}

export default function DataTablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { can } = useWorkspace();
  const editable = can('datatable:manage');
  const t = useWsQuery<TableDetail>(['data-table', id], `/data-tables/${id}`);
  const [search, setSearch] = useState('');
  const [filterColumn, setFilterColumn] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [sort, setSort] = useState('');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const rows = useWsQuery<Page<Row>>(['data-table-rows', id], `/data-tables/${id}/rows`, { search, filterColumn, filterValue, sort, order, page, pageSize: 50 });
  const [edit, setEdit] = useState<Partial<Row> | null>(null);
  const [colDialog, setColDialog] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { confirm, dialog } = useConfirm();
  if (t.error) return <ErrorState error={t.error} />;
  if (!t.data) return <Skeleton className="h-96" />;
  const cols = t.data.columns;
  const refresh = () => { void rows.refetch(); void t.refetch(); };

  const importCsv = async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    try {
      const r = await api<{ imported: number; columnsCreated: number }>(`/data-tables/${id}/import`, { method: 'POST', form });
      toast.success(`Imported ${r.imported} rows${r.columnsCreated ? `, created ${r.columnsCreated} columns` : ''}`);
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  };
  const exportCsv = async () => {
    const res = await api<Response>(`/data-tables/${id}/export`, { raw: true });
    download(`${t.data!.name}.csv`, await res.text(), 'text/csv');
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link href="/data-tables"><Button variant="ghost" size="icon" aria-label="Back"><ArrowLeft /></Button></Link>
        <div className="min-w-0 flex-1"><h1 className="text-xl font-semibold">{t.data.name}</h1><p className="text-xs text-muted-foreground">{rows.data?.total ?? 0} rows · {cols.length} columns · id <code>{id}</code></p></div>
        <Button variant="outline" onClick={exportCsv}><Download /> Export CSV</Button>
        {editable && <>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
          <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload /> Import CSV</Button>
          <Button variant="outline" onClick={() => setColDialog(true)}><Columns3 /> Columns</Button>
          <Button onClick={() => setEdit({ data: {} })}><Plus /> Add row</Button>
          <Button variant="ghost" aria-label="Delete table" onClick={async () => { if (await confirm({ title: `Delete table ${t.data!.name}?`, description: 'All rows will be deleted.', destructive: true, confirmLabel: 'Delete' })) { await del(`/data-tables/${id}`); router.push('/data-tables'); } }}><Trash2 /></Button>
        </>}
      </div>
      <div className="mb-4 flex flex-col gap-2 lg:flex-row">
        <div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search all columns…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div>
        <Select className="lg:w-44" value={filterColumn} onChange={(e) => setFilterColumn(e.target.value)}><option value="">Filter column…</option>{cols.map((c) => <option key={c.id}>{c.name}</option>)}</Select>
        <Input className="lg:w-44" placeholder="equals…" value={filterValue} disabled={!filterColumn} onChange={(e) => { setFilterValue(e.target.value); setPage(1); }} />
        <Select className="lg:w-44" value={sort} onChange={(e) => setSort(e.target.value)}><option value="">Sort: created</option>{cols.map((c) => <option key={c.id} value={c.name}>Sort: {c.name}</option>)}</Select>
        <Select className="lg:w-28" value={order} onChange={(e) => setOrder(e.target.value as 'asc')}><option value="desc">Desc</option><option value="asc">Asc</option></Select>
      </div>
      {!rows.data ? <Skeleton className="h-64" /> : rows.data.items.length === 0 ? <EmptyState icon={<Plus />} title="No rows" description="Add rows manually, import a CSV or write to this table from a workflow." /> : (
        <Card>
          <Table>
            <THead><tr>{cols.map((c) => <TH key={c.id}>{c.name} <span className="normal-case text-[10px] opacity-60">{c.type.toLowerCase()}</span></TH>)}<TH className="hidden md:table-cell">Updated</TH><TH /></tr></THead>
            <tbody>{rows.data.items.map((r) => (
              <TR key={r.id}>
                {cols.map((c) => <TD key={c.id} className="max-w-[240px] truncate">{display(r.data[c.name])}</TD>)}
                <TD className="hidden text-xs text-muted-foreground md:table-cell">{timeAgo(r.updatedAt)}</TD>
                <TD className="whitespace-nowrap">{editable && <><Button size="icon-sm" variant="ghost" onClick={() => setEdit(r)} aria-label="Edit"><Pencil /></Button><Button size="icon-sm" variant="ghost" aria-label="Delete row" onClick={async () => { await del(`/data-tables/${id}/rows/${r.id}`); refresh(); }}><Trash2 /></Button></>}</TD>
              </TR>
            ))}</tbody>
          </Table>
          <div className="px-4"><Pagination page={rows.data.page} pageCount={rows.data.pageCount} total={rows.data.total} onPage={setPage} /></div>
        </Card>
      )}
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        {edit && (
          <DialogContent>
            <DialogHeader><DialogTitle>{edit.id ? 'Edit row' : 'Add row'}</DialogTitle></DialogHeader>
            <form className="space-y-3" onSubmit={async (e) => {
              e.preventDefault();
              const data = Object.fromEntries(new FormData(e.currentTarget).entries());
              for (const c of cols) if (c.type === 'BOOLEAN') data[c.name] = String((e.currentTarget.elements.namedItem(c.name) as HTMLInputElement).checked);
              try {
                if (edit.id) await patch(`/data-tables/${id}/rows/${edit.id}`, { data });
                else await post(`/data-tables/${id}/rows`, { data });
                setEdit(null);
                refresh();
              } catch (err) { toast.error((err as Error).message); }
            }}>
              {cols.map((c) => {
                const v = edit.data?.[c.name];
                return (
                  <Field key={c.id} label={`${c.name} (${c.type.toLowerCase()})`}>
                    {c.type === 'BOOLEAN' ? <input type="checkbox" name={c.name} defaultChecked={v === true} className="h-4 w-4" />
                      : <Input name={c.name} type={c.type === 'NUMBER' ? 'number' : 'text'} step="any" defaultValue={v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)} placeholder={c.type === 'DATE' ? '2026-01-31' : c.type === 'JSON' ? '{"key": "value"}' : ''} />}
                  </Field>
                );
              })}
              <DialogFooter><Button type="submit">Save</Button></DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>
      <Dialog open={colDialog} onOpenChange={setColDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Columns</DialogTitle></DialogHeader>
          <ul className="divide-y rounded-lg border">{cols.map((c) => <li key={c.id} className="flex items-center justify-between p-2.5 text-sm"><span>{c.name} <Badge variant="secondary">{c.type.toLowerCase()}</Badge></span><Button size="icon-sm" variant="ghost" aria-label="Remove column" onClick={async () => { if (await confirm({ title: `Remove column ${c.name}?`, description: 'Values in this column are deleted from every row.', destructive: true, confirmLabel: 'Remove' })) { await del(`/data-tables/${id}/columns/${c.id}`); refresh(); } }}><Trash2 /></Button></li>)}</ul>
          <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); try { await post(`/data-tables/${id}/columns`, { name: f.get('name'), type: f.get('type') }); (e.target as HTMLFormElement).reset(); refresh(); } catch (err) { toast.error((err as Error).message); } }}>
            <Input name="name" placeholder="new_column" required /><Select name="type" className="w-32">{['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'JSON'].map((x) => <option key={x}>{x}</option>)}</Select><Button type="submit"><Plus /></Button>
          </form>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
}
