'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Download, LayoutTemplate, Plus, Search, Sparkles, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/misc';
import { LucideIcon, NodeIcon } from '@/components/icons';
import { del, post } from '@/lib/api';
import { useNodeCatalog, useWorkspace, useWsQuery } from '@/lib/hooks';

interface TemplateRow { id: string; name: string; description: string; category: string; tags: string[]; icon: string | null; visibility: string; featured: boolean; installs: number; nodeCount: number; nodeTypes: string[]; integrations: string[]; createdBy: { name: string } | null; workspaceId: string | null }

export default function TemplatesPage() {
  const router = useRouter();
  const { can, me } = useWorkspace();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [scope, setScope] = useState('');
  const q = useWsQuery<TemplateRow[]>(['templates'], '/templates', { search, category, scope });
  const cats = useWsQuery<Array<{ category: string; count: number }>>(['template-categories'], '/templates/categories');
  const catalog = useNodeCatalog();
  const [preview, setPreview] = useState<TemplateRow | null>(null);
  const [sharing, setSharing] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const wfs = useWsQuery<{ items: Array<{ id: string; name: string }> }>(['workflows', 'all'], '/workflows', { pageSize: 100 }, { enabled: sharing });
  const install = async (t: TemplateRow) => {
    setInstalling(t.id);
    try {
      const wf = await post<{ id: string }>(`/templates/${t.id}/install`, {});
      toast.success(`“${t.name}” added to your workflows`);
      router.push(`/workflows/${wf.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setInstalling(null);
    }
  };
  return (
    <>
      <PageHeader icon={<LayoutTemplate />} title="Templates" description="Production-ready automations you can install and customize in one click."
        actions={can('template:manage') && <Button variant="outline" onClick={() => setSharing(true)}><Plus /> Save workflow as template</Button>} />
      <div className="mb-5 flex flex-col gap-2 md:flex-row">
        <div className="relative flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search templates…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <Select className="md:w-56" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{cats.data?.map((c) => <option key={c.category} value={c.category}>{c.category} ({c.count})</option>)}</Select>
        <Select className="md:w-48" value={scope} onChange={(e) => setScope(e.target.value)}><option value="">All templates</option><option value="public">Marketplace</option><option value="team">Shared with team</option><option value="mine">My templates</option></Select>
      </div>
      {q.error ? <ErrorState error={q.error} /> : !q.data ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-52" />)}</div> : q.data.length === 0 ? <EmptyState icon={<LayoutTemplate />} title="No templates found" /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((t) => (
            <Card key={t.id} className="flex flex-col p-5 transition-all hover:-translate-y-0.5 hover:shadow-lift">
              <div className="flex items-start justify-between">
                <div className="brand-gradient flex h-11 w-11 items-center justify-center rounded-xl text-white"><LucideIcon name={t.icon ?? 'workflow'} className="h-5 w-5" /></div>
                <div className="flex gap-1">{t.featured && <Badge><Star className="h-3 w-3" />Featured</Badge>}{t.visibility !== 'PUBLIC' && <Badge variant="info">{t.visibility === 'WORKSPACE' ? 'Team' : 'Private'}</Badge>}</div>
              </div>
              <p className="mt-3 font-semibold">{t.name}</p>
              <p className="mt-1 line-clamp-3 flex-1 text-sm text-muted-foreground">{t.description}</p>
              <div className="mt-4 flex items-center -space-x-1.5">
                {t.nodeTypes.slice(0, 7).map((type) => { const n = catalog.data?.find((x) => x.type === type); return n ? <NodeIcon key={type} icon={n.icon} color={n.color} size="sm" className="ring-2 ring-card" /> : null; })}
                <span className="pl-3 text-xs text-muted-foreground">{t.nodeCount} nodes · {t.installs} installs</span>
              </div>
              <div className="mt-4 flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setPreview(t)}>Preview</Button>
                {can('workflow:create') && <Button className="flex-1" onClick={() => install(t)} loading={installing === t.id}><Download /> Use template</Button>}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        {preview && (
          <DialogContent size="lg">
            <DialogHeader><DialogTitle>{preview.name}</DialogTitle><DialogDescription>{preview.category} · {preview.createdBy?.name ?? 'SimplyAI'}</DialogDescription></DialogHeader>
            <p className="text-sm">{preview.description}</p>
            <div className="mt-4 flex flex-wrap gap-1.5">{preview.tags.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}</div>
            <p className="mt-5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Nodes used</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {preview.nodeTypes.map((type) => { const n = catalog.data?.find((x) => x.type === type); return n ? <div key={type} className="flex items-center gap-2 rounded-lg border p-2"><NodeIcon icon={n.icon} color={n.color} size="sm" /><div className="min-w-0"><p className="text-sm font-medium">{n.displayName}</p><p className="truncate text-xs text-muted-foreground">{n.description}</p></div></div> : null; })}
            </div>
            <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground"><Sparkles className="h-3.5 w-3.5" />After installing, select credentials on the highlighted nodes and press Execute to test.</p>
            <DialogFooter>
              {preview.workspaceId && (preview.createdBy?.name === me?.user.name || can('template:manage')) && <Button variant="ghost" onClick={async () => { await del(`/templates/${preview.id}`); toast.success('Template deleted'); setPreview(null); void q.refetch(); }}><Trash2 /> Delete</Button>}
              {can('workflow:create') && <Button onClick={() => install(preview)} loading={installing === preview.id}><Download /> Use template</Button>}
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
      <Dialog open={sharing} onOpenChange={setSharing}>
        <DialogContent>
          <DialogHeader><DialogTitle>Save workflow as template</DialogTitle><DialogDescription>Credentials are removed. Share with your team or keep it private.</DialogDescription></DialogHeader>
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              await post('/templates', { workflowId: f.get('workflowId'), name: f.get('name'), description: f.get('description'), category: f.get('category'), tags: String(f.get('tags') ?? '').split(',').map((s) => s.trim()).filter(Boolean), visibility: f.get('visibility') });
              toast.success('Template saved');
              setSharing(false);
              void q.refetch();
            } catch (err) { toast.error((err as Error).message); }
          }}>
            <Field label="Workflow"><Select name="workflowId" required>{wfs.data?.items.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
            <Field label="Template name"><Input name="name" required /></Field>
            <Field label="Description"><Textarea name="description" rows={3} /></Field>
            <div className="grid grid-cols-2 gap-3"><Field label="Category"><Input name="category" required defaultValue="Operations" /></Field><Field label="Visibility"><Select name="visibility"><option value="WORKSPACE">Team (this workspace)</option><option value="PRIVATE">Only me</option></Select></Field></div>
            <Field label="Tags (comma separated)"><Input name="tags" /></Field>
            <DialogFooter><Button type="submit">Save template</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
