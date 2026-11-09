import type { ExecutionMode, Item, SerializedError, WorkflowDefinition, WorkflowNodeDef, NodeRunStatus } from '@simplyai/shared';
import {
  ExecutionCancelledError,
  NodeOperationError,
  NodeTimeoutError,
  SsrfBlockedError,
  httpRequest,
  isControlSignal,
  serializeError,
  sleep,
  type ExecuteContext,
  type HttpRequestOptions,
  type Logger,
  type NodeDefinition,
  type NodeRegistry,
  type RuntimeServices,
} from '@simplyai/sdk';
import { ExpressionError, resolveDeep } from './expression';
import { ancestorsOf, buildGraph, connectionKey, findBackEdges, loopBody, reachableFrom, type Graph } from './graph';

export type EngineNodeStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed' | 'waiting';

export interface NodeRuntimeState {
  status: EngineNodeStatus;
  runs: number;
  nodeState: Record<string, unknown>;
}

export interface EngineState {
  version: 1;
  startNodeId: string;
  active: string[];
  backEdges: string[];
  nodes: Record<string, NodeRuntimeState>;
  pending: Record<string, Record<number, Item[]>>;
  outputs: Record<string, Item[][]>;
  order: string[];
  waiting?: { nodeId: string; kind: 'time' | 'approval'; until?: string; message?: string; inputs: Item[][]; output?: Item[][] };
  failed?: SerializedError;
  handlingError?: boolean;
  stoppedBy?: { status: 'success' | 'error'; message?: string; nodeId: string };
}

export interface NodeStartedEvent {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  runIndex: number;
  inputs: Item[][];
  startedAt: Date;
}

export interface NodeFinishedEvent extends NodeStartedEvent {
  status: NodeRunStatus;
  outputs: Item[][] | null;
  error: SerializedError | null;
  attempts: number;
  finishedAt: Date;
}

export interface EngineHooks {
  nodeStarted?(e: NodeStartedEvent): void | Promise<void>;
  nodeFinished?(e: NodeFinishedEvent): void | Promise<void>;
}

export interface EngineOptions {
  workflow: { id: string; name: string; workspaceId: string };
  definition: WorkflowDefinition;
  execution: { id: string; mode: ExecutionMode };
  registry: NodeRegistry;
  services: RuntimeServices;
  variables?: Record<string, string>;
  secrets?: Record<string, string>;
  staticData?: Record<string, unknown>;
  hooks?: EngineHooks;
  signal?: AbortSignal;
  logger?: Logger;
  /** waits shorter than this run in-process; longer waits persist the state */
  inProcessWaitMaxMs?: number;
  maxItemsPerNode?: number;
}

export interface RunInput {
  startNodeId?: string;
  triggerItems?: Item[];
  destinationNodeId?: string;
}

export interface ResumeInput {
  approved?: boolean;
  data?: Record<string, unknown>;
}

export interface EngineResult {
  status: 'SUCCESS' | 'FAILED' | 'WAITING' | 'CANCELLED';
  error?: SerializedError;
  lastNodeId?: string;
  output: Item[];
  state: EngineState;
  waitUntil?: string;
  staticData: Record<string, unknown>;
}

const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

export class WorkflowEngine {
  private readonly graph: Graph;
  private state!: EngineState;
  private activeSet = new Set<string>();
  private backEdgeSet = new Set<string>();
  private loopBodies = new Map<string, Set<string>>();
  private stop: false | 'wait' | 'error' | 'stopNode' | 'cancel' = false;
  private readonly logger: Logger;
  private readonly staticData: Record<string, unknown>;

  constructor(private readonly opts: EngineOptions) {
    this.graph = buildGraph(opts.definition);
    this.logger = opts.logger ?? silentLogger;
    this.staticData = opts.staticData ?? {};
  }

  // ───────────────────────────── public API ─────────────────────────────

  async run(input: RunInput = {}): Promise<EngineResult> {
    const start = this.pickStartNode(input.startNodeId);
    this.state = {
      version: 1,
      startNodeId: start.id,
      active: [],
      backEdges: [],
      nodes: {},
      pending: {},
      outputs: {},
      order: [],
    };
    this.activate(start.id, input.destinationNodeId);
    this.state.pending[start.id] = { 0: input.triggerItems?.length ? input.triggerItems : [{ json: {} }] };
    return this.drive();
  }

  async resume(state: EngineState, input: ResumeInput = {}): Promise<EngineResult> {
    this.state = state;
    this.restoreIndexes();
    const w = state.waiting;
    if (!w) throw new Error('Execution is not waiting');
    const node = this.graph.nodes.get(w.nodeId);
    if (!node) throw new Error('Waiting node no longer exists');
    let outputs: Item[][];
    if (w.kind === 'approval') {
      const items = (w.inputs[0] ?? []).map((i) => ({ ...i, json: { ...i.json, approval: { approved: !!input.approved, ...(input.data ?? {}) } } }));
      outputs = input.approved ? [items, []] : [[], items];
    } else outputs = w.output ?? [w.inputs[0] ?? []];
    state.waiting = undefined;
    const rs = state.nodes[w.nodeId]!;
    const startedAt = new Date();
    this.finishNode(node, outputs);
    await this.opts.hooks?.nodeFinished?.({
      nodeId: node.id, nodeName: node.name, nodeType: node.type, runIndex: rs.runs - 1, inputs: w.inputs, startedAt,
      status: 'SUCCESS', outputs, error: null, attempts: 1, finishedAt: new Date(),
    });
    return this.drive();
  }

  // ───────────────────────────── setup ─────────────────────────────

  private pickStartNode(startNodeId?: string): WorkflowNodeDef {
    if (startNodeId) {
      const n = this.graph.nodes.get(startNodeId);
      if (!n) throw new NodeOperationError(`Start node "${startNodeId}" was not found`);
      return n;
    }
    const nodes = [...this.graph.nodes.values()].filter((n) => !n.disabled);
    const isTrigger = (n: WorkflowNodeDef) => !!this.opts.registry.getNode(n.type)?.trigger;
    const manual = nodes.find((n) => this.opts.registry.getNode(n.type)?.trigger === 'manual');
    const anyTrigger = nodes.find((n) => isTrigger(n) && this.opts.registry.getNode(n.type)?.trigger !== 'error');
    const start = manual ?? anyTrigger;
    if (!start) throw new NodeOperationError('The workflow has no trigger node to start from');
    return start;
  }

  private activate(startId: string, destinationId?: string): void {
    let active = reachableFrom(this.graph, startId);
    if (destinationId) {
      const anc = ancestorsOf(this.graph, destinationId);
      active = new Set([...active].filter((id) => anc.has(id)));
    }
    for (const id of active) {
      this.state.nodes[id] ??= { status: 'pending', runs: 0, nodeState: {} };
      if (this.state.handlingError) this.state.nodes[id]!.status = 'pending';
    }
    const back = findBackEdges(this.graph, startId, active);
    this.state.active = [...new Set([...this.state.active, ...active])];
    this.state.backEdges = [...new Set([...this.state.backEdges, ...back])];
    this.restoreIndexes();
  }

  private restoreIndexes(): void {
    this.activeSet = new Set(this.state.active);
    this.backEdgeSet = new Set(this.state.backEdges);
    this.loopBodies.clear();
    for (const id of this.activeSet) {
      const node = this.graph.nodes.get(id)!;
      const def = this.opts.registry.getNode(node.type);
      if (def?.loopOutput !== undefined) {
        const body = loopBody(this.graph, id, def.loopOutput);
        this.loopBodies.set(id, body);
        for (const c of this.graph.incoming.get(id) ?? []) if (body.has(c.source)) this.backEdgeSet.add(connectionKey(c));
      }
    }
    this.state.backEdges = [...this.backEdgeSet];
  }

  // ───────────────────────────── scheduling ─────────────────────────────

  private forwardIncoming(id: string) {
    return (this.graph.incoming.get(id) ?? []).filter((c) => this.activeSet.has(c.source) && !this.backEdgeSet.has(connectionKey(c)));
  }

  private isSettled(id: string): boolean {
    const s = this.state.nodes[id];
    if (!s) return true;
    if (s.nodeState.__continue === true) return false;
    return s.status === 'done' || s.status === 'skipped' || s.status === 'failed';
  }

  /** A loop node's loop-port edges are settled once it emitted a batch; its other edges wait until the loop is finished. */
  private isConnectionSettled(c: import('@simplyai/shared').WorkflowConnectionDef): boolean {
    const s = this.state.nodes[c.source];
    if (!s) return true;
    const def = this.opts.registry.getNode(this.graph.nodes.get(c.source)!.type);
    if (def?.loopOutput !== undefined && c.sourceOutput === def.loopOutput) return s.status === 'done' || s.status === 'skipped' || s.status === 'failed';
    return this.isSettled(c.source);
  }

  private hasPending(id: string): boolean {
    const p = this.state.pending[id];
    return !!p && Object.values(p).some((items) => items.length > 0);
  }

  private settleSkippable(): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of this.activeSet) {
        const s = this.state.nodes[id]!;
        if (s.status !== 'pending' || this.hasPending(id)) continue;
        if (id === this.state.startNodeId && s.runs === 0) continue;
        const inc = this.forwardIncoming(id);
        if (inc.every((c) => this.isConnectionSettled(c))) {
          s.status = 'skipped';
          changed = true;
        }
      }
    }
  }

  private findReady(): string[] {
    const ready: string[] = [];
    for (const id of this.activeSet) {
      const s = this.state.nodes[id]!;
      if (s.status === 'pending') {
        if (!this.hasPending(id)) continue;
        if (this.forwardIncoming(id).every((c) => this.isConnectionSettled(c))) ready.push(id);
      } else if (s.status === 'done' && s.nodeState.__continue === true) {
        const body = this.loopBodies.get(id);
        if (body && [...body].every((b) => !this.activeSet.has(b) || this.isSettled(b))) ready.push(id);
      }
    }
    return ready;
  }

  private async drive(): Promise<EngineResult> {
    const limit = Math.max(1, this.opts.definition.settings?.maxParallelism ?? 8);
    const running = new Map<string, Promise<void>>();
    const signal = this.opts.signal;

    const loop = async () => {
      for (;;) {
        if (signal?.aborted && !this.stop) this.stop = 'cancel';
        if (!this.stop) {
          this.settleSkippable();
          for (const id of this.findReady()) {
            if (running.size >= limit) break;
            if (running.has(id)) continue;
            this.state.nodes[id]!.status = 'running';
            running.set(
              id,
              this.executeNode(id).finally(() => running.delete(id)),
            );
          }
        }
        if (running.size === 0) break;
        await Promise.race(running.values());
      }
    };

    await loop();

    // In-workflow error handler
    if (this.stop === 'error' && !this.state.handlingError) {
      const handler = [...this.graph.nodes.values()].find((n) => !n.disabled && this.opts.registry.getNode(n.type)?.trigger === 'error');
      if (handler) {
        this.state.handlingError = true;
        this.stop = false;
        this.activate(handler.id);
        const f = this.state.failed!;
        this.state.pending[handler.id] = {
          0: [{ json: { error: { message: f.message, name: f.name, description: f.description }, node: { id: f.nodeId, name: f.nodeName }, execution: { id: this.opts.execution.id, mode: this.opts.execution.mode }, workflow: { id: this.opts.workflow.id, name: this.opts.workflow.name } } }],
        };
        this.state.nodes[handler.id]!.status = 'pending';
        await loop();
        if (!this.stop) this.stop = 'error';
      }
    }

    return this.result();
  }

  private result(): EngineResult {
    const lastNodeId = [...this.state.order].reverse().find((id) => (this.state.outputs[id]?.[0]?.length ?? 0) > 0) ?? this.state.order.at(-1);
    const output = lastNodeId ? this.state.outputs[lastNodeId]?.[0] ?? [] : [];
    const base = { lastNodeId, output, state: this.state, staticData: this.staticData };
    if (this.stop === 'cancel' || (this.opts.signal?.aborted && this.stop !== 'wait'))
      return { ...base, status: 'CANCELLED', error: { name: 'ExecutionCancelledError', message: 'Execution was cancelled' } };
    if (this.stop === 'wait' && this.state.waiting) return { ...base, status: 'WAITING', waitUntil: this.state.waiting.until };
    if (this.state.failed) return { ...base, status: 'FAILED', error: this.state.failed };
    if (this.state.stoppedBy?.status === 'error') {
      const node = this.graph.nodes.get(this.state.stoppedBy.nodeId);
      return { ...base, status: 'FAILED', error: { name: 'WorkflowStopped', message: this.state.stoppedBy.message || 'Workflow stopped with an error', nodeId: node?.id, nodeName: node?.name } };
    }
    return { ...base, status: 'SUCCESS' };
  }

  // ───────────────────────────── node execution ─────────────────────────────

  private collectInputs(id: string, def: NodeDefinition | undefined): Item[][] {
    const pending = this.state.pending[id] ?? {};
    delete this.state.pending[id];
    const ports = Math.max(def?.inputs.length ?? 1, ...Object.keys(pending).map((k) => Number(k) + 1), 1);
    const inputs: Item[][] = [];
    for (let i = 0; i < ports; i++) inputs.push(pending[i] ?? []);
    return inputs;
  }

  private resetLoopBody(loopId: string): void {
    const body = this.loopBodies.get(loopId);
    if (!body) return;
    for (const b of body) {
      if (!this.activeSet.has(b)) continue;
      const s = this.state.nodes[b]!;
      s.status = 'pending';
      s.nodeState = {};
      delete this.state.pending[b];
    }
  }

  private async executeNode(id: string): Promise<void> {
    const node = this.graph.nodes.get(id)!;
    const def = this.opts.registry.getNode(node.type);
    const rs = this.state.nodes[id]!;
    const isLoopRerun = rs.runs > 0 && this.loopBodies.has(id);
    let inputs = this.collectInputs(id, def);
    if (isLoopRerun) this.resetLoopBody(id);
    const runIndex = rs.runs++;
    const startedAt = new Date();
    await this.opts.hooks?.nodeStarted?.({ nodeId: id, nodeName: node.name, nodeType: node.type, runIndex, inputs, startedAt });

    const settings = node.settings ?? {};
    if (settings.executeOnce) inputs = inputs.map((p) => p.slice(0, 1));
    const maxTries = settings.retry?.enabled ? Math.max(1, Math.min(10, settings.retry.maxTries)) : 1;
    let attempts = 0;
    let outputs: Item[][] | null = null;
    let error: unknown = null;

    if (!def) error = new NodeOperationError(`Unknown node type "${node.type}". Is the integration installed?`);
    else if (node.disabled) outputs = [inputs[0] ?? []];
    else {
      while (attempts < maxTries) {
        attempts++;
        try {
          const res = await this.invoke(node, def, inputs, runIndex, rs);
          if (isControlSignal(res)) {
            outputs = await this.handleControl(node, res, inputs);
            if (outputs === null) {
              rs.status = 'waiting';
              await this.opts.hooks?.nodeFinished?.({
                nodeId: id, nodeName: node.name, nodeType: node.type, runIndex, inputs, startedAt, status: 'WAITING', outputs: null, error: null, attempts, finishedAt: new Date(),
              });
              return;
            }
          } else outputs = this.normalizeOutputs(res, node);
          error = null;
          break;
        } catch (err) {
          error = err;
          const nonRetryable = err instanceof ExecutionCancelledError || err instanceof SsrfBlockedError || err instanceof ExpressionError || this.opts.signal?.aborted;
          if (nonRetryable || attempts >= maxTries) break;
          const base = settings.retry?.waitBetweenMs ?? 1000;
          const wait = settings.retry?.backoff === 'exponential' ? base * 2 ** (attempts - 1) : base;
          this.logger.warn(`Node "${node.name}" failed (attempt ${attempts}/${maxTries}), retrying in ${wait}ms`, { error: (err as Error).message });
          try {
            await sleep(Math.min(wait, 300_000), this.opts.signal);
          } catch {
            break;
          }
        }
      }
    }

    if (error) {
      const serialized = serializeError(error, { nodeId: id, nodeName: node.name });
      const cancelled = error instanceof ExecutionCancelledError || this.opts.signal?.aborted;
      if (!cancelled && node.settings?.continueOnFail && def) {
        const source = inputs[0]?.length ? inputs[0] : [{ json: {} }];
        const errItems = source.map((i, idx) => ({ json: { ...i.json, error: { message: serialized.message, name: serialized.name, httpCode: serialized.httpCode } }, pairedItem: idx }));
        const n = def.outputs.length;
        outputs = settings.errorOutput ? [...Array.from({ length: n }, () => [] as Item[]), errItems] : [errItems];
        this.finishNode(node, outputs);
        await this.opts.hooks?.nodeFinished?.({
          nodeId: id, nodeName: node.name, nodeType: node.type, runIndex, inputs, startedAt, status: 'FAILED', outputs, error: serialized, attempts, finishedAt: new Date(),
        });
        return;
      }
      rs.status = 'failed';
      if (cancelled) this.stop = 'cancel';
      else {
        this.state.failed = serialized;
        this.stop = 'error';
      }
      await this.opts.hooks?.nodeFinished?.({
        nodeId: id, nodeName: node.name, nodeType: node.type, runIndex, inputs, startedAt, status: cancelled ? 'CANCELLED' : 'FAILED', outputs: null, error: serialized, attempts, finishedAt: new Date(),
      });
      return;
    }

    if (settings.alwaysOutputData && outputs!.every((o) => o.length === 0)) outputs![0] = [{ json: {} }];
    this.finishNode(node, outputs!);
    await this.opts.hooks?.nodeFinished?.({
      nodeId: id, nodeName: node.name, nodeType: node.type, runIndex, inputs, startedAt, status: 'SUCCESS', outputs, error: null, attempts, finishedAt: new Date(),
    });
  }

  private finishNode(node: WorkflowNodeDef, outputs: Item[][]): void {
    const rs = this.state.nodes[node.id]!;
    rs.status = 'done';
    this.state.outputs[node.id] = outputs;
    this.state.order.push(node.id);
    for (const c of this.graph.outgoing.get(node.id) ?? []) {
      if (!this.activeSet.has(c.target)) continue;
      const items = outputs[c.sourceOutput];
      if (!items?.length) continue;
      const target = (this.state.pending[c.target] ??= {});
      target[c.targetInput] = [...(target[c.targetInput] ?? []), ...items];
    }
  }

  private normalizeOutputs(res: unknown, node: WorkflowNodeDef): Item[][] {
    if (!Array.isArray(res)) throw new NodeOperationError(`Node "${node.name}" returned an invalid result`);
    const max = this.opts.maxItemsPerNode ?? 100_000;
    return (res as unknown[]).map((port) => {
      if (!Array.isArray(port)) throw new NodeOperationError(`Node "${node.name}" returned an invalid output port`);
      if (port.length > max) throw new NodeOperationError(`Node "${node.name}" produced ${port.length} items, above the limit of ${max}`);
      return port.map((it) => {
        if (it && typeof it === 'object' && 'json' in it && typeof (it as Item).json === 'object' && (it as Item).json !== null) return it as Item;
        return { json: it && typeof it === 'object' && !Array.isArray(it) ? (it as Record<string, unknown>) : { value: it } };
      });
    });
  }

  private async handleControl(node: WorkflowNodeDef, sig: import('@simplyai/sdk').ControlSignal, inputs: Item[][]): Promise<Item[][] | null> {
    if (sig.control === 'stop') {
      this.state.stoppedBy = { status: sig.status, message: sig.message, nodeId: node.id };
      this.stop = 'stopNode';
      return sig.output ?? [inputs[0] ?? []];
    }
    if (sig.kind === 'time') {
      this.state.waiting = { nodeId: node.id, kind: 'time', until: sig.until, inputs, output: sig.output };
    } else {
      this.state.waiting = { nodeId: node.id, kind: 'approval', message: sig.message, inputs, output: sig.output };
    }
    this.stop = 'wait';
    return null;
  }

  private async invoke(node: WorkflowNodeDef, def: NodeDefinition, inputs: Item[][], runIndex: number, rs: NodeRuntimeState) {
    const controller = new AbortController();
    const signals = [controller.signal];
    if (this.opts.signal) signals.push(this.opts.signal);
    const signal = AbortSignal.any(signals);
    const ctx = this.buildContext(node, def, inputs, runIndex, rs, signal);
    const maxInProcess = this.opts.inProcessWaitMaxMs ?? 65_000;
    const exec = (async () => {
      const res = def.execute ? await def.execute(ctx) : [inputs[0]?.length ? inputs[0] : [{ json: {} }]];
      if (isControlSignal(res) && res.control === 'wait' && res.kind === 'time') {
        const ms = new Date(res.until).getTime() - Date.now();
        if (ms <= maxInProcess) {
          if (ms > 0) {
            try {
              await sleep(ms, signal);
            } catch (err) {
              if (err instanceof NodeTimeoutError) throw err;
              throw new ExecutionCancelledError();
            }
          }
          return res.output ?? [inputs[0] ?? []];
        }
      }
      return res;
    })();
    const timeoutMs = node.settings?.timeoutMs;
    const execSignal = this.opts.signal;
    let onAbort: (() => void) | undefined;
    const cancelPromise = new Promise<never>((_, reject) => {
      if (!execSignal) return;
      onAbort = () => reject(new ExecutionCancelledError());
      if (execSignal.aborted) onAbort();
      else execSignal.addEventListener('abort', onAbort, { once: true });
    });
    cancelPromise.catch(() => undefined);
    const racers: Promise<unknown>[] = [exec, cancelPromise];
    let timer: NodeJS.Timeout | undefined;
    if (timeoutMs && timeoutMs > 0) {
      racers.push(
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort(new NodeTimeoutError(`Node timed out after ${timeoutMs}ms`));
            reject(new NodeTimeoutError(`Node "${node.name}" timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      );
    }
    try {
      return await Promise.race(racers);
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) execSignal?.removeEventListener('abort', onAbort);
      if (!controller.signal.aborted) controller.abort();
    }
  }

  // ───────────────────────────── context ─────────────────────────────

  private expressionContext(node: WorkflowNodeDef, inputs: Item[][], itemIndex: number, runIndex: number): Record<string, unknown> {
    const port = inputs.find((p) => p.length > 0) ?? inputs[0] ?? [];
    const item = port[itemIndex] ?? port[0] ?? { json: {} };
    const outputsByName: Record<string, unknown> = {};
    const accessor = (out: Item[][] | undefined) => {
      const items = out?.[0] ?? [];
      return {
        json: (items[itemIndex] ?? items[0])?.json ?? {},
        item: items[itemIndex] ?? items[0] ?? { json: {} },
        all: () => items,
        first: () => items[0] ?? { json: {} },
        last: () => items[items.length - 1] ?? { json: {} },
        isExecuted: !!out,
      };
    };
    for (const [id, out] of Object.entries(this.state.outputs)) {
      const n = this.graph.nodes.get(id);
      if (n) outputsByName[n.name] = accessor(out);
    }
    const now = new Date();
    return {
      $json: item.json,
      $binary: item.binary ?? {},
      $item: item,
      $itemIndex: itemIndex,
      $runIndex: runIndex,
      $input: { item, all: () => port, first: () => port[0] ?? { json: {} }, last: () => port[port.length - 1] ?? { json: {} } },
      $node: outputsByName,
      $: (name: string) => {
        const target = this.graph.byName.get(name);
        if (!target) throw new ExpressionError(`Node "${name}" does not exist`);
        return accessor(this.state.outputs[target.id]);
      },
      $vars: { ...(this.opts.variables ?? {}) },
      $secrets: { ...(this.opts.secrets ?? {}) },
      $execution: { id: this.opts.execution.id, mode: this.opts.execution.mode },
      $workflow: { id: this.opts.workflow.id, name: this.opts.workflow.name },
      $now: now.toISOString(),
      $today: now.toISOString().slice(0, 10),
      $thisNode: { name: node.name, id: node.id },
    };
  }

  private buildContext(node: WorkflowNodeDef, def: NodeDefinition, inputs: Item[][], runIndex: number, rs: NodeRuntimeState, signal: AbortSignal): ExecuteContext {
    const defaults: Record<string, unknown> = Object.fromEntries(def.properties.map((p) => [p.name, p.default]));
    const services = this.opts.services;
    const self = this;
    const ctx: ExecuteContext = {
      node,
      workflow: this.opts.workflow,
      execution: this.opts.execution,
      inputs,
      getInputItems: (port = 0) => inputs[port] ?? [],
      getRawParam: <T>(name: string) => (node.parameters[name] ?? defaults[name]) as T,
      getParam<T>(name: string, itemIndex = 0, fallback?: T): T {
        const raw = node.parameters[name] ?? defaults[name];
        if (raw === undefined) return fallback as T;
        try {
          const value = resolveDeep(raw, self.expressionContext(node, inputs, itemIndex, runIndex));
          return (value === undefined ? fallback : value) as T;
        } catch (err) {
          throw new NodeOperationError(`Expression error in parameter "${name}": ${(err as Error).message}`, { itemIndex });
        }
      },
      hasCredential: () => !!node.credentialId,
      async getCredential<T>() {
        if (!node.credentialId) throw new NodeOperationError(`Node "${node.name}" needs a credential. Select one in the node settings.`);
        return (await services.getCredential(node.credentialId, def.credentials?.types ?? [])) as import('@simplyai/sdk').ResolvedCredential<T>;
      },
      http: <T>(o: HttpRequestOptions) => httpRequest<T>({ ...o, signal: o.signal ?? signal }),
      async httpWithAuth<T>(o: HttpRequestOptions) {
        const cred = await ctx.getCredential();
        const req = await services.authenticateRequest(cred, o);
        return httpRequest<T>({ ...req, signal: req.signal ?? signal });
      },
      nodeState: rs.nodeState,
      staticData: this.staticData,
      runIndex,
      signal,
      logger: this.logger,
      services,
      continueOnFail: !!node.settings?.continueOnFail,
    };
    return ctx;
  }
}
