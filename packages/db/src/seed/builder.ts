import type { WorkflowDefinition } from '@simplyai/shared';

type NodeSpec = [id: string, name: string, type: string, x: number, y: number, parameters?: Record<string, unknown>, extra?: Record<string, unknown>];
type EdgeSpec = [source: string, target: string, sourceOutput?: number, targetInput?: number];

export function workflow(nodes: NodeSpec[], edges: EdgeSpec[], meta?: WorkflowDefinition['meta']): WorkflowDefinition {
  return {
    nodes: nodes.map(([id, name, type, x, y, parameters = {}, extra = {}]) => ({ id, name, type, position: { x, y }, parameters, ...extra })),
    connections: edges.map(([source, target, sourceOutput = 0, targetInput = 0]) => ({ source, target, sourceOutput, targetInput })),
    settings: {},
    meta: meta ?? {},
  };
}

export const note = (id: string, text: string, x: number, y: number, width = 320, height = 120) => ({ id, text, position: { x, y }, width, height, color: 'yellow' });
