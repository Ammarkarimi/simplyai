/** Real-time events published by workers and relayed to browsers. */
import type { ExecutionStatus, NodeRunStatus, SerializedError } from './workflow';

export const EVENTS_CHANNEL = 'sai:events';
export const CANCEL_CHANNEL = 'sai:cancel';

export type RealtimeEvent =
  | { type: 'execution.started'; workspaceId: string; executionId: string; workflowId: string; at: string }
  | {
      type: 'execution.finished';
      workspaceId: string;
      executionId: string;
      workflowId: string;
      status: ExecutionStatus;
      error?: SerializedError | null;
      durationMs?: number;
      at: string;
    }
  | { type: 'execution.waiting'; workspaceId: string; executionId: string; workflowId: string; waitUntil?: string | null; at: string }
  | { type: 'node.started'; workspaceId: string; executionId: string; workflowId: string; nodeId: string; nodeName: string; runIndex: number; at: string }
  | {
      type: 'node.finished';
      workspaceId: string;
      executionId: string;
      workflowId: string;
      nodeId: string;
      nodeName: string;
      runIndex: number;
      status: NodeRunStatus;
      itemsOut: number;
      durationMs: number;
      error?: SerializedError | null;
      at: string;
    }
  | { type: 'agent.step'; workspaceId: string; conversationId: string; step: Record<string, unknown>; at: string }
  | { type: 'agent.finished'; workspaceId: string; conversationId: string; status: string; at: string };

export const QUEUES = {
  executions: 'executions',
  triggers: 'triggers',
  agents: 'agents',
  ingest: 'ingest',
} as const;
