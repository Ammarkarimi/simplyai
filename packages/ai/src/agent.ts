/** Provider-agnostic agent loop with tool calling and human approval. */
import type { LlmChatResponse, LlmMessage, LlmToolDefinition } from '@simplyai/sdk';

export interface AgentToolImpl extends LlmToolDefinition {
  requiresApproval?: boolean;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

export interface AgentStep {
  type: 'model' | 'tool' | 'approval';
  content?: string;
  toolName?: string;
  toolCallId?: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  at: string;
}

export interface AgentLoopOptions {
  chat(messages: LlmMessage[], tools: LlmToolDefinition[]): Promise<LlmChatResponse>;
  messages: LlmMessage[];
  tools: AgentToolImpl[];
  maxIterations: number;
  onStep?(step: AgentStep, message: LlmMessage): Promise<void> | void;
  /** tool calls already approved by a human (by call id) */
  approvedCallIds?: Set<string>;
  rejectedCallIds?: Set<string>;
  signal?: AbortSignal;
}

export interface AgentLoopResult {
  output: string;
  messages: LlmMessage[];
  steps: AgentStep[];
  usage: { inputTokens: number; outputTokens: number };
  pendingApproval: { toolCallId: string; toolName: string; arguments: Record<string, unknown> } | null;
  iterations: number;
}

function stringifyResult(v: unknown): string {
  if (typeof v === 'string') return v.slice(0, 20_000);
  try {
    return JSON.stringify(v).slice(0, 20_000);
  } catch {
    return String(v);
  }
}

export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const messages = [...opts.messages];
  const steps: AgentStep[] = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  const toolDefs: LlmToolDefinition[] = opts.tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
  const record = async (step: AgentStep, msg: LlmMessage) => {
    steps.push(step);
    await opts.onStep?.(step, msg);
  };

  const runTools = async (calls: NonNullable<LlmMessage['toolCalls']>): Promise<AgentLoopResult['pendingApproval']> => {
    for (const call of calls) {
      if (messages.some((m) => m.role === 'tool' && m.toolCallId === call.id)) continue;
      const tool = opts.tools.find((t) => t.name === call.name);
      let content: string;
      let error: string | undefined;
      if (!tool) content = error = `Unknown tool "${call.name}"`;
      else if (tool.requiresApproval && opts.rejectedCallIds?.has(call.id)) content = error = 'A human reviewer rejected this tool call.';
      else if (tool.requiresApproval && !opts.approvedCallIds?.has(call.id)) {
        await record({ type: 'approval', toolName: call.name, toolCallId: call.id, arguments: call.arguments, at: new Date().toISOString() }, { role: 'assistant', content: '' });
        return { toolCallId: call.id, toolName: call.name, arguments: call.arguments };
      } else {
        try {
          content = stringifyResult(await tool.execute(call.arguments));
        } catch (err) {
          content = error = `Tool error: ${(err as Error).message}`;
        }
      }
      const msg: LlmMessage = { role: 'tool', content, toolCallId: call.id, toolName: call.name };
      messages.push(msg);
      await record({ type: 'tool', toolName: call.name, toolCallId: call.id, arguments: call.arguments, result: content.slice(0, 2_000), error, at: new Date().toISOString() }, msg);
    }
    return null;
  };

  // Resume: finish tool calls of the last assistant message first.
  const last = messages[messages.length - 1];
  if (last?.role === 'assistant' && last.toolCalls?.length) {
    const pending = await runTools(last.toolCalls);
    if (pending) return { output: '', messages, steps, usage, pendingApproval: pending, iterations: 0 };
  }

  for (let i = 0; i < opts.maxIterations; i++) {
    if (opts.signal?.aborted) throw new Error('Agent run cancelled');
    const res = await opts.chat(messages, toolDefs);
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    const msg: LlmMessage = { role: 'assistant', content: res.content, toolCalls: res.toolCalls.length ? res.toolCalls : undefined };
    messages.push(msg);
    await record({ type: 'model', content: res.content, at: new Date().toISOString() }, msg);
    if (!res.toolCalls.length) return { output: res.content, messages, steps, usage, pendingApproval: null, iterations: i + 1 };
    const pending = await runTools(res.toolCalls);
    if (pending) return { output: '', messages, steps, usage, pendingApproval: pending, iterations: i + 1 };
  }
  const final = await opts.chat([...messages, { role: 'user', content: 'Give your final answer now without calling tools.' }], []);
  usage.inputTokens += final.usage.inputTokens;
  usage.outputTokens += final.usage.outputTokens;
  const msg: LlmMessage = { role: 'assistant', content: final.content };
  messages.push(msg);
  await record({ type: 'model', content: final.content, at: new Date().toISOString() }, msg);
  return { output: final.content, messages, steps, usage, pendingApproval: null, iterations: opts.maxIterations };
}

/** Safe arithmetic evaluator for the calculator tool. */
export function calculate(expression: string): number {
  if (!/^[\d\s+\-*/().,%^]+$/.test(expression)) throw new Error('Only numbers and + - * / % ^ ( ) are allowed');
  const tokens = expression.replace(/,/g, '').match(/\d+(?:\.\d+)?|[+\-*/%^()]/g) ?? [];
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const parsePrimary = (): number => {
    const t = next();
    if (t === '(') {
      const v = parseExpr();
      if (next() !== ')') throw new Error('Missing )');
      return v;
    }
    if (t === '-') return -parsePrimary();
    if (t === '+') return parsePrimary();
    const n = Number(t);
    if (Number.isNaN(n)) throw new Error(`Unexpected token ${t}`);
    return n;
  };
  const parsePow = (): number => {
    const b = parsePrimary();
    if (peek() === '^') { next(); return b ** parsePow(); }
    return b;
  };
  const parseTerm = (): number => {
    let v = parsePow();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = next();
      const r = parsePow();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  };
  const parseExpr = (): number => {
    let v = parseTerm();
    while (peek() === '+' || peek() === '-') v = next() === '+' ? v + parseTerm() : v - parseTerm();
    return v;
  };
  const result = parseExpr();
  if (pos < tokens.length) throw new Error('Unexpected input');
  return result;
}
