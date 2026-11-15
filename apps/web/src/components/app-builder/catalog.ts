/** Component catalog: palette entries, defaults and inspector fields. */
import { uiId, type UINode, type UIStyle } from '@simplyai/shared';

export type FieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'color' | 'icon' | 'expression' | 'code' | 'page';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: Array<string | { label: string; value: string }>;
  placeholder?: string;
  help?: string;
}

export interface EventDef {
  key: string;
  label: string;
}

export type Category = 'Layout' | 'Text' | 'Inputs' | 'Data' | 'Media' | 'Feedback' | 'Navigation';

export interface ComponentMeta {
  type: string;
  label: string;
  icon: string;
  category: Category;
  description: string;
  container?: boolean;
  /** what `{{ name.* }}` exposes */
  exposes?: string;
  props: Record<string, unknown>;
  style?: UIStyle;
  children?: () => UINode[];
  fields: FieldDef[];
  events?: EventDef[];
  keywords?: string;
}

const tone = { key: 'tone', label: 'Tone', type: 'select' as const, options: ['primary', 'success', 'warning', 'danger', 'info', 'neutral'] };
const label = { key: 'label', label: 'Label', type: 'text' as const };
const required = { key: 'required', label: 'Required', type: 'boolean' as const };
const disabled = { key: 'disabled', label: 'Disabled', type: 'boolean' as const };
const helper = { key: 'helperText', label: 'Helper text', type: 'text' as const };
const change: EventDef[] = [{ key: 'onChange', label: 'On change' }];

export const COMPONENTS: ComponentMeta[] = [
  // Layout
  {
    type: 'container', label: 'Container', icon: 'square-dashed', category: 'Layout', container: true, description: 'Flexible box that stacks or rows its children',
    props: {}, style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', minHeight: '48px' },
    fields: [{ key: 'tag', label: 'HTML tag', type: 'select', options: ['div', 'section', 'header', 'footer', 'main', 'aside', 'nav'] }],
    events: [{ key: 'onClick', label: 'On click' }], keywords: 'box flex row column stack div section',
  },
  {
    type: 'grid', label: 'Grid', icon: 'layout-grid', category: 'Layout', container: true, description: 'Columns that wrap their children into a grid',
    props: { columns: 3, stackOnMobile: true }, style: { gap: '16px' },
    children: () => [mk('container', { style: { padding: '16px', minHeight: '80px' } }), mk('container', { style: { padding: '16px', minHeight: '80px' } }), mk('container', { style: { padding: '16px', minHeight: '80px' } })],
    fields: [{ key: 'columns', label: 'Columns', type: 'number' }, { key: 'stackOnMobile', label: 'Single column on mobile', type: 'boolean' }],
    keywords: 'columns layout',
  },
  {
    type: 'card', label: 'Card', icon: 'panel-top', category: 'Layout', container: true, description: 'Surface with optional title, border and shadow',
    props: { title: 'Card title', subtitle: '' }, style: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '20px' },
    fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'subtitle', label: 'Subtitle', type: 'text' }],
    events: [{ key: 'onClick', label: 'On click' }], keywords: 'panel box surface',
  },
  {
    type: 'tabs', label: 'Tabs', icon: 'panels-top-left', category: 'Layout', container: true, description: 'Tabbed panels; each child container is a tab',
    exposes: '.activeTab (index)', props: { tabs: 'Overview, Details', variant: 'underline' }, style: {},
    children: () => [mk('container', { style: { padding: '16px', minHeight: '80px' } }), mk('container', { style: { padding: '16px', minHeight: '80px' } })],
    fields: [{ key: 'tabs', label: 'Tab labels (comma separated)', type: 'text' }, { key: 'variant', label: 'Style', type: 'select', options: ['underline', 'pills', 'boxed'] }],
    events: [{ key: 'onChange', label: 'On tab change' }],
  },
  {
    type: 'modal', label: 'Modal', icon: 'app-window', category: 'Layout', container: true, description: 'Dialog opened with the Open modal action',
    exposes: '.open', props: { title: 'Dialog', width: 520, closeOnBackdrop: true }, style: { display: 'flex', flexDirection: 'column', gap: '12px' },
    fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'width', label: 'Width (px)', type: 'number' }, { key: 'closeOnBackdrop', label: 'Close on backdrop click', type: 'boolean' }],
    events: [{ key: 'onClose', label: 'On close' }], keywords: 'dialog popup overlay',
  },
  {
    type: 'list', label: 'List / Repeater', icon: 'list', category: 'Layout', container: true, description: 'Repeats its children for every item; use {{ item }} and {{ index }}',
    props: { data: '{{ [{ title: "First" }, { title: "Second" }] }}', emptyText: 'Nothing here yet' }, style: { display: 'flex', flexDirection: 'column', gap: '8px' },
    children: () => [mk('text', { props: { text: '{{ item.title }}' } })],
    fields: [{ key: 'data', label: 'Items', type: 'expression', placeholder: '{{ query.data }}' }, { key: 'emptyText', label: 'Empty text', type: 'text' }],
    events: [{ key: 'onItemClick', label: 'On item click' }], keywords: 'repeat loop map cards',
  },
  {
    type: 'form', label: 'Form', icon: 'clipboard-list', category: 'Inputs', container: true, description: 'Groups inputs, validates required fields and submits',
    exposes: '.data (values by input name)', props: { submitLabel: 'Submit', showSubmit: true, resetOnSubmit: true }, style: { display: 'flex', flexDirection: 'column', gap: '12px' },
    children: () => [mk('input', { props: { label: 'Name', placeholder: 'Jane Doe', required: true } }), mk('input', { props: { label: 'Email', inputType: 'email', placeholder: 'jane@example.com', required: true } })],
    fields: [{ key: 'submitLabel', label: 'Submit label', type: 'text' }, { key: 'showSubmit', label: 'Show submit button', type: 'boolean' }, { key: 'resetOnSubmit', label: 'Reset after submit', type: 'boolean' }],
    events: [{ key: 'onSubmit', label: 'On submit' }],
  },
  { type: 'divider', label: 'Divider', icon: 'minus', category: 'Layout', description: 'Horizontal rule with optional label', props: { label: '' }, style: {}, fields: [{ key: 'label', label: 'Label', type: 'text' }] },
  { type: 'spacer', label: 'Spacer', icon: 'move-vertical', category: 'Layout', description: 'Empty vertical space', props: { height: 32 }, style: {}, fields: [{ key: 'height', label: 'Height (px)', type: 'number' }] },

  // Text
  {
    type: 'heading', label: 'Heading', icon: 'heading', category: 'Text', description: 'Title text (H1–H4)', props: { text: 'Heading', level: 'h2' }, style: {},
    fields: [{ key: 'text', label: 'Text', type: 'textarea' }, { key: 'level', label: 'Level', type: 'select', options: ['h1', 'h2', 'h3', 'h4'] }], keywords: 'title h1',
  },
  { type: 'text', label: 'Text', icon: 'type', category: 'Text', description: 'Paragraph text with bindings', props: { text: 'Some text' }, style: {}, fields: [{ key: 'text', label: 'Text', type: 'textarea' }], events: [{ key: 'onClick', label: 'On click' }], keywords: 'paragraph label' },
  { type: 'markdown', label: 'Markdown', icon: 'file-text', category: 'Text', description: 'Rich text written in Markdown', props: { content: '## Hello\n\nWrite **Markdown** with [links](https://example.com) and lists:\n\n- One\n- Two' }, style: {}, fields: [{ key: 'content', label: 'Markdown', type: 'textarea' }], keywords: 'rich text' },
  {
    type: 'button', label: 'Button', icon: 'rectangle-horizontal', category: 'Inputs', description: 'Clickable button with variants and icon', props: { label: 'Click me', variant: 'primary', size: 'md', icon: '', iconRight: false },
    style: {}, fields: [label, { key: 'variant', label: 'Variant', type: 'select', options: ['primary', 'secondary', 'outline', 'ghost', 'danger', 'gradient', 'glass'] }, { key: 'size', label: 'Size', type: 'select', options: ['sm', 'md', 'lg'] }, { key: 'icon', label: 'Icon', type: 'icon' }, { key: 'iconRight', label: 'Icon on the right', type: 'boolean' }, { key: 'fullWidth', label: 'Full width', type: 'boolean' }, disabled, { key: 'loadingWhen', label: 'Loading when', type: 'expression', placeholder: '{{ query.loading }}' }],
    events: [{ key: 'onClick', label: 'On click' }], keywords: 'cta action submit',
  },
  { type: 'link', label: 'Link', icon: 'link', category: 'Navigation', description: 'Text link to a URL or page', props: { text: 'Learn more', url: 'https://example.com', newTab: true }, style: {}, fields: [{ key: 'text', label: 'Text', type: 'text' }, { key: 'url', label: 'URL', type: 'text' }, { key: 'page', label: 'Or go to page', type: 'page' }, { key: 'newTab', label: 'Open in new tab', type: 'boolean' }], events: [{ key: 'onClick', label: 'On click' }] },
  { type: 'navbar', label: 'Navigation bar', icon: 'panel-top-open', category: 'Navigation', description: 'Brand and links to the app pages', props: { brand: 'My App', logo: '', showPages: true, sticky: false }, style: { padding: '14px 24px' }, fields: [{ key: 'brand', label: 'Brand', type: 'text' }, { key: 'logo', label: 'Logo URL', type: 'text' }, { key: 'showPages', label: 'Show page links', type: 'boolean' }, { key: 'sticky', label: 'Sticky', type: 'boolean' }], keywords: 'menu header' },

  // Inputs
  { type: 'input', label: 'Text input', icon: 'text-cursor-input', category: 'Inputs', description: 'Single line input', exposes: '.value', props: { label: 'Label', placeholder: 'Type here…', inputType: 'text', defaultValue: '' }, style: {}, fields: [label, { key: 'placeholder', label: 'Placeholder', type: 'text' }, { key: 'inputType', label: 'Type', type: 'select', options: ['text', 'email', 'number', 'password', 'url', 'tel', 'search'] }, { key: 'defaultValue', label: 'Default value', type: 'text' }, { key: 'icon', label: 'Icon', type: 'icon' }, required, disabled, helper], events: [...change, { key: 'onSubmit', label: 'On Enter' }], keywords: 'field textbox email number' },
  { type: 'textarea', label: 'Text area', icon: 'align-left', category: 'Inputs', description: 'Multi-line input', exposes: '.value', props: { label: 'Message', placeholder: '', rows: 4, defaultValue: '' }, style: {}, fields: [label, { key: 'placeholder', label: 'Placeholder', type: 'text' }, { key: 'rows', label: 'Rows', type: 'number' }, { key: 'defaultValue', label: 'Default value', type: 'textarea' }, required, disabled, helper], events: change },
  { type: 'select', label: 'Select', icon: 'chevrons-up-down', category: 'Inputs', description: 'Dropdown; options as a comma list or an expression', exposes: '.value', props: { label: 'Choose', options: 'Option A, Option B, Option C', placeholder: 'Select…', defaultValue: '' }, style: {}, fields: [label, { key: 'options', label: 'Options', type: 'textarea', help: 'Comma separated, or {{ expression }} returning strings or { label, value } objects' }, { key: 'placeholder', label: 'Placeholder', type: 'text' }, { key: 'defaultValue', label: 'Default value', type: 'text' }, required, disabled], events: change, keywords: 'dropdown picker' },
  { type: 'radio', label: 'Radio group', icon: 'circle-dot', category: 'Inputs', description: 'Pick one option', exposes: '.value', props: { label: 'Choose one', options: 'Small, Medium, Large', defaultValue: 'Medium', inline: true }, style: {}, fields: [label, { key: 'options', label: 'Options', type: 'textarea' }, { key: 'defaultValue', label: 'Default value', type: 'text' }, { key: 'inline', label: 'Inline', type: 'boolean' }, required, disabled], events: change },
  { type: 'checkbox', label: 'Checkbox', icon: 'square-check', category: 'Inputs', description: 'True/false checkbox', exposes: '.value', props: { label: 'I agree', defaultValue: false }, style: {}, fields: [label, { key: 'defaultValue', label: 'Checked by default', type: 'boolean' }, required, disabled], events: change },
  { type: 'switch', label: 'Switch', icon: 'toggle-right', category: 'Inputs', description: 'Toggle switch', exposes: '.value', props: { label: 'Enabled', defaultValue: true }, style: {}, fields: [label, { key: 'defaultValue', label: 'On by default', type: 'boolean' }, disabled], events: change, keywords: 'toggle' },
  { type: 'date', label: 'Date picker', icon: 'calendar', category: 'Inputs', description: 'Date or date-time input', exposes: '.value', props: { label: 'Date', includeTime: false, defaultValue: '' }, style: {}, fields: [label, { key: 'includeTime', label: 'Include time', type: 'boolean' }, { key: 'defaultValue', label: 'Default value', type: 'text', placeholder: '{{ new Date().toISOString().slice(0, 10) }}' }, required, disabled], events: change },
  { type: 'slider', label: 'Slider', icon: 'sliders-horizontal', category: 'Inputs', description: 'Numeric range slider', exposes: '.value', props: { label: 'Amount', min: 0, max: 100, step: 1, defaultValue: 50, showValue: true }, style: {}, fields: [label, { key: 'min', label: 'Min', type: 'number' }, { key: 'max', label: 'Max', type: 'number' }, { key: 'step', label: 'Step', type: 'number' }, { key: 'defaultValue', label: 'Default value', type: 'number' }, { key: 'showValue', label: 'Show value', type: 'boolean' }, disabled], events: change, keywords: 'range' },
  { type: 'rating', label: 'Rating', icon: 'star', category: 'Inputs', description: 'Star rating', exposes: '.value', props: { label: 'Rate us', max: 5, defaultValue: 4 }, style: {}, fields: [label, { key: 'max', label: 'Stars', type: 'number' }, { key: 'defaultValue', label: 'Default value', type: 'number' }, disabled], events: change },
  { type: 'color', label: 'Color picker', icon: 'palette', category: 'Inputs', description: 'Pick a color', exposes: '.value', props: { label: 'Color', defaultValue: '#7c3aed' }, style: {}, fields: [label, { key: 'defaultValue', label: 'Default value', type: 'color' }, disabled], events: change },

  // Data
  { type: 'table', label: 'Table', icon: 'table', category: 'Data', description: 'Searchable, sortable, paginated table', exposes: '.selectedRow, .selectedIndex, .searchText', props: { data: '{{ [{ name: "Ava", role: "Admin" }, { name: "Liam", role: "Editor" }] }}', columns: '', pageSize: 10, searchable: true, striped: true, compact: false }, style: {}, fields: [{ key: 'data', label: 'Rows', type: 'expression', placeholder: '{{ query.data }}' }, { key: 'columns', label: 'Columns (comma separated, empty = all)', type: 'text' }, { key: 'pageSize', label: 'Rows per page', type: 'number' }, { key: 'searchable', label: 'Search box', type: 'boolean' }, { key: 'striped', label: 'Striped rows', type: 'boolean' }, { key: 'compact', label: 'Compact', type: 'boolean' }, { key: 'emptyText', label: 'Empty text', type: 'text' }], events: [{ key: 'onRowClick', label: 'On row click' }], keywords: 'grid rows data' },
  { type: 'chart', label: 'Chart', icon: 'chart-column', category: 'Data', description: 'Bar, line, area, pie or donut chart', props: { type: 'bar', data: '{{ [{ label: "Mon", value: 12 }, { label: "Tue", value: 19 }, { label: "Wed", value: 9 }, { label: "Thu", value: 24 }, { label: "Fri", value: 17 }] }}', xKey: 'label', yKeys: 'value', height: 260, showLegend: false, showGrid: true, curved: true, stacked: false, colors: '' }, style: {}, fields: [{ key: 'type', label: 'Type', type: 'select', options: ['bar', 'line', 'area', 'pie', 'donut', 'radial'] }, { key: 'data', label: 'Data', type: 'expression' }, { key: 'xKey', label: 'Label field', type: 'text' }, { key: 'yKeys', label: 'Value fields (comma separated)', type: 'text' }, { key: 'height', label: 'Height', type: 'number' }, { key: 'colors', label: 'Colors (comma separated)', type: 'text', placeholder: 'theme colors' }, { key: 'showLegend', label: 'Legend', type: 'boolean' }, { key: 'showGrid', label: 'Grid lines', type: 'boolean' }, { key: 'curved', label: 'Curved lines', type: 'boolean' }, { key: 'stacked', label: 'Stacked', type: 'boolean' }], keywords: 'graph plot analytics' },
  { type: 'stat', label: 'Stat / KPI', icon: 'trending-up', category: 'Data', description: 'Metric with label, change and icon', props: { label: 'Revenue', value: '$48,200', change: '+12.5%', trend: 'up', icon: 'dollar-sign' }, style: { padding: '20px', borderRadius: 'var(--app-radius)', background: 'var(--app-surface)', border: '1px solid var(--app-border)' }, fields: [{ key: 'label', label: 'Label', type: 'text' }, { key: 'value', label: 'Value', type: 'text' }, { key: 'change', label: 'Change', type: 'text' }, { key: 'trend', label: 'Trend', type: 'select', options: ['up', 'down', 'neutral'] }, { key: 'icon', label: 'Icon', type: 'icon' }], keywords: 'metric number kpi' },
  { type: 'progress', label: 'Progress', icon: 'loader', category: 'Feedback', description: 'Progress bar', props: { value: 64, max: 100, showLabel: true, label: 'Completion' }, style: {}, fields: [{ key: 'label', label: 'Label', type: 'text' }, { key: 'value', label: 'Value', type: 'text' }, { key: 'max', label: 'Max', type: 'number' }, { key: 'showLabel', label: 'Show percentage', type: 'boolean' }, { key: 'color', label: 'Bar color', type: 'color' }] },
  { type: 'badge', label: 'Badge', icon: 'tag', category: 'Feedback', description: 'Small status label', props: { text: 'New', tone: 'primary' }, style: {}, fields: [{ key: 'text', label: 'Text', type: 'text' }, tone], keywords: 'pill chip tag' },
  { type: 'alert', label: 'Alert', icon: 'info', category: 'Feedback', description: 'Callout with title and message', props: { title: 'Heads up', message: 'This is an informative message.', tone: 'info' }, style: {}, fields: [{ key: 'title', label: 'Title', type: 'text' }, { key: 'message', label: 'Message', type: 'textarea' }, tone], keywords: 'callout notice banner' },

  // Media
  { type: 'image', label: 'Image', icon: 'image', category: 'Media', description: 'Image from a URL', props: { src: 'https://images.unsplash.com/photo-1557683316-973673baf926?w=1200', alt: 'Image', fit: 'cover' }, style: { width: '100%', height: '220px', borderRadius: 'var(--app-radius)' }, fields: [{ key: 'src', label: 'Image URL', type: 'text' }, { key: 'alt', label: 'Alt text', type: 'text' }, { key: 'fit', label: 'Fit', type: 'select', options: ['cover', 'contain', 'fill', 'none'] }], events: [{ key: 'onClick', label: 'On click' }], keywords: 'picture photo' },
  { type: 'icon', label: 'Icon', icon: 'smile', category: 'Media', description: 'Any Lucide icon', props: { icon: 'sparkles', size: 28 }, style: { color: 'var(--app-primary)' }, fields: [{ key: 'icon', label: 'Icon', type: 'icon' }, { key: 'size', label: 'Size', type: 'number' }], events: [{ key: 'onClick', label: 'On click' }] },
  { type: 'avatar', label: 'Avatar', icon: 'circle-user', category: 'Media', description: 'Profile picture or initials', props: { name: 'Ada Lovelace', src: '', size: 48 }, style: {}, fields: [{ key: 'name', label: 'Name', type: 'text' }, { key: 'src', label: 'Image URL', type: 'text' }, { key: 'size', label: 'Size', type: 'number' }] },
  { type: 'video', label: 'Video', icon: 'video', category: 'Media', description: 'YouTube, Vimeo or MP4 video', props: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, style: { width: '100%', aspectRatio: '16 / 9', borderRadius: 'var(--app-radius)' }, fields: [{ key: 'url', label: 'Video URL', type: 'text' }, { key: 'autoplay', label: 'Autoplay (muted)', type: 'boolean' }] },
  { type: 'embed', label: 'Embed', icon: 'frame', category: 'Media', description: 'Embed an external https page in a sandboxed frame', props: { url: 'https://example.com', height: 400 }, style: { width: '100%', borderRadius: 'var(--app-radius)' }, fields: [{ key: 'url', label: 'URL (https)', type: 'text' }, { key: 'height', label: 'Height', type: 'number' }], keywords: 'iframe map' },
];

export const COMPONENT_MAP = new Map(COMPONENTS.map((c) => [c.type, c]));
export const CONTAINER_TYPES = new Set(['page', ...COMPONENTS.filter((c) => c.container).map((c) => c.type)]);
export const CATEGORIES: Category[] = ['Layout', 'Text', 'Inputs', 'Data', 'Feedback', 'Media', 'Navigation'];

export function metaFor(type: string): ComponentMeta | undefined {
  return COMPONENT_MAP.get(type);
}

/** New node with catalog defaults; names are made unique by the builder. */
export function mk(type: string, over: Partial<UINode> = {}): UINode {
  const meta = COMPONENT_MAP.get(type);
  return {
    id: uiId('n'),
    type,
    name: type,
    props: { ...(meta?.props ?? {}), ...(over.props ?? {}) },
    style: { ...(meta?.style ?? {}), ...(over.style ?? {}) },
    ...(meta?.container ? { children: over.children ?? meta.children?.() ?? [] } : {}),
  };
}

/** Prebuilt sections for the "Blocks" palette tab. */
export interface Block {
  key: string;
  label: string;
  icon: string;
  build: () => UINode;
}

const row = (children: UINode[], style: UIStyle = {}) => mk('container', { style: { display: 'flex', flexDirection: 'row', gap: '12px', alignItems: 'center', padding: '0', minHeight: '0', flexWrap: 'wrap', ...style }, children });

export const BLOCKS: Block[] = [
  {
    key: 'hero', label: 'Gradient hero', icon: 'sparkles', build: () => mk('container', {
      style: { alignItems: 'center', textAlign: 'center', gap: '18px', padding: '80px 24px', borderRadius: '28px', background: 'linear-gradient(135deg, var(--app-primary), var(--app-accent))', color: '#ffffff' },
      children: [
        mk('heading', { props: { text: 'Your big idea, beautifully presented', level: 'h1' }, style: { fontSize: '52px', color: '#ffffff', letterSpacing: '-0.02em' } }),
        mk('text', { props: { text: 'A short supporting sentence that explains the value in one breath.' }, style: { fontSize: '18px', opacity: 0.9, maxWidth: '620px' } }),
        row([mk('button', { props: { label: 'Get started', size: 'lg' }, style: { background: '#ffffff', color: 'var(--app-primary)', borderRadius: '999px' } }), mk('button', { props: { label: 'Learn more', variant: 'outline', size: 'lg' }, style: { color: '#ffffff', borderColor: 'rgba(255,255,255,0.6)', borderRadius: '999px' } })], { justifyContent: 'center' }),
      ],
    }),
  },
  {
    key: 'stats', label: 'KPI row', icon: 'trending-up', build: () => mk('grid', {
      props: { columns: 4, stackOnMobile: true },
      children: [
        mk('stat', { props: { label: 'Revenue', value: '$48.2k', change: '+12%', trend: 'up', icon: 'dollar-sign' } }),
        mk('stat', { props: { label: 'Users', value: '3,490', change: '+5%', trend: 'up', icon: 'users' } }),
        mk('stat', { props: { label: 'Churn', value: '1.8%', change: '-0.3%', trend: 'down', icon: 'activity' } }),
        mk('stat', { props: { label: 'NPS', value: '62', change: '+4', trend: 'up', icon: 'smile' } }),
      ],
    }),
  },
  {
    key: 'features', label: 'Feature cards', icon: 'layout-grid', build: () => mk('grid', {
      props: { columns: 3, stackOnMobile: true },
      children: ['zap', 'shield-check', 'bot'].map((icon, i) => mk('card', {
        props: { title: ['Fast', 'Secure', 'Smart'][i], subtitle: '' },
        children: [mk('icon', { props: { icon, size: 26 } }), mk('text', { props: { text: 'Describe the benefit in a sentence or two.' }, style: { color: 'var(--app-muted)' } })],
      })),
    }),
  },
  {
    key: 'contact', label: 'Contact form', icon: 'mail', build: () => mk('card', {
      props: { title: 'Contact us', subtitle: 'We reply within one business day' },
      children: [mk('form', { props: { submitLabel: 'Send message', showSubmit: true, resetOnSubmit: true }, children: [mk('input', { props: { label: 'Name', required: true, placeholder: 'Your name' } }), mk('input', { props: { label: 'Email', inputType: 'email', required: true, placeholder: 'you@example.com' } }), mk('textarea', { props: { label: 'Message', rows: 4, required: true } })] })],
    }),
  },
  {
    key: 'crud', label: 'Search + table', icon: 'table', build: () => mk('card', {
      props: { title: 'Records', subtitle: '' },
      children: [row([mk('input', { props: { label: '', placeholder: 'Search…', icon: 'search' }, style: { flex: '1' } }), mk('button', { props: { label: 'New', icon: 'plus' } })]), mk('table')],
    }),
  },
  {
    key: 'pricing', label: 'Pricing tiers', icon: 'badge-dollar-sign', build: () => mk('grid', {
      props: { columns: 3, stackOnMobile: true },
      children: [['Starter', '$9'], ['Pro', '$29'], ['Team', '$79']].map(([name, price], i) => mk('card', {
        props: { title: name, subtitle: '' },
        style: i === 1 ? { border: '2px solid var(--app-primary)', boxShadow: '0 20px 40px -20px var(--app-primary)', transform: 'scale(1.03)' } : {},
        children: [mk('heading', { props: { text: `${price}/mo`, level: 'h2' } }), mk('text', { props: { text: '✓ Unlimited projects\n✓ Priority support\n✓ Advanced analytics' }, style: { whiteSpace: 'pre-line', color: 'var(--app-muted)' } }), mk('button', { props: { label: 'Choose plan', variant: i === 1 ? 'gradient' : 'outline', fullWidth: true } })],
      })),
    }),
  },
];
