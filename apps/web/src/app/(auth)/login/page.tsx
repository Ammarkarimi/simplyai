'use client';
import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

import { GoogleButton, SimpleForm, useAuthSubmit } from '../auth-form';

function LoginInner() {
  const submit = useAuthSubmit();
  const params = useSearchParams();
  const error = params.get('error');
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mb-8 mt-1 text-sm text-muted-foreground">Sign in to your SimplyAI workspace.</p>
      {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <GoogleButton />
      <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground"><div className="h-px flex-1 bg-border" />or<div className="h-px flex-1 bg-border" /></div>
      <SimpleForm
        fields={[{ name: 'email', label: 'Email', type: 'email', autoComplete: 'email' }, { name: 'password', label: 'Password', type: 'password', autoComplete: 'current-password' }]}
        submitLabel="Sign in"
        onSubmit={(v) => submit('/auth/login', v, params.get('next') ?? undefined)}
      />
      <div className="mt-6 flex justify-between text-sm">
        <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground">Forgot password?</Link>
        <Link href="/signup" className="font-medium text-primary">Create account</Link>
      </div>
    </>
  );
}

export default function LoginPage() {
  return <Suspense><LoginInner /></Suspense>;
}
