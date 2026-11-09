import { createDefaultRegistry } from '@simplyai/nodes';
import type { NodeRegistry } from '@simplyai/sdk';

let registry: NodeRegistry | undefined;
/** Process wide node registry. Custom node packages can be registered with getRegistry().use(bundle). */
export function getRegistry(): NodeRegistry {
  registry ??= createDefaultRegistry();
  return registry;
}
