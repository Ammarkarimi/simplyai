'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Workflow, Bot, Puzzle, KeyRound, Activity, LayoutTemplate, Table2, Variable, Webhook, Users, Settings, BookOpen, ShieldCheck, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { Logo } from '@/components/icons';
import { Tooltip } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/hooks';
import { useWorkspaceStore } from '@/stores/workspace';

export const NAV = [
  { href: '/overview', label: 'Overview', icon: LayoutDashboard },
  { href: '/workflows', label: 'Workflows', icon: Workflow },
  { href: '/agents', label: 'AI Agents', icon: Bot },
  { href: '/integrations', label: 'Integrations', icon: Puzzle },
  { href: '/credentials', label: 'Credentials', icon: KeyRound },
  { href: '/executions', label: 'Executions', icon: Activity },
  { href: '/templates', label: 'Templates', icon: LayoutTemplate },
  { href: '/data-tables', label: 'Data Tables', icon: Table2 },
  { href: '/variables', label: 'Variables', icon: Variable },
  { href: '/webhooks', label: 'Webhooks', icon: Webhook },
  { href: '/team', label: 'Team Management', icon: Users },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/docs', label: 'Documentation', icon: BookOpen },
];

export function SidebarNav({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { me } = useWorkspace();
  const items = me?.user.isPlatformAdmin ? [...NAV, { href: '/admin', label: 'Admin', icon: ShieldCheck }] : NAV;
  return (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-2 scrollbar-thin">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const link = (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              'group flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors',
              active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              collapsed && 'justify-center px-0',
            )}
          >
            <item.icon className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')} />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Link>
        );
        return collapsed ? <Tooltip key={item.href} content={item.label} side="right">{link}</Tooltip> : link;
      })}
    </nav>
  );
}

export function Sidebar() {
  const { sidebarCollapsed, toggleSidebar } = useWorkspaceStore();
  return (
    <aside className={cn('sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-card transition-[width] duration-200 lg:flex', sidebarCollapsed ? 'w-[68px]' : 'w-[248px]')}>
      <div className={cn('flex h-14 items-center border-b px-4', sidebarCollapsed && 'justify-center px-0')}>
        <Link href="/overview"><Logo collapsed={sidebarCollapsed} /></Link>
      </div>
      <SidebarNav collapsed={sidebarCollapsed} />
      <button onClick={toggleSidebar} className={cn('m-3 flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted', sidebarCollapsed && 'justify-center')}>
        {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <><PanelLeftClose className="h-4 w-4" /> Collapse</>}
      </button>
    </aside>
  );
}
