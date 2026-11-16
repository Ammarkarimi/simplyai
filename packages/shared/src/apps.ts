/**
 * UI builder: app definition format shared by the API (validation, query
 * execution) and the web app (builder canvas and runtime renderer).
 *
 * An app is a set of pages. Each page holds a tree of components. Component
 * props and styles may contain `{{ expressions }}` evaluated in the browser
 * against the app scope (component values, query results, state, page, user).
 * Queries are executed on the server from the stored definition, so a viewer
 * can only supply arguments, never change which workflow or table is used.
 */
import { z } from 'zod';

export type Breakpoint = 'desktop' | 'tablet' | 'mobile';
export const BREAKPOINT_WIDTH: Record<Breakpoint, number> = { desktop: 1280, tablet: 768, mobile: 390 };

export type UIStyle = Record<string, string | number>;

export interface UIAction {
  id: string;
  type: UIActionType;
  /** expression; the action is skipped when it evaluates falsy */
  condition?: string;
  [param: string]: unknown;
}

export const UI_ACTION_TYPES = [
  'runQuery', 'setState', 'navigate', 'openUrl', 'toast', 'openModal', 'closeModal', 'setValue', 'resetInputs', 'copy', 'scrollTo', 'download',
] as const;
export type UIActionType = (typeof UI_ACTION_TYPES)[number];

export interface UIAnimation {
  type: 'none' | 'fade' | 'slideUp' | 'slideDown' | 'slideLeft' | 'slideRight' | 'zoom' | 'bounce' | 'pulse' | 'float' | 'spin' | 'shake';
  durationMs?: number;
  delayMs?: number;
  loop?: boolean;
}

export interface UINode {
  id: string;
  type: string;
  /** unique identifier used in expressions, e.g. `nameInput.value` */
  name: string;
  props: Record<string, unknown>;
  style?: UIStyle;
  hoverStyle?: UIStyle;
  tabletStyle?: UIStyle;
  mobileStyle?: UIStyle;
  animation?: UIAnimation;
  /** expression; hidden when it evaluates falsy */
  visible?: string;
  hideOn?: Breakpoint[];
  events?: Record<string, UIAction[]>;
  children?: UINode[];
  locked?: boolean;
}

export interface UIPage {
  id: string;
  name: string;
  /** url segment, unique per app */
  path: string;
  title?: string;
  hidden?: boolean;
  root: UINode;
  onLoad?: UIAction[];
}

export type AppQueryKind = 'workflow' | 'dataTable' | 'static';
export type DataTableOperation = 'list' | 'get' | 'insert' | 'update' | 'delete';

export interface AppQuery {
  id: string;
  name: string;
  kind: AppQueryKind;
  runOnLoad?: boolean;
  /** workflow: id of a workflow with an App Trigger */
  workflowId?: string;
  /** workflow: JSON template with expressions sent as the trigger item */
  payload?: string;
  /** dataTable */
  tableId?: string;
  operation?: DataTableOperation;
  /** dataTable arguments (search, pageSize, rowId, data…), each may be an expression */
  args?: Record<string, string>;
  /** static: JSON value */
  staticData?: string;
  /** expression applied to the result; `data` is the raw result */
  transform?: string;
  /** ask for confirmation before running */
  confirm?: string;
  onSuccess?: UIAction[];
  onError?: UIAction[];
}

export interface AppStateVar {
  name: string;
  /** JSON literal */
  initial: string;
}

export interface AppTheme {
  mode: 'light' | 'dark';
  primary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  border: string;
  radius: number;
  font: string;
  headingFont: string;
}

export interface AppSettings {
  navigation: 'none' | 'top' | 'side';
  maxWidth: number;
  favicon?: string;
  customFonts?: string[];
}

export interface AppDefinition {
  version: 1;
  theme: AppTheme;
  settings: AppSettings;
  pages: UIPage[];
  queries: AppQuery[];
  state: AppStateVar[];
}

export const FONT_OPTIONS = [
  'Inter', 'Poppins', 'Montserrat', 'Playfair Display', 'Space Grotesk', 'DM Sans', 'Roboto', 'Lato', 'Merriweather', 'JetBrains Mono',
  'Outfit', 'Sora', 'Bricolage Grotesque', 'Fraunces', 'Caveat', 'system-ui',
] as const;

export const THEME_PRESETS: Record<string, AppTheme> = {
  violet: { mode: 'light', primary: '#7c3aed', accent: '#ec4899', background: '#f8f7ff', surface: '#ffffff', text: '#18181b', mutedText: '#71717a', border: '#e4e4e7', radius: 12, font: 'Inter', headingFont: 'Inter' },
  ocean: { mode: 'light', primary: '#0284c7', accent: '#14b8a6', background: '#f0f9ff', surface: '#ffffff', text: '#0f172a', mutedText: '#64748b', border: '#e2e8f0', radius: 10, font: 'DM Sans', headingFont: 'Space Grotesk' },
  sunset: { mode: 'light', primary: '#ea580c', accent: '#db2777', background: '#fff7ed', surface: '#ffffff', text: '#1c1917', mutedText: '#78716c', border: '#fed7aa', radius: 16, font: 'Poppins', headingFont: 'Poppins' },
  forest: { mode: 'light', primary: '#16a34a', accent: '#ca8a04', background: '#f7fdf9', surface: '#ffffff', text: '#14261c', mutedText: '#5f7368', border: '#d6eadc', radius: 8, font: 'Lato', headingFont: 'Merriweather' },
  midnight: { mode: 'dark', primary: '#8b5cf6', accent: '#22d3ee', background: '#09090b', surface: '#18181b', text: '#fafafa', mutedText: '#a1a1aa', border: '#27272a', radius: 12, font: 'Inter', headingFont: 'Space Grotesk' },
  neon: { mode: 'dark', primary: '#22c55e', accent: '#f0abfc', background: '#020617', surface: '#0f172a', text: '#e2e8f0', mutedText: '#94a3b8', border: '#1e293b', radius: 4, font: 'JetBrains Mono', headingFont: 'Sora' },
  mono: { mode: 'light', primary: '#18181b', accent: '#71717a', background: '#ffffff', surface: '#fafafa', text: '#09090b', mutedText: '#71717a', border: '#e4e4e7', radius: 0, font: 'Space Grotesk', headingFont: 'Space Grotesk' },
};

// ── Limits & validation ───────────────────────────────────────

export const APP_LIMITS = {
  maxBytes: 2_000_000,
  maxPages: 50,
  maxNodes: 3_000,
  maxDepth: 40,
  maxQueries: 100,
  maxState: 100,
} as const;

export const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
export const RESERVED_NAMES = new Set(['state', 'page', 'user', 'url', 'theme', 'item', 'index', 'app', 'event', 'data', 'Math', 'JSON', 'Object', 'Array', 'Number', 'String', 'Boolean', 'Date', 'true', 'false', 'null', 'undefined']);

/** CSS properties the style editor may set. Anything else is dropped at render time. */
export const ALLOWED_STYLE_PROPS = new Set([
  'display', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'alignSelf', 'alignContent', 'gap', 'rowGap', 'columnGap',
  'gridTemplateColumns', 'gridTemplateRows', 'gridColumn', 'gridRow', 'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'order',
  'width', 'minWidth', 'maxWidth', 'height', 'minHeight', 'maxHeight', 'aspectRatio',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'color', 'background', 'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat', 'backgroundAttachment', 'backgroundClip',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textAlign', 'textTransform', 'textDecoration', 'textShadow', 'whiteSpace', 'wordBreak',
  'border', 'borderWidth', 'borderStyle', 'borderColor', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft', 'borderRadius',
  'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius', 'outline', 'outlineOffset',
  'boxShadow', 'opacity', 'overflow', 'overflowX', 'overflowY', 'position', 'top', 'right', 'bottom', 'left', 'zIndex', 'inset',
  'transform', 'transformOrigin', 'transition', 'filter', 'backdropFilter', 'mixBlendMode', 'cursor', 'objectFit', 'objectPosition', 'pointerEvents',
  'WebkitBackgroundClip', 'WebkitTextFillColor', 'clipPath', 'visibility', 'userSelect',
]);

const URL_IN_CSS = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;

/**
 * Sanitize a CSS value: blocks script-like constructs and only allows
 * https:, data:image and relative urls inside url().
 */
export function sanitizeStyleValue(prop: string, value: unknown): string | number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  if (!v || v.length > 2_000) return undefined;
  if (/[<>{};]|expression\s*\(|javascript:|vbscript:|@import|behavior\s*:|-moz-binding/i.test(v)) return undefined;
  let ok = true;
  v.replace(URL_IN_CSS, (_m, _q, url: string) => {
    if (!/^(https:\/\/|data:image\/(png|jpe?g|gif|webp|svg\+xml);|\/)/i.test(url.trim())) ok = false;
    return '';
  });
  if (!ok) return undefined;
  if (prop === 'position' && !['relative', 'absolute', 'sticky', 'static'].includes(v)) return undefined;
  return v;
}

export function sanitizeStyle(style: UIStyle | undefined): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!style) return out;
  for (const [k, raw] of Object.entries(style)) {
    if (!ALLOWED_STYLE_PROPS.has(k)) continue;
    const v = sanitizeStyleValue(k, raw);
    if (v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

/** Only http(s), mailto, tel and in-app (#, /) links. */
export function safeUrl(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  const u = url.trim();
  if (/^(https?:\/\/|mailto:|tel:|#|\/(?!\/))/i.test(u)) return u;
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(u)) return u;
  return undefined;
}

const actionSchema = z.object({ id: z.string().min(1).max(64), type: z.enum(UI_ACTION_TYPES), condition: z.string().max(5_000).optional() }).passthrough();
const styleSchema = z.record(z.union([z.string().max(2_000), z.number()]));

export const uiNodeSchema: z.ZodType<UINode> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(64),
    type: z.string().min(1).max(64),
    name: z.string().regex(IDENTIFIER_RE, 'Component names must be identifiers'),
    props: z.record(z.unknown()),
    style: styleSchema.optional(),
    hoverStyle: styleSchema.optional(),
    tabletStyle: styleSchema.optional(),
    mobileStyle: styleSchema.optional(),
    animation: z.object({ type: z.string().max(32), durationMs: z.number().min(0).max(60_000).optional(), delayMs: z.number().min(0).max(60_000).optional(), loop: z.boolean().optional() }).optional(),
    visible: z.string().max(5_000).optional(),
    hideOn: z.array(z.enum(['desktop', 'tablet', 'mobile'])).optional(),
    events: z.record(z.array(actionSchema).max(50)).optional(),
    children: z.array(uiNodeSchema).max(500).optional(),
    locked: z.boolean().optional(),
  }),
) as z.ZodType<UINode>;

export const appQuerySchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().regex(IDENTIFIER_RE, 'Query names must be identifiers'),
  kind: z.enum(['workflow', 'dataTable', 'static']),
  runOnLoad: z.boolean().optional(),
  workflowId: z.string().max(64).optional(),
  payload: z.string().max(50_000).optional(),
  tableId: z.string().max(64).optional(),
  operation: z.enum(['list', 'get', 'insert', 'update', 'delete']).optional(),
  args: z.record(z.string().max(20_000)).optional(),
  staticData: z.string().max(500_000).optional(),
  transform: z.string().max(10_000).optional(),
  confirm: z.string().max(500).optional(),
  onSuccess: z.array(actionSchema).max(50).optional(),
  onError: z.array(actionSchema).max(50).optional(),
});

const hex = z.string().max(64);
export const appThemeSchema = z.object({
  mode: z.enum(['light', 'dark']), primary: hex, accent: hex, background: hex, surface: hex, text: hex, mutedText: hex, border: hex,
  radius: z.number().min(0).max(64), font: z.string().max(64), headingFont: z.string().max(64),
});

export const appDefinitionSchema = z
  .object({
    version: z.literal(1),
    theme: appThemeSchema,
    settings: z.object({ navigation: z.enum(['none', 'top', 'side']), maxWidth: z.number().min(0).max(10_000), favicon: z.string().max(2_000).optional(), customFonts: z.array(z.string().max(64)).max(10).optional() }),
    pages: z
      .array(
        z.object({
          id: z.string().min(1).max(64),
          name: z.string().min(1).max(100),
          path: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'Page paths use lowercase letters, digits and -'),
          title: z.string().max(200).optional(),
          hidden: z.boolean().optional(),
          root: uiNodeSchema,
          onLoad: z.array(actionSchema).max(50).optional(),
        }),
      )
      .min(1)
      .max(APP_LIMITS.maxPages),
    queries: z.array(appQuerySchema).max(APP_LIMITS.maxQueries),
    state: z.array(z.object({ name: z.string().regex(IDENTIFIER_RE), initial: z.string().max(100_000) })).max(APP_LIMITS.maxState),
  })
  .superRefine((def, ctx) => {
    const names = new Set<string>();
    const ids = new Set<string>();
    let count = 0;
    const visit = (n: UINode, depth: number) => {
      count++;
      if (depth > APP_LIMITS.maxDepth) ctx.addIssue({ code: 'custom', message: 'Components are nested too deeply' });
      if (names.has(n.name)) ctx.addIssue({ code: 'custom', message: `Duplicate component name "${n.name}"` });
      if (ids.has(n.id)) ctx.addIssue({ code: 'custom', message: `Duplicate component id "${n.id}"` });
      if (RESERVED_NAMES.has(n.name)) ctx.addIssue({ code: 'custom', message: `"${n.name}" is a reserved name` });
      names.add(n.name);
      ids.add(n.id);
      n.children?.forEach((c) => visit(c, depth + 1));
    };
    def.pages.forEach((p) => visit(p.root, 0));
    if (count > APP_LIMITS.maxNodes) ctx.addIssue({ code: 'custom', message: `Apps are limited to ${APP_LIMITS.maxNodes} components` });
    for (const q of def.queries) {
      if (names.has(q.name)) ctx.addIssue({ code: 'custom', message: `Query "${q.name}" has the same name as a component` });
      names.add(q.name);
    }
    const paths = new Set<string>();
    for (const p of def.pages) {
      if (paths.has(p.path)) ctx.addIssue({ code: 'custom', message: `Duplicate page path "${p.path}"` });
      paths.add(p.path);
    }
  });

export const appSlugSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{2,62}$/, 'Use 3-63 lowercase letters, digits and -');

export const createAppSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1_000).optional(),
  template: z.string().max(64).optional(),
  definition: z.unknown().optional(),
});

export const updateAppSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(1_000).nullable().optional(),
  icon: z.string().max(64).optional(),
  color: z.string().max(32).optional(),
  slug: appSlugSchema.optional(),
  access: z.enum(['PRIVATE', 'PUBLIC']).optional(),
  definition: appDefinitionSchema.optional(),
});

export const publishAppSchema = z.object({ message: z.string().max(500).optional() });
export const runAppQuerySchema = z.object({ args: z.record(z.unknown()).default({}), query: appQuerySchema.optional() });

// ── Helpers ───────────────────────────────────────────────────

let counter = 0;
export function uiId(prefix = 'n'): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${counter.toString(36)}`;
}

export function walkNodes(node: UINode, fn: (n: UINode, parent: UINode | null) => void, parent: UINode | null = null): void {
  fn(node, parent);
  node.children?.forEach((c) => walkNodes(c, fn, node));
}

export function allNodes(def: Pick<AppDefinition, 'pages'>): UINode[] {
  const out: UINode[] = [];
  def.pages.forEach((p) => walkNodes(p.root, (n) => out.push(n)));
  return out;
}

export function emptyPage(name = 'Home', path = 'home'): UIPage {
  return {
    id: uiId('page'),
    name,
    path,
    root: { id: uiId('root'), type: 'page', name: `${path.replace(/-/g, '_')}Page`, props: {}, style: { padding: '32px', gap: '20px' }, children: [] },
  };
}

export function emptyAppDefinition(theme: AppTheme = THEME_PRESETS.violet!): AppDefinition {
  return { version: 1, theme: { ...theme }, settings: { navigation: 'none', maxWidth: 1200 }, pages: [emptyPage()], queries: [], state: [] };
}

export * from './app-templates';
