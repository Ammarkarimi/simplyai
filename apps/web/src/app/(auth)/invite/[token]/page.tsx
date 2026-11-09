'use client';
import Link from 'next/link';
import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { useWorkspaceStore } from '@/stores/workspace';

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const setWorkspace = useWorkspaceStore((s) => s.setWorkspace);
  const info = useQuery({ queryKey: ['invite', token], queryFn: () => api<{ email: string; workspace: string; role: string; invitedBy: string; hasAccount: boolean }>(`/invitations/${token}`, { workspace: null }), retry: false });
  const me = useQuery({ queryKey: ['me'], queryFn: () => api('/auth/me', { workspace: null }), retry: false });
  if (info.isLoading) return <Spinner className="h-6 w-6" />;
  if (info.error) return <p className="text-sm text-red-600">{(info.error as Error).message}</p>;
  const i = info.data!;
  const accept = async () => {
    try {
      const r = await api<{ workspaceId: string }>(`/invitations/${token}/accept`, { method: 'POST', body: {}, workspace: null });
      setWorkspace(r.workspaceId);
      await qc.invalidateQueries({ queryKey: ['me'] });
      toast.success(`Welcome to ${i.workspace}!`);
      router.push('/overview');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Join {i.workspace}</h1>
      <p className="mb-8 mt-2 text-sm text-muted-foreground">{i.invitedBy} invited <b>{i.email}</b> to join as <b>{i.role}</b>.</p>
      {me.data ? (
        <Button className="w-full" onClick={accept}>Accept invitation</Button>
      ) : i.hasAccount ? (
        <Link href={`/login?next=/invite/${token}`}><Button className="w-full">Sign in to accept</Button></Link>
      ) : (
        <Link href={`/signup?invite=${token}&email=${encodeURIComponent(i.email)}`}><Button className="w-full">Create account</Button></Link>
      )}
    </>
  );
}
