/**
 * Declarative builder for REST based integration nodes. Each operation maps
 * parameters to an HTTP request and the response to output items.
 */
import { defineNode, NodeOperationError, toItems, type ExecuteContext, type NodeDefinition, type NodeProperty, type Item } from '@simplyai/sdk';
import type { NodeCategory } from '@simplyai/shared';

export type ParamGetter = <T = unknown>(name: string, fallback?: T) => T;

export interface RestOperation {
  value: string;
  name: string;
  description?: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** absolute URL or path relative to the credential / node base URL */
  url: (p: ParamGetter) => string;
  query?: (p: ParamGetter) => Record<string, string | number | boolean | undefined | null>;
  body?: (p: ParamGetter) => unknown;
  bodyType?: 'json' | 'form';
  headers?: Record<string, string>;
  properties?: NodeProperty[];
  /** transform the response body into output data (object or array) */
  output?: (body: any, p: ParamGetter) => unknown;
  /** custom execution for operations that need multiple calls */
  run?: (ctx: ExecuteContext, p: ParamGetter, itemIndex: number) => Promise<unknown>;
}

export interface RestNodeConfig {
  type: string;
  displayName: string;
  description: string;
  integration: string;
  category?: NodeCategory;
  subcategory?: string;
  icon?: string;
  color: string;
  credentialTypes: string[];
  baseUrl?: string;
  operations: RestOperation[];
  docs?: string;
  usableAsTool?: boolean;
}

/** Turns Stripe-style nested objects into form fields: metadata[key]=value */
export function flattenForm(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flattenForm(v as Record<string, unknown>, key));
    else if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? Object.assign(out, flattenForm(x as Record<string, unknown>, `${key}[${i}]`)) : (out[`${key}[${i}]`] = String(x))));
    else out[key] = String(v);
  }
  return out;
}

export const enc = (v: unknown) => encodeURIComponent(String(v ?? ''));

export function jsonParam(v: unknown, name: string): Record<string, unknown> {
  if (v === undefined || v === null || v === '') return {};
  if (typeof v === 'object') return v as Record<string, unknown>;
  try {
    return JSON.parse(String(v)) as Record<string, unknown>;
  } catch {
    throw new NodeOperationError(`"${name}" must be valid JSON`);
  }
}

export function defineRestNode(cfg: RestNodeConfig): NodeDefinition {
  const props = new Map<string, NodeProperty>();
  for (const op of cfg.operations) {
    for (const p of op.properties ?? []) {
      const existing = props.get(p.name);
      if (existing) {
        const ops = existing.displayOptions?.show?.operation ?? [];
        existing.displayOptions = { show: { ...existing.displayOptions?.show, operation: [...ops, op.value] } };
      } else {
        props.set(p.name, { ...p, displayOptions: { show: { ...p.displayOptions?.show, operation: [op.value] } } });
      }
    }
  }
  const properties: NodeProperty[] = [
    {
      name: 'operation', displayName: 'Operation', type: 'options', required: true, noExpression: true,
      default: cfg.operations[0]!.value,
      options: cfg.operations.map((o) => ({ name: o.name, value: o.value, description: o.description })),
    },
    ...props.values(),
  ];
  return defineNode({
    type: cfg.type,
    version: 1,
    displayName: cfg.displayName,
    description: cfg.description,
    category: cfg.category ?? 'business',
    subcategory: cfg.subcategory,
    icon: cfg.icon ?? cfg.integration,
    color: cfg.color,
    integration: cfg.integration,
    inputs: [{ name: 'main' }],
    outputs: [{ name: 'main' }],
    credentials: { types: cfg.credentialTypes, required: true },
    usableAsTool: cfg.usableAsTool ?? true,
    properties,
    docs: cfg.docs ?? `${cfg.description}\n\n**Operations:** ${cfg.operations.map((o) => o.name).join(', ')}.`,
    async execute(ctx) {
      const items = ctx.getInputItems();
      const source = items.length ? items : [{ json: {} }];
      const out: Item[] = [];
      for (let i = 0; i < source.length; i++) {
        const p: ParamGetter = (name, fallback) => ctx.getParam(name, i, fallback);
        const opName = p<string>('operation');
        const op = cfg.operations.find((o) => o.value === opName);
        if (!op) throw new NodeOperationError(`Unsupported operation "${opName}"`);
        try {
          let result: unknown;
          if (op.run) result = await op.run(ctx, p, i);
          else {
            let url = op.url(p);
            if (cfg.baseUrl && url.startsWith('/')) url = cfg.baseUrl + url;
            const res = await ctx.httpWithAuth({
              method: op.method,
              url,
              query: op.query?.(p),
              body: op.body ? (op.bodyType === 'form' ? flattenForm(op.body(p) as Record<string, unknown>) : (op.body(p) as never)) : undefined,
              bodyType: op.bodyType,
              headers: op.headers,
            });
            result = op.output ? op.output(res.body, p) : res.body;
          }
          if (result === undefined || result === null) result = { success: true };
          out.push(...toItems(result, i));
        } catch (err) {
          if (ctx.continueOnFail) out.push({ json: { error: (err as Error).message }, pairedItem: i });
          else throw err;
        }
      }
      return [out];
    },
  });
}
