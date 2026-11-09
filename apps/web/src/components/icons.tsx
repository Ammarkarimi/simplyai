'use client';
import * as React from 'react';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';
import { siAirtable, siAnthropic, siAsana, siDiscord, siFirebase, siGmail, siGoogle, siGooglecalendar, siGoogledocs, siGoogledrive, siGooglegemini, siGooglesheets, siGraphql, siHubspot, siJira, siMongodb, siMysql, siNotion, siOpenai, siPostgresql, siRedis, siSalesforce, siShopify, siSlack, siStripe, siSupabase, siTelegram, siTrello, siTwilio, siWhatsapp, siWoocommerce, siWordpress } from 'simple-icons';
import { cn } from '@/lib/utils';

const BRANDS: Record<string, { path: string; hex: string }> = {
  openai: siOpenai,
  anthropic: siAnthropic,
  gemini: siGooglegemini,
  gmail: siGmail,
  slack: siSlack,
  discord: siDiscord,
  telegram: siTelegram,
  whatsapp: siWhatsapp,
  twilio: siTwilio,
  googleSheets: siGooglesheets,
  googleDrive: siGoogledrive,
  googleDocs: siGoogledocs,
  googleCalendar: siGooglecalendar,
  google: siGoogle,
  airtable: siAirtable,
  notion: siNotion,
  trello: siTrello,
  asana: siAsana,
  jira: siJira,
  hubspot: siHubspot,
  salesforce: siSalesforce,
  shopify: siShopify,
  woocommerce: siWoocommerce,
  stripe: siStripe,
  wordpress: siWordpress,
  postgres: siPostgresql,
  mysql: siMysql,
  mongodb: siMongodb,
  redis: siRedis,
  supabase: siSupabase,
  firebase: siFirebase,
  graphql: siGraphql,
};

function brand(key: string): { path: string; hex: string } | null {
  return BRANDS[key] ?? null;
}

const LUCIDE_FALLBACK: Record<string, IconName> = { outlook: 'mail', teams: 'users', sms: 'message-square-text', smtp: 'mail', email: 'inbox', customLlm: 'cpu', http: 'globe', webhook: 'webhook', microsoft: 'layout-grid' };

export function LucideIcon({ name, className }: { name: string; className?: string }) {
  return <DynamicIcon name={(name as IconName) || 'box'} className={className} fallback={() => <span className={cn('inline-block rounded bg-current/20', className)} />} />;
}

/** Node icon: brand logo for integrations, otherwise a lucide icon tinted by the node color. */
export function NodeIcon({ icon, color, className, size = 'md' }: { icon: string; color?: string; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const b = brand(icon);
  const box = { sm: 'h-7 w-7 rounded-lg', md: 'h-9 w-9 rounded-xl', lg: 'h-12 w-12 rounded-2xl' }[size];
  const inner = { sm: 'h-3.5 w-3.5', md: 'h-[18px] w-[18px]', lg: 'h-6 w-6' }[size];
  if (b) {
    return (
      <div className={cn('flex shrink-0 items-center justify-center border bg-white shadow-sm', box, className)}>
        <svg viewBox="0 0 24 24" className={inner} fill={`#${b.hex === '000000' ? '111827' : b.hex}`} aria-hidden><path d={b.path} /></svg>
      </div>
    );
  }
  const name = LUCIDE_FALLBACK[icon] ?? icon;
  return (
    <div className={cn('flex shrink-0 items-center justify-center', box, className)} style={{ backgroundColor: `${color ?? '#7c3aed'}17`, color: color ?? '#7c3aed' }}>
      <LucideIcon name={name} className={inner} />
    </div>
  );
}

export function IntegrationLogo({ integrationKey, name, color, size = 'md' }: { integrationKey: string; name: string; color: string; size?: 'sm' | 'md' | 'lg' }) {
  const b = brand(integrationKey);
  if (b || LUCIDE_FALLBACK[integrationKey]) return <NodeIcon icon={integrationKey} color={color} size={size} />;
  const box = { sm: 'h-7 w-7 rounded-lg text-xs', md: 'h-9 w-9 rounded-xl text-sm', lg: 'h-12 w-12 rounded-2xl text-base' }[size];
  return <div className={cn('flex items-center justify-center font-semibold text-white', box)} style={{ backgroundColor: color }}>{name.slice(0, 2)}</div>;
}

export function Logo({ className, collapsed }: { className?: string; collapsed?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="brand-gradient flex h-8 w-8 items-center justify-center rounded-xl shadow-lift">
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="6" cy="6" r="2.2" /><circle cx="18" cy="12" r="2.2" /><circle cx="6" cy="18" r="2.2" /><path d="M8 6.8 15.8 11M8 17.2l7.8-4.2" />
        </svg>
      </div>
      {!collapsed && <span className="text-[17px] font-semibold tracking-tight">Simply<span className="text-brand-gradient">AI</span></span>}
    </div>
  );
}
