import type { Execution, Prisma } from '@simplyai/db';
import {
  applyCredential, createExecution, dispatchEvent, env, getRegistry, incrementUsage, loadDraftDefinition, pickTrigger, resolveCredential, resolveSecrets, resolveVariables, systemLog,
  type ExecutionJob, type ExecutionJobResult,
} from '@simplyai/core';
import { createRedactor, WorkflowEngine, type EngineResult, type EngineState, type NodeFinishedEvent, type NodeStartedEvent } from '@simplyai/engine';
import { llmChat, llmEmbed } from '@simplyai/ai';
import { NodeOperationError, type Item, type LlmMessage, type RuntimeServices } from '@simplyai/sdk';
import { truncateJson, type WorkflowDefinition, type ExecutionMode } from '@simplyai/shared';
import { db, log, publish, queues, redis } from './context';
import { runAgentForWorkflow } from './agents';
import { dataTableService } from './data-tables';
import { addTextDocument, searchKnowledge } from './knowledge';
import { runInSandbox } from './sandbox';

const MAX_DEPTH = 5;
/** Running executions in this process, for cancellation. */
export const running = new Map<string, AbortController>();

interface RunContext {
  execution: Execution;
  workflow: { id: string; name: string; workspaceId: string; organizationId: string; staticData: Record<string, unknown>; settings: Record<string, unknown> };
  depth: number;
  signal: AbortSignal;
  secretValues: Set<string>;
}

function buildServices(ctx: RunContext, variables: Record<string, string>): RuntimeServices {
  const wsId = ctx.workflow.workspaceId;
  const tables = dataTableService(wsId);
  const runSubWorkflow: RuntimeServices['runSubWorkflow'] = async (workflowId, items, opts) => {
    if (ctx.depth + 1 > MAX_DEPTH) throw new NodeOperationError(`Sub-workflows can be nested at most ${MAX_DEPTH} levels deep`);
    const wf = await db.workflow.findFirst({ where: { id: workflowId, workspaceId: wsId }, include: { activeVersion: true } });
    if (!wf) throw new NodeOperationError('Sub-workflow not found in this workspace');
    const definition = (wf.activeVersion?.definition as unknown as WorkflowDefinition | undefined) ?? (await loadDraftDefinition(db, wf.id));
    const trigger = pickTrigger(definition, (t) => getRegistry().getNode(t)?.trigger);
    if (!trigger) throw new NodeOperationError(`Sub-workflow "${wf.name}" has no trigger node`);
    if (!opts.waitForCompletion) {
      const ex = await createExecution(db, queues, { workspaceId: wsId, workflowId: wf.id, mode: 'SUBWORKFLOW', definition, workflowVersionId: wf.activeVersionId, triggerNodeId: trigger, items, parentExecutionId: ctx.execution.id });
      return [{ json: { executionId: ex.id, status: 'QUEUED' } }];
    }
    const child = await createExecution(db, null, { workspaceId: wsId, workflowId: wf.id, mode: 'SUBWORKFLOW', definition, workflowVersionId: wf.activeVersionId, triggerNodeId: trigger, items, parentExecutionId: ctx.execution.id, inline: true });
    const result = await runExecution(child, undefined, ctx.depth + 1, opts.signal ?? ctx.signal);
    if (result.status === 'FAILED') throw new NodeOperationError(`Sub-workflow "${wf.name}" failed: ${result.error?.message ?? 'unknown error'}`);
    if (result.status === 'CANCELLED') throw new NodeOperationError(`Sub-workflow "${wf.name}" was cancelled`);
    if (result.status === 'WAITING') throw new NodeOperationError(`Sub-workflow "${wf.name}" is waiting; run it without waiting for completion`);
    return result.output;
  };
  return {
    async getCredential(id, types) {
      const c = await resolveCredential(db, wsId, id, types);
      const collect = (v: unknown) => {
        if (typeof v === 'string' && v.length >= 6) ctx.secretValues.add(v);
        else if (v && typeof v === 'object') Object.values(v).forEach(collect);
      };
      collect(c.data);
      return c;
    },
    async authenticateRequest(cred, request) {
      return applyCredential(cred, request);
    },
    runSubWorkflow,
    async runCode(code, items, opts) {
      const res = await runInSandbox(code, items, { mode: opts.mode, timeoutMs: opts.timeoutMs, signal: opts.signal ?? ctx.signal, vars: variables });
      return res.items;
    },
    llmChat: (req) => llmChat({ ...req, signal: req.signal ?? ctx.signal }),
    llmEmbed: (req) => llmEmbed({ ...req, signal: req.signal ?? ctx.signal }),
    runAgent: (req) => runAgentForWorkflow(wsId, req.agentId, req.input, req.sessionId, runSubWorkflow, req.signal ?? ctx.signal),
    memory: {
      async load(sessionId, limit) {
        const rows = await db.agentMemory.findMany({ where: { workspaceId: wsId, sessionId }, orderBy: { createdAt: 'desc' }, take: Math.min(limit, 200) });
        return rows.reverse().map((r) => ({ role: r.role as LlmMessage['role'], content: r.content }));
      },
      async append(sessionId, messages) {
        await db.agentMemory.createMany({ data: messages.map((m) => ({ workspaceId: wsId, sessionId, role: m.role, content: m.content.slice(0, 100_000) })) });
      },
      async clear(sessionId) {
        await db.agentMemory.deleteMany({ where: { workspaceId: wsId, sessionId } });
      },
    },
    knowledge: {
      search: (kb, q, k) => searchKnowledge(wsId, kb, q, k),
      addText: (kb, name, text) => addTextDocument(wsId, kb, name, text),
    },
    dataTables: tables,
    emitEvent: (event, payload) => dispatchEvent(db, queues, wsId, event, payload),
    recordUsage: (metric, q) => incrementUsage(db, ctx.workflow.organizationId, wsId, metric, q),
  };
}

function store(value: unknown, redact: <T>(v: T) => T): Prisma.InputJsonValue {
  return truncateJson(redact(value), env.maxPayloadBytes).value as Prisma.InputJsonValue;
}

/**
 * Run (or resume) an execution record to completion in this process.
 * Persists node results, publishes realtime events and returns the outcome.
 */
export async function runExecution(execution: Execution, resume: ExecutionJob['resume'] | undefined, depth = 0, parentSignal?: AbortSignal): Promise<EngineResult> {
  const wf = await db.workflow.findUniqueOrThrow({ where: { id: execution.workflowId }, include: { workspace: { select: { organizationId: true } } } });
  const controller = new AbortController();
  running.set(execution.id, controller);
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  if (await redis.get(`sai:cancel:${execution.id}`)) controller.abort();
  const definition = execution.workflowSnapshot as unknown as WorkflowDefinition;
  const timeoutMs = Number(definition.settings?.timeoutMs ?? 0);
  const timeout = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  const startedAt = execution.startedAt ?? new Date();
  await db.execution.update({ where: { id: execution.id }, data: { status: 'RUNNING', startedAt, waitUntil: null } });
  const base = { workspaceId: execution.workspaceId, executionId: execution.id, workflowId: execution.workflowId };
  await publish({ type: 'execution.started', ...base, at: new Date().toISOString() });

  const [variables, secrets] = await Promise.all([resolveVariables(db, execution.workspaceId, execution.workflowId), resolveSecrets(db, execution.workspaceId)]);
  const ctx: RunContext = {
    execution, depth, signal: controller.signal, secretValues: new Set(Object.values(secrets)),
    workflow: { id: wf.id, name: wf.name, workspaceId: wf.workspaceId, organizationId: wf.workspace.organizationId, staticData: (wf.staticData ?? {}) as Record<string, unknown>, settings: (wf.settings ?? {}) as Record<string, unknown> },
  };
  const redact = <T>(v: T): T => createRedactor(ctx.secretValues)(v);
  const nodeRows = new Map<string, Promise<string>>();
  let tasks = 0;
  const registry = getRegistry();

  const hooks = {
    nodeStarted: (e: NodeStartedEvent) => {
      const key = `${e.nodeId}:${e.runIndex}`;
      nodeRows.set(key, db.nodeExecution.create({
        data: { executionId: execution.id, nodeKey: e.nodeId, nodeName: e.nodeName, nodeType: e.nodeType, runIndex: e.runIndex, status: 'RUNNING', inputData: store(e.inputs, redact), itemsIn: e.inputs.reduce((s, p) => s + p.length, 0), startedAt: e.startedAt },
      }).then((r) => r.id));
      void publish({ type: 'node.started', ...base, nodeId: e.nodeId, nodeName: e.nodeName, runIndex: e.runIndex, at: e.startedAt.toISOString() });
    },
    nodeFinished: async (e: NodeFinishedEvent) => {
      const key = `${e.nodeId}:${e.runIndex}`;
      if (!registry.getNode(e.nodeType)?.trigger) tasks++;
      const durationMs = e.finishedAt.getTime() - e.startedAt.getTime();
      const itemsOut = e.outputs?.reduce((s, p) => s + p.length, 0) ?? 0;
      const data = { status: e.status, outputData: e.outputs ? store(e.outputs, redact) : undefined, error: e.error ? store(e.error, redact) : undefined, attempts: e.attempts, itemsOut, finishedAt: e.finishedAt, durationMs };
      const pending = nodeRows.get(key);
      if (pending) await db.nodeExecution.update({ where: { id: await pending }, data });
      else await db.nodeExecution.create({ data: { executionId: execution.id, nodeKey: e.nodeId, nodeName: e.nodeName, nodeType: e.nodeType, runIndex: e.runIndex, startedAt: e.startedAt, inputData: store(e.inputs, redact), ...data } });
      await publish({ type: 'node.finished', ...base, nodeId: e.nodeId, nodeName: e.nodeName, runIndex: e.runIndex, status: e.status, itemsOut, durationMs, error: e.error ? redact(e.error) : null, at: e.finishedAt.toISOString() });
    },
  };

  const engine = new WorkflowEngine({
    workflow: { id: wf.id, name: wf.name, workspaceId: wf.workspaceId }, definition, execution: { id: execution.id, mode: execution.mode as ExecutionMode },
    registry, services: buildServices(ctx, variables), variables, secrets, staticData: ctx.workflow.staticData, hooks, signal: controller.signal,
    logger: { debug: (m, c) => log.debug(m, { executionId: execution.id, ...c }), info: (m, c) => log.info(m, { executionId: execution.id, ...c }), warn: (m, c) => log.warn(m, { executionId: execution.id, ...c }), error: (m, c) => log.error(m, { executionId: execution.id, ...c }) },
  });

  let result: EngineResult;
  try {
    if (resume) result = await engine.resume(execution.state as unknown as EngineState, { approved: resume.approved, data: resume.data });
    else result = await engine.run({ startNodeId: execution.triggerNodeKey ?? undefined, triggerItems: (execution.inputData as unknown as Item[] | null) ?? undefined, destinationNodeId: execution.destinationNodeKey ?? undefined });
  } catch (err) {
    result = { status: 'FAILED', error: { name: (err as Error).name, message: (err as Error).message }, output: [], state: {} as EngineState, staticData: ctx.workflow.staticData };
  } finally {
    if (timeout) clearTimeout(timeout);
    running.delete(execution.id);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
  if (result.status === 'CANCELLED' && timeoutMs > 0 && !(await redis.get(`sai:cancel:${execution.id}`)) && !parentSignal?.aborted) {
    result = { ...result, status: 'FAILED', error: { name: 'WorkflowTimeout', message: `Workflow exceeded its ${timeoutMs}ms timeout` } };
  }

  await Promise.allSettled(nodeRows.values());
  const finishedAt = new Date();
  const waiting = result.status === 'WAITING';
  await db.execution.update({
    where: { id: execution.id },
    data: {
      status: result.status,
      finishedAt: waiting ? null : finishedAt,
      durationMs: waiting ? null : finishedAt.getTime() - startedAt.getTime(),
      outputData: waiting ? undefined : store(result.output, redact),
      error: result.error ? store(result.error, redact) : undefined,
      state: waiting ? (JSON.parse(JSON.stringify(result.state)) as Prisma.InputJsonValue) : undefined,
      waitUntil: waiting && result.waitUntil ? new Date(result.waitUntil) : null,
    },
  });
  if (!waiting && execution.state) await db.execution.update({ where: { id: execution.id }, data: { state: undefined } }).catch(() => undefined);
  if (JSON.stringify(result.staticData) !== JSON.stringify(wf.staticData)) await db.workflow.update({ where: { id: wf.id }, data: { staticData: result.staticData as Prisma.InputJsonValue } });
  await incrementUsage(db, ctx.workflow.organizationId, wf.workspaceId, 'TASKS', tasks);

  if (waiting) {
    if (result.waitUntil) {
      const delay = Math.max(0, new Date(result.waitUntil).getTime() - Date.now());
      await queues.executions.add('resume', { executionId: execution.id, resume: {} }, { jobId: `resume-${execution.id}-${Date.now()}`, delay });
    }
    await publish({ type: 'execution.waiting', ...base, waitUntil: result.waitUntil ?? null, at: finishedAt.toISOString() });
  } else {
    await publish({ type: 'execution.finished', ...base, status: result.status, error: result.error ?? null, durationMs: finishedAt.getTime() - startedAt.getTime(), at: finishedAt.toISOString() });
    if (result.status === 'FAILED' && depth === 0) await onFailure(execution, wf.name, ctx.workflow.settings, result);
    if (result.status === 'SUCCESS' && depth === 0 && execution.mode !== 'ERROR' && execution.mode !== 'MANUAL')
      void dispatchEvent(db, queues, wf.workspaceId, 'system.execution.succeeded', { executionId: execution.id, workflowId: wf.id, workflowName: wf.name }).catch(() => undefined);
  }
  return result;
}

async function onFailure(execution: Execution, workflowName: string, settings: Record<string, unknown>, result: EngineResult) {
  if (execution.mode === 'ERROR') return;
  const payload = { executionId: execution.id, workflowId: execution.workflowId, workflowName, error: result.error ?? null, mode: execution.mode };
  await dispatchEvent(db, queues, execution.workspaceId, 'system.execution.failed', payload).catch(() => undefined);
  const errorWorkflowId = settings.errorWorkflowId as string | undefined;
  if (!errorWorkflowId || errorWorkflowId === execution.workflowId) return;
  try {
    const ewf = await db.workflow.findFirst({ where: { id: errorWorkflowId, workspaceId: execution.workspaceId }, include: { activeVersion: true } });
    if (!ewf) return;
    const def = (ewf.activeVersion?.definition as unknown as WorkflowDefinition | undefined) ?? (await loadDraftDefinition(db, ewf.id));
    const trigger = pickTrigger(def, (t) => getRegistry().getNode(t)?.trigger);
    if (!trigger) return;
    await createExecution(db, queues, { workspaceId: execution.workspaceId, workflowId: ewf.id, mode: 'ERROR', definition: def, workflowVersionId: ewf.activeVersionId, triggerNodeId: trigger, items: [{ json: payload as never }] });
  } catch (err) {
    await systemLog(db, 'warn', 'worker', `Error workflow could not start: ${(err as Error).message}`, { executionId: execution.id });
  }
}

/** BullMQ processor for the executions queue. */
export async function processExecutionJob(data: ExecutionJob): Promise<ExecutionJobResult> {
  const execution = await db.execution.findUnique({ where: { id: data.executionId } });
  if (!execution) return { status: 'MISSING', output: [] };
  if (execution.status === 'CANCELLED' || execution.status === 'SUCCESS' || execution.status === 'FAILED') return { status: execution.status, output: [] };
  if (data.resume && !execution.state) return { status: execution.status, output: [] };
  if (!data.resume && execution.status === 'RUNNING') {
    log.warn('re-running an execution that was marked running (worker restart?)', { executionId: execution.id });
    await db.nodeExecution.deleteMany({ where: { executionId: execution.id } });
  }
  const result = await runExecution(execution, data.resume);
  return { status: result.status, output: result.output.slice(0, 1000), error: result.error ? { message: result.error.message } : null };
}
