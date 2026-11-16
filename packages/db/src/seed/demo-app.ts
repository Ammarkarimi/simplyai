/** Demo app for the UI builder: a lead manager on top of the Leads data table and a scoring workflow. */
import type { Prisma, PrismaClient } from '@prisma/client';
import { THEME_PRESETS, type AppDefinition, type UIAction, type UINode, type UIStyle } from '@simplyai/shared';
import { workflow } from './builder';

let seq = 0;
const nid = () => `demo_${(++seq).toString(36)}`;
const act = (type: UIAction['type'], params: Record<string, unknown> = {}): UIAction => ({ id: nid(), type, ...params });
function c(type: string, name: string, props: Record<string, unknown> = {}, style: UIStyle = {}, children?: UINode[], extra: Partial<UINode> = {}): UINode {
  return { id: nid(), type, name, props, style, ...(children ? { children } : {}), ...extra };
}

export function leadScoringWorkflow() {
  return workflow(
    [
      ['app', 'From Lead Manager app', 'simplyai.appTrigger', 0, 200, { testData: JSON.stringify({ name: 'Ada Lovelace', email: 'ada@analytical.com', company: 'Analytical Engines' }) }],
      ['score', 'Score Lead', 'simplyai.set', 280, 200, { assignments: [{ name: 'score', type: 'number', value: '{{ ($json.company ? 45 : 15) + (String($json.email || "").endsWith(".com") ? 25 : 10) + Math.min(String($json.name || "").length * 2, 30) }}' }] }],
      ['tier', 'Assign Tier', 'simplyai.set', 560, 200, { assignments: [{ name: 'tier', type: 'string', value: '{{ $json.score >= 80 ? "Hot" : $json.score >= 55 ? "Warm" : "Cold" }}' }, { name: 'scoredAt', type: 'string', value: '{{ $now }}' }] }],
    ],
    [['app', 'score'], ['score', 'tier']],
    { annotations: [{ id: 'n1', text: 'Called by the "Lead Manager" app (App Builder). The output of the last node is returned to the app as scoreLead.data.', position: { x: 0, y: 40 }, width: 420, height: 100, color: 'yellow' }] },
  );
}

export function leadManagerApp(leadsTableId: string, workflowId: string): AppDefinition {
  const card: UIStyle = { padding: '20px' };
  const statCard = (name: string, label: string, value: string, icon: string, delay: number) =>
    c('stat', name, { label, value, icon }, { padding: '20px', borderRadius: 'var(--app-radius)', background: 'var(--app-surface)', border: '1px solid var(--app-border)', transition: 'all .2s ease' }, undefined, { hoverStyle: { transform: 'translateY(-3px)', boxShadow: '0 16px 32px -16px var(--app-primary)' }, animation: { type: 'slideUp', durationMs: 500, delayMs: delay } });
  return {
    version: 1,
    theme: { ...THEME_PRESETS.ocean! },
    settings: { navigation: 'top', maxWidth: 1180 },
    state: [],
    queries: [
      { id: 'getLeads', name: 'getLeads', kind: 'dataTable', tableId: leadsTableId, operation: 'list', runOnLoad: true, args: { search: '{{ leadSearch.value }}', filters: '{{ statusFilter.value && statusFilter.value !== "all" ? ({ status: statusFilter.value }) : ({}) }}', pageSize: '200' } },
      {
        id: 'addLead', name: 'addLead', kind: 'dataTable', tableId: leadsTableId, operation: 'insert', args: { data: '{{ ({ name: leadName.value, email: leadEmail.value, company: leadCompany.value, status: leadStatus.value || "new" }) }}' },
        onSuccess: [act('closeModal', { modal: 'newLeadModal' }), act('runQuery', { query: 'getLeads' }), act('toast', { message: '{{ leadName.value }} added', variant: 'success' })],
      },
      {
        id: 'markContacted', name: 'markContacted', kind: 'dataTable', tableId: leadsTableId, operation: 'update', args: { rowId: '{{ leadsTable.selectedRow.id }}', data: '{{ ({ status: "contacted" }) }}' },
        onSuccess: [act('closeModal', { modal: 'leadModal' }), act('runQuery', { query: 'getLeads' }), act('toast', { message: 'Marked as contacted', variant: 'success' })],
      },
      {
        id: 'deleteLead', name: 'deleteLead', kind: 'dataTable', tableId: leadsTableId, operation: 'delete', confirm: 'Delete {{ leadsTable.selectedRow.name }}?', args: { rowId: '{{ leadsTable.selectedRow.id }}' },
        onSuccess: [act('closeModal', { modal: 'leadModal' }), act('runQuery', { query: 'getLeads' }), act('toast', { message: 'Lead deleted', variant: 'info' })],
      },
      { id: 'scoreLead', name: 'scoreLead', kind: 'workflow', workflowId, payload: '{{ ({ name: leadsTable.selectedRow.name, email: leadsTable.selectedRow.email, company: leadsTable.selectedRow.company }) }}' },
    ],
    pages: [
      {
        id: 'leads', name: 'Leads', path: 'leads',
        root: c('page', 'leadsPage', {}, { padding: '32px 24px', gap: '24px' }, [
          c('container', 'hero', {}, { display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', padding: '0' }, [
            c('container', 'heroText', {}, { display: 'flex', flexDirection: 'column', gap: '4px', padding: '0' }, [
              c('heading', 'title', { text: 'Lead Manager', level: 'h1' }, { background: 'linear-gradient(90deg, var(--app-primary), var(--app-accent))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }, undefined, { animation: { type: 'fade', durationMs: 600 } }),
              c('text', 'subtitle', { text: 'Built with the App Builder · data from the "Leads" table · scoring by a workflow' }, { color: 'var(--app-muted)' }),
            ]),
            c('button', 'newLeadBtn', { label: 'New lead', icon: 'user-plus', variant: 'gradient', size: 'lg' }, { borderRadius: '999px' }, undefined, { events: { onClick: [act('resetInputs', { component: 'newLeadForm' }), act('openModal', { modal: 'newLeadModal' })] } }),
          ]),
          c('grid', 'stats', { columns: 3, stackOnMobile: true }, { gap: '16px' }, [
            statCard('statTotal', 'Total leads', '{{ getLeads.meta ? getLeads.meta.total : "—" }}', 'users', 0),
            statCard('statNew', 'New', '{{ (getLeads.data || []).filter((l) => l.status === "new").length }}', 'sparkles', 100),
            statCard('statContacted', 'Contacted', '{{ (getLeads.data || []).filter((l) => l.status === "contacted").length }}', 'phone', 200),
          ]),
          c('card', 'leadsCard', {}, card, [
            c('container', 'filters', {}, { display: 'flex', flexDirection: 'row', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap', padding: '0' }, [
              c('input', 'leadSearch', { placeholder: 'Search name, email or company…', icon: 'search' }, { flex: '1', minWidth: '220px' }, undefined, { events: { onChange: [act('runQuery', { query: 'getLeads' })] } }),
              c('select', 'statusFilter', { options: 'all, new, contacted, qualified', defaultValue: 'all', placeholder: 'Status' }, { width: '180px' }, undefined, { events: { onChange: [act('runQuery', { query: 'getLeads' })] } }),
            ]),
            c('table', 'leadsTable', { data: '{{ getLeads.data }}', columns: 'name, email, company, status', pageSize: 8, searchable: false, striped: true, emptyText: 'No leads match your filters' }, {}, undefined, {
              events: { onRowClick: [act('openModal', { modal: 'leadModal' })] },
            }),
          ]),
          c('modal', 'leadModal', { title: '{{ leadsTable.selectedRow.name }}', width: 520 }, { display: 'flex', flexDirection: 'column', gap: '14px' }, [
            c('container', 'leadInfo', {}, { display: 'flex', flexDirection: 'row', gap: '14px', alignItems: 'center', padding: '0' }, [
              c('avatar', 'leadAvatar', { name: '{{ leadsTable.selectedRow.name }}', size: 52 }),
              c('container', 'leadMeta', {}, { display: 'flex', flexDirection: 'column', gap: '2px', padding: '0' }, [
                c('text', 'leadEmailText', { text: '{{ leadsTable.selectedRow.email }}' }, { fontWeight: '600' }),
                c('text', 'leadCompanyText', { text: '{{ leadsTable.selectedRow.company || "No company" }}' }, { color: 'var(--app-muted)' }),
              ]),
              c('badge', 'leadStatusBadge', { text: '{{ leadsTable.selectedRow.status }}', tone: '{{ leadsTable.selectedRow.status === "new" ? "info" : "success" }}' }, { marginLeft: 'auto' }),
            ]),
            c('alert', 'scoreResult', { title: '{{ scoreLead.data.tier }} lead · score {{ scoreLead.data.score }}', message: 'Scored by the "Lead Scoring (app)" workflow at {{ scoreLead.data.scoredAt }}', tone: '{{ scoreLead.data.tier === "Hot" ? "danger" : scoreLead.data.tier === "Warm" ? "warning" : "info" }}' }, {}, undefined, { visible: '{{ scoreLead.data && scoreLead.data.email === leadsTable.selectedRow.email }}', animation: { type: 'zoom', durationMs: 300 } }),
            c('container', 'leadActions', {}, { display: 'flex', flexDirection: 'row', gap: '8px', flexWrap: 'wrap', padding: '0' }, [
              c('button', 'scoreBtn', { label: 'Score with workflow', icon: 'wand-sparkles', variant: 'gradient', loadingWhen: '{{ scoreLead.loading }}' }, {}, undefined, { events: { onClick: [act('runQuery', { query: 'scoreLead' })] } }),
              c('button', 'contactedBtn', { label: 'Mark contacted', icon: 'check', variant: 'secondary' }, {}, undefined, { visible: '{{ leadsTable.selectedRow.status !== "contacted" }}', events: { onClick: [act('runQuery', { query: 'markContacted' })] } }),
              c('button', 'deleteBtn', { label: 'Delete', icon: 'trash-2', variant: 'ghost' }, { color: '#dc2626', marginLeft: 'auto' }, undefined, { events: { onClick: [act('runQuery', { query: 'deleteLead' })] } }),
            ]),
          ]),
          c('modal', 'newLeadModal', { title: 'New lead', width: 520 }, { display: 'flex', flexDirection: 'column', gap: '12px' }, [
            c('form', 'newLeadForm', { submitLabel: 'Save lead', showSubmit: true, resetOnSubmit: false }, { display: 'flex', flexDirection: 'column', gap: '12px' }, [
              c('grid', 'leadFields', { columns: 2, stackOnMobile: true }, { gap: '12px' }, [
                c('input', 'leadName', { label: 'Name', placeholder: 'Jane Doe', required: true }),
                c('input', 'leadEmail', { label: 'Email', inputType: 'email', placeholder: 'jane@company.com', required: true }),
                c('input', 'leadCompany', { label: 'Company', placeholder: 'Acme' }),
                c('select', 'leadStatus', { label: 'Status', options: 'new, contacted, qualified', defaultValue: 'new' }),
              ]),
            ], { events: { onSubmit: [act('runQuery', { query: 'addLead' })] } }),
          ]),
        ]),
      },
      {
        id: 'insights', name: 'Insights', path: 'insights',
        root: c('page', 'insightsPage', {}, { padding: '32px 24px', gap: '20px' }, [
          c('heading', 'insightsTitle', { text: 'Pipeline insights', level: 'h2' }),
          c('grid', 'charts', { columns: 2, stackOnMobile: true }, { gap: '16px' }, [
            c('card', 'statusCard', { title: 'Leads by status' }, card, [
              c('chart', 'statusChart', { type: 'bar', data: '{{ ["new", "contacted", "qualified"].map((s) => ({ status: s, leads: (getLeads.data || []).filter((l) => l.status === s).length })) }}', xKey: 'status', yKeys: 'leads', height: 260 }),
            ]),
            c('card', 'companyCard', { title: 'Leads with a company' }, card, [
              c('chart', 'companyChart', { type: 'donut', data: '{{ [{ label: "With company", value: (getLeads.data || []).filter((l) => l.company).length }, { label: "Unknown", value: (getLeads.data || []).filter((l) => !l.company).length }] }}', xKey: 'label', yKeys: 'value', height: 260, showLegend: true }),
            ]),
          ]),
          c('markdown', 'about', { content: '### How this app works\n\n- **getLeads** lists rows of the *Leads* data table, filtered by the search box and status select.\n- **addLead**, **markContacted** and **deleteLead** write to the same table.\n- **scoreLead** runs the *Lead Scoring (app)* workflow through its **App Trigger** and shows the result.\n\nOpen the app in the **App Builder** to change anything.' }, { padding: '20px', borderRadius: 'var(--app-radius)', background: 'var(--app-surface)', border: '1px solid var(--app-border)' }),
        ]),
      },
    ],
  };
}

/** Creates the scoring workflow (active) and the published Lead Manager app if they do not exist yet. */
export async function seedDemoApp(db: PrismaClient, p: { workspaceId: string; userId: string; leadsTableId: string }) {
  if (await db.app.findFirst({ where: { workspaceId: p.workspaceId, name: 'Lead Manager' } })) return false;
  const def = leadScoringWorkflow();
  const wf = await db.workflow.create({ data: { workspaceId: p.workspaceId, name: 'Lead Scoring (app)', description: 'Scores leads for the Lead Manager app. Triggered by the App Trigger.', tags: ['demo', 'apps'], createdById: p.userId, meta: (def.meta ?? {}) as Prisma.InputJsonValue } });
  await db.workflowNode.createMany({ data: def.nodes.map((n) => ({ workflowId: wf.id, nodeKey: n.id, name: n.name, type: n.type, positionX: n.position.x, positionY: n.position.y, parameters: n.parameters as Prisma.InputJsonValue, settings: (n.settings ?? {}) as Prisma.InputJsonValue })) });
  await db.workflowConnection.createMany({ data: def.connections.map((x) => ({ workflowId: wf.id, sourceKey: x.source, sourceOutput: x.sourceOutput, targetKey: x.target, targetInput: x.targetInput })) });
  const version = await db.workflowVersion.create({ data: { workflowId: wf.id, version: 1, definition: def as unknown as Prisma.InputJsonValue, message: 'Initial version', createdById: p.userId } });
  await db.workflow.update({ where: { id: wf.id }, data: { active: true, activeVersionId: version.id } });

  const appDef = leadManagerApp(p.leadsTableId, wf.id) as unknown as Prisma.InputJsonValue;
  const app = await db.app.create({ data: { workspaceId: p.workspaceId, name: 'Lead Manager', description: 'Search, add, score and update leads — built with the App Builder.', slug: 'lead-manager-demo', icon: 'contact', color: '#0284c7', definition: appDef, createdById: p.userId } });
  const appVersion = await db.appVersion.create({ data: { appId: app.id, version: 1, definition: appDef, message: 'Demo', createdById: p.userId } });
  await db.app.update({ where: { id: app.id }, data: { publishedVersionId: appVersion.id, publishedAt: new Date() } });
  return true;
}
