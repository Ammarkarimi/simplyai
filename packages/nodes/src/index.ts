import { NodeRegistry, type NodeDefinition } from '@simplyai/sdk';
import { credentialTypes } from './credentials';
import { triggerNodes } from './nodes/triggers';
import { logicNodes } from './nodes/logic';
import { transformNodes } from './nodes/transform';
import { aiNodes } from './nodes/ai';
import { communicationNodes } from './nodes/communication';
import { businessNodes } from './nodes/business';
import { developerNodes } from './nodes/developer';
import { buildIntegrations } from './integrations';

export const builtinNodes: NodeDefinition[] = [
  ...triggerNodes, ...logicNodes, ...transformNodes, ...aiNodes, ...communicationNodes, ...businessNodes, ...developerNodes,
];

export const builtinCredentials = credentialTypes;
export const builtinIntegrations = buildIntegrations(builtinNodes, credentialTypes);

/** Registry with every built-in node. Plugins can call registry.use(bundle) afterwards. */
export function createDefaultRegistry(): NodeRegistry {
  return new NodeRegistry().use({ nodes: builtinNodes, credentials: credentialTypes, integrations: builtinIntegrations });
}

export { PROVIDER_BY_CREDENTIAL, LLM_CREDENTIAL_TYPES, EMBEDDING_CREDENTIAL_TYPES, extractJson, validateSchema } from './lib/ai';
export { evaluateCondition, evaluateGroup } from './lib/conditions';
export { defineRestNode } from './lib/rest';
export { queryDatabase } from './nodes/developer/sql';
export { testConnectionCredential } from './lib/connection-test';
