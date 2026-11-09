import { Queue, QueueEvents, type JobsOptions } from 'bullmq';
import { QUEUES } from '@simplyai/shared';
import { redisConnectionOptions } from './redis';

export interface ExecutionJob {
  executionId: string;
  resume?: { approved?: boolean; data?: Record<string, unknown>; userId?: string };
}

export interface ExecutionJobResult {
  status: string;
  output: unknown[];
  error?: { message: string } | null;
}

export type TriggerJob =
  | { kind: 'schedule'; workflowId: string; nodeKey: string }
  | { kind: 'poll'; workflowId: string; nodeKey: string }
  | { kind: 'event'; workspaceId: string; event: string; payload: Record<string, unknown> }
  | { kind: 'maintenance' };

export interface AgentJob {
  conversationId: string;
  workspaceId: string;
  /** resolve a pending approval */
  approval?: { toolCallId: string; approved: boolean };
}

export interface IngestJob {
  documentId: string;
  text?: string;
}

export interface Queues {
  executions: Queue<ExecutionJob, ExecutionJobResult>;
  triggers: Queue<TriggerJob>;
  agents: Queue<AgentJob>;
  ingest: Queue<IngestJob>;
  close(): Promise<void>;
}

const defaultJobOptions: JobsOptions = { removeOnComplete: { age: 3600, count: 5000 }, removeOnFail: { age: 24 * 3600, count: 5000 } };

export function createQueues(): Queues {
  const connection = redisConnectionOptions();
  const executions = new Queue<ExecutionJob, ExecutionJobResult>(QUEUES.executions, { connection, defaultJobOptions });
  const triggers = new Queue<TriggerJob>(QUEUES.triggers, { connection, defaultJobOptions });
  const agents = new Queue<AgentJob>(QUEUES.agents, { connection, defaultJobOptions });
  const ingest = new Queue<IngestJob>(QUEUES.ingest, { connection, defaultJobOptions: { ...defaultJobOptions, attempts: 3, backoff: { type: 'exponential', delay: 5000 } } });
  return {
    executions, triggers, agents, ingest,
    async close() {
      await Promise.all([executions.close(), triggers.close(), agents.close(), ingest.close()]);
    },
  };
}

export function createQueueEvents(name: keyof typeof QUEUES): QueueEvents {
  return new QueueEvents(QUEUES[name], { connection: redisConnectionOptions() });
}
