'use client';
import { use, useMemo } from 'react';
import Link from 'next/link';
import { Pencil } from 'lucide-react';
import { AppRunner } from '@/components/app-builder/app-runner';
import { builderTransport, type AppRecord } from '@/components/app-builder/builder';
import { ErrorState, Spinner } from '@/components/ui/misc';
import { useMe, useWsQuery } from '@/lib/hooks';

export default function AppPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useMe();
  const app = useWsQuery<AppRecord>(['app', id, 'preview'], `/apps/${id}`, undefined, { staleTime: 0 });
  const transport = useMemo(() => builderTransport(id), [id]);
  if (app.error) return <div className="p-8"><ErrorState error={app.error as Error} /></div>;
  if (!app.data) return <div className="flex h-screen items-center justify-center"><Spinner className="h-6 w-6" /></div>;
  return (
    <>
      <AppRunner definition={app.data.definition} name={app.data.name} transport={transport} mode="preview" user={me.data ? { name: me.data.user.name, email: me.data.user.email } : null} />
      <Link href={`/apps/${id}`} className="fixed bottom-4 right-4 z-[70] flex items-center gap-1.5 rounded-full bg-zinc-900/90 px-3.5 py-2 text-xs font-medium text-white shadow-xl backdrop-blur hover:bg-zinc-900">
        <Pencil className="h-3.5 w-3.5" />Draft preview · Edit
      </Link>
    </>
  );
}
