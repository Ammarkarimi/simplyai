'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Download, MoreHorizontal, Play, Plus, Search, Trash2, Upload, Workflow } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, PageHeader, Skeleton, Switch } from '@/components/ui/misc';
import { Pagination, Table, TD, TH, THead, TR, useConfirm } from '@/components/ui/extras';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/menu';
import { NodeIcon } from '@/components/icons';
import { del, get, post, type Page } from '@/lib/api';
import { useAction, useNodeCatalog, useWorkspace, useWsQuery } from '@/lib/hooks';
import { download, timeAgo } from '@/lib/utils';

interface WorkflowRow { id: string; name: string; description: string | null; active: boolean; tags: string[]; updatedAt: string; nodeTypes: string[]; nodeCount: number; executionCount: number; lastExecution: { id: string; status: string; queuedAt: string } | null; createdBy: { name: string } | null }

export default function WorkflowsPage() {
  const router = useRouter();
  const { can } = useWorkspace();
  const [search, setSearch] = useState('');
  const [active, setActive] = useState('');
  const [tag, setTag] = useState('');
  const [page, setPage] = useState(1);
  const q = useWsQuery<Page<WorkflowRow>>(['workflows'], '/workflows', { search, active, tag, page, pageSize: 20 });
  const tags = useWsQuery<string[]>(['workflow-tags'], '/workflows/tags');
  const catalog = useNodeCatalog();
  const { confirm, dialog } = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const nodeDesc = (type: string) => catalog.data?.find((n) => n.type === type);

  const toggle = useAction(({ id, on }: { id: string; on: boolean }) => post(`/workflows/${id}/${on ? 'activate' : 'deactivate'}`), { invalidate: [['workflows']], success: (r: { active: boolean }) => (r.active ? 'Workflow activated' : 'Workflow deactivated') });
  const remove = useAction((id: string) => del(`/workflows/${id}`), { invalidate: [['workflows']], success: 'Workflow deleted' });
  const duplicate = useAction((id: string) => post<{ id: string }>(`/workflows/${id}/duplicate`), { invalidate: [['workflows']], success: 'Workflow duplicated' });
  const run = useAction((id: string) => post<{ executionId: string }>(`/workflows/${id}/run`, {}), { success: 'Execution started', onSuccess: (r) => router.push(`/executions/${r.executionId}`) });
  const create = useAction(() => post<{ id: string }>('/workflows', { name: 'Untitled workflow' }), { onSuccess: (r) => router.push(`/workflows/${r.id}`) });

  const importFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const wf = await post<{ id: string }>('/workflows/import', { name: data.name ?? file.name.replace(/\.json$/, ''), description: data.description, tags: data.tags, definition: data.definition ?? data });
      toast.success('Workflow imported');
      router.push(`/workflows/${wf.id}`);
    } catch (e) {
      toast.error(`Import failed: ${(e as Error).message}`);
    }
  };

  return (
    <>
      <PageHeader
        icon={<Workflow />}
        title="Workflows"
        description="Design, version and run your automations."
        actions={can('workflow:create') && (
          <>
            <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
            <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload /> Import</Button>
            <Button onClick={() => create.mutate()} loading={create.isPending}><Plus /> New workflow</Button>
          </>
        )}
      />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input placeholder="Search workflows…" className="pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div>
        <Select className="sm:w-40" value={active} onChange={(e) => { setActive(e.target.value); setPage(1); }}><option value="">All statuses</option><option value="true">Active</option><option value="false">Inactive</option></Select>
        <Select className="sm:w-40" value={tag} onChange={(e) => { setTag(e.target.value); setPage(1); }}><option value="">All tags</option>{tags.data?.map((t) => <option key={t}>{t}</option>)}</Select>
      </div>
      {q.error ? <ErrorState error={q.error} retry={() => q.refetch()} /> : !q.data ? <Skeleton className="h-80" /> : q.data.items.length === 0 ? (
        <EmptyState icon={<Workflow />} title={search || active || tag ? 'No matching workflows' : 'No workflows yet'} description="Create a workflow from scratch, import a JSON export or start from a template." action={can('workflow:create') && <div className="flex gap-2"><Button onClick={() => create.mutate()}><Plus /> New workflow</Button><Link href="/templates"><Button variant="outline">Templates</Button></Link></div>} />
      ) : (
        <Card>
          <Table>
            <THead><tr><TH>Name</TH><TH className="hidden md:table-cell">Nodes</TH><TH className="hidden lg:table-cell">Last run</TH><TH className="hidden sm:table-cell">Updated</TH><TH>Active</TH><TH className="w-10" /></tr></THead>
            <tbody>
              {q.data.items.map((w) => (
                <TR key={w.id} className="cursor-pointer" onClick={() => router.push(`/workflows/${w.id}`)}>
                  <TD>
                    <p className="font-medium">{w.name}</p>
                    <div className="mt-1 flex flex-wrap gap-1">{w.tags.slice(0, 4).map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}{w.description && <span className="truncate text-xs text-muted-foreground">{w.description.slice(0, 80)}</span>}</div>
                  </TD>
                  <TD className="hidden md:table-cell">
                    <div className="flex items-center -space-x-1.5">
                      {w.nodeTypes.slice(0, 5).map((t) => { const n = nodeDesc(t); return n ? <NodeIcon key={t} icon={n.icon} color={n.color} size="sm" className="ring-2 ring-card" /> : null; })}
                      {w.nodeTypes.length > 5 && <span className="pl-3 text-xs text-muted-foreground">+{w.nodeTypes.length - 5}</span>}
                    </div>
                  </TD>
                  <TD className="hidden lg:table-cell">{w.lastExecution ? <div className="flex items-center gap-2"><StatusBadge status={w.lastExecution.status} /><span className="text-xs text-muted-foreground">{timeAgo(w.lastExecution.queuedAt)}</span></div> : <span className="text-xs text-muted-foreground">Never</span>}</TD>
                  <TD className="hidden text-xs text-muted-foreground sm:table-cell">{timeAgo(w.updatedAt)}</TD>
                  <TD onClick={(e) => e.stopPropagation()}><Switch checked={w.active} disabled={!can('workflow:activate') || toggle.isPending} onCheckedChange={(on) => toggle.mutate({ id: w.id, on })} aria-label="Toggle active" /></TD>
                  <TD onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {can('workflow:execute') && <DropdownMenuItem onSelect={() => run.mutate(w.id)}><Play /> Run now</DropdownMenuItem>}
                        {can('workflow:create') && <DropdownMenuItem onSelect={() => duplicate.mutate(w.id)}><Copy /> Duplicate</DropdownMenuItem>}
                        <DropdownMenuItem onSelect={async () => { const data = await get(`/workflows/${w.id}/export`); download(`${w.name.replace(/[^\w-]+/g, '_')}.json`, JSON.stringify(data, null, 2)); }}><Download /> Export JSON</DropdownMenuItem>
                        {can('workflow:delete') && (<><DropdownMenuSeparator /><DropdownMenuItem destructive onSelect={async () => { if (await confirm({ title: `Delete "${w.name}"?`, description: 'The workflow, its versions and execution history will be removed. This cannot be undone.', confirmLabel: 'Delete', destructive: true })) remove.mutate(w.id); }}><Trash2 /> Delete</DropdownMenuItem></>)}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
          <div className="px-4"><Pagination page={q.data.page} pageCount={q.data.pageCount} total={q.data.total} onPage={setPage} /></div>
        </Card>
      )}
      {dialog}
    </>
  );
}
