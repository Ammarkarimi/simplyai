import type { CredentialTypeDescription, IntegrationDescription, NodeDescription } from '@simplyai/shared';
import type { CredentialDefinition, IntegrationDefinition, NodeDefinition } from './types';

/** Holds node, credential and integration definitions. The engine only talks to this. */
export class NodeRegistry {
  private nodes = new Map<string, NodeDefinition>();
  private credentials = new Map<string, CredentialDefinition>();
  private integrations = new Map<string, IntegrationDefinition>();

  registerNode(def: NodeDefinition): this {
    if (this.nodes.has(def.type)) throw new Error(`Node type ${def.type} is already registered`);
    this.nodes.set(def.type, def);
    return this;
  }

  registerCredential(def: CredentialDefinition): this {
    if (this.credentials.has(def.type)) throw new Error(`Credential type ${def.type} is already registered`);
    this.credentials.set(def.type, def);
    return this;
  }

  registerIntegration(def: IntegrationDefinition): this {
    this.integrations.set(def.key, def);
    return this;
  }

  /** Register a bundle (a plugin package exporting nodes/credentials/integrations). */
  use(bundle: { nodes?: NodeDefinition[]; credentials?: CredentialDefinition[]; integrations?: IntegrationDefinition[] }): this {
    bundle.credentials?.forEach((c) => this.registerCredential(c));
    bundle.nodes?.forEach((n) => this.registerNode(n));
    bundle.integrations?.forEach((i) => this.registerIntegration(i));
    return this;
  }

  getNode(type: string): NodeDefinition | undefined {
    return this.nodes.get(type);
  }

  requireNode(type: string): NodeDefinition {
    const n = this.nodes.get(type);
    if (!n) throw new Error(`Unknown node type "${type}"`);
    return n;
  }

  getCredential(type: string): CredentialDefinition | undefined {
    return this.credentials.get(type);
  }

  listNodes(): NodeDefinition[] {
    return [...this.nodes.values()];
  }

  listCredentials(): CredentialDefinition[] {
    return [...this.credentials.values()];
  }

  listIntegrations(): IntegrationDefinition[] {
    return [...this.integrations.values()];
  }

  /** Serializable descriptions for the editor (functions stripped). */
  nodeDescriptions(): NodeDescription[] {
    return this.listNodes().map(({ execute: _e, poll: _p, ...desc }) => desc);
  }

  credentialDescriptions(): CredentialTypeDescription[] {
    return this.listCredentials().map(({ authenticate: _a, test, ...desc }) => ({ ...desc, testable: !!test }));
  }

  integrationDescriptions(): IntegrationDescription[] {
    return this.listIntegrations();
  }
}
