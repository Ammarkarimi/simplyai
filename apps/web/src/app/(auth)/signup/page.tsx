'use client';
import Link from 'next/link';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { GoogleButton, SimpleForm, useAuthSubmit } from '../auth-form';

function SignUpInner() {
  const submit = useAuthSubmit();
  const params = useSearchParams();
  const invite = params.get('invite');
  const email = params.get('email') ?? undefined;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{invite ? 'Join your team' : 'Create your account'}</h1>
      <p className="mb-8 mt-1 text-sm text-muted-foreground">{invite ? 'Create an account to accept the invitation.' : 'Start automating in minutes. Free plan, no card required.'}</p>
      {!invite && (
        <>
          <GoogleButton />
          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground"><div className="h-px flex-1 bg-border" />or<div className="h-px flex-1 bg-border" /></div>
        </>
      )}
      <SimpleForm
        fields={[
          { name: 'name', label: 'Full name', autoComplete: 'name' },
          { name: 'email', label: 'Work email', type: 'email', autoComplete: 'email', defaultValue: email, readOnly: !!invite && !!email },
          ...(invite ? [] : [{ name: 'organizationName', label: 'Company / team name', autoComplete: 'organization' }]),
          { name: 'password', label: 'Password', type: 'password', autoComplete: 'new-password', hint: 'At least 8 characters with a letter and a number' },
        ]}
        submitLabel={invite ? 'Create account & join' : 'Create account'}
        onSubmit={(v) => submit('/auth/signup', { ...v, ...(invite ? { inviteToken: invite } : {}) })}
      />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account? <Link href="/login" className="font-medium text-primary">Sign in</Link>
      </p>
    </>
  );
}

export default function SignUpPage() {
  return <Suspense><SignUpInner /></Suspense>;
}
