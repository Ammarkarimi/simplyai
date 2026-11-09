import { calculate, llmChat, runAgentLoop, type AgentStep, type AgentToolImpl } from '@simplyai/ai';
import { assertUsageQuota, incrementUsage, resolveCredential, type AgentJob } from '@simplyai/core';
import { extractJson, validateSchema } from '@simplyai/nodes';
import { httpRequest, NodeOperationError, type AgentRunResult, type Item, type LlmMessage, type RuntimeServices } from '@simplyai/sdk';
import type { Agent, Prisma } from '@simplyai/db';
import type { AgentTool } from '@simplyai/shared';
import { db, log, publish } from './context';
import { dataTableService } from './data-tables';
import { searchKnowledge } from './knowledge';
import { runInSandbox } from './sandbox';

const CREDENTIAL_FOR: Record<string, string[]> = { openai: ['openAiApi'], anthropic: ['anthropicApi'], gemini: ['googleGeminiApi'], custom: ['customLlmApi'] };

type AgentWithKb = Agent & { knowledgeBases: { knowledgeBaseId: string }[] };

export function buildTools(agent: AgentWithKb, runSubWorkflow?: RuntimeServices['runSubWorkflow'], signal?: AbortSignal): AgentToolImpl[] {
  const tools: AgentToolImpl[] = [];
  for (const t of (agent.tools as unknown as AgentTool[]) ?? []) {
    const cfg = (t.config ?? {}) as Record<string, unknown>;
    const base = { name: t.name, description: t.description, requiresApproval: !!t.requiresApproval };
    switch (t.type) {
      case 'calculator':
        tools.push({ ...base, parameters: { type: 'object', properties: { expression: { type: 'string', description: 'Arithmetic expression, e.g. (12 * 4) / 3' } }, required: ['expression'] }, execute: async (a) => ({ result: calculate(String(a.expression)) }) });
        break;
      case 'datetime':
        tools.push({ ...base, parameters: { type: 'object', properties: {} }, execute: async () => ({ now: new Date().toISOString(), weekday: new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }), timezone: 'UTC' }) });
        break;
      case 'http':
        tools.push({
          ...base,
          parameters: { type: 'object', properties: { path: { type: 'string', description: 'Path appended to the base URL' }, query: { type: 'object', description: 'Query parameters' }, body: { type: 'object', description: 'JSON body for POST/PUT' } } },
          execute: async (a) => {
            const url = `${String(cfg.url ?? '').replace(/\/$/, '')}${a.path ? `/${String(a.path).replace(/^\//, '')}` : ''}`;
            const res = await httpRequest({ url, method: String(cfg.method ?? 'GET'), query: a.query as Record<string, string>, body: a.body as Record<string, unknown>, headers: (cfg.headers ?? {}) as Record<string, string>, timeoutMs: 20_000, signal, maxResponseBytes: 2_000_000 });
            return res.body;
          },
        });
        break;
      case 'workflow':
        tools.push({
          ...base,
          parameters: (cfg.parameters as Record<string, unknown>) ?? { type: 'object', properties: { input: { type: 'string', description: 'Input for the workflow' } } },
          execute: async (a) => {
            if (!runSubWorkflow) throw new Error('Workflow tools are not available here');
            const out = await runSubWorkflow(String(cfg.workflowId), [{ json: a }], { waitForCompletion: true, signal });
            return out.map((i) => i.json);
          },
        });
        break;
      case 'code':
        tools.push({
          ...base,
          parameters: (cfg.parameters as Record<string, unknown>) ?? { type: 'object', properties: { input: { type: 'string' } } },
          execute: async (a) => (await runInSandbox(String(cfg.code ?? 'return $json'), [{ json: a }], { mode: 'all', signal })).items.map((i) => i.json),
        });
        break;
      case 'knowledge':
        tools.push({
          ...base,
          parameters: { type: 'object', properties: { query: { type: 'string', description: 'What to search for' } }, required: ['query'] },
          execute: async (a) => searchKnowledge(agent.workspaceId, String(cfg.knowledgeBaseId), String(a.query), Number(cfg.topK ?? 4)),
        });
        break;
      case 'dataTable': {
        const svc = dataTableService(agent.workspaceId);
        const op = String(cfg.operation ?? 'find');
        tools.push({
          ...base,
          parameters: op === 'insert'
            ? { type: 'object', properties: { row: { type: 'object', description: 'Column values of the row to insert' } }, required: ['row'] }
            : { type: 'object', properties: { column: { type: 'string' }, value: { type: 'string' } } },
          execute: async (a) => (op === 'insert'
            ? svc.insert(String(cfg.tableId), [(a.row ?? a) as Record<string, unknown>])
            : svc.find(String(cfg.tableId), a.column ? [{ column: String(a.column), operator: 'contains', value: a.value }] : [], { limit: 20 })),
        });
        break;
      }
      case 'webSearch':
        tools.push({
          ...base,
          parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
          execute: async (a) => {
            if (!cfg.searxngUrl) throw new Error('Web search needs a SearXNG compatible endpoint configured on the tool');
            const res = await httpRequest<{ results?: Array<{ title: string; url: string; content: string }> }>({ url: `${String(cfg.searxngUrl).replace(/\/$/, '')}/search`, query: { q: String(a.query), format: 'json' }, timeoutMs: 15_000, signal });
            return (res.body.results ?? []).slice(0, 5).map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
          },
        });
        break;
    }
  }
  if (agent.knowledgeBases.length && !tools.some((t) => t.name === 'search_knowledge')) {
    tools.push({
      name: 'search_knowledge', description: 'Search the knowledge base for relevant information before answering factual questions.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      execute: async (a) => (await Promise.all(agent.knowledgeBases.map((k) => searchKnowledge(agent.workspaceId, k.knowledgeBaseId, String(a.query), 4)))).flat().sort((x, y) => y.score - x.score).slice(0, 6),
    });
  }
  return tools;
}

function systemPrompt(agent: Agent): string {
  let s = agent.systemPrompt || 'You are a helpful assistant.';
  if (agent.outputFormat === 'json') s += `\n\nAlways answer with a single JSON object${agent.outputSchema ? ` matching this JSON schema: ${JSON.stringify(agent.outputSchema)}` : ''}. Do not add any text outside the JSON.`;
  return s;
}

async function chatFn(agent: Agent, signal?: AbortSignal) {
  if (!agent.credentialId) throw new NodeOperationError(`Agent "${agent.name}" has no model credential`);
  const cred = await resolveCredential(db, agent.workspaceId, agent.credentialId, CREDENTIAL_FOR[agent.provider] ?? []);
  return (messages: LlmMessage[], tools: Parameters<typeof llmChat>[0]['tools']) =>
    llmChat({ provider: agent.provider as 'openai', model: agent.model, credentials: cred.data, messages, tools, temperature: agent.temperature, maxTokens: agent.maxTokens, jsonMode: agent.outputFormat === 'json' && !tools?.length, signal });
}

function parseOutput(agent: Agent, output: string): unknown {
  if (agent.outputFormat !== 'json') return undefined;
  const parsed = extractJson(output);
  if (agent.outputSchema) {
    const errors = validateSchema(parsed, agent.outputSchema as Record<string, unknown>);
    if (errors.length) throw new NodeOperationError(`Agent output does not match the schema: ${errors.join('; ')}`);
  }
  return parsed;
}

/** Trim history to the window while keeping tool call/result pairs together. */
function windowed(messages: LlmMessage[], size: number): LlmMessage[] {
  if (size <= 0) return messages.slice(-1);
  let start = Math.max(0, messages.length - size);
  while (start > 0 && messages[start]!.role !== 'user') start--;
  return messages.slice(start);
}

/** Agent used from a workflow node: memory keyed by session id. */
export async function runAgentForWorkflow(workspaceId: string, agentId: string, input: string, sessionId: string | undefined, runSub: RuntimeServices['runSubWorkflow'], signal?: AbortSignal): Promise<AgentRunResult> {
  const agent = await db.agent.findFirst({ where: { id: agentId, workspaceId }, include: { knowledgeBases: true, workspace: { select: { organizationId: true } } } });
  if (!agent) throw new NodeOperationError('Agent not found in this workspace');
  await assertUsageQuota(db, agent.workspace.organizationId, 'AI_TOKENS', 1);
  const history: LlmMessage[] = sessionId && agent.memoryEnabled
    ? (await db.agentMemory.findMany({ where: { workspaceId, sessionId }, orderBy: { createdAt: 'desc' }, take: agent.memoryWindow })).reverse().map((m) => ({ role: m.role as 'user', content: m.content }))
    : [];
  const result = await runAgentLoop({
    chat: await chatFn(agent, signal), tools: buildTools(agent, runSub, signal), maxIterations: agent.maxIterations, signal,
    messages: [{ role: 'system', content: systemPrompt(agent) }, ...history.filter((m) => m.role === 'user' || m.role === 'assistant'), { role: 'user', content: input }],
  });
  await incrementUsage(db, agent.workspace.organizationId, workspaceId, 'AI_TOKENS', result.usage.inputTokens + result.usage.outputTokens);
  if (sessionId && agent.memoryEnabled && !result.pendingApproval) {
    await db.agentMemory.createMany({ data: [{ workspaceId, agentId, sessionId, role: 'user', content: input }, { workspaceId, agentId, sessionId, role: 'assistant', content: result.output }] });
  }
  return {
    output: result.output, parsed: result.pendingApproval ? undefined : parseOutput(agent, result.output), usage: result.usage,
    steps: result.steps as unknown as Array<Record<string, unknown>>,
    pendingApproval: result.pendingApproval ? { toolName: result.pendingApproval.toolName, arguments: result.pendingApproval.arguments } : null,
  };
}

/** Playground conversation turn (and approval resume). */
export async function runConversation(job: AgentJob, runSub: RuntimeServices['runSubWorkflow']): Promise<void> {
  const conv = await db.agentConversation.findUnique({ where: { id: job.conversationId }, include: { agent: { include: { knowledgeBases: true, workspace: { select: { organizationId: true } } } }, messages: { orderBy: { createdAt: 'asc' } } } });
  if (!conv) return;
  const agent = conv.agent;
  const emit = (step: Record<string, unknown>) => publish({ type: 'agent.step', workspaceId: conv.workspaceId, conversationId: conv.id, step, at: new Date().toISOString() });
  try {
    const history: LlmMessage[] = conv.messages.map((m) => ({
      role: m.role as LlmMessage['role'], content: m.content,
      toolCalls: (m.toolCalls as unknown as LlmMessage['toolCalls']) ?? undefined, toolCallId: m.toolCallId ?? undefined, toolName: m.toolName ?? undefined,
    }));
    const approved = new Set<string>();
    const rejected = new Set<string>();
    if (job.approval) {
      (job.approval.approved ? approved : rejected).add(job.approval.toolCallId);
      await db.agentMessage.updateMany({ where: { conversationId: conv.id, approvalStatus: 'pending' }, data: { approvalStatus: job.approval.approved ? 'approved' : 'rejected' } });
    }
    let lastAssistantId: string | null = null;
    const result = await runAgentLoop({
      chat: await chatFn(agent), tools: buildTools(agent, runSub), maxIterations: agent.maxIterations, approvedCallIds: approved, rejectedCallIds: rejected,
      messages: [{ role: 'system', content: systemPrompt(agent) }, ...windowed(history, agent.memoryEnabled ? agent.memoryWindow : 1)],
      onStep: async (step: AgentStep, msg: LlmMessage) => {
        if (step.type === 'model') {
          const row = await db.agentMessage.create({ data: { conversationId: conv.id, role: 'assistant', content: msg.content, toolCalls: (msg.toolCalls ?? undefined) as Prisma.InputJsonValue | undefined } });
          lastAssistantId = row.id;
        } else if (step.type === 'tool') {
          await db.agentMessage.create({ data: { conversationId: conv.id, role: 'tool', content: msg.content, toolCallId: msg.toolCallId, toolName: msg.toolName } });
        } else if (step.type === 'approval') {
          const target = lastAssistantId ?? (await db.agentMessage.findFirst({ where: { conversationId: conv.id, role: 'assistant' }, orderBy: { createdAt: 'desc' } }))?.id;
          if (target) await db.agentMessage.update({ where: { id: target }, data: { approvalStatus: 'pending' } });
        }
        await emit(step as unknown as Record<string, unknown>);
      },
    });
    await incrementUsage(db, agent.workspace.organizationId, conv.workspaceId, 'AI_TOKENS', result.usage.inputTokens + result.usage.outputTokens);
    if (lastAssistantId) await db.agentMessage.update({ where: { id: lastAssistantId }, data: { tokensIn: result.usage.inputTokens, tokensOut: result.usage.outputTokens } });
    const status = result.pendingApproval ? 'awaiting_approval' : 'idle';
    await db.agentConversation.update({ where: { id: conv.id }, data: { status } });
    await publish({ type: 'agent.finished', workspaceId: conv.workspaceId, conversationId: conv.id, status, at: new Date().toISOString() });
  } catch (err) {
    log.warn('agent run failed', { conversationId: conv.id, error: (err as Error).message });
    await db.agentMessage.create({ data: { conversationId: conv.id, role: 'assistant', content: `⚠️ ${(err as Error).message}` } });
    await db.agentConversation.update({ where: { id: conv.id }, data: { status: 'idle' } });
    await publish({ type: 'agent.finished', workspaceId: conv.workspaceId, conversationId: conv.id, status: 'error', at: new Date().toISOString() });
  }
}

export type { Item };
