'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { KeyRound, Lock, Pencil, Plus, Trash2, Variable } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState, ErrorState, PageHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { CopyButton, Table, TD, TH, THead, TR, useConfirm } from '@/components/ui/extras';
import { del, patch, post } from '@/lib/api';
import { useWorkspace, useWsQuery } from '@/lib/hooks';
import { timeAgo } from '@/lib/utils';

interface VarRow { id: string; scope: 'GLOBAL' | 'WORKSPACE' | 'WORKFLOW' | 'ENVIRONMENT'; key: string; value: string; description: string | null; environment: string | null; workflow: { name: string } | null; updatedAt: string }
interface SecretRow { id: string; key: string; description: string | null; updatedAt: string; createdBy: { name: string } | null }

const SCOPE_INFO: Record<string, string> = { GLOBAL: 'All workspaces in the organization', WORKSPACE: 'This workspace', ENVIRONMENT: 'Only when the workspace environment matches', WORKFLOW: 'A single workflow' };

export default function VariablesPage() {
  const { can } = useWorkspace();
  const vars = useWsQuery<{ activeEnvironment: string; variables: VarRow[] }>(['variables'], '/variables');
  const secrets = useWsQuery<SecretRow[]>(['secrets'], '/secrets');
  const wfs = useWsQuery<{ items: Array<{ id: string; name: string }> }>(['workflows', 'all'], '/workflows', { pageSize: 100 });
  const [editVar, setEditVar] = useState<Partial<VarRow> | null>(null);
  const [editSecret, setEditSecret] = useState<Partial<SecretRow> | null>(null);
  const { confirm, dialog } = useConfirm();
  return (
    <>
      <PageHeader icon={<Variable />} title="Variables & Secrets" description={<>Reference variables with <code className="rounded bg-muted px-1">{'{{ $vars.KEY }}'}</code> and secrets with <code className="rounded bg-muted px-1">{'{{ $secrets.KEY }}'}</code>. Active environment: <Badge variant="secondary">{vars.data?.activeEnvironment ?? '…'}</Badge></>} />
      <Tabs defaultValue="vars">
        <TabsList><TabsTrigger value="vars"><Variable />Variables</TabsTrigger><TabsTrigger value="secrets"><Lock />Secrets</TabsTrigger></TabsList>
        <TabsContent value="vars">
          <div className="mb-3 flex justify-end">{can('variable:manage') && <Button onClick={() => setEditVar({ scope: 'WORKSPACE' })}><Plus /> New variable</Button>}</div>
          {vars.error ? <ErrorState error={vars.error} /> : !vars.data ? <Skeleton className="h-48" /> : vars.data.variables.length === 0 ? <EmptyState icon={<Variable />} title="No variables" description="Store reusable configuration such as base URLs, IDs or feature switches." /> : (
            <Card>
              <Table>
                <THead><tr><TH>Key</TH><TH>Value</TH><TH>Scope</TH><TH className="hidden md:table-cell">Updated</TH><TH /></tr></THead>
                <tbody>{vars.data.variables.map((v) => (
                  <TR key={v.id}>
                    <TD><div className="flex items-center gap-1 font-mono text-xs font-medium">{v.key}<CopyButton value={`{{ $vars.${v.key} }}`} /></div>{v.description && <p className="text-xs text-muted-foreground">{v.description}</p>}</TD>
                    <TD className="max-w-xs truncate font-mono text-xs">{v.value}</TD>
                    <TD><Badge variant={v.scope === 'GLOBAL' ? 'info' : 'secondary'}>{v.scope.toLowerCase()}</Badge>{v.environment && <Badge variant="outline" className="ml-1">{v.environment}</Badge>}{v.workflow && <span className="ml-1 text-xs text-muted-foreground">{v.workflow.name}</span>}</TD>
                    <TD className="hidden text-xs text-muted-foreground md:table-cell">{timeAgo(v.updatedAt)}</TD>
                    <TD className="whitespace-nowrap">{can('variable:manage') && <><Button size="icon-sm" variant="ghost" onClick={() => setEditVar(v)} aria-label="Edit"><Pencil /></Button><Button size="icon-sm" variant="ghost" aria-label="Delete" onClick={async () => { if (await confirm({ title: `Delete ${v.key}?`, destructive: true, confirmLabel: 'Delete' })) { try { await del(`/variables/${v.id}`); void vars.refetch(); } catch (e) { toast.error((e as Error).message); } } }}><Trash2 /></Button></>}</TD>
                  </TR>
                ))}</tbody>
              </Table>
            </Card>
          )}
        </TabsContent>
        <TabsContent value="secrets">
          <Card className="mb-4 border-violet-200 bg-accent/40"><CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" />Secure secret storage</CardTitle><CardDescription>Secret values are encrypted, write-only (never displayed again) and automatically redacted from execution logs.</CardDescription></CardHeader></Card>
          <div className="mb-3 flex justify-end">{can('secret:manage') && <Button onClick={() => setEditSecret({})}><Plus /> New secret</Button>}</div>
          {!secrets.data ? <Skeleton className="h-32" /> : secrets.data.length === 0 ? <EmptyState icon={<Lock />} title="No secrets" /> : (
            <Card><Table><THead><tr><TH>Key</TH><TH>Value</TH><TH className="hidden md:table-cell">Updated</TH><TH /></tr></THead><tbody>
              {secrets.data.map((s) => (
                <TR key={s.id}>
                  <TD><div className="flex items-center gap-1 font-mono text-xs font-medium">{s.key}<CopyButton value={`{{ $secrets.${s.key} }}`} /></div>{s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}</TD>
                  <TD className="font-mono text-xs text-muted-foreground">••••••••</TD>
                  <TD className="hidden text-xs text-muted-foreground md:table-cell">{timeAgo(s.updatedAt)}{s.createdBy && ` · ${s.createdBy.name}`}</TD>
                  <TD className="whitespace-nowrap">{can('secret:manage') && <><Button size="icon-sm" variant="ghost" onClick={() => setEditSecret(s)} aria-label="Rotate"><Pencil /></Button><Button size="icon-sm" variant="ghost" aria-label="Delete" onClick={async () => { if (await confirm({ title: `Delete secret ${s.key}?`, destructive: true, confirmLabel: 'Delete' })) { await del(`/secrets/${s.id}`); void secrets.refetch(); } }}><Trash2 /></Button></>}</TD>
                </TR>
              ))}
            </tbody></Table></Card>
          )}
        </TabsContent>
      </Tabs>
      <Dialog open={!!editVar} onOpenChange={(o) => !o && setEditVar(null)}>
        {editVar && (
          <DialogContent>
            <DialogHeader><DialogTitle>{editVar.id ? `Edit ${editVar.key}` : 'New variable'}</DialogTitle><DialogDescription>Resolution order: workflow → environment → workspace → global.</DialogDescription></DialogHeader>
            <form className="space-y-4" onSubmit={async (e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
              try {
                if (editVar.id) await patch(`/variables/${editVar.id}`, { value: f.value, description: f.description || null });
                else await post('/variables', { scope: f.scope, key: f.key, value: f.value, description: f.description || null, workflowId: f.workflowId || null, environment: f.environment || null });
                toast.success('Variable saved');
                setEditVar(null);
                void vars.refetch();
              } catch (err) { toast.error((err as Error).message); }
            }}>
              {!editVar.id && (
                <>
                  <Field label="Scope" hint={SCOPE_INFO[editVar.scope ?? 'WORKSPACE']}><Select name="scope" value={editVar.scope} onChange={(e) => setEditVar({ ...editVar, scope: e.target.value as VarRow['scope'] })}><option value="WORKSPACE">Workspace</option><option value="ENVIRONMENT">Environment</option><option value="WORKFLOW">Workflow</option><option value="GLOBAL">Global (organization)</option></Select></Field>
                  {editVar.scope === 'ENVIRONMENT' && <Field label="Environment"><Input name="environment" required defaultValue={vars.data?.activeEnvironment} placeholder="production" /></Field>}
                  {editVar.scope === 'WORKFLOW' && <Field label="Workflow"><Select name="workflowId" required>{wfs.data?.items.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>}
                  <Field label="Key"><Input name="key" required pattern="[A-Za-z_][A-Za-z0-9_]*" placeholder="API_BASE_URL" className="font-mono" /></Field>
                </>
              )}
              <Field label="Value"><Textarea name="value" rows={3} defaultValue={editVar.value} className="font-mono text-xs" /></Field>
              <Field label="Description"><Input name="description" defaultValue={editVar.description ?? ''} /></Field>
              <DialogFooter><Button type="submit">Save</Button></DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>
      <Dialog open={!!editSecret} onOpenChange={(o) => !o && setEditSecret(null)}>
        {editSecret && (
          <DialogContent>
            <DialogHeader><DialogTitle>{editSecret.id ? `Rotate ${editSecret.key}` : 'New secret'}</DialogTitle></DialogHeader>
            <form className="space-y-4" onSubmit={async (e) => {
              e.preventDefault();
              const f = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
              try {
                if (editSecret.id) await patch(`/secrets/${editSecret.id}`, { value: f.value || undefined, description: f.description || null });
                else await post('/secrets', { key: f.key, value: f.value, description: f.description || null });
                toast.success('Secret saved');
                setEditSecret(null);
                void secrets.refetch();
              } catch (err) { toast.error((err as Error).message); }
            }}>
              {!editSecret.id && <Field label="Key"><Input name="key" required pattern="[A-Za-z_][A-Za-z0-9_]*" className="font-mono" placeholder="STRIPE_WEBHOOK_SECRET" /></Field>}
              <Field label="Value" hint={editSecret.id ? 'Leave empty to keep the current value' : undefined}><Input name="value" type="password" autoComplete="off" required={!editSecret.id} /></Field>
              <Field label="Description"><Input name="description" defaultValue={editSecret.description ?? ''} /></Field>
              <DialogFooter><Button type="submit">Save secret</Button></DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>
      {dialog}
    </>
  );
}
