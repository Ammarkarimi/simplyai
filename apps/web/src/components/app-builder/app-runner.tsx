'use client';
/** Full-page runtime used by the draft preview and published apps. */
import * as React from 'react';
import type { AppDefinition } from '@simplyai/shared';
import { AppView } from './render';
import { AppRuntime, breakpointFor, type QueryTransport, type RuntimeMode } from './runtime';

export function AppRunner({ definition, name, transport, mode, user, basePath }: { definition: AppDefinition; name: string; transport: QueryTransport; mode: RuntimeMode; user?: { name: string | null; email: string } | null; basePath?: string }) {
  const initialPage = React.useMemo(() => {
    if (typeof window === 'undefined') return undefined;
    const path = new URLSearchParams(window.location.search).get('page');
    return definition.pages.find((p) => p.path === path)?.id;
  }, [definition]);
  const runtime = React.useMemo(
    () => new AppRuntime({
      def: definition, mode, transport, user, app: { name }, initialPageId: initialPage,
      onNavigate: (page) => {
        const url = new URL(window.location.href);
        if (page.id === definition.pages[0]!.id) url.searchParams.delete('page');
        else url.searchParams.set('page', page.path);
        window.history.pushState({}, '', basePath ? `${basePath}${url.search}` : url.toString());
      },
    }),
    [definition, mode, transport, user, name, initialPage, basePath],
  );
  const [bp, setBp] = React.useState(() => (typeof window === 'undefined' ? 'desktop' as const : breakpointFor(window.innerWidth)));
  React.useEffect(() => {
    const onResize = () => setBp(breakpointFor(window.innerWidth));
    const onPop = () => {
      const path = new URLSearchParams(window.location.search).get('page');
      const page = definition.pages.find((p) => p.path === path) ?? definition.pages[0]!;
      runtime.store.setState({ pageId: page.id, modals: {} });
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('popstate', onPop);
    void runtime.runOnLoad().then(() => runtime.enterPage(runtime.store.getState().pageId));
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('popstate', onPop);
    };
  }, [runtime, definition]);
  const pageId = React.useSyncExternalStore(runtime.store.subscribe, () => runtime.store.getState().pageId, () => runtime.store.getState().pageId);
  React.useEffect(() => {
    const page = definition.pages.find((p) => p.id === pageId);
    document.title = page?.title || (page ? `${page.name} · ${name}` : name);
  }, [pageId, definition, name]);
  React.useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = definition.theme.background;
    return () => { document.body.style.background = prev; };
  }, [definition.theme.background]);
  return <div className="min-h-screen" data-app-scroll><AppView runtime={runtime} breakpoint={bp} fill /></div>;
}
