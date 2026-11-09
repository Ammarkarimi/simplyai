'use client';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CredentialTypeDescription, NodeDescription, Permission } from '@simplyai/shared';
import { api, get } from './api';
import { useWorkspaceStore } from '@/stores/workspace';

export interface Me {
  user: { id: string; email: string; name: string; avatarUrl: string | null; emailVerified: boolean; isPlatformAdmin: boolean; hasPassword: boolean; createdAt: string };
  workspaces: Array<{ id: string; name: string; slug: string; organizationId: string; activeEnvironment: string; timezone: string; role: { key: string; name: string; permissions: string[] } }>;
  organizations: Array<{ id: string; name: string; slug: string; role: string; plan: string }>;
  features: { googleLogin: boolean; email: boolean; billing: boolean };
}

export function useMe() {
  return useQuery<Me>({ queryKey: ['me'], queryFn: () => api('/auth/me', { workspace: null }), retry: false, staleTime: 60_000 });
}

/** Current workspace from the session plus permission helper. */
export function useWorkspace() {
  const me = useMe();
  const workspaceId = useWorkspaceStore((s) => s.workspaceId);
  const ws = me.data?.workspaces.find((w) => w.id === workspaceId) ?? me.data?.workspaces[0];
  const can = (p: Permission) => !!ws?.role.permissions.includes(p);
  return { me: me.data, workspace: ws, can, isLoading: me.isLoading };
}

/** Query scoped to the current workspace. */
export function useWsQuery<T = any>(key: QueryKey, path: string, query?: Record<string, string | number | boolean | undefined | null>, opts: { enabled?: boolean; refetchInterval?: number | false; staleTime?: number } = {}) {
  const ws = useWorkspaceStore((s) => s.workspaceId);
  return useQuery<T>({ queryKey: [ws, ...key, query ?? null], queryFn: () => get<T>(path, query), enabled: !!ws && (opts.enabled ?? true), refetchInterval: opts.refetchInterval, staleTime: opts.staleTime });
}

export function useAction<TVars = void, TResult = any>(fn: (v: TVars) => Promise<TResult>, opts: { success?: string | ((r: TResult) => string); invalidate?: QueryKey[]; onSuccess?: (r: TResult) => void } = {}) {
  const qc = useQueryClient();
  const ws = useWorkspaceStore((s) => s.workspaceId);
  return useMutation<TResult, Error, TVars>({
    mutationFn: fn,
    onSuccess: (r) => {
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      for (const k of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: [ws, ...k] });
      opts.onSuccess?.(r);
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useNodeCatalog() {
  return useWsQuery<NodeDescription[]>(['nodes'], '/nodes', undefined, { staleTime: 5 * 60_000 });
}

export function useCredentialTypes() {
  return useWsQuery<CredentialTypeDescription[]>(['credential-types'], '/credential-types', undefined, { staleTime: 5 * 60_000 });
}
