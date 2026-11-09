import { BadRequestException, Body, Controller, Get, HttpCode, Logger, Post, Req, UnauthorizedException } from '@nestjs/common';
import { z } from 'zod';
import { env, getMonthlyUsage, getOrganizationPlan, audit } from '@simplyai/core';
import { monthStart } from '@simplyai/shared';
import { Public, RequirePermission, SessionOnly, Ws } from '../../common/decorators';
import type { AppRequest, WorkspaceContext } from '../../common/context';
import { zbody } from '../../common/zod.pipe';
import { PrismaService } from '../../infra/prisma.service';
import { stripe, verifyStripeSignature } from './stripe';

const checkoutSchema = z.object({ planKey: z.string() });

@Controller('billing')
export class BillingController {
  private readonly logger = new Logger('Billing');
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.db;
  }

  @Public()
  @Get('plans')
  plans() {
    return this.db.plan.findMany({ where: { isPublic: true }, orderBy: { sortOrder: 'asc' } });
  }

  @RequirePermission('billing:read')
  @Get()
  async overview(@Ws() ws: WorkspaceContext) {
    const orgId = ws.organizationId;
    const wsIds = (await this.db.workspace.findMany({ where: { organizationId: orgId }, select: { id: true } })).map((w) => w.id);
    const [plan, subscription, executions, tasks, aiTokens, workflows, activeWorkflows, credentials, members, workspaces] = await Promise.all([
      getOrganizationPlan(this.db, orgId),
      this.db.subscription.findUnique({ where: { organizationId: orgId } }),
      getMonthlyUsage(this.db, orgId, 'EXECUTIONS'),
      getMonthlyUsage(this.db, orgId, 'TASKS'),
      getMonthlyUsage(this.db, orgId, 'AI_TOKENS'),
      this.db.workflow.count({ where: { workspaceId: { in: wsIds }, archivedAt: null } }),
      this.db.workflow.count({ where: { workspaceId: { in: wsIds }, active: true } }),
      this.db.credential.count({ where: { workspaceId: { in: wsIds } } }),
      this.db.workspaceMember.findMany({ where: { workspaceId: { in: wsIds } }, distinct: ['userId'], select: { userId: true } }).then((r) => r.length),
      wsIds.length,
    ]);
    const history = await this.db.usageRecord.groupBy({ by: ['period', 'metric'], where: { organizationId: orgId, period: { gte: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 5, 1)) } }, _sum: { quantity: true } });
    return {
      plan, subscription, stripeEnabled: !!env.stripeSecretKey, periodStart: monthStart(),
      usage: {
        executions: { used: executions, limit: plan.monthlyExecutions },
        tasks: { used: tasks, limit: plan.monthlyTasks },
        aiTokens: { used: aiTokens, limit: plan.monthlyAiTokens },
        workflows: { used: workflows, limit: plan.maxWorkflows },
        activeWorkflows: { used: activeWorkflows, limit: plan.maxActiveWorkflows },
        credentials: { used: credentials, limit: plan.maxCredentials },
        members: { used: members, limit: plan.maxMembers },
        workspaces: { used: workspaces, limit: plan.maxWorkspaces },
      },
      history: history.map((h) => ({ period: h.period, metric: h.metric, quantity: Number(h._sum.quantity ?? 0) })),
    };
  }

  @RequirePermission('billing:read')
  @Get('invoices')
  invoices(@Ws() ws: WorkspaceContext) {
    return this.db.invoice.findMany({ where: { organizationId: ws.organizationId }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  private requireStripe() {
    if (!env.stripeSecretKey) throw new BadRequestException('Online payments are not configured on this server. Ask a platform administrator to change your plan.');
  }

  private async customer(orgId: string, email: string) {
    const sub = await this.db.subscription.findUnique({ where: { organizationId: orgId }, include: { organization: true } });
    if (sub?.stripeCustomerId) return sub.stripeCustomerId;
    const org = await this.db.organization.findUniqueOrThrow({ where: { id: orgId } });
    const c = await stripe<{ id: string }>('POST', '/customers', { email, name: org.name, metadata: { organizationId: orgId } });
    if (sub) await this.db.subscription.update({ where: { id: sub.id }, data: { stripeCustomerId: c.id } });
    return c.id;
  }

  @SessionOnly()
  @RequirePermission('billing:manage')
  @HttpCode(200)
  @Post('checkout')
  async checkout(@Ws() ws: WorkspaceContext, @Req() req: AppRequest, @Body(zbody(checkoutSchema)) body: z.infer<typeof checkoutSchema>) {
    this.requireStripe();
    const plan = await this.db.plan.findUnique({ where: { key: body.planKey } });
    if (!plan || !plan.isPublic) throw new BadRequestException('Unknown plan');
    if (!plan.stripePriceId) throw new BadRequestException(`${plan.name} is not purchasable online. Contact sales.`);
    const email = req.auth?.kind === 'session' ? req.auth.user.email : '';
    const customer = await this.customer(ws.organizationId, email);
    const session = await stripe<{ url: string }>('POST', '/checkout/sessions', {
      mode: 'subscription', customer, line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: `${env.appUrl}/settings/billing?checkout=success`, cancel_url: `${env.appUrl}/settings/billing?checkout=cancelled`,
      client_reference_id: ws.organizationId, subscription_data: { metadata: { organizationId: ws.organizationId, planKey: plan.key } },
    });
    return { url: session.url };
  }

  @SessionOnly()
  @RequirePermission('billing:manage')
  @HttpCode(200)
  @Post('portal')
  async portal(@Ws() ws: WorkspaceContext, @Req() req: AppRequest) {
    this.requireStripe();
    const customer = await this.customer(ws.organizationId, req.auth?.kind === 'session' ? req.auth.user.email : '');
    const s = await stripe<{ url: string }>('POST', '/billing_portal/sessions', { customer, return_url: `${env.appUrl}/settings/billing` });
    return { url: s.url };
  }

  @SessionOnly()
  @RequirePermission('billing:manage')
  @HttpCode(200)
  @Post('cancel')
  async cancel(@Ws() ws: WorkspaceContext) {
    const sub = await this.db.subscription.findUnique({ where: { organizationId: ws.organizationId } });
    if (!sub) throw new BadRequestException('No subscription');
    if (sub.stripeSubscriptionId) {
      this.requireStripe();
      await stripe('POST', `/subscriptions/${sub.stripeSubscriptionId}`, { cancel_at_period_end: true });
      await this.db.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: true } });
    } else {
      const free = await this.db.plan.findUniqueOrThrow({ where: { key: 'free' } });
      await this.db.subscription.update({ where: { id: sub.id }, data: { planId: free.id } });
    }
    await audit(this.db, { action: 'billing.cancelled', userId: ws.userId, organizationId: ws.organizationId });
    return { ok: true };
  }

  @Public()
  @HttpCode(200)
  @Post('stripe/webhook')
  async webhook(@Req() req: AppRequest) {
    if (!env.stripeWebhookSecret) throw new BadRequestException('Stripe webhooks are not configured');
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    if (!verifyStripeSignature(raw, String(req.headers['stripe-signature'] ?? ''), env.stripeWebhookSecret)) throw new UnauthorizedException('Invalid signature');
    const event = JSON.parse(raw.toString('utf8')) as { type: string; data: { object: any } };
    const o = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed': {
        const orgId = o.client_reference_id as string;
        if (orgId && o.subscription) await this.syncSubscription(orgId, await stripe('GET', `/subscriptions/${o.subscription}`), o.customer);
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created':
      case 'customer.subscription.deleted': {
        const orgId = o.metadata?.organizationId ?? (await this.db.subscription.findFirst({ where: { stripeCustomerId: o.customer } }))?.organizationId;
        if (orgId) await this.syncSubscription(orgId, o, o.customer);
        break;
      }
      case 'invoice.paid':
      case 'invoice.payment_failed':
      case 'invoice.finalized': {
        const sub = await this.db.subscription.findFirst({ where: { stripeCustomerId: o.customer } });
        if (sub) {
          await this.db.invoice.upsert({
            where: { stripeInvoiceId: o.id },
            create: {
              organizationId: sub.organizationId, number: o.number ?? o.id, amountCents: o.amount_due ?? 0, currency: o.currency ?? 'usd', status: o.status ?? 'open',
              periodStart: new Date((o.period_start ?? Date.now() / 1000) * 1000), periodEnd: new Date((o.period_end ?? Date.now() / 1000) * 1000), stripeInvoiceId: o.id, hostedUrl: o.hosted_invoice_url, pdfUrl: o.invoice_pdf,
            },
            update: { status: o.status, hostedUrl: o.hosted_invoice_url, pdfUrl: o.invoice_pdf, amountCents: o.amount_due },
          });
          if (event.type === 'invoice.payment_failed') await this.db.subscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE' } });
        }
        break;
      }
      default:
        this.logger.debug(`Ignoring Stripe event ${event.type}`);
    }
    return { received: true };
  }

  private async syncSubscription(orgId: string, s: any, customer: string) {
    const priceId = s.items?.data?.[0]?.price?.id;
    const plan = (priceId && (await this.db.plan.findFirst({ where: { stripePriceId: priceId } }))) || (await this.db.plan.findUniqueOrThrow({ where: { key: 'free' } }));
    const deleted = s.status === 'canceled';
    const free = await this.db.plan.findUniqueOrThrow({ where: { key: 'free' } });
    const statusMap: Record<string, 'ACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELED'> = { active: 'ACTIVE', trialing: 'TRIALING', past_due: 'PAST_DUE', unpaid: 'PAST_DUE', canceled: 'CANCELED' };
    const data = {
      planId: deleted ? free.id : plan.id, status: deleted ? ('ACTIVE' as const) : (statusMap[s.status] ?? 'ACTIVE'), stripeCustomerId: customer, stripeSubscriptionId: deleted ? null : s.id,
      currentPeriodStart: new Date((s.current_period_start ?? s.items?.data?.[0]?.current_period_start ?? Date.now() / 1000) * 1000),
      currentPeriodEnd: new Date((s.current_period_end ?? s.items?.data?.[0]?.current_period_end ?? Date.now() / 1000 + 2_592_000) * 1000),
      cancelAtPeriodEnd: !!s.cancel_at_period_end,
    };
    await this.db.subscription.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, ...data }, update: data });
    await audit(this.db, { action: 'billing.subscription_synced', organizationId: orgId, metadata: { plan: deleted ? 'free' : plan.key, status: s.status } });
  }
}
