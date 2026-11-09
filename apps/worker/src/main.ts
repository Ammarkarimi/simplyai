import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Worker, type Job } from 'bullmq';
import { createRedis, env, getRegistry, redisConnectionOptions, systemLog, type AgentJob, type ExecutionJob, type IngestJob, type TriggerJob } from '@simplyai/core';
import { CANCEL_CHANNEL, QUEUES } from '@simplyai/shared';
import { db, log, queues, redis } from './context';
import { processExecutionJob, runExecution, running } from './executor';
import { processTriggerJob } from './triggers';
import { runConversation } from './agents';
import { ingestDocument } from './knowledge';

const workerId = `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 6)}`;
const stats = { processed: 0, failed: 0, startedAt: new Date().toISOString() };

async function main() {
  getRegistry();
  const connection = redisConnectionOptions();
  const concurrency = env.workerConcurrency;
  const subWorkflowRunner = async (workflowId: string, items: never[], opts: { waitForCompletion: boolean }) => {
    void workflowId; void items; void opts;
    throw new Error('Workflow tools are available when the agent runs inside a workflow');
  };

  const workers = [
    new Worker<ExecutionJob>(QUEUES.executions, (job: Job<ExecutionJob>) => processExecutionJob(job.data), { connection, concurrency, lockDuration: 60_000, maxStalledCount: 2 }),
    new Worker<TriggerJob>(QUEUES.triggers, (job: Job<TriggerJob>) => processTriggerJob(job.data), { connection, concurrency: Math.max(2, Math.floor(concurrency / 2)) }),
    new Worker<AgentJob>(QUEUES.agents, async (job: Job<AgentJob>) => {
      const { runExecutionSubWorkflow } = await import('./subworkflow');
      await runConversation(job.data, runExecutionSubWorkflow(job.data.workspaceId) ?? subWorkflowRunner);
    }, { connection, concurrency: Math.max(2, Math.floor(concurrency / 2)), lockDuration: 300_000 }),
    new Worker<IngestJob>(QUEUES.ingest, (job: Job<IngestJob>) => ingestDocument(job.data.documentId, job.data.text), { connection, concurrency: 2, lockDuration: 300_000 }),
  ];
  for (const w of workers) {
    w.on('completed', () => stats.processed++);
    w.on('failed', (job, err) => {
      stats.failed++;
      log.error('job failed', { queue: w.name, jobId: job?.id, error: err.message });
      void systemLog(db, 'error', `worker:${w.name}`, err.message, { jobId: job?.id, workerId });
    });
    w.on('error', (err) => log.error('worker error', { queue: w.name, error: err.message }));
  }

  // Cancellation signals from the API
  const sub = createRedis();
  await sub.subscribe(CANCEL_CHANNEL);
  sub.on('message', (_c, executionId: string) => running.get(executionId)?.abort());

  // Maintenance every 5 minutes (single scheduler shared by all workers)
  await queues.triggers.upsertJobScheduler('maintenance', { every: 5 * 60_000 }, { name: 'maintenance', data: { kind: 'maintenance' } });

  const heartbeat = async () => {
    const data = { id: workerId, hostname: os.hostname(), pid: process.pid, concurrency, running: running.size, ...stats, memoryMb: Math.round(process.memoryUsage().rss / 1_048_576), load: os.loadavg()[0], at: new Date().toISOString() };
    await redis.set(`sai:worker:${workerId}`, JSON.stringify(data), 'EX', 30).catch(() => undefined);
  };
  await heartbeat();
  const hb = setInterval(heartbeat, 10_000);

  log.info('SimplyAI worker started', { workerId, concurrency, nodes: getRegistry().listNodes().length });

  const shutdown = async (signal: string) => {
    log.info('shutting down', { signal });
    clearInterval(hb);
    await Promise.allSettled(workers.map((w) => w.close()));
    await redis.del(`sai:worker:${workerId}`).catch(() => undefined);
    sub.disconnect();
    await queues.close();
    await db.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

export { runExecution };

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
