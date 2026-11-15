'use client';
import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Lock } from 'lucide-react';
import type { AppDefinition, AppQuery } from '@simplyai/shared';
import { AppRunner } from '@/components/app-builder/app-runner';
import { Logo } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';

interface PublishedApp { id: string; name: string; slug: string; access: 'PRIVATE' | 'PUBLIC'; version: number; definition: AppDefinition; user: { name: string | null; email: string } | null }

export default function PublishedAppPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [app, setApp] = useState<PublishedApp | null>(null);
  const [error, setError] = useState<{ message: string; login?: boolean } | null>(null);
  useEffect(() => {
    api<PublishedApp>(`/public/apps/${encodeURIComponent(slug)}`, { workspace: null })
      .then(setApp)
      .catch((e: ApiError) => setError({ message: e.message, login: e.status === 401 }));
  }, [slug]);
  const transport = useMemo(
    () => async (query: AppQuery, args: Record<string, unknown>) => api<{ data: unknown; meta?: Record<string, unknown> }>(`/public/apps/${encodeURIComponent(slug)}/queries/${encodeURIComponent(query.id)}`, { method: 'POST', body: { args }, workspace: null }),
    [slug],
  );
  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-muted/30 p-6 text-center">
        <Logo />
        <div className="max-w-sm rounded-2xl border bg-card p-8 shadow-soft">
          {error.login ? <Lock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /> : null}
          <p className="font-medium">{error.message}</p>
          {error.login ? <Link className={`${buttonVariants()} mt-4`} href={`/login?next=${encodeURIComponent(`/a/${slug}`)}`}>Sign in</Link> : null}
        </div>
      </div>
    );
  }
  if (!app) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  return <AppRunner definition={app.definition} name={app.name} transport={transport} mode="live" user={app.user} />;
}
