'use client';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui/misc';
import { useMe } from '@/lib/hooks';
import { useWorkspaceStore } from '@/stores/workspace';

/** Ensures a session exists and a valid workspace is selected. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const { workspaceId, setWorkspace } = useWorkspaceStore();
  useEffect(() => {
    if (me.error) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [me.error, router, pathname]);
  useEffect(() => {
    if (me.data && (!workspaceId || !me.data.workspaces.some((w) => w.id === workspaceId))) setWorkspace(me.data.workspaces[0]?.id ?? null);
  }, [me.data, workspaceId, setWorkspace]);
  if (me.isLoading || me.error || !me.data || !workspaceId || !me.data.workspaces.some((w) => w.id === workspaceId)) {
    if (me.data && me.data.workspaces.length === 0)
      return <div className="flex h-screen items-center justify-center p-6 text-center text-sm text-muted-foreground">You are not a member of any workspace yet. Ask an admin to invite you.</div>;
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  return <>{children}</>;
}
