/**
 * LLM provider adapters. All HTTP goes through the SDK client (SSRF guard,
 * timeouts). Each adapter maps the provider-neutral request to the vendor API.
 */
import { httpRequest, NodeApiError, type LlmChatRequest, type LlmChatResponse, type LlmEmbedRequest, type LlmEmbedResponse, type LlmMessage, type LlmToolCall } from '@simplyai/sdk';

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
let callCounter = 0;
const newCallId = () => `call_${Date.now().toString(36)}_${(callCounter++).toString(36)}`;

function requireKey(creds: Record<string, unknown>, field = 'apiKey'): string {
  const k = str(creds[field]);
  if (!k) throw new NodeApiError('The selected credential has no API key');
  return k;
}

function safeParseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    return JSON.parse(str(raw) || '{}') as Record<string, unknown>;
  } catch {
    return { _raw: raw };
  }
}

// ───────────────────────── OpenAI & compatible ─────────────────────────

function openAiMessages(messages: LlmMessage[], jsonMode?: boolean) {
  const out = messages.map((m) => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    if (m.role === 'assistant' && m.toolCalls?.length)
      return { role: 'assistant', content: m.content || null, tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) };
    return { role: m.role, content: m.content };
  });
  if (jsonMode && !messages.some((m) => /json/i.test(m.content))) out.unshift({ role: 'system', content: 'Respond with a valid JSON object.' });
  return out;
}

async function openAiChat(req: LlmChatRequest, custom: boolean): Promise<LlmChatResponse> {
  const base = str(req.credentials.baseUrl || (custom ? '' : 'https://api.openai.com/v1')).replace(/\/$/, '');
  if (!base) throw new NodeApiError('The custom LLM credential needs a base URL');
  const headers: Record<string, string> = {};
  const key = str(req.credentials.apiKey);
  if (key) headers.authorization = `Bearer ${key}`;
  else if (!custom) requireKey(req.credentials);
  if (req.credentials.organization) headers['openai-organization'] = str(req.credentials.organization);
  const body: Record<string, unknown> = {
    model: req.model,
    messages: openAiMessages(req.messages, req.jsonMode),
    temperature: req.temperature,
    ...(custom ? { max_tokens: req.maxTokens } : { max_completion_tokens: req.maxTokens }),
  };
  if (req.tools?.length) body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  if (req.jsonMode && !req.tools?.length) body.response_format = { type: 'json_object' };
  const res = await httpRequest<any>({ url: `${base}/chat/completions`, method: 'POST', headers, body, timeoutMs: 120_000, signal: req.signal });
  const choice = res.body?.choices?.[0];
  if (!choice) throw new NodeApiError('The model returned no choices', res.status, res.body);
  const toolCalls: LlmToolCall[] = (choice.message?.tool_calls ?? []).map((c: any) => ({ id: c.id ?? newCallId(), name: c.function?.name, arguments: safeParseArgs(c.function?.arguments) }));
  return {
    content: str(choice.message?.content),
    toolCalls,
    finishReason: str(choice.finish_reason),
    usage: { inputTokens: res.body.usage?.prompt_tokens ?? 0, outputTokens: res.body.usage?.completion_tokens ?? 0 },
    model: str(res.body.model || req.model),
  };
}

async function openAiEmbed(req: LlmEmbedRequest, custom: boolean): Promise<LlmEmbedResponse> {
  const base = str(req.credentials.baseUrl || (custom ? '' : 'https://api.openai.com/v1')).replace(/\/$/, '');
  const key = str(req.credentials.apiKey);
  const res = await httpRequest<any>({
    url: `${base}/embeddings`, method: 'POST', headers: key ? { authorization: `Bearer ${key}` } : {}, body: { model: req.model, input: req.input }, timeoutMs: 120_000, signal: req.signal,
  });
  const data = [...(res.body?.data ?? [])].sort((a: any, b: any) => a.index - b.index);
  return { embeddings: data.map((d: any) => d.embedding as number[]), usage: { inputTokens: res.body?.usage?.prompt_tokens ?? 0 } };
}

// ───────────────────────── Anthropic ─────────────────────────

function anthropicMessages(messages: LlmMessage[]) {
  const out: Array<{ role: 'user' | 'assistant'; content: any[] }> = [];
  const push = (role: 'user' | 'assistant', block: any) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(block);
    else out.push({ role, content: [block] });
  };
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') push('user', { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content });
    else if (m.role === 'assistant') {
      if (m.content) push('assistant', { type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) push('assistant', { type: 'tool_use', id: c.id, name: c.name, input: c.arguments });
    } else push('user', { type: 'text', text: m.content });
  }
  return out;
}

async function anthropicChat(req: LlmChatRequest): Promise<LlmChatResponse> {
  const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const body: Record<string, unknown> = {
    model: req.model,
    max_tokens: req.maxTokens ?? 1024,
    temperature: req.temperature,
    system: (req.jsonMode ? `${system}\n\nRespond only with valid JSON.` : system) || undefined,
    messages: anthropicMessages(req.messages),
  };
  if (req.tools?.length) body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const res = await httpRequest<any>({
    url: 'https://api.anthropic.com/v1/messages', method: 'POST', timeoutMs: 120_000, signal: req.signal,
    headers: { 'x-api-key': requireKey(req.credentials), 'anthropic-version': '2023-06-01' }, body,
  });
  const blocks: any[] = res.body?.content ?? [];
  return {
    content: blocks.filter((b) => b.type === 'text').map((b) => b.text).join(''),
    toolCalls: blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id, name: b.name, arguments: b.input ?? {} })),
    finishReason: str(res.body?.stop_reason),
    usage: { inputTokens: res.body?.usage?.input_tokens ?? 0, outputTokens: res.body?.usage?.output_tokens ?? 0 },
    model: str(res.body?.model || req.model),
  };
}

// ───────────────────────── Gemini ─────────────────────────

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
const UNSUPPORTED_SCHEMA_KEYS = new Set(['$schema', 'additionalProperties', '$id', 'default', 'examples']);
function cleanSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(cleanSchema);
  if (s && typeof s === 'object') return Object.fromEntries(Object.entries(s).filter(([k]) => !UNSUPPORTED_SCHEMA_KEYS.has(k)).map(([k, v]) => [k, cleanSchema(v)]));
  return s;
}

function geminiContents(messages: LlmMessage[]) {
  const out: Array<{ role: 'user' | 'model'; parts: any[] }> = [];
  const push = (role: 'user' | 'model', part: any) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts.push(part);
    else out.push({ role, parts: [part] });
  };
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      let response: unknown;
      try { response = JSON.parse(m.content); } catch { response = { result: m.content }; }
      push('user', { functionResponse: { name: m.toolName, response: response && typeof response === 'object' && !Array.isArray(response) ? response : { result: response } } });
    } else if (m.role === 'assistant') {
      if (m.content) push('model', { text: m.content });
      for (const c of m.toolCalls ?? []) push('model', { functionCall: { name: c.name, args: c.arguments } });
    } else push('user', { text: m.content });
  }
  return out;
}

async function geminiChat(req: LlmChatRequest): Promise<LlmChatResponse> {
  const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const body: Record<string, unknown> = {
    contents: geminiContents(req.messages),
    generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxTokens, ...(req.jsonMode && !req.tools?.length ? { responseMimeType: 'application/json' } : {}) },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (req.tools?.length) body.tools = [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: cleanSchema(t.parameters) })) }];
  const res = await httpRequest<any>({
    url: `${GEMINI}/models/${encodeURIComponent(req.model)}:generateContent`, method: 'POST', timeoutMs: 120_000, signal: req.signal,
    headers: { 'x-goog-api-key': requireKey(req.credentials) }, body,
  });
  const cand = res.body?.candidates?.[0];
  const parts: any[] = cand?.content?.parts ?? [];
  if (!cand) throw new NodeApiError(`Gemini returned no candidates${res.body?.promptFeedback?.blockReason ? ` (${res.body.promptFeedback.blockReason})` : ''}`, res.status, res.body);
  return {
    content: parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join(''),
    toolCalls: parts.filter((p) => p.functionCall).map((p) => ({ id: newCallId(), name: p.functionCall.name, arguments: p.functionCall.args ?? {} })),
    finishReason: str(cand.finishReason),
    usage: { inputTokens: res.body?.usageMetadata?.promptTokenCount ?? 0, outputTokens: res.body?.usageMetadata?.candidatesTokenCount ?? 0 },
    model: req.model,
  };
}

async function geminiEmbed(req: LlmEmbedRequest): Promise<LlmEmbedResponse> {
  const model = req.model.startsWith('models/') ? req.model : `models/${req.model}`;
  const res = await httpRequest<any>({
    url: `${GEMINI}/${model}:batchEmbedContents`, method: 'POST', timeoutMs: 120_000, signal: req.signal,
    headers: { 'x-goog-api-key': requireKey(req.credentials) },
    body: { requests: req.input.map((text) => ({ model, content: { parts: [{ text }] } })) },
  });
  return { embeddings: (res.body?.embeddings ?? []).map((e: any) => e.values as number[]), usage: { inputTokens: Math.ceil(req.input.join(' ').length / 4) } };
}

// ───────────────────────── public API ─────────────────────────

export async function llmChat(req: LlmChatRequest): Promise<LlmChatResponse> {
  switch (req.provider) {
    case 'openai': return openAiChat(req, false);
    case 'custom': return openAiChat(req, true);
    case 'anthropic': return anthropicChat(req);
    case 'gemini': return geminiChat(req);
    default: throw new NodeApiError(`Unknown provider ${String(req.provider)}`);
  }
}

export async function llmEmbed(req: LlmEmbedRequest): Promise<LlmEmbedResponse> {
  const batches: string[][] = [];
  for (let i = 0; i < req.input.length; i += 96) batches.push(req.input.slice(i, i + 96));
  const out: LlmEmbedResponse = { embeddings: [], usage: { inputTokens: 0 } };
  for (const b of batches) {
    let r: LlmEmbedResponse;
    switch (req.provider) {
      case 'openai': r = await openAiEmbed({ ...req, input: b }, false); break;
      case 'custom': r = await openAiEmbed({ ...req, input: b }, true); break;
      case 'gemini': r = await geminiEmbed({ ...req, input: b }); break;
      default: throw new NodeApiError(`Embeddings are not available for provider ${req.provider}. Use OpenAI, Gemini or a custom endpoint.`);
    }
    out.embeddings.push(...r.embeddings);
    out.usage.inputTokens += r.usage.inputTokens;
  }
  return out;
}

export const PROVIDERS = [
  { key: 'openai', name: 'OpenAI', credentialType: 'openAiApi', suggestedModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'gpt-4.1-mini'], embeddingModels: ['text-embedding-3-small', 'text-embedding-3-large'] },
  { key: 'anthropic', name: 'Anthropic', credentialType: 'anthropicApi', suggestedModels: [], embeddingModels: [] },
  { key: 'gemini', name: 'Google Gemini', credentialType: 'googleGeminiApi', suggestedModels: ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'], embeddingModels: ['text-embedding-004'] },
  { key: 'custom', name: 'Custom (OpenAI compatible)', credentialType: 'customLlmApi', suggestedModels: ['llama3.1', 'mistral', 'qwen2.5'], embeddingModels: ['nomic-embed-text'] },
] as const;
