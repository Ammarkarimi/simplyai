'use client';
import Link from 'next/link';
import { useState } from 'react';
import { MailCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { SimpleForm } from '../auth-form';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  if (sent)
    return (
      <div className="text-center">
        <MailCheck className="mx-auto h-10 w-10 text-primary" />
        <h1 className="mt-4 text-xl font-semibold">Check your inbox</h1>
        <p className="mt-2 text-sm text-muted-foreground">If an account exists for that email, we sent a link to reset your password. It expires in one hour.</p>
        <Link href="/login" className="mt-6 inline-block text-sm font-medium text-primary">Back to sign in</Link>
      </div>
    );
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mb-8 mt-1 text-sm text-muted-foreground">We will email you a reset link.</p>
      <SimpleForm fields={[{ name: 'email', label: 'Email', type: 'email', autoComplete: 'email' }]} submitLabel="Send reset link" onSubmit={async (v) => { await api('/auth/forgot-password', { body: v, workspace: null }); setSent(true); }} />
      <Link href="/login" className="mt-6 block text-center text-sm text-muted-foreground hover:text-foreground">Back to sign in</Link>
    </>
  );
}
