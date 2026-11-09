'use client';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Eye, History, Settings2, Webhook } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, ErrorState, PageHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { CopyField, JsonView, Pagination, Table, TD, TH, THead, TR } from '@/components/ui/extras';
import { get, patch, type Page } from '@/lib/api';
import { useWorkspace, useWsQuery } from '@/lib/hooks';
import { formatDate, timeAgo } from '@/lib/utils';

interface WebhookRow {
  id: string; kind: string; path: string; methods: string[]; active: boolean; nodeKey: string; workflow: { id: string; name: string; active: boolean };
  authType: 'NONE' | 'HEADER' | 'BASIC' | 'HMAC'; auth: { headerName: string; username: string; hasToken: boolean; hasPassword: boolean; hasSecret: boolean };
  responseMode: 'IMMEDIATE' | 'LAST_NODE'; responseCode: number; responseHeaders: Record<string, string>; responseBody: string | null; url: string; testUrl: string; requestCount: number;
}
interface RequestRow { id: string; method: string; headers: Record<string, string>; query: Record<string, string>; body: unknown; ip: string | null; statusCode: number; test: boolean; executionId: string | null; durationMs: number | null; receivedAt: string; execution: { status: string } | null }

function RequestsDialog({ w, onClose }: { w: WebhookRow; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const q = useWsQuery<Page<RequestRow>>(['webhook-requests', w.id], `/webhooks/${w.id}/requests`, { page, pageSize: 20 }, { refetchInterval: 5000 });
  const [sel, setSel] = useState<RequestRow | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl">
        <DialogHeader><DialogTitle>Request history</DialogTitle><DialogDescription>{w.workflow.name} · /{w.path}</DialogDescription></DialogHeader>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            {!q.data ? <Skeleton className="h-64" /> : q.data.items.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No requests received yet. Send one to the test URL.</p> : (
              <>
                <ul className="divide-y rounded-lg border">{q.data.items.map((r) => (
                  <li key={r.id}><button className={`flex w-full items-center gap-2 p-2.5 text-left text-sm hover:bg-muted ${sel?.id === r.id ? 'bg-accent' : ''}`} onClick={() => setSel(r)}>
                    <Badge variant="outline">{r.method}</Badge><Badge variant={r.statusCode < 300 ? 'success' : r.statusCode < 500 ? 'warning' : 'destructive'}>{r.statusCode}</Badge>{r.test && <Badge variant="info">test</Badge>}
                    <span className="ml-auto text-xs text-muted-foreground">{timeAgo(r.receivedAt)}</span>
                  </button></li>
                ))}</ul>
                <Pagination page={q.data.page} pageCount={q.data.pageCount} total={q.data.total} onPage={setPage} />
              </>
            )}
          </div>
          <div className="space-y-3">
            {sel ? (
              <>
                <p className="text-xs text-muted-foreground">{formatDate(sel.receivedAt)} · {sel.ip} · {sel.durationMs}ms {sel.executionId && <>· <Link className="text-primary" href={`/executions/${sel.executionId}`}>execution</Link> {sel.execution && <StatusBadge status={sel.execution.status} />}</>}</p>
                <Tabs defaultValue="body"><TabsList><TabsTrigger value="body">Body</TabsTrigger><TabsTrigger value="headers">Headers</TabsTrigger><TabsTrigger value="query">Query</TabsTrigger></TabsList>
                  <TabsContent value="body"><JsonView data={sel.body} /></TabsContent>
                  <TabsContent value="headers"><JsonView data={sel.headers} /></TabsContent>
                  <TabsContent value="query"><JsonView data={sel.query} /></TabsContent>
                </Tabs>
              </>
            ) : <p className="py-10 text-center text-sm text-muted-foreground">Select a request to inspect the payload.</p>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConfigDialog({ w, onClose, onSaved }: { w: WebhookRow; onClose: () => void; onSaved: () => void }) {
  const [authType, setAuthType] = useState(w.authType);
  const [secret, setSecret] = useState<{ token: string | null; secret: string | null; headerName: string } | null>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>Configure webhook</DialogTitle><DialogDescription>{w.workflow.name}</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
          let headers: Record<string, string> = {};
          try { headers = f.responseHeaders ? JSON.parse(f.responseHeaders) : {}; } catch { toast.error('Response headers must be JSON'); return; }
          try {
            await patch(`/webhooks/${w.id}`, {
              authType, responseMode: w.kind === 'WEBHOOK' ? f.responseMode : undefined, responseCode: Number(f.responseCode), responseHeaders: headers, responseBody: f.responseBody || null,
              auth: { headerName: f.headerName || undefined, token: f.token || undefined, username: f.username || undefined, password: f.password || undefined, secret: f.secret || undefined },
            });
            toast.success('Webhook updated');
            onSaved();
            onClose();
          } catch (err) { toast.error((err as Error).message); }
        }}>
          <Field label="Authentication">
            <Select value={authType} onChange={(e) => setAuthType(e.target.value as WebhookRow['authType'])}>
              <option value="NONE">None</option><option value="HEADER">Header token</option><option value="BASIC">Basic auth</option><option value="HMAC">HMAC-SHA256 signature</option>
            </Select>
          </Field>
          {authType === 'HEADER' && <div className="grid grid-cols-2 gap-3"><Field label="Header name"><Input name="headerName" defaultValue={w.auth.headerName} /></Field><Field label="Token" hint={w.auth.hasToken ? 'Leave empty to keep the current token' : 'Leave empty to generate one'}><Input name="token" type="password" autoComplete="off" /></Field></div>}
          {authType === 'BASIC' && <div className="grid grid-cols-2 gap-3"><Field label="Username"><Input name="username" defaultValue={w.auth.username} required /></Field><Field label="Password" hint={w.auth.hasPassword ? 'Leave empty to keep' : undefined}><Input name="password" type="password" autoComplete="off" required={!w.auth.hasPassword} /></Field></div>}
          {authType === 'HMAC' && <Field label="Signing secret" hint={<>Senders must send <code>X-SimplyAI-Signature: sha256=HMAC(secret, raw body)</code> (GitHub-style <code>X-Hub-Signature-256</code> also accepted). Leave empty to {w.auth.hasSecret ? 'keep' : 'generate'}.</>}><Input name="secret" type="password" autoComplete="off" /></Field>}
          {authType !== 'NONE' && authType !== 'BASIC' && (
            <div>
              <Button type="button" variant="outline" size="sm" onClick={async () => setSecret(await get(`/webhooks/${w.id}/secret`))}><Eye /> Reveal current token/secret</Button>
              {secret && <div className="mt-2"><CopyField value={secret.token ?? secret.secret ?? '(save first to generate)'} /></div>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {w.kind === 'WEBHOOK' && <Field label="Respond"><Select name="responseMode" defaultValue={w.responseMode}><option value="IMMEDIATE">Immediately</option><option value="LAST_NODE">With last node output</option></Select></Field>}
            <Field label="Status code"><Input name="responseCode" type="number" defaultValue={w.responseCode} /></Field>
          </div>
          <Field label="Response headers (JSON)"><Input name="responseHeaders" defaultValue={JSON.stringify(w.responseHeaders ?? {})} className="font-mono text-xs" /></Field>
          {w.kind === 'WEBHOOK' && <Field label="Custom response body (immediate mode)" hint="Leave empty to return { message, executionId }"><Textarea name="responseBody" rows={3} defaultValue={w.responseBody ?? ''} className="font-mono text-xs" /></Field>}
          <DialogFooter><Button type="submit">Save</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function WebhooksPage() {
  const { can } = useWorkspace();
  const q = useWsQuery<WebhookRow[]>(['webhooks'], '/webhooks');
  const [history, setHistory] = useState<WebhookRow | null>(null);
  const [config, setConfig] = useState<WebhookRow | null>(null);
  return (
    <>
      <PageHeader icon={<Webhook />} title="Webhooks" description="Inbound endpoints created by Webhook, Form and Chat triggers. Configure authentication, responses and inspect payloads." />
      {q.error ? <ErrorState error={q.error} /> : !q.data ? <Skeleton className="h-48" /> : q.data.length === 0 ? (
        <EmptyState icon={<Webhook />} title="No webhooks yet" description="Add a Webhook Trigger, Form Submission Trigger or Chat Message Trigger to a workflow and save it." />
      ) : (
        <Card>
          <Table>
            <THead><tr><TH>Endpoint</TH><TH>Workflow</TH><TH>Auth</TH><TH>Status</TH><TH className="hidden md:table-cell">Requests</TH><TH /></tr></THead>
            <tbody>{q.data.map((w) => (
              <TR key={w.id}>
                <TD className="max-w-[360px]"><div className="mb-1 flex gap-1"><Badge variant="secondary">{w.kind.toLowerCase()}</Badge>{w.kind === 'WEBHOOK' && w.methods.map((m) => <Badge key={m} variant="outline">{m}</Badge>)}</div><CopyField value={w.url} /></TD>
                <TD><Link href={`/workflows/${w.workflow.id}`} className="font-medium hover:text-primary">{w.workflow.name}</Link></TD>
                <TD><Badge variant={w.authType === 'NONE' ? 'warning' : 'success'}>{w.authType === 'NONE' ? 'none' : w.authType.toLowerCase()}</Badge></TD>
                <TD>{w.active ? <Badge variant="success">Live</Badge> : <Badge variant="secondary">Test only</Badge>}</TD>
                <TD className="hidden md:table-cell text-sm">{w.requestCount}</TD>
                <TD className="whitespace-nowrap"><Button size="sm" variant="ghost" onClick={() => setHistory(w)}><History /> History</Button>{can('webhook:manage') && <Button size="sm" variant="ghost" onClick={() => setConfig(w)}><Settings2 /> Configure</Button>}</TD>
              </TR>
            ))}</tbody>
          </Table>
        </Card>
      )}
      {history && <RequestsDialog w={history} onClose={() => setHistory(null)} />}
      {config && <ConfigDialog w={config} onClose={() => setConfig(null)} onSaved={() => void q.refetch()} />}
    </>
  );
}
