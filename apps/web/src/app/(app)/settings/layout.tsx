'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, CreditCard, KeyRound, ScrollText, Settings, User } from 'lucide-react';
import { PageHeader } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/settings', label: 'Profile', icon: User },
  { href: '/settings/workspace', label: 'Workspace', icon: Building2 },
  { href: '/settings/api-keys', label: 'API keys', icon: KeyRound },
  { href: '/settings/billing', label: 'Billing & usage', icon: CreditCard },
  { href: '/settings/audit', label: 'Audit log', icon: ScrollText },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <PageHeader icon={<Settings />} title="Settings" description="Manage your profile, workspace, API access and subscription." />
      <div className="flex flex-col gap-6 lg:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto lg:w-52 lg:flex-col">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className={cn('flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium', pathname === t.href ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
              <t.icon className="h-4 w-4" />{t.label}
            </Link>
          ))}
        </nav>
        <div className="min-w-0 flex-1 space-y-6">{children}</div>
      </div>
    </>
  );
}
