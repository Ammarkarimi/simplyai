'use client';
import Link from 'next/link';
import { Suspense, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BookOpen, Bot, FileText, MessageSquare, Plus, RefreshCw, Search, Trash2, Upload, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, ErrorState, PageHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { Table, TD, TH, THead, TR, useConfirm } from '@/components/ui/extras';
import { api, del, post } from '@/lib/api';
import { useWorkspace, useWsQuery } from '@/lib/hooks';
import { formatNumber, timeAgo } from '@/lib/utils';

interface AgentRow { id: string; name: string; description: string | null; provider: string; model: string; updatedAt: string; tools: unknown[]; conversationCount: number; knowledgeBaseCount: number; credentialId: string | null }
interface KbRow { id: string; name: string; description: string | null; embeddingProvider: string; embeddingModel: string; documentCount: number; chunkCount: number; credential: { name: string } | null; updatedAt: string }
interface KbDetail extends KbRow { documents: Array<{ id: string; name: string; status: string; error: string | null; chunkCount: number; size: number; createdAt: string }> }

const PROVIDER_LABEL: Record<string, string> = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Gemini', custom: 'Custom' };

function KnowledgeBases() {
  const { workspace, can } = useWorkspace();
  const qc = useQueryClient();
  const q = useWsQuery<KbRow[]>(['knowledge-bases'], '/knowledge-bases');
  const creds = useWsQuery<Array<{ id: string; name: string; type: string }>>(['credentials', 'embed'], '/credentials', { type: 'openAiApi,googleGeminiApi,customLlmApi' });
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', embeddingProvider: 'openai', embeddingModel: 'text-embedding-3-small', credentialId: '', chunkSize: 1000, chunkOverlap: 150 });
  const refresh = () => qc.invalidateQueries({ queryKey: [workspace?.id, 'knowledge-bases'] });
  const providerCred: Record<string, string> = { openai: 'openAiApi', gemini: 'googleGeminiApi', custom: 'customLlmApi' };
  return (
    <>
      <div className="mb-4 flex justify-end">{can('agent:manage') && <Button onClick={() => setCreating(true)}><Plus /> New knowledge base</Button>}</div>
      {q.error ? <ErrorState error={q.error} /> : !q.data ? <Skeleton className="h-40" /> : q.data.length === 0 ? (
        <EmptyState icon={<BookOpen />} title="No knowledge bases" description="Upload documents (PDF, Markdown, text, CSV, JSON, HTML) to give agents and RAG nodes your own knowledge." action={can('agent:manage') && <Button onClick={() => setCreating(true)}><Plus /> New knowledge base</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((k) => (
            <Card key={k.id} className="cursor-pointer p-4 hover:shadow-lift" onClick={() => setOpenId(k.id)}>
              <div className="flex items-start justify-between"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-primary"><BookOpen className="h-5 w-5" /></div><Badge variant="secondary">{PROVIDER_LABEL[k.embeddingProvider]}</Badge></div>
              <p className="mt-3 font-semibold">{k.name}</p>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{k.description || 'No description'}</p>
              <p className="mt-3 text-xs text-muted-foreground">{k.documentCount} documents · {formatNumber(k.chunkCount)} chunks · {k.embeddingModel}</p>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader><DialogTitle>New knowledge base</DialogTitle><DialogDescription>Documents are chunked and embedded with the selected model.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Description"><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Embedding provider"><Select value={form.embeddingProvider} onChange={(e) => setForm({ ...form, embeddingProvider: e.target.value, embeddingModel: e.target.value === 'gemini' ? 'text-embedding-004' : e.target.value === 'custom' ? 'nomic-embed-text' : 'text-embedding-3-small', credentialId: '' })}><option value="openai">OpenAI</option><option value="gemini">Gemini</option><option value="custom">Custom (OpenAI compatible)</option></Select></Field>
              <Field label="Model"><Input value={form.embeddingModel} onChange={(e) => setForm({ ...form, embeddingModel: e.target.value })} /></Field>
            </div>
            <Field label="Credential" hint={<Link href={`/credentials?new=${providerCred[form.embeddingProvider]}`} className="text-primary">Create a credential</Link>}>
              <Select value={form.credentialId} onChange={(e) => setForm({ ...form, credentialId: e.target.value })}><option value="">Select…</option>{creds.data?.filter((c) => c.type === providerCred[form.embeddingProvider]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Chunk size (chars)"><Input type="number" value={form.chunkSize} onChange={(e) => setForm({ ...form, chunkSize: Number(e.target.value) })} /></Field>
              <Field label="Overlap"><Input type="number" value={form.chunkOverlap} onChange={(e) => setForm({ ...form, chunkOverlap: Number(e.target.value) })} /></Field>
            </div>
          </div>
          <DialogFooter><Button onClick={async () => { try { await post('/knowledge-bases', { ...form, credentialId: form.credentialId || null }); toast.success('Knowledge base created'); setCreating(false); void refresh(); } catch (e) { toast.error((e as Error).message); } }}>Create</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {openId && <KbDialog id={openId} onClose={() => { setOpenId(null); void refresh(); }} />}
    </>
  );
}

function KbDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useWorkspace();
  const q = useWsQuery<KbDetail>(['knowledge-base', id], `/knowledge-bases/${id}`, undefined, { refetchInterval: 4000 });
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState({ name: '', text: '' });
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ content: string; score: number; documentName: string }> | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();
  const upload = async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    try { await api(`/knowledge-bases/${id}/documents`, { method: 'POST', form }); toast.success(`${file.name} uploaded – indexing…`); void q.refetch(); } catch (e) { toast.error((e as Error).message); }
  };
  const d = q.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>{d?.name ?? 'Knowledge base'}</DialogTitle><DialogDescription>{d ? `${d.embeddingModel} · ${d.credential?.name ?? 'no credential'}` : ''}</DialogDescription></DialogHeader>
        <Tabs defaultValue="docs">
          <TabsList><TabsTrigger value="docs"><FileText />Documents</TabsTrigger><TabsTrigger value="text">Add text</TabsTrigger><TabsTrigger value="search"><Search />Test search</TabsTrigger></TabsList>
          <TabsContent value="docs">
            {can('agent:manage') && <><input ref={fileRef} type="file" className="hidden" accept=".txt,.md,.markdown,.csv,.json,.html,.htm,.pdf" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /><Button className="mb-3" variant="outline" onClick={() => fileRef.current?.click()}><Upload /> Upload document</Button></>}
            {!d ? <Skeleton className="h-32" /> : d.documents.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No documents yet.</p> : (
              <Table><THead><tr><TH>Name</TH><TH>Status</TH><TH>Chunks</TH><TH /></tr></THead><tbody>
                {d.documents.map((doc) => (
                  <TR key={doc.id}>
                    <TD><p className="font-medium">{doc.name}</p><p className="text-xs text-muted-foreground">{(doc.size / 1024).toFixed(1)} KB · {timeAgo(doc.createdAt)}</p></TD>
                    <TD><Badge variant={doc.status === 'READY' ? 'success' : doc.status === 'FAILED' ? 'destructive' : 'warning'}>{doc.status.toLowerCase()}</Badge>{doc.error && <p className="mt-1 max-w-xs text-xs text-red-600">{doc.error}</p>}</TD>
                    <TD>{doc.chunkCount}</TD>
                    <TD className="whitespace-nowrap">{can('agent:manage') && <><Button size="icon-sm" variant="ghost" aria-label="Re-index" onClick={async () => { await post(`/knowledge-bases/${id}/documents/${doc.id}/reindex`); void q.refetch(); }}><RefreshCw /></Button><Button size="icon-sm" variant="ghost" aria-label="Delete" onClick={async () => { if (await confirm({ title: `Delete ${doc.name}?`, destructive: true, confirmLabel: 'Delete' })) { await del(`/knowledge-bases/${id}/documents/${doc.id}`); void q.refetch(); } }}><Trash2 /></Button></>}</TD>
                  </TR>
                ))}
              </tbody></Table>
            )}
          </TabsContent>
          <TabsContent value="text" className="space-y-3">
            <Field label="Title"><Input value={text.name} onChange={(e) => setText({ ...text, name: e.target.value })} placeholder="Refund policy" /></Field>
            <Field label="Content (Markdown)"><Textarea rows={10} value={text.text} onChange={(e) => setText({ ...text, text: e.target.value })} /></Field>
            <Button disabled={!can('agent:manage') || !text.name || !text.text} onClick={async () => { try { await post(`/knowledge-bases/${id}/documents/text`, text); toast.success('Added – indexing…'); setText({ name: '', text: '' }); void q.refetch(); } catch (e) { toast.error((e as Error).message); } }}>Add to knowledge base</Button>
          </TabsContent>
          <TabsContent value="search" className="space-y-3">
            <div className="flex gap-2"><Input placeholder="Ask something…" value={query} onChange={(e) => setQuery(e.target.value)} /><Button loading={busy} disabled={!query} onClick={async () => { setBusy(true); try { setResults(await post(`/knowledge-bases/${id}/search`, { query, topK: 5 })); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } }}>Search</Button></div>
            {results?.map((r, i) => <div key={i} className="rounded-lg border p-3 text-sm"><div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>{r.documentName}</span><span>score {r.score.toFixed(3)}</span></div><p className="whitespace-pre-wrap">{r.content.slice(0, 600)}</p></div>)}
            {results && results.length === 0 && <p className="text-sm text-muted-foreground">No results.</p>}
          </TabsContent>
        </Tabs>
        {dialog}
      </DialogContent>
    </Dialog>
  );
}

function AgentsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useWorkspace();
  const q = useWsQuery<AgentRow[]>(['agents'], '/agents');
  return (
    <>
      <PageHeader icon={<Bot />} title="AI Agent Studio" description="Build agents with instructions, tools, knowledge and memory. Test them in the playground and use them in workflows."
        actions={can('agent:manage') && <Button onClick={() => router.push('/agents/new')}><Plus /> New agent</Button>} />
      <Tabs defaultValue={params.get('tab') ?? 'agents'}>
        <TabsList><TabsTrigger value="agents"><Bot />Agents</TabsTrigger><TabsTrigger value="knowledge"><BookOpen />Knowledge bases</TabsTrigger></TabsList>
        <TabsContent value="agents">
          {q.error ? <ErrorState error={q.error} /> : !q.data ? <Skeleton className="h-40" /> : q.data.length === 0 ? (
            <EmptyState icon={<Bot />} title="No agents yet" description="Create an assistant that can call tools, search your documents and trigger workflows." action={can('agent:manage') && <Button onClick={() => router.push('/agents/new')}><Plus /> New agent</Button>} />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {q.data.map((a) => (
                <Link key={a.id} href={`/agents/${a.id}`}>
                  <Card className="h-full p-4 transition-all hover:-translate-y-0.5 hover:shadow-lift">
                    <div className="flex items-start justify-between"><div className="brand-gradient flex h-10 w-10 items-center justify-center rounded-xl text-white"><Bot className="h-5 w-5" /></div><Badge variant="secondary">{PROVIDER_LABEL[a.provider]} · {a.model}</Badge></div>
                    <p className="mt-3 font-semibold">{a.name}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.description || 'No description'}</p>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Wrench className="h-3 w-3" />{a.tools.length} tools</span>
                      <span className="flex items-center gap-1"><BookOpen className="h-3 w-3" />{a.knowledgeBaseCount} KB</span>
                      <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" />{a.conversationCount}</span>
                      {!a.credentialId && <Badge variant="warning">No credential</Badge>}
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="knowledge"><KnowledgeBases /></TabsContent>
      </Tabs>
    </>
  );
}

export default function AgentsPage() {
  return <Suspense><AgentsInner /></Suspense>;
}
