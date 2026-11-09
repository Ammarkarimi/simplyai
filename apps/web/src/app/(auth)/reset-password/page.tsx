'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { SimpleForm } from '../auth-form';

function ResetInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mb-8 mt-1 text-sm text-muted-foreground">All other sessions will be signed out.</p>
      {!token ? <p className="text-sm text-red-600">This link is missing its token.</p> : (
        <SimpleForm
          fields={[{ name: 'password', label: 'New password', type: 'password', autoComplete: 'new-password', hint: 'At least 8 characters with a letter and a number' }]}
          submitLabel="Update password"
          onSubmit={async (v) => { await api('/auth/reset-password', { body: { token, password: v.password }, workspace: null }); toast.success('Password updated, please sign in'); router.push('/login'); }}
        />
      )}
    </>
  );
}

export default function ResetPasswordPage() {
  return <Suspense><ResetInner /></Suspense>;
}
