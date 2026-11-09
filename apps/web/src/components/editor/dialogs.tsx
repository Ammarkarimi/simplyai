'use client';
import { useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/misc';
import { post } from '@/lib/api';
import { useWsQuery } from '@/lib/hooks';
import { formatDate } from '@/lib/utils';
import { useEditor } from '@/stores/editor';

interface Version { id: string; version: number; message: string | null; createdAt: string; createdBy: { name: string } | null; nodeCount: number; isActive: boolean }

export function VersionsDialog({ workflowId, open, onOpenChange, onRestored, canEdit }: { workflowId: string; open: boolean; onOpenChange: (o: boolean) => void; onRestored: () => void; canEdit: boolean }) {
  const q = useWsQuery<Version[]>(['versions', workflowId], `/workflows/${workflowId}/versions`, undefined, { enabled: open });
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><History className="h-5 w-5" />Version history</DialogTitle><DialogDescription>Each publish creates an immutable version. Triggers always run the active version.</DialogDescription></DialogHeader>
        {!q.data ? <Spinner /> : q.data.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No versions yet. Publish to create the first one.</p> : (
          <ul className="divide-y rounded-lg border">
            {q.data.map((v) => (
              <li key={v.id} className="flex items-center gap-3 p-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-xs font-semibold text-accent-foreground">v{v.version}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{v.message || 'No description'} {v.isActive && <Badge variant="success" className="ml-1">Active</Badge>}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(v.createdAt)} · {v.createdBy?.name ?? 'API'} · {v.nodeCount} nodes</p>
                </div>
                {canEdit && (
                  <Button size="sm" variant="outline" loading={busy === v.id} onClick={async () => {
                    setBusy(v.id);
                    try { await post(`/workflows/${workflowId}/versions/${v.id}/restore`); toast.success(`Draft restored from v${v.version}`); onRestored(); onOpenChange(false); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
                  }}><RotateCcw /> Restore</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PublishDialog({ open, onOpenChange, onPublish, active }: { open: boolean; onOpenChange: (o: boolean) => void; onPublish: (message: string, activate: boolean) => Promise<void>; active: boolean }) {
  const [message, setMessage] = useState('');
  const [activate, setActivate] = useState(true);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>Publish version</DialogTitle><DialogDescription>{active ? 'The workflow is active: triggers will switch to this version immediately.' : 'Create a new version from the current draft.'}</DialogDescription></DialogHeader>
        <Field label="What changed?"><Input autoFocus value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Added Slack notification" maxLength={500} /></Field>
        {!active && <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} /> Activate triggers after publishing</label>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={busy} onClick={async () => { setBusy(true); try { await onPublish(message, active || activate); onOpenChange(false); setMessage(''); } finally { setBusy(false); } }}>Publish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WorkflowSettingsDialog({ open, onOpenChange, workflowId }: { open: boolean; onOpenChange: (o: boolean) => void; workflowId: string }) {
  const settings = useEditor((s) => s.settings) ?? {};
  const setSettings = useEditor((s) => s.setSettings);
  const wfs = useWsQuery<{ items: Array<{ id: string; name: string }> }>(['workflows', 'all'], '/workflows', { pageSize: 100 }, { enabled: open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>Workflow settings</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <Field label="Execution timeout (seconds)" hint="0 = no limit"><Input type="number" min={0} value={Math.round((settings.timeoutMs ?? 0) / 1000)} onChange={(e) => setSettings({ ...settings, timeoutMs: Number(e.target.value) * 1000 || undefined })} /></Field>
          <Field label="Parallel nodes" hint="Maximum nodes running at the same time in one execution"><Input type="number" min={1} max={32} value={settings.maxParallelism ?? 8} onChange={(e) => setSettings({ ...settings, maxParallelism: Number(e.target.value) || undefined })} /></Field>
          <Field label="Error workflow" hint="Runs with the error details when an execution fails">
            <Select value={settings.errorWorkflowId ?? ''} onChange={(e) => setSettings({ ...settings, errorWorkflowId: e.target.value || null })}>
              <option value="">None</option>
              {wfs.data?.items.filter((w) => w.id !== workflowId).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label="Timezone"><Input value={settings.timezone ?? ''} placeholder="UTC" onChange={(e) => setSettings({ ...settings, timezone: e.target.value || undefined })} /></Field>
        </div>
        <DialogFooter><Button onClick={() => onOpenChange(false)}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
