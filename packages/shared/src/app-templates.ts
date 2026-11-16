/** Starter apps for the UI builder gallery. */
import type { AppDefinition, AppQuery, AppTheme, UIAction, UINode, UIPage, UIStyle } from './apps';
import { THEME_PRESETS } from './apps';

let seq = 0;
const id = (p: string) => `${p}_${(++seq).toString(36)}`;

interface Extra {
  hoverStyle?: UIStyle;
  mobileStyle?: UIStyle;
  tabletStyle?: UIStyle;
  animation?: UINode['animation'];
  events?: Record<string, UIAction[]>;
  visible?: string;
}

function c(type: string, name: string, props: Record<string, unknown> = {}, style: UIStyle = {}, children?: UINode[], extra: Extra = {}): UINode {
  return { id: id('n'), type, name, props, style, ...(children ? { children } : {}), ...extra };
}

const act = (type: UIAction['type'], params: Record<string, unknown> = {}): UIAction => ({ id: id('a'), type, ...params });

function page(name: string, path: string, children: UINode[], style: UIStyle = {}, onLoad?: UIAction[]): UIPage {
  return { id: id('page'), name, path, root: { id: id('root'), type: 'page', name: `${path.replace(/-/g, '_')}Page`, props: {}, style: { padding: '32px', gap: '24px', ...style }, children }, ...(onLoad ? { onLoad } : {}) };
}

function def(theme: AppTheme, pages: UIPage[], queries: AppQuery[] = [], state: AppDefinition['state'] = [], settings: Partial<AppDefinition['settings']> = {}): AppDefinition {
  return { version: 1, theme: { ...theme }, settings: { navigation: 'none', maxWidth: 1200, ...settings }, pages, queries, state };
}

// ── Sales dashboard ───────────────────────────────────────────

function dashboard(): AppDefinition {
  const glass: UIStyle = { background: 'linear-gradient(135deg, rgba(139,92,246,0.18), rgba(34,211,238,0.06))', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(12px)', borderRadius: '18px', padding: '20px' };
  const lift: UIStyle = { transform: 'translateY(-4px)', boxShadow: '0 20px 40px -12px rgba(139,92,246,0.45)' };
  const stat = (name: string, label: string, value: string, change: string, trend: string, icon: string, delay: number) =>
    c('stat', name, { label, value, change, trend, icon }, { ...glass, transition: 'all .25s ease' }, undefined, { hoverStyle: lift, animation: { type: 'slideUp', durationMs: 600, delayMs: delay } });
  return def(
    THEME_PRESETS.midnight!,
    [
      page('Overview', 'overview', [
        c('container', 'header', {}, { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }, [
          c('container', 'titleGroup', {}, { display: 'flex', flexDirection: 'column', gap: '4px' }, [
            c('heading', 'title', { text: 'Revenue cockpit', level: 'h1' }, { fontSize: '34px', background: 'linear-gradient(90deg,#a78bfa,#22d3ee)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }, undefined, { animation: { type: 'fade', durationMs: 800 } }),
            c('text', 'subtitle', { text: 'Live view of sales across every channel · {{ periodSelect.value }}' }, { color: 'var(--app-muted)' }),
          ]),
          c('select', 'periodSelect', { label: '', options: 'Last 7 days, Last 30 days, This quarter, This year', defaultValue: 'Last 30 days' }, { width: '200px' }),
        ]),
        c('grid', 'kpis', { columns: 4, stackOnMobile: true }, { gap: '16px' }, [
          stat('kpiRevenue', 'Revenue', '{{ "$" + salesData.data.reduce((s, m) => s + m.revenue, 0).toLocaleString() }}', '+18.2%', 'up', 'dollar-sign', 0),
          stat('kpiOrders', 'Orders', '{{ salesData.data.reduce((s, m) => s + m.orders, 0).toLocaleString() }}', '+9.4%', 'up', 'shopping-bag', 100),
          stat('kpiConversion', 'Conversion', '3.8%', '-0.4%', 'down', 'target', 200),
          stat('kpiCustomers', 'New customers', '1,284', '+22.1%', 'up', 'users', 300),
        ], { tabletStyle: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } }),
        c('grid', 'charts', { columns: 3, stackOnMobile: true }, { gap: '16px' }, [
          c('card', 'revenueCard', { title: 'Revenue vs. target', subtitle: 'Monthly, USD' }, { ...glass, gridColumn: 'span 2' }, [
            c('chart', 'revenueChart', { type: 'area', data: '{{ salesData.data }}', xKey: 'month', yKeys: 'revenue, target', height: 280, showLegend: true, showGrid: true, curved: true, colors: '#8b5cf6, #22d3ee' }),
          ], { mobileStyle: { gridColumn: 'auto' } }),
          c('card', 'channelCard', { title: 'Sales by channel' }, glass, [
            c('chart', 'channelChart', { type: 'donut', data: '{{ channels.data }}', xKey: 'channel', yKeys: 'value', height: 280, showLegend: true, colors: '#8b5cf6, #22d3ee, #f472b6, #facc15' }),
          ]),
        ]),
        c('card', 'ordersCard', { title: 'Recent orders', subtitle: 'Click a row to inspect it' }, glass, [
          c('table', 'ordersTable', { data: '{{ orders.data }}', columns: 'id, customer, amount, status, date', pageSize: 5, searchable: true, striped: false }, {}, undefined, {
            events: { onRowClick: [act('openModal', { modal: 'orderModal' })] },
          }),
        ]),
        c('modal', 'orderModal', { title: 'Order {{ ordersTable.selectedRow.id }}', width: 480 }, {}, [
          c('container', 'orderDetails', {}, { display: 'flex', flexDirection: 'column', gap: '12px' }, [
            c('stat', 'orderAmount', { label: 'Amount', value: '{{ "$" + ordersTable.selectedRow.amount }}', icon: 'receipt' }),
            c('text', 'orderCustomer', { text: 'Customer: {{ ordersTable.selectedRow.customer }}' }),
            c('badge', 'orderStatus', { text: '{{ ordersTable.selectedRow.status }}', tone: '{{ ordersTable.selectedRow.status === "Paid" ? "success" : "warning" }}' }),
            c('button', 'closeOrder', { label: 'Close', variant: 'outline' }, {}, undefined, { events: { onClick: [act('closeModal', { modal: 'orderModal' })] } }),
          ]),
        ]),
      ], { background: 'radial-gradient(1200px 600px at 10% -10%, rgba(139,92,246,0.25), transparent), radial-gradient(800px 500px at 100% 0%, rgba(34,211,238,0.15), transparent)' }),
    ],
    [
      { id: id('q'), name: 'salesData', kind: 'static', runOnLoad: true, staticData: JSON.stringify(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((month, i) => ({ month, revenue: Math.round(42000 + i * 4100 + Math.sin(i) * 6000), target: 45000 + i * 3500, orders: 380 + i * 31 }))) },
      { id: id('q'), name: 'channels', kind: 'static', runOnLoad: true, staticData: JSON.stringify([{ channel: 'Web', value: 46 }, { channel: 'Mobile', value: 31 }, { channel: 'Partners', value: 15 }, { channel: 'Retail', value: 8 }]) },
      { id: id('q'), name: 'orders', kind: 'static', runOnLoad: true, staticData: JSON.stringify(['Ava Chen', 'Liam Patel', 'Noah Kim', 'Mia Rossi', 'Lucas Silva', 'Emma Novak', 'Omar Haddad', 'Sofia Ivanova'].map((customer, i) => ({ id: `#10${42 + i}`, customer, amount: (120 + i * 87.5).toFixed(2), status: i % 3 === 0 ? 'Pending' : 'Paid', date: `2026-11-${String(14 - i).padStart(2, '0')}` }))) },
    ],
  );
}

// ── CRM admin panel ───────────────────────────────────────────

function crm(): AppDefinition {
  const seed = [
    { name: 'Ava Chen', email: 'ava@northwind.io', company: 'Northwind', stage: 'Customer', value: 12000 },
    { name: 'Liam Patel', email: 'liam@globex.com', company: 'Globex', stage: 'Proposal', value: 8000 },
    { name: 'Mia Rossi', email: 'mia@initech.com', company: 'Initech', stage: 'Lead', value: 3000 },
    { name: 'Noah Kim', email: 'noah@umbrella.co', company: 'Umbrella', stage: 'Qualified', value: 5500 },
  ];
  return def(
    THEME_PRESETS.ocean!,
    [
      page('Customers', 'customers', [
        c('container', 'toolbar', {}, { display: 'flex', flexDirection: 'row', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap' }, [
          c('container', 'heading', {}, { display: 'flex', flexDirection: 'column', gap: '2px', flex: '1' }, [
            c('heading', 'customersTitle', { text: 'Customers', level: 'h2' }),
            c('text', 'customersCount', { text: '{{ state.customers.length }} contacts · pipeline ${{ state.customers.reduce((s, x) => s + Number(x.value || 0), 0).toLocaleString() }}' }, { color: 'var(--app-muted)' }),
          ]),
          c('select', 'stageFilter', { label: 'Stage', options: 'All, Lead, Qualified, Proposal, Customer', defaultValue: 'All' }, { width: '180px' }),
          c('button', 'addCustomerBtn', { label: 'Add customer', icon: 'plus', variant: 'primary' }, {}, undefined, { events: { onClick: [act('openModal', { modal: 'customerModal' })] } }),
        ]),
        c('card', 'tableCard', {}, { padding: '8px' }, [
          c('table', 'customersTable', { data: '{{ stageFilter.value === "All" ? state.customers : state.customers.filter((x) => x.stage === stageFilter.value) }}', columns: 'name, email, company, stage, value', pageSize: 8, searchable: true, striped: true }),
        ]),
        c('modal', 'customerModal', { title: 'New customer', width: 520 }, {}, [
          c('form', 'customerForm', { submitLabel: 'Save customer', resetOnSubmit: true, showSubmit: true }, { display: 'flex', flexDirection: 'column', gap: '12px' }, [
            c('grid', 'formGrid', { columns: 2, stackOnMobile: true }, { gap: '12px' }, [
              c('input', 'name', { label: 'Name', placeholder: 'Jane Doe', required: true }),
              c('input', 'email', { label: 'Email', inputType: 'email', placeholder: 'jane@company.com', required: true }),
              c('input', 'company', { label: 'Company', placeholder: 'Acme' }),
              c('input', 'value', { label: 'Deal value', inputType: 'number', defaultValue: '1000' }),
            ]),
            c('radio', 'stage', { label: 'Stage', options: 'Lead, Qualified, Proposal, Customer', defaultValue: 'Lead', inline: true }),
          ], {
            events: {
              onSubmit: [
                act('setState', { key: 'customers', value: '{{ state.customers.concat([customerForm.data]) }}' }),
                act('closeModal', { modal: 'customerModal' }),
                act('toast', { message: '{{ customerForm.data.name }} added', variant: 'success' }),
              ],
            },
          }),
        ]),
      ]),
      page('Insights', 'insights', [
        c('heading', 'insightsTitle', { text: 'Pipeline insights', level: 'h2' }),
        c('grid', 'insightsGrid', { columns: 2, stackOnMobile: true }, { gap: '16px' }, [
          c('card', 'valueByStage', { title: 'Value by stage' }, {}, [
            c('chart', 'stageChart', { type: 'bar', data: '{{ ["Lead", "Qualified", "Proposal", "Customer"].map((s) => ({ stage: s, value: state.customers.filter((x) => x.stage === s).reduce((a, x) => a + Number(x.value || 0), 0) })) }}', xKey: 'stage', yKeys: 'value', height: 260 }),
          ]),
          c('card', 'stageMix', { title: 'Contacts by stage' }, {}, [
            c('chart', 'mixChart', { type: 'pie', data: '{{ ["Lead", "Qualified", "Proposal", "Customer"].map((s) => ({ stage: s, count: state.customers.filter((x) => x.stage === s).length })) }}', xKey: 'stage', yKeys: 'count', height: 260, showLegend: true }),
          ]),
        ]),
      ]),
    ],
    [],
    [{ name: 'customers', initial: JSON.stringify(seed) }],
    { navigation: 'side' },
  );
}

// ── Landing page ──────────────────────────────────────────────

function landing(): AppDefinition {
  const feature = (name: string, icon: string, title: string, text: string, delay: number) =>
    c('card', name, {}, { padding: '28px', transition: 'all .3s ease', gap: '10px' }, [
      c('icon', `${name}Icon`, { icon, size: 28 }, { color: 'var(--app-primary)', background: 'color-mix(in srgb, var(--app-primary) 12%, transparent)', padding: '12px', borderRadius: '14px', width: 'fit-content' }),
      c('heading', `${name}Title`, { text: title, level: 'h3' }),
      c('text', `${name}Text`, { text }, { color: 'var(--app-muted)', lineHeight: '1.6' }),
    ], { hoverStyle: { transform: 'translateY(-6px) rotate(-0.5deg)', boxShadow: '0 24px 48px -16px rgba(234,88,12,0.35)' }, animation: { type: 'slideUp', durationMs: 700, delayMs: delay } });
  return def(
    THEME_PRESETS.sunset!,
    [
      page('Home', 'home', [
        c('container', 'hero', {}, { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '22px', padding: '96px 24px', borderRadius: '32px', background: 'linear-gradient(135deg, #ea580c 0%, #db2777 55%, #7c3aed 100%)', color: '#ffffff', overflow: 'hidden', position: 'relative' }, [
          c('badge', 'heroBadge', { text: '✨ Now in public beta', tone: 'neutral' }, { background: 'rgba(255,255,255,0.18)', color: '#fff', backdropFilter: 'blur(6px)' }, undefined, { animation: { type: 'fade', durationMs: 600 } }),
          c('heading', 'heroTitle', { text: 'Ship delightful products, faster', level: 'h1' }, { fontSize: '64px', lineHeight: '1.05', maxWidth: '820px', letterSpacing: '-0.03em', color: '#fff' }, undefined, { animation: { type: 'slideUp', durationMs: 800 }, mobileStyle: { fontSize: '40px' } }),
          c('text', 'heroText', { text: 'Design, automate and launch without waiting on a sprint. Everything you see here was built by dragging and dropping.' }, { fontSize: '20px', maxWidth: '640px', opacity: 0.9, color: '#fff' }, undefined, { animation: { type: 'slideUp', durationMs: 800, delayMs: 150 } }),
          c('container', 'heroCtas', {}, { display: 'flex', flexDirection: 'row', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }, [
            c('button', 'ctaPrimary', { label: 'Join the waitlist', icon: 'arrow-down', size: 'lg' }, { background: '#ffffff', color: '#db2777', borderRadius: '999px', boxShadow: '0 12px 30px -8px rgba(0,0,0,0.35)' }, undefined, { hoverStyle: { transform: 'scale(1.05)' }, events: { onClick: [act('scrollTo', { target: 'waitlist' })] } }),
            c('button', 'ctaSecondary', { label: 'Watch demo', icon: 'play', variant: 'outline', size: 'lg' }, { color: '#fff', borderColor: 'rgba(255,255,255,0.6)', borderRadius: '999px' }, undefined, { hoverStyle: { background: 'rgba(255,255,255,0.12)' }, events: { onClick: [act('toast', { message: 'Demo coming soon!', variant: 'info' })] } }),
          ]),
          c('icon', 'floatingStar', { icon: 'sparkles', size: 40 }, { position: 'absolute', top: '40px', right: '60px', color: 'rgba(255,255,255,0.7)' }, undefined, { animation: { type: 'float', durationMs: 3000, loop: true }, mobileStyle: { display: 'none' } }),
        ]),
        c('grid', 'features', { columns: 3, stackOnMobile: true }, { gap: '20px' }, [
          feature('featureSpeed', 'zap', 'Lightning fast', 'Launch pages in minutes with responsive components and live data.', 0),
          feature('featureAi', 'bot', 'AI built in', 'Connect any button to an AI workflow and stream results to your users.', 120),
          feature('featureSecure', 'shield-check', 'Secure by default', 'Queries run on the server. Visitors never see your credentials.', 240),
        ]),
        c('card', 'waitlist', { title: 'Get early access', subtitle: 'We will email you as soon as your spot is ready.' }, { padding: '32px', maxWidth: '560px', width: '100%', alignSelf: 'center' }, [
          c('form', 'waitlistForm', { submitLabel: 'Request access', resetOnSubmit: true, showSubmit: true }, { display: 'flex', flexDirection: 'column', gap: '12px' }, [
            c('input', 'waitlistEmail', { label: 'Work email', inputType: 'email', placeholder: 'you@company.com', required: true }),
            c('select', 'waitlistRole', { label: 'Role', options: 'Founder, Product, Engineering, Marketing, Other', placeholder: 'Choose one' }),
          ], { events: { onSubmit: [act('setState', { key: 'joined', value: '{{ true }}' }), act('toast', { message: 'You are on the list! 🎉', variant: 'success' })] } }),
          c('alert', 'joinedAlert', { title: 'Thanks for joining!', message: 'Connect this form to a workflow with an App Trigger to store signups.', tone: 'success' }, {}, undefined, { visible: '{{ state.joined }}', animation: { type: 'zoom', durationMs: 400 } }),
        ]),
        c('text', 'footer', { text: '© 2026 Your company · Built with the SimplyAI UI builder' }, { textAlign: 'center', color: 'var(--app-muted)', fontSize: '14px' }),
      ], { maxWidth: '1100px', margin: '0 auto' }),
    ],
    [],
    [{ name: 'joined', initial: 'false' }],
    { maxWidth: 0 },
  );
}

// ── AI assistant ──────────────────────────────────────────────

function assistant(): AppDefinition {
  return def(
    THEME_PRESETS.violet!,
    [
      page('Assistant', 'assistant', [
        c('card', 'chatCard', { title: 'AI assistant', subtitle: 'Messages are answered by the workflow selected in the askAI query' }, { maxWidth: '760px', width: '100%', alignSelf: 'center', gap: '16px', padding: '24px' }, [
          c('list', 'messages', { data: '{{ state.messages }}', emptyText: 'Ask anything to get started' }, { display: 'flex', flexDirection: 'column', gap: '10px', minHeight: '320px', maxHeight: '480px', overflowY: 'auto', padding: '8px' }, [
            c('container', 'bubble', {}, { maxWidth: '80%', padding: '10px 14px', borderRadius: '16px', alignSelf: '{{ item.role === "user" ? "flex-end" : "flex-start" }}', background: '{{ item.role === "user" ? "var(--app-primary)" : "var(--app-bg)" }}', color: '{{ item.role === "user" ? "#fff" : "var(--app-text)" }}' }, [
              c('text', 'bubbleText', { text: '{{ item.text }}' }, { whiteSpace: 'pre-wrap' }),
            ], { animation: { type: 'slideUp', durationMs: 300 } }),
          ]),
          c('container', 'composer', {}, { display: 'flex', flexDirection: 'row', gap: '8px', alignItems: 'flex-end' }, [
            c('input', 'chatInput', { placeholder: 'Type a message and press Enter' }, { flex: '1' }, undefined, { events: { onSubmit: [act('runQuery', { query: 'sendMessage' })] } }),
            c('button', 'sendBtn', { label: 'Send', icon: 'send', loadingWhen: '{{ askAI.loading }}', disabled: '{{ !chatInput.value }}' }, {}, undefined, { events: { onClick: [act('runQuery', { query: 'sendMessage' })] } }),
          ]),
        ]),
      ], { background: 'linear-gradient(180deg, var(--app-bg), color-mix(in srgb, var(--app-primary) 8%, var(--app-bg)))', minHeight: '100vh' }),
    ],
    [
      {
        id: id('q'), name: 'sendMessage', kind: 'static', staticData: 'null',
        onSuccess: [
          act('setState', { key: 'messages', value: '{{ state.messages.concat([{ role: "user", text: chatInput.value }]) }}', condition: '{{ chatInput.value }}' }),
          act('setState', { key: 'pending', value: '{{ chatInput.value }}' }),
          act('setValue', { component: 'chatInput', value: '' }),
          act('runQuery', { query: 'askAI', condition: '{{ state.pending }}' }),
        ],
      },
      {
        id: id('q'), name: 'askAI', kind: 'workflow', payload: '{{ ({ message: state.pending, history: state.messages }) }}',
        onSuccess: [act('setState', { key: 'messages', value: '{{ state.messages.concat([{ role: "assistant", text: String(askAI.data.output || askAI.data.reply || askAI.data.text || JSON.stringify(askAI.data)) }]) }}' })],
        onError: [act('setState', { key: 'messages', value: '{{ state.messages.concat([{ role: "assistant", text: "⚠️ " + askAI.error }]) }}' })],
      },
    ],
    [{ name: 'messages', initial: '[]' }, { name: 'pending', initial: '""' }],
  );
}

function blank(): AppDefinition {
  return def(THEME_PRESETS.violet!, [
    page('Home', 'home', [
      c('heading', 'welcomeTitle', { text: 'Start building', level: 'h1' }),
      c('text', 'welcomeText', { text: 'Drag components from the left panel onto the canvas. Select anything to style it, bind data with {{ expressions }} and wire up events.' }, { color: 'var(--app-muted)' }),
    ]),
  ]);
}

export interface AppTemplate {
  key: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  build: () => AppDefinition;
}

export const APP_TEMPLATES: AppTemplate[] = [
  { key: 'blank', name: 'Blank app', description: 'An empty page to start from scratch', icon: 'square-dashed', color: '#71717a', build: blank },
  { key: 'dashboard', name: 'Revenue dashboard', description: 'Dark glassmorphism dashboard with KPIs, charts, a table and a detail modal', icon: 'chart-area', color: '#8b5cf6', build: dashboard },
  { key: 'crm', name: 'CRM admin panel', description: 'Customer table with filters, an add-customer form in a modal and pipeline charts', icon: 'contact', color: '#0284c7', build: crm },
  { key: 'landing', name: 'Landing page', description: 'Animated gradient hero, feature cards with hover effects and a waitlist form', icon: 'rocket', color: '#ea580c', build: landing },
  { key: 'assistant', name: 'AI assistant', description: 'Chat interface that sends each message to a workflow with an App Trigger', icon: 'bot', color: '#7c3aed', build: assistant },
];

export function buildAppTemplate(key: string): AppDefinition | null {
  const t = APP_TEMPLATES.find((x) => x.key === key);
  return t ? t.build() : null;
}
