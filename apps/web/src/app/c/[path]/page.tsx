'use client';
import { Suspense, use, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Bot, Loader2, Send } from 'lucide-react';
import { Logo } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

function ChatInner({ path }: { path: string }) {
  const test = useSearchParams().get('test') === '1';
  const qs = test ? '?test=1' : '';
  const [info, setInfo] = useState<{ title: string; welcomeMessage: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'bot'; text: string }>>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [session] = useState(() => {
    const key = `simplyai.chat.${path}`;
    const existing = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
    const id = existing ?? `chat_${crypto.randomUUID()}`;
    if (typeof window !== 'undefined') window.localStorage.setItem(key, id);
    return id;
  });
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    fetch(`/api/v1/public/chat/${encodeURIComponent(path)}${qs}`, { credentials: 'include' }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.message); setInfo(j); if (j.welcomeMessage) setMessages([{ role: 'bot', text: j.welcomeMessage }]); }).catch((e: Error) => setError(e.message));
  }, [path, qs]);
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [messages.length, busy]);
  const send = async () => {
    const msg = text.trim();
    if (!msg) return;
    setText('');
    setMessages((m) => [...m, { role: 'user', text: msg }]);
    setBusy(true);
    try {
      const r = await fetch(`/api/v1/public/chat/${encodeURIComponent(path)}${qs}`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session, message: msg }) });
      const j = await r.json();
      setMessages((m) => [...m, { role: 'bot', text: r.ok ? j.reply : j.message }]);
    } catch {
      setMessages((m) => [...m, { role: 'bot', text: 'Network error, please try again.' }]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex h-screen flex-col bg-gradient-to-b from-violet-50 to-background">
      <header className="flex items-center gap-3 border-b bg-card px-5 py-3"><div className="brand-gradient flex h-9 w-9 items-center justify-center rounded-xl text-white"><Bot className="h-5 w-5" /></div><p className="font-semibold">{info?.title ?? 'Chat'}</p>{test && <span className="ml-auto rounded bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">test mode</span>}</header>
      <div className="mx-auto w-full max-w-2xl flex-1 space-y-3 overflow-y-auto p-5">
        {error && <p className="text-center text-sm text-muted-foreground">{error}</p>}
        {messages.map((m, i) => <div key={i} className={cn('flex', m.role === 'user' && 'justify-end')}><div className={cn('max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm shadow-sm', m.role === 'user' ? 'bg-primary text-white' : 'bg-card')}>{m.text}</div></div>)}
        {busy && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        <div ref={end} />
      </div>
      <form className="mx-auto flex w-full max-w-2xl gap-2 p-4" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <Input className="h-11" placeholder="Type a message…" value={text} onChange={(e) => setText(e.target.value)} disabled={!info || busy} maxLength={5000} />
        <Button type="submit" size="icon" className="h-11 w-11" disabled={!info || busy || !text.trim()} aria-label="Send"><Send /></Button>
      </form>
      <div className="pb-3 text-center text-[11px] text-muted-foreground opacity-70"><Logo className="inline-flex scale-75" /></div>
    </div>
  );
}

export default function PublicChatPage({ params }: { params: Promise<{ path: string }> }) {
  const { path } = use(params);
  return <Suspense><ChatInner path={path} /></Suspense>;
}
