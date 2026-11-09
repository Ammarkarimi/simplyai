'use client';
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ErrorState, Skeleton } from '@/components/ui/misc';
import { Pagination, Table, TD, TH, THead, TR } from '@/components/ui/extras';
import type { Page } from '@/lib/api';
import { useWorkspace, useWsQuery } from '@/lib/hooks';
import { formatDate, prettyAction } from '@/lib/utils';

interface Log { id: string; action: string; resourceType: string | null; resourceId: string | null; metadata: Record<string, unknown>; ip: string | null; createdAt: string; user: { name: string; email: string } | null }

export default function AuditPage() {
  const { can } = useWorkspace();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useWsQuery<Page<Log>>(['audit'], '/audit-logs', { search, page, pageSize: 30 }, { enabled: can('audit:read') });
  if (!can('audit:read')) return <ErrorState error={new Error('Only workspace admins can view the audit log.')} />;
  return (
    <>
      <Input placeholder="Filter by action, e.g. credential" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      {!q.data ? <Skeleton className="h-96" /> : (
        <Card>
          <Table><THead><tr><TH>When</TH><TH>Who</TH><TH>Action</TH><TH className="hidden md:table-cell">Details</TH></tr></THead><tbody>
            {q.data.items.map((l) => (
              <TR key={l.id}>
                <TD className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(l.createdAt)}</TD>
                <TD className="text-sm">{l.user?.name ?? 'System / API'}<p className="text-xs text-muted-foreground">{l.ip}</p></TD>
                <TD className="text-sm font-medium">{prettyAction(l.action)}{l.resourceType && <p className="font-mono text-[11px] font-normal text-muted-foreground">{l.resourceType} {l.resourceId}</p>}</TD>
                <TD className="hidden max-w-sm truncate font-mono text-[11px] text-muted-foreground md:table-cell">{Object.keys(l.metadata ?? {}).length ? JSON.stringify(l.metadata) : ''}</TD>
              </TR>
            ))}
          </tbody></Table>
          <div className="px-4"><Pagination page={q.data.page} pageCount={q.data.pageCount} total={q.data.total} onPage={setPage} /></div>
        </Card>
      )}
    </>
  );
}
