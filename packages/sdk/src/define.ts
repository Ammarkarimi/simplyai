import { isPropertyVisible, type NodeProperty } from '@simplyai/shared';
import type { CredentialDefinition, IntegrationDefinition, NodeDefinition } from './types';

const TYPE_RE = /^[a-zA-Z][\w.-]{1,119}$/;

function validateProperties(owner: string, props: NodeProperty[]): void {
  const seen = new Set<string>();
  for (const p of props) {
    if (seen.has(p.name)) throw new Error(`${owner}: duplicate property "${p.name}"`);
    seen.add(p.name);
    if ((p.type === 'options' || p.type === 'multiOptions') && !p.options?.length)
      throw new Error(`${owner}: property "${p.name}" needs options`);
    if (p.type === 'fixedCollection' && !p.fields?.length) throw new Error(`${owner}: property "${p.name}" needs fields`);
  }
}

/** Declare a node. Throws on malformed definitions so mistakes surface at startup. */
export function defineNode<T extends NodeDefinition>(def: T): T {
  if (!TYPE_RE.test(def.type)) throw new Error(`Invalid node type "${def.type}"`);
  if (!def.trigger && !def.execute) throw new Error(`Node ${def.type} must implement execute()`);
  if (def.trigger === 'poll' && !def.poll) throw new Error(`Polling trigger ${def.type} must implement poll()`);
  validateProperties(def.type, def.properties);
  return def;
}

export function defineCredentialType<T extends CredentialDefinition>(def: T): T {
  if (!TYPE_RE.test(def.type)) throw new Error(`Invalid credential type "${def.type}"`);
  validateProperties(def.type, def.properties);
  if (def.authKind === 'oauth2' && !def.oauth2) throw new Error(`OAuth2 credential ${def.type} needs oauth2 settings`);
  return def;
}

export function defineIntegration<T extends IntegrationDefinition>(def: T): T {
  return def;
}

export interface ParameterIssue {
  parameter: string;
  message: string;
}

/** Validate static parameter values (expressions are treated as present). */
export function validateNodeParameters(def: Pick<NodeDefinition, 'properties'>, params: Record<string, unknown>): ParameterIssue[] {
  const issues: ParameterIssue[] = [];
  for (const p of def.properties) {
    if (!isPropertyVisible(p, params) || p.type === 'notice') continue;
    const v = params[p.name] ?? p.default;
    if (p.required && (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0))) {
      issues.push({ parameter: p.name, message: `${p.displayName} is required` });
      continue;
    }
    if (typeof v === 'string' && v.includes('{{')) continue;
    if (p.type === 'number' && v !== undefined && v !== '' && v !== null) {
      const n = Number(v);
      if (!Number.isFinite(n)) issues.push({ parameter: p.name, message: `${p.displayName} must be a number` });
      else if (p.min !== undefined && n < p.min) issues.push({ parameter: p.name, message: `${p.displayName} must be ≥ ${p.min}` });
      else if (p.max !== undefined && n > p.max) issues.push({ parameter: p.name, message: `${p.displayName} must be ≤ ${p.max}` });
    }
    if ((p.type === 'options') && v !== undefined && v !== '' && p.options && !p.options.some((o) => o.value === v))
      issues.push({ parameter: p.name, message: `${p.displayName} has an invalid value` });
    if (p.type === 'json' && typeof v === 'string' && v.trim()) {
      try {
        JSON.parse(v);
      } catch {
        issues.push({ parameter: p.name, message: `${p.displayName} must be valid JSON` });
      }
    }
  }
  return issues;
}
