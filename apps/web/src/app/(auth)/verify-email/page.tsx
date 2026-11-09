'use client';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { Spinner } from '@/components/ui/misc';

function VerifyInner() {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!token) { setState('error'); setMessage('Missing token'); return; }
    api('/auth/verify-email', { body: { token }, workspace: null }).then(() => setState('ok')).catch((e: Error) => { setState('error'); setMessage(e.message); });
  }, [token]);
  return (
    <div className="text-center">
      {state === 'loading' && <Spinner className="mx-auto h-8 w-8" />}
      {state === 'ok' && <><CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" /><h1 className="mt-4 text-xl font-semibold">Email verified</h1><Link href="/overview" className="mt-6 inline-block text-sm font-medium text-primary">Continue to SimplyAI</Link></>}
      {state === 'error' && <><XCircle className="mx-auto h-10 w-10 text-red-500" /><h1 className="mt-4 text-xl font-semibold">Verification failed</h1><p className="mt-2 text-sm text-muted-foreground">{message}</p><Link href="/overview" className="mt-6 inline-block text-sm font-medium text-primary">Go to app</Link></>}
    </div>
  );
}

export default function VerifyEmailPage() {
  return <Suspense><VerifyInner /></Suspense>;
}
