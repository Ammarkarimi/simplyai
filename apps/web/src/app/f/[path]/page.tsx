'use client';
import { Suspense, use, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Logo } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';

interface FormDef { title: string; description: string; submitLabel: string; fields: Array<{ label: string; name: string; fieldType: string; options?: string; required?: boolean }> }

function FormInner({ path }: { path: string }) {
  const test = useSearchParams().get('test') === '1';
  const [form, setForm] = useState<FormDef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qs = test ? '?test=1' : '';
  useEffect(() => {
    fetch(`/api/v1/public/forms/${encodeURIComponent(path)}${qs}`, { credentials: 'include' }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.message); setForm(j); }).catch((e: Error) => setError(e.message));
  }, [path, qs]);
  return (
    <div className="min-h-screen bg-gradient-to-b from-violet-50 to-background px-4 py-12">
      <div className="mx-auto max-w-lg">
        {test && <p className="mb-4 rounded-lg bg-amber-100 px-3 py-2 text-center text-xs text-amber-800">Test mode – submissions run the saved draft of the workflow.</p>}
        <div className="rounded-2xl border bg-card p-8 shadow-soft">
          {error ? <p className="text-center text-sm text-muted-foreground">{error}</p> : !form ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /> : done ? (
            <div className="py-8 text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" /><p className="mt-4 text-lg font-medium">{done}</p></div>
          ) : (
            <form className="space-y-4" onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              const data: Record<string, unknown> = Object.fromEntries(new FormData(e.currentTarget).entries());
              for (const f of form.fields) if (f.fieldType === 'checkbox') data[f.name] = (e.currentTarget.elements.namedItem(f.name) as HTMLInputElement).checked;
              try {
                const r = await fetch(`/api/v1/public/forms/${encodeURIComponent(path)}${qs}`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
                const j = await r.json();
                if (!r.ok) throw new Error(j.message);
                setDone(j.message);
              } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
            }}>
              <div><h1 className="text-2xl font-semibold">{form.title}</h1>{form.description && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{form.description}</p>}</div>
              {form.fields.map((f) => (
                <Field key={f.name} label={<>{f.label}{f.required && <span className="text-red-500"> *</span>}</>}>
                  {f.fieldType === 'textarea' ? <Textarea name={f.name} required={f.required} rows={4} />
                    : f.fieldType === 'select' ? <Select name={f.name} required={f.required}><option value="">Select…</option>{(f.options ?? '').split(',').map((o) => o.trim()).filter(Boolean).map((o) => <option key={o}>{o}</option>)}</Select>
                    : f.fieldType === 'checkbox' ? <div><input type="checkbox" name={f.name} className="h-4 w-4" /></div>
                    : <Input name={f.name} type={f.fieldType === 'email' ? 'email' : f.fieldType === 'number' ? 'number' : f.fieldType === 'date' ? 'date' : 'text'} required={f.required} />}
                </Field>
              ))}
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <Button className="w-full" loading={busy}>{form.submitLabel}</Button>
            </form>
          )}
        </div>
        <div className="mt-6 flex justify-center opacity-70"><Logo /></div>
      </div>
    </div>
  );
}

export default function PublicFormPage({ params }: { params: Promise<{ path: string }> }) {
  const { path } = use(params);
  return <Suspense><FormInner path={path} /></Suspense>;
}
