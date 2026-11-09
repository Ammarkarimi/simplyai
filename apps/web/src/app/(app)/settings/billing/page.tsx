'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Check, CreditCard, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress, Skeleton } from '@/components/ui/misc';
import { Table, TD, TH, THead, TR, useConfirm } from '@/components/ui/extras';
import { post } from '@/lib/api';
import { useWorkspace, useWsQuery } from '@/lib/hooks';
import { cn, formatDate, formatLimit, formatNumber } from '@/lib/utils';

interface Plan { id: string; key: string; name: string; description: string; priceMonthlyCents: number; stripePriceId: string | null; features: string[]; monthlyExecutions: number; maxWorkflows: number; maxMembers: number; monthlyAiTokens: number }
interface Overview { plan: Plan; subscription: { status: string; currentPeriodEnd: string; cancelAtPeriodEnd: boolean; stripeSubscriptionId: string | null } | null; stripeEnabled: boolean; usage: Record<string, { used: number; limit: number }>; history: Array<{ period: string; metric: string; quantity: number }> }
interface Invoice { id: string; number: string; amountCents: number; currency: string; status: string; periodStart: string; hostedUrl: string | null; pdfUrl: string | null; createdAt: string }

const LABELS: Record<string, string> = { executions: 'Executions this month', tasks: 'Tasks (node runs) this month', aiTokens: 'AI tokens this month', workflows: 'Workflows', activeWorkflows: 'Active workflows', credentials: 'Credentials', members: 'Team members', workspaces: 'Workspaces' };

function BillingInner() {
  const params = useSearchParams();
  const { can } = useWorkspace();
  const q = useWsQuery<Overview>(['billing'], '/billing');
  const plans = useWsQuery<Plan[]>(['plans'], '/billing/plans');
  const invoices = useWsQuery<Invoice[]>(['invoices'], '/billing/invoices');
  const [busy, setBusy] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  useEffect(() => {
    if (params.get('checkout') === 'success') toast.success('Subscription updated – it may take a few seconds to appear.');
    if (params.get('checkout') === 'cancelled') toast.info('Checkout cancelled');
  }, [params]);
  if (!q.data) return <Skeleton className="h-96" />;
  const d = q.data;
  const manage = can('billing:manage');
  const go = async (path: string, body?: unknown) => {
    setBusy(path);
    try { const r = await post<{ url: string }>(path, body); window.location.href = r.url; } catch (e) { toast.error((e as Error).message); setBusy(null); }
  };
  return (
    <>
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div><CardTitle className="flex items-center gap-2">{d.plan.name} plan <Badge variant={d.subscription?.status === 'PAST_DUE' ? 'destructive' : 'success'}>{(d.subscription?.status ?? 'ACTIVE').toLowerCase()}</Badge></CardTitle>
            <CardDescription>{d.plan.priceMonthlyCents ? `$${(d.plan.priceMonthlyCents / 100).toFixed(0)}/month` : d.plan.key === 'enterprise' ? 'Custom pricing' : 'Free'}{d.subscription && ` · renews ${formatDate(d.subscription.currentPeriodEnd, { dateStyle: 'medium' })}`}{d.subscription?.cancelAtPeriodEnd && ' · cancels at period end'}</CardDescription></div>
          {manage && d.stripeEnabled && d.subscription?.stripeSubscriptionId && <Button variant="outline" onClick={() => go('/billing/portal')} loading={busy === '/billing/portal'}><CreditCard /> Manage billing</Button>}
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          {Object.entries(d.usage).map(([k, u]) => (
            <div key={k}>
              <div className="mb-1.5 flex justify-between text-sm"><span>{LABELS[k] ?? k}</span><span className="text-muted-foreground">{formatNumber(u.used)} / {formatLimit(u.limit)}</span></div>
              <Progress value={u.limit === -1 ? 0 : (u.used / Math.max(1, u.limit)) * 100} />
            </div>
          ))}
        </CardContent>
      </Card>
      {!d.stripeEnabled && <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">Online payments are not configured on this server (set <code>STRIPE_SECRET_KEY</code>). A platform administrator can change your plan from the admin panel.</div>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {plans.data?.map((p) => {
          const current = p.key === d.plan.key;
          return (
            <Card key={p.id} className={cn('flex flex-col p-5', current && 'border-primary ring-2 ring-primary/15')}>
              <p className="font-semibold">{p.name}</p>
              <p className="mt-1 text-2xl font-semibold">{p.key === 'enterprise' ? 'Custom' : p.priceMonthlyCents ? `$${p.priceMonthlyCents / 100}` : '$0'}<span className="text-sm font-normal text-muted-foreground">{p.priceMonthlyCents ? '/mo' : ''}</span></p>
              <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
              <ul className="mt-4 flex-1 space-y-1.5 text-xs">
                <li className="flex gap-1.5"><Check className="h-3.5 w-3.5 text-primary" />{formatLimit(p.monthlyExecutions)} executions/mo</li>
                <li className="flex gap-1.5"><Check className="h-3.5 w-3.5 text-primary" />{formatLimit(p.maxWorkflows)} workflows</li>
                <li className="flex gap-1.5"><Check className="h-3.5 w-3.5 text-primary" />{formatLimit(p.maxMembers)} members</li>
                {p.features.map((f) => <li key={f} className="flex gap-1.5"><Check className="h-3.5 w-3.5 text-primary" />{f}</li>)}
              </ul>
              {current ? <Button className="mt-4" variant="secondary" disabled>Current plan</Button>
                : manage && p.stripePriceId && d.stripeEnabled ? <Button className="mt-4" onClick={() => go('/billing/checkout', { planKey: p.key })} loading={busy === '/billing/checkout'}>Upgrade</Button>
                : <Button className="mt-4" variant="outline" disabled title={p.key === 'enterprise' ? 'Contact sales' : 'Online checkout unavailable for this plan'}>{p.key === 'enterprise' ? 'Contact sales' : 'Unavailable'}</Button>}
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader><CardTitle>Billing history</CardTitle></CardHeader>
        <CardContent>
          {!invoices.data?.length ? <p className="text-sm text-muted-foreground">No invoices yet.</p> : (
            <Table><THead><tr><TH>Invoice</TH><TH>Date</TH><TH>Amount</TH><TH>Status</TH><TH /></tr></THead><tbody>
              {invoices.data.map((i) => <TR key={i.id}><TD className="font-mono text-xs">{i.number}</TD><TD className="text-sm">{formatDate(i.createdAt, { dateStyle: 'medium' })}</TD><TD>{(i.amountCents / 100).toFixed(2)} {i.currency.toUpperCase()}</TD><TD><Badge variant={i.status === 'paid' ? 'success' : 'warning'}>{i.status}</Badge></TD><TD>{(i.hostedUrl || i.pdfUrl) && <a href={i.hostedUrl ?? i.pdfUrl!} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><ExternalLink /> View</Button></a>}</TD></TR>)}
            </tbody></Table>
          )}
        </CardContent>
      </Card>
      {manage && d.plan.key !== 'free' && !d.subscription?.cancelAtPeriodEnd && (
        <Button variant="ghost" className="text-destructive" onClick={async () => { if (await confirm({ title: 'Cancel subscription?', description: 'Paid features remain until the end of the billing period.', destructive: true, confirmLabel: 'Cancel subscription' })) { try { await post('/billing/cancel'); toast.success('Subscription cancelled'); void q.refetch(); } catch (e) { toast.error((e as Error).message); } } }}>Cancel subscription</Button>
      )}
      {dialog}
    </>
  );
}

export default function BillingPage() {
  return <Suspense><BillingInner /></Suspense>;
}
