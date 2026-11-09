'use client';
import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { isPropertyVisible, type CredentialTypeDescription } from '@simplyai/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/misc';
import { CopyField } from '@/components/ui/extras';
import { patch, post } from '@/lib/api';

export interface CredentialRow { id: string; name: string; type: string; typeName: string; integration: string | null; authKind: string; status: string; statusMessage: string | null; lastTestedAt: string | null; updatedAt: string; data: Record<string, unknown>; connected: boolean; usedByNodes?: number }

export function CredentialDialog({ open, onOpenChange, types, initialType, existing, onSaved }: {
  open: boolean; onOpenChange: (o: boolean) => void; types: CredentialTypeDescription[]; initialType?: string; existing?: CredentialRow | null; onSaved: (c: CredentialRow) => void;
}) {
  const [type, setType] = useState(existing?.type ?? initialType ?? types[0]?.type ?? '');
  const desc = types.find((t) => t.type === type);
  const [name, setName] = useState(existing?.name ?? '');
  const [data, setData] = useState<Record<string, unknown>>(existing?.data ?? {});
  const [busy, setBusy] = useState(false);
  const values = { ...Object.fromEntries((desc?.properties ?? []).map((p) => [p.name, p.default])), ...data };

  const submit = async () => {
    if (!desc) return;
    setBusy(true);
    try {
      const payload = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
      const saved = existing
        ? await patch<CredentialRow>(`/credentials/${existing.id}`, { name, data: payload })
        : await post<CredentialRow>('/credentials', { name: name || desc.displayName, type, data: payload });
      toast.success(existing ? 'Credential updated' : 'Credential created');
      onSaved(saved);
      if (!existing && desc.authKind === 'oauth2') {
        const { url } = await post<{ url: string }>(`/credentials/${saved.id}/oauth2/authorize`);
        window.location.href = url;
        return;
      }
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{existing ? `Edit ${existing.name}` : 'New credential'}</DialogTitle>
          <DialogDescription>Secrets are encrypted with AES-256-GCM, scoped to this workspace and never shown again.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!existing && (
            <Field label="Type">
              <Select value={type} onChange={(e) => { setType(e.target.value); setData({}); }}>
                {types.map((t) => <option key={t.type} value={t.type}>{t.displayName}</option>)}
              </Select>
            </Field>
          )}
          {desc?.description && <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">{desc.description}</p>}
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={desc?.displayName} /></Field>
          {desc?.authKind === 'oauth2' && (
            <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-xs">
              <p className="font-medium">OAuth redirect URL</p>
              <p className="text-muted-foreground">Add this to your OAuth app before connecting.</p>
              <CopyField value={`${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/oauth2/callback`} />
            </div>
          )}
          {desc?.properties.filter((p) => isPropertyVisible(p, values)).map((p) => {
            const v = values[p.name];
            const str = v === undefined || v === null ? '' : String(v);
            return (
              <Field key={p.name} label={<>{p.displayName}{p.required && <span className="text-red-500"> *</span>}</>} hint={p.description ?? (existing && p.password ? 'Leave unchanged to keep the stored value' : undefined)}>
                {p.type === 'boolean' ? <div><Switch checked={!!v} onCheckedChange={(c) => setData({ ...data, [p.name]: c })} /></div>
                  : p.type === 'options' ? <Select value={str} onChange={(e) => setData({ ...data, [p.name]: e.target.value })}>{p.options?.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.name}</option>)}</Select>
                  : p.type === 'json' || p.type === 'text' ? <Textarea rows={5} className="font-mono text-xs" value={typeof v === 'object' && v ? JSON.stringify(v, null, 2) : str} onChange={(e) => setData({ ...data, [p.name]: e.target.value })} />
                  : <Input type={p.password ? 'password' : p.type === 'number' ? 'number' : 'text'} autoComplete="off" placeholder={p.placeholder} value={str} onChange={(e) => setData({ ...data, [p.name]: p.type === 'number' ? Number(e.target.value) : e.target.value })} />}
              </Field>
            );
          })}
          {desc?.docsUrl && <a href={desc.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary">Provider documentation <ExternalLink className="h-3 w-3" /></a>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} loading={busy}>{existing ? 'Save' : desc?.authKind === 'oauth2' ? 'Save & connect' : 'Create credential'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
