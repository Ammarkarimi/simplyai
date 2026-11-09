import type { WorkflowConnectionDef, WorkflowDefinition, WorkflowNodeDef } from '@simplyai/shared';

export interface Graph {
  nodes: Map<string, WorkflowNodeDef>;
  byName: Map<string, WorkflowNodeDef>;
  outgoing: Map<string, WorkflowConnectionDef[]>;
  incoming: Map<string, WorkflowConnectionDef[]>;
}

export function connectionKey(c: WorkflowConnectionDef): string {
  return `${c.source}:${c.sourceOutput}->${c.target}:${c.targetInput}`;
}

export function buildGraph(def: WorkflowDefinition): Graph {
  const nodes = new Map<string, WorkflowNodeDef>();
  const byName = new Map<string, WorkflowNodeDef>();
  for (const n of def.nodes) {
    if (nodes.has(n.id)) throw new Error(`Duplicate node id "${n.id}"`);
    if (byName.has(n.name)) throw new Error(`Duplicate node name "${n.name}"`);
    nodes.set(n.id, n);
    byName.set(n.name, n);
  }
  const outgoing = new Map<string, WorkflowConnectionDef[]>();
  const incoming = new Map<string, WorkflowConnectionDef[]>();
  for (const c of def.connections) {
    if (!nodes.has(c.source) || !nodes.has(c.target)) continue;
    (outgoing.get(c.source) ?? outgoing.set(c.source, []).get(c.source)!).push(c);
    (incoming.get(c.target) ?? incoming.set(c.target, []).get(c.target)!).push(c);
  }
  return { nodes, byName, outgoing, incoming };
}

export function reachableFrom(graph: Graph, start: string): Set<string> {
  const seen = new Set<string>([start]);
  const stack = [start];
  while (stack.length) {
    const id = stack.pop()!;
    for (const c of graph.outgoing.get(id) ?? []) {
      if (!seen.has(c.target)) {
        seen.add(c.target);
        stack.push(c.target);
      }
    }
  }
  return seen;
}

export function ancestorsOf(graph: Graph, target: string): Set<string> {
  const seen = new Set<string>([target]);
  const stack = [target];
  while (stack.length) {
    const id = stack.pop()!;
    for (const c of graph.incoming.get(id) ?? []) {
      if (!seen.has(c.source)) {
        seen.add(c.source);
        stack.push(c.source);
      }
    }
  }
  return seen;
}

/** Nodes executed once per iteration of a loop node: reachable from its loop port without passing through it. */
export function loopBody(graph: Graph, loopId: string, loopOutput: number): Set<string> {
  const body = new Set<string>();
  const stack = (graph.outgoing.get(loopId) ?? []).filter((c) => c.sourceOutput === loopOutput).map((c) => c.target);
  while (stack.length) {
    const id = stack.pop()!;
    if (id === loopId || body.has(id)) continue;
    body.add(id);
    for (const c of graph.outgoing.get(id) ?? []) stack.push(c.target);
  }
  return body;
}

/** Edges closing a cycle when walking depth-first from start. */
export function findBackEdges(graph: Graph, start: string, active: Set<string>): Set<string> {
  const back = new Set<string>();
  const state = new Map<string, 1 | 2>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const c of graph.outgoing.get(id) ?? []) {
      if (!active.has(c.target)) continue;
      const s = state.get(c.target);
      if (s === 1) back.add(connectionKey(c));
      else if (!s) visit(c.target);
    }
    state.set(id, 2);
  };
  visit(start);
  return back;
}

/** Static validation used before publishing. */
export function analyzeWorkflow(def: WorkflowDefinition, isTrigger: (type: string) => boolean): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  let graph: Graph;
  try {
    graph = buildGraph(def);
  } catch (err) {
    return { errors: [(err as Error).message], warnings };
  }
  const triggers = def.nodes.filter((n) => isTrigger(n.type) && !n.disabled);
  if (!triggers.length) errors.push('The workflow needs at least one trigger node');
  const reached = new Set<string>();
  for (const t of triggers) reachableFrom(graph, t.id).forEach((id) => reached.add(id));
  for (const n of def.nodes) if (!reached.has(n.id) && !isTrigger(n.type)) warnings.push(`Node "${n.name}" is not connected to a trigger`);
  for (const c of def.connections) {
    if (!graph.nodes.has(c.source) || !graph.nodes.has(c.target)) warnings.push(`A connection references a missing node`);
  }
  return { errors, warnings };
}
