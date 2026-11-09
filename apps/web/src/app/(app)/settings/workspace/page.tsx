'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { useConfirm } from '@/components/ui/extras';
import { api, patch } from '@/lib/api';
import { useWorkspace, useWsQuery } from '@/lib/hooks';
import { useWorkspaceStore } from '@/stores/workspace';

export default function WorkspaceSettings() {
  const { can } = useWorkspace();
  const qc = useQueryClient();
  const router = useRouter();
  const ws = useWsQuery<{ id: string; name: string; description: string | null; activeEnvironment: string; timezone: string; slug: string; organization: { name: string }; _count: { members: number; workflows: number } }>(['workspace'], '/workspace');
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();
  if (!ws.data) return <Skeleton className="h-64" />;
  const editable = can('workspace:update');
  return (
    <>
      <Card>
        <form onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          try {
            await patch('/workspace', { name: f.get('name'), description: f.get('description') || null, activeEnvironment: f.get('activeEnvironment'), timezone: f.get('timezone') });
            await qc.invalidateQueries({ queryKey: ['me'] });
            void ws.refetch();
            toast.success('Workspace updated');
          } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
        }}>
          <CardHeader><CardTitle>Workspace</CardTitle><CardDescription>{ws.data.organization.name} · {ws.data._count.members} members · {ws.data._count.workflows} workflows</CardDescription></CardHeader>
          <fieldset disabled={!editable}>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Name"><Input name="name" defaultValue={ws.data.name} required /></Field>
              <Field label="Timezone"><Input name="timezone" defaultValue={ws.data.timezone} /></Field>
              <Field label="Active environment" hint="Environment-scoped variables with this name are used at run time"><Input name="activeEnvironment" defaultValue={ws.data.activeEnvironment} pattern="[a-zA-Z0-9_-]+" /></Field>
              <Field label="Workspace ID"><Input value={ws.data.id} readOnly className="font-mono text-xs" /></Field>
              <Field label="Description" className="sm:col-span-2"><Textarea name="description" rows={2} defaultValue={ws.data.description ?? ''} /></Field>
            </CardContent>
            <CardFooter><Button loading={busy}>Save</Button></CardFooter>
          </fieldset>
        </form>
      </Card>
      {can('workspace:delete') && (
        <Card className="border-red-200">
          <CardHeader><CardTitle className="text-red-700">Delete workspace</CardTitle><CardDescription>Permanently deletes all workflows, executions, credentials and data in this workspace.</CardDescription></CardHeader>
          <CardFooter><Button variant="destructive" onClick={async () => {
            if (!(await confirm({ title: `Delete ${ws.data!.name}?`, description: 'This cannot be undone.', destructive: true, confirmLabel: 'Delete workspace' }))) return;
            try { await api('/workspace', { method: 'DELETE' }); useWorkspaceStore.getState().setWorkspace(null); await qc.invalidateQueries({ queryKey: ['me'] }); router.push('/overview'); } catch (e) { toast.error((e as Error).message); }
          }}>Delete workspace</Button></CardFooter>
        </Card>
      )}
      {dialog}
    </>
  );
}
