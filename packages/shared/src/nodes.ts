/** Node description schema: drives the editor UI, validation and docs. */

export type NodeCategory =
  | 'trigger'
  | 'logic'
  | 'transform'
  | 'ai'
  | 'communication'
  | 'business'
  | 'developer';

export const NODE_CATEGORIES: { key: NodeCategory; label: string; description: string }[] = [
  { key: 'trigger', label: 'Triggers', description: 'Start a workflow' },
  { key: 'logic', label: 'Logic', description: 'Branch, merge, loop and control flow' },
  { key: 'transform', label: 'Data transformation', description: 'Shape, parse and format data' },
  { key: 'ai', label: 'AI', description: 'Language models, agents and retrieval' },
  { key: 'communication', label: 'Communication', description: 'Email, chat and messaging' },
  { key: 'business', label: 'Business apps', description: 'CRM, productivity and commerce' },
  { key: 'developer', label: 'Developer', description: 'HTTP, databases and code' },
];

export type NodePropertyType =
  | 'string'
  | 'text'
  | 'number'
  | 'boolean'
  | 'options'
  | 'multiOptions'
  | 'json'
  | 'code'
  | 'keyValue'
  | 'fixedCollection'
  | 'conditions'
  | 'cron'
  | 'workflow'
  | 'agent'
  | 'dataTable'
  | 'knowledgeBase'
  | 'notice';

export interface NodePropertyOption {
  name: string;
  value: string | number | boolean;
  description?: string;
}

export interface DisplayOptions {
  show?: Record<string, Array<string | number | boolean>>;
  hide?: Record<string, Array<string | number | boolean>>;
}

export interface NodeProperty {
  name: string;
  displayName: string;
  type: NodePropertyType;
  default?: unknown;
  required?: boolean;
  description?: string;
  placeholder?: string;
  options?: NodePropertyOption[];
  /** for fixedCollection: the fields of each entry */
  fields?: NodeProperty[];
  displayOptions?: DisplayOptions;
  /** disallow {{ expressions }} */
  noExpression?: boolean;
  /** code editor language */
  language?: 'javascript' | 'json' | 'sql' | 'graphql' | 'html' | 'markdown';
  rows?: number;
  min?: number;
  max?: number;
  /** secret-looking input that should be masked in the editor */
  password?: boolean;
}

export interface NodePort {
  name: string;
  label?: string;
}

export type TriggerKind = 'manual' | 'webhook' | 'schedule' | 'poll' | 'event' | 'form' | 'chat' | 'error';

export interface NodeCredentialRef {
  /** accepted credential types */
  types: string[];
  required?: boolean;
  displayOptions?: DisplayOptions;
}

export interface NodeDescription {
  type: string;
  version: number;
  displayName: string;
  description: string;
  category: NodeCategory;
  /** sub group within the palette, e.g. "Flow", "Google" */
  subcategory?: string;
  /** lucide icon name or integration key for a brand logo */
  icon: string;
  color: string;
  /** integration key this node belongs to (marketplace) */
  integration?: string;
  trigger?: TriggerKind;
  inputs: NodePort[];
  /** static outputs; dynamicOutputs computed in the editor from parameters */
  outputs: NodePort[];
  /** name of a parameter whose entries become output ports (Switch) */
  dynamicOutputs?: { parameter: string; labelField?: string; fallback?: boolean };
  credentials?: NodeCredentialRef;
  properties: NodeProperty[];
  /** markdown documentation shown in the editor */
  docs?: string;
  /** example output used for documentation */
  outputExample?: Record<string, unknown>;
  /** node can be a tool for an AI agent */
  usableAsTool?: boolean;
  /** output port index that starts a loop body (Loop node) */
  loopOutput?: number;
}

export interface CredentialTypeDescription {
  type: string;
  displayName: string;
  description?: string;
  /** integration key the credential belongs to */
  integration?: string;
  authKind: 'apiKey' | 'oauth2' | 'basic' | 'connection' | 'custom';
  properties: NodeProperty[];
  docsUrl?: string;
  /** true when the credential type supports a connection test */
  testable: boolean;
  oauth2?: {
    authorizationUrl: string;
    tokenUrl: string;
    scopes: string[];
    authQueryParameters?: Record<string, string>;
  };
}

export interface IntegrationDescription {
  key: string;
  name: string;
  description: string;
  category: string;
  /** simple-icons slug, used for the logo */
  logo?: string;
  color: string;
  website?: string;
  docsUrl?: string;
  credentialTypes: string[];
  triggers: string[];
  actions: string[];
}

/** Evaluate displayOptions against current parameter values. */
export function isPropertyVisible(prop: { displayOptions?: DisplayOptions }, params: Record<string, unknown>): boolean {
  const d = prop.displayOptions;
  if (!d) return true;
  if (d.show) {
    for (const [key, values] of Object.entries(d.show)) {
      if (!values.includes(params[key] as never)) return false;
    }
  }
  if (d.hide) {
    for (const [key, values] of Object.entries(d.hide)) {
      if (values.includes(params[key] as never)) return false;
    }
  }
  return true;
}

/** Compute the output ports of a node instance, taking dynamic outputs into account. */
export function resolveOutputs(desc: NodeDescription, params: Record<string, unknown>): NodePort[] {
  if (!desc.dynamicOutputs) return desc.outputs;
  const raw = params[desc.dynamicOutputs.parameter];
  const entries = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  const ports: NodePort[] = entries.map((e, i) => ({
    name: `output${i}`,
    label: String((desc.dynamicOutputs?.labelField && e[desc.dynamicOutputs.labelField]) || `Output ${i}`),
  }));
  if (desc.dynamicOutputs.fallback && params.fallbackOutput !== false) ports.push({ name: 'fallback', label: 'Fallback' });
  return ports.length ? ports : desc.outputs;
}
