'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useWorkspaceStore } from '@/stores/workspace';
import type { Me } from '@/lib/hooks';

export function useAuthSubmit() {
  const router = useRouter();
  const qc = useQueryClient();
  const setWorkspace = useWorkspaceStore((s) => s.setWorkspace);
  return async (path: string, body: unknown, next?: string) => {
    const me = await api<Me>(path, { method: 'POST', body, workspace: null });
    qc.setQueryData(['me'], me);
    const current = useWorkspaceStore.getState().workspaceId;
    if (!current || !me.workspaces.some((w) => w.id === current)) setWorkspace(me.workspaces[0]?.id ?? null);
    router.push(next ?? '/overview');
  };
}

export function GoogleButton({ enabled = true }: { enabled?: boolean }) {
  return (
    <Button variant="outline" className="w-full" type="button" disabled={!enabled} onClick={() => (window.location.href = '/api/v1/auth/google')} title={enabled ? undefined : 'Google sign-in is not configured on this server'}>
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" /><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.6 10.6 0 0 0 12 1 11 11 0 0 0 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z" /></svg>
      Continue with Google
    </Button>
  );
}

export function SimpleForm({ fields, submitLabel, onSubmit }: { fields: Array<{ name: string; label: string; type?: string; autoComplete?: string; defaultValue?: string; hint?: string; readOnly?: boolean }>; submitLabel: string; onSubmit: (values: Record<string, string>) => Promise<void> }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        const values = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
        try {
          await onSubmit(values);
        } catch (err) {
          setError((err as Error).message);
          toast.error((err as Error).message);
        } finally {
          setLoading(false);
        }
      }}
    >
      {fields.map((f) => (
        <Field key={f.name} label={f.label} hint={f.hint}>
          <Input name={f.name} type={f.type ?? 'text'} autoComplete={f.autoComplete} defaultValue={f.defaultValue} readOnly={f.readOnly} required />
        </Field>
      ))}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <Button className="w-full" loading={loading}>{submitLabel}</Button>
    </form>
  );
}
