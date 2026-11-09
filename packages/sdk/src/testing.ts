/** Lightweight harness to unit test a single node without the engine or a database. */
import type { Item, WorkflowNodeDef } from '@simplyai/shared';
import { httpRequest, type HttpRequestOptions } from './http';
import type { ExecuteContext, NodeDefinition, NodeOutput, ResolvedCredential, RuntimeServices } from './types';

export interface TestNodeOptions {
  parameters?: Record<string, unknown>;
  inputs?: Item[][];
  credential?: ResolvedCredential;
  services?: Partial<RuntimeServices>;
  authenticate?: (req: HttpRequestOptions) => HttpRequestOptions;
  http?: ExecuteContext['http'];
}

function notAvailable(name: string): never {
  throw new Error(`Runtime service "${name}" is not available in this test`);
}

export async function testNode(def: NodeDefinition, opts: TestNodeOptions = {}): Promise<NodeOutput> {
  const node: WorkflowNodeDef = { id: 'test', name: def.displayName, type: def.type, position: { x: 0, y: 0 }, parameters: opts.parameters ?? {} };
  const params = { ...Object.fromEntries(def.properties.map((p) => [p.name, p.default])), ...node.parameters };
  const http = opts.http ?? (<T>(o: HttpRequestOptions) => httpRequest<T>(o));
  const services = new Proxy(opts.services ?? {}, {
    get: (target, prop: string) => (prop in target ? (target as Record<string, unknown>)[prop] : () => notAvailable(prop)),
  }) as RuntimeServices;
  const ctx: ExecuteContext = {
    node,
    workflow: { id: 'wf', name: 'Test', workspaceId: 'ws' },
    execution: { id: 'exec', mode: 'MANUAL' },
    inputs: opts.inputs ?? [[{ json: {} }]],
    getInputItems: (port = 0) => ctx.inputs[port] ?? [],
    getParam: <T>(name: string, _i?: number, fallback?: T) => (params[name] ?? fallback) as T,
    getRawParam: <T>(name: string) => params[name] as T,
    getCredential: async <T>() => {
      if (!opts.credential) throw new Error('No credential provided');
      return opts.credential as ResolvedCredential<T>;
    },
    hasCredential: () => !!opts.credential,
    http: http as ExecuteContext['http'],
    httpWithAuth: ((o: HttpRequestOptions) => http(opts.authenticate ? opts.authenticate(o) : o)) as ExecuteContext['http'],
    nodeState: {},
    staticData: {},
    runIndex: 0,
    signal: new AbortController().signal,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    services,
    continueOnFail: false,
  };
  if (!def.execute) return ctx.inputs;
  return def.execute(ctx);
}
