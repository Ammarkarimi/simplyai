import { defineNode, NodeOperationError, parseJsonParam, type Item, type LlmMessage, type NodeDefinition, type NodeProperty } from '@simplyai/sdk';
import { chat, EMBEDDING_CREDENTIAL_TYPES, extractJson, LLM_CREDENTIAL_TYPES, llmOptions, modelProperty, PROVIDER_BY_CREDENTIAL, resolveLlm, validateSchema } from '../lib/ai';

const main = [{ name: 'main' }];
const llmCreds = { types: LLM_CREDENTIAL_TYPES, required: true };
const color = '#8b5cf6';
const textProp = (def = '{{ $json.text }}'): NodeProperty => ({ name: 'text', displayName: 'Text', type: 'text', default: def, required: true, rows: 3 });

function each(ctx: Parameters<NonNullable<NodeDefinition['execute']>>[0]) {
  const items = ctx.getInputItems();
  return items.length ? items : [{ json: {} }];
}

export const aiAgentNode = defineNode({
  type: 'simplyai.aiAgent', version: 1, displayName: 'AI Agent', category: 'ai', subcategory: 'Agents', icon: 'bot', color,
  description: 'Run an agent from Agent Studio with its tools, knowledge and memory', inputs: main, outputs: main,
  properties: [
    { name: 'agentId', displayName: 'Agent', type: 'agent', default: '', required: true },
    { name: 'input', displayName: 'Input', type: 'text', default: '{{ $json.message ?? $json.text }}', required: true },
    { name: 'sessionId', displayName: 'Session ID (memory)', type: 'string', default: '{{ $json.sessionId ?? $execution.id }}', description: 'Messages with the same session id share conversation memory' },
  ],
  docs: 'Configure the model, instructions, tools and knowledge in **AI Agents**. Output: `{ output, parsed, steps, usage }`. If a tool requires approval, the run stops and `pendingApproval` describes the call.',
  async execute(ctx) {
    const out: Item[] = [];
    const items = each(ctx);
    for (let i = 0; i < items.length; i++) {
      const res = await ctx.services.runAgent({ agentId: ctx.getParam<string>('agentId', i), input: String(ctx.getParam('input', i) ?? ''), sessionId: ctx.getParam<string>('sessionId', i) || undefined, signal: ctx.signal });
      out.push({ json: { output: res.output, parsed: (res.parsed ?? null) as never, steps: res.steps as never, usage: res.usage as never, pendingApproval: (res.pendingApproval ?? null) as never }, pairedItem: i });
    }
    return [out];
  },
});

export const llmChatNode = defineNode({
  type: 'simplyai.llmChat', version: 1, displayName: 'LLM Chat', category: 'ai', subcategory: 'Language models', icon: 'messages-square', color,
  description: 'Chat with OpenAI, Anthropic, Gemini or a custom model, with optional memory', inputs: main, outputs: main,
  credentials: llmCreds,
  properties: [
    modelProperty,
    { name: 'systemPrompt', displayName: 'System prompt', type: 'text', default: 'You are a helpful assistant.', rows: 3 },
    { name: 'prompt', displayName: 'User message', type: 'text', default: '{{ $json.message }}', required: true, rows: 3 },
    { name: 'sessionId', displayName: 'Memory session ID (optional)', type: 'string', default: '' },
    { name: 'memoryWindow', displayName: 'Messages to remember', type: 'number', default: 10, min: 0, max: 100 },
    { name: 'jsonMode', displayName: 'Respond with JSON', type: 'boolean', default: false },
    ...llmOptions,
  ],
  outputExample: { response: 'Hello! How can I help?', usage: { inputTokens: 12, outputTokens: 9 } },
  async execute(ctx) {
    const out: Item[] = [];
    const items = each(ctx);
    for (let i = 0; i < items.length; i++) {
      const session = ctx.getParam<string>('sessionId', i);
      const window = Number(ctx.getParam('memoryWindow', i, 10));
      const history: LlmMessage[] = session && window > 0 ? await ctx.services.memory.load(session, window) : [];
      const prompt = String(ctx.getParam('prompt', i) ?? '');
      const messages = [
        { role: 'system' as const, content: ctx.getParam<string>('systemPrompt', i) ?? '' },
        ...history.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user' as const, content: prompt },
      ];
      const jsonMode = !!ctx.getParam('jsonMode', i);
      const res = await chat(ctx, i, messages, { jsonMode });
      if (session) await ctx.services.memory.append(session, [{ role: 'user', content: prompt }, { role: 'assistant', content: res.content }]);
      out.push({ json: { response: jsonMode ? (extractJson(res.content) as never) : res.content, model: res.model, usage: res.usage as never }, pairedItem: i });
    }
    return [out];
  },
});

export const textGenerationNode = defineNode({
  type: 'simplyai.textGeneration', version: 1, displayName: 'Text Generation', category: 'ai', subcategory: 'Language models', icon: 'sparkles', color,
  description: 'Generate text from a prompt', inputs: main, outputs: main, credentials: llmCreds,
  properties: [
    modelProperty,
    { name: 'prompt', displayName: 'Prompt', type: 'text', default: 'Write a short, friendly product description for: {{ $json.product }}', required: true, rows: 4 },
    { name: 'target', displayName: 'Output field', type: 'string', default: 'text', noExpression: true },
    ...llmOptions,
  ],
  async execute(ctx) {
    const out: Item[] = [];
    const items = each(ctx);
    for (let i = 0; i < items.length; i++) {
      const res = await chat(ctx, i, [{ role: 'user', content: String(ctx.getParam('prompt', i)) }]);
      out.push({ json: { ...items[i]!.json, [ctx.getRawParam<string>('target') || 'text']: res.content }, pairedItem: i });
    }
    return [out];
  },
});

export const classificationNode = defineNode({
  type: 'simplyai.textClassifier', version: 1, displayName: 'Text Classification', category: 'ai', subcategory: 'Analysis', icon: 'tags', color,
  description: 'Classify text into categories and route each item to the matching output', inputs: main, outputs: main, credentials: llmCreds,
  dynamicOutputs: { parameter: 'categories', labelField: 'name', fallback: true },
  properties: [
    modelProperty,
    textProp(),
    {
      name: 'categories', displayName: 'Categories', type: 'fixedCollection', noExpression: true,
      default: [{ name: 'Sales', description: 'Pricing, demos, purchasing' }, { name: 'Support', description: 'Problems, bugs, how-to questions' }],
      fields: [{ name: 'name', displayName: 'Name', type: 'string', default: '' }, { name: 'description', displayName: 'Description', type: 'string', default: '' }],
    },
    { name: 'fallbackOutput', displayName: 'Route unknown to "Fallback"', type: 'boolean', default: true, noExpression: true },
    ...llmOptions,
  ],
  async execute(ctx) {
    const cats = ctx.getRawParam<Array<{ name: string; description?: string }>>('categories') ?? [];
    if (!cats.length) throw new NodeOperationError('Add at least one category');
    const outs: Item[][] = cats.map(() => []);
    const fallback: Item[] = [];
    const items = each(ctx);
    for (let i = 0; i < items.length; i++) {
      const list = cats.map((c) => `- ${c.name}${c.description ? `: ${c.description}` : ''}`).join('\n');
      const res = await chat(ctx, i, [
        { role: 'system', content: `Classify the text into exactly one of these categories:\n${list}\nRespond with JSON: {"category": "<name or Other>", "confidence": <0-1>, "reason": "<short>"}` },
        { role: 'user', content: String(ctx.getParam('text', i)) },
      ], { jsonMode: true });
      const parsed = extractJson(res.content) as { category?: string; confidence?: number; reason?: string };
      const idx = cats.findIndex((c) => c.name.toLowerCase() === String(parsed.category ?? '').toLowerCase());
      const item = { json: { ...items[i]!.json, classification: { category: idx >= 0 ? cats[idx]!.name : 'Other', confidence: parsed.confidence ?? null, reason: parsed.reason ?? null } }, pairedItem: i };
      (idx >= 0 ? outs[idx]! : fallback).push(item);
    }
    return ctx.getRawParam('fallbackOutput') === false ? outs : [...outs, fallback];
  },
});

export const summarizationNode = defineNode({
  type: 'simplyai.summarize', version: 1, displayName: 'Summarization', category: 'ai', subcategory: 'Analysis', icon: 'list-collapse', color,
  description: 'Summarize long text as a paragraph or bullet points', inputs: main, outputs: main, credentials: llmCreds,
  properties: [
    modelProperty,
    textProp(),
    { name: 'style', displayName: 'Style', type: 'options', default: 'paragraph', options: [{ name: 'Paragraph', value: 'paragraph' }, { name: 'Bullet points', value: 'bullets' }, { name: 'One sentence (TL;DR)', value: 'tldr' }] },
    { name: 'maxWords', displayName: 'Max words', type: 'number', default: 120, min: 10 },
    ...llmOptions,
  ],
  async execute(ctx) {
    const out: Item[] = [];
    const items = each(ctx);
    for (let i = 0; i < items.length; i++) {
      const style = ctx.getParam<string>('style', i);
      const instruction = style === 'bullets' ? 'as concise bullet points' : style === 'tldr' ? 'in one sentence' : 'as a short paragraph';
      const res = await chat(ctx, i, [
        { role: 'system', content: `Summarize the user's text ${instruction}, in at most ${ctx.getParam('maxWords', i)} words. Keep facts accurate; do not add information.` },
        { role: 'user', content: String(ctx.getParam('text', i)) },
      ]);
      out.push({ json: { ...items[i]!.json, summary: res.content }, pairedItem: i });
    }
    return [out];
  },
});

export const extractionNode = defineNode({
  type: 'simplyai.informationExtractor', version: 1, displayName: 'Information Extraction', category: 'ai', subcategory: 'Analysis', icon: 'scan-text', color,
  description: 'Extract structured fields from unstructured text', inputs: main, outputs: main, credentials: llmCreds,
  properties: [
    modelProperty,
    textProp(),
    {
      name: 'attributes', displayName: 'Attributes', type: 'fixedCollection', noExpression: true,
      default: [{ name: 'name', type: 'string', description: 'Full name of the person', required: true }, { name: 'email', type: 'string', description: 'Email address', required: false }],
      fields: [
        { name: 'name', displayName: 'Name', type: 'string', default: '' },
        { name: 'type', displayName: 'Type', type: 'options', default: 'string', options: ['string', 'number', 'boolean', 'array'].map((v) => ({ name: v, value: v })) },
        { name: 'description', displayName: 'Description', type: 'string', default: '' },
        { name: 'required', displayName: 'Required', type: 'boolean', default: false },
      ],
    },
    ...llmOptions,
  ],
  async execute(ctx) {
    const attrs = ctx.getRawParam<Array<{ name: string; type: string; description?: string; required?: boolean }>>('attributes') ?? [];
    const schema = {
      type: 'object',
      properties: Object.fromEntries(attrs.map((a) => [a.name, { type: a.type === 'array' ? 'array' : a.type, description: a.description }])),
      required: attrs.filter((a) => a.required).map((a) => a.name),
    };
    const out: Item[] = [];
    const items = each(ctx);
    for (let i = 0; i < items.length; i++) {
      const res = await chat(ctx, i, [
        { role: 'system', content: `Extract information from the text. Respond only with JSON matching this JSON schema; use null when a value is not present:\n${JSON.stringify(schema)}` },
        { role: 'user', content: String(ctx.getParam('text', i)) },
      ], { jsonMode: true });
      out.push({ json: { ...items[i]!.json, extracted: extractJson(res.content) as never }, pairedItem: i });
    }
    return [out];
  },
});

export const sentimentNode = defineNode({
  type: 'simplyai.sentiment', version: 1, displayName: 'Sentiment Analysis', category: 'ai', subcategory: 'Analysis', icon: 'smile', color,
  description: 'Detect positive, neutral or negative sentiment', inputs: main,
  outputs: [{ name: 'positive', label: 'Positive' }, { name: 'neutral', label: 'Neutral' }, { name: 'negative', label: 'Negative' }],
  credentials: llmCreds,
  properties: [modelProperty, textProp(), ...llmOptions],
  async execute(ctx) {
    const outs: Record<string, Item[]> = { positive: [], neutral: [], negative: [] };
    const items = each(ctx);
    for (let i = 0; i < items.length; i++) {
      const res = await chat(ctx, i, [
        { role: 'system', content: 'Analyse the sentiment of the text. Respond with JSON: {"sentiment": "positive" | "neutral" | "negative", "score": <-1..1>, "emotions": [<strings>]}' },
        { role: 'user', content: String(ctx.getParam('text', i)) },
      ], { jsonMode: true });
      const p = extractJson(res.content) as { sentiment?: string; score?: number; emotions?: string[] };
      const s = ['positive', 'neutral', 'negative'].includes(String(p.sentiment)) ? String(p.sentiment) : 'neutral';
      outs[s]!.push({ json: { ...items[i]!.json, sentiment: { label: s, score: p.score ?? null, emotions: p.emotions ?? [] } }, pairedItem: i });
    }
    return [outs.positive!, outs.neutral!, outs.negative!];
  },
});

export const embeddingsNode = defineNode({
  type: 'simplyai.embeddings', version: 1, displayName: 'Embeddings', category: 'ai', subcategory: 'Retrieval', icon: 'binary', color,
  description: 'Create vector embeddings for text', inputs: main, outputs: main,
  credentials: { types: EMBEDDING_CREDENTIAL_TYPES, required: true },
  properties: [
    { name: 'model', displayName: 'Model', type: 'string', default: 'text-embedding-3-small', required: true },
    textProp(),
    { name: 'target', displayName: 'Output field', type: 'string', default: 'embedding', noExpression: true },
  ],
  async execute(ctx) {
    const { provider, credentials } = await resolveLlm(ctx);
    const items = each(ctx);
    const texts = items.map((_, i) => String(ctx.getParam('text', i) ?? ''));
    const res = await ctx.services.llmEmbed({ provider, credentials, model: ctx.getParam<string>('model'), input: texts, signal: ctx.signal });
    await ctx.services.recordUsage('AI_TOKENS', res.usage.inputTokens);
    const target = ctx.getRawParam<string>('target') || 'embedding';
    return [items.map((it, i) => ({ json: { ...it.json, [target]: res.embeddings[i] ?? [] }, pairedItem: i }))];
  },
});

export const vectorSearchNode = defineNode({
  type: 'simplyai.vectorSearch', version: 1, displayName: 'Vector Search', category: 'ai', subcategory: 'Retrieval', icon: 'search', color, usableAsTool: true,
  description: 'Find the most relevant chunks in a knowledge base', inputs: main, outputs: main,
  properties: [
    { name: 'knowledgeBaseId', displayName: 'Knowledge base', type: 'knowledgeBase', default: '', required: true },
    { name: 'query', displayName: 'Query', type: 'text', default: '{{ $json.question }}', required: true },
    { name: 'topK', displayName: 'Results', type: 'number', default: 4, min: 1, max: 50 },
    { name: 'minScore', displayName: 'Minimum similarity (0-1)', type: 'number', default: 0, min: 0, max: 1 },
  ],
  async execute(ctx) {
    const out: Item[] = [];
    const items = each(ctx);
    for (let i = 0; i < items.length; i++) {
      const matches = await ctx.services.knowledge.search(ctx.getParam<string>('knowledgeBaseId', i), String(ctx.getParam('query', i)), Number(ctx.getParam('topK', i, 4)));
      const min = Number(ctx.getParam('minScore', i, 0));
      matches.filter((m) => m.score >= min).forEach((m) => out.push({ json: { ...m }, pairedItem: i }));
    }
    return [out];
  },
});

export const ragNode = defineNode({
  type: 'simplyai.rag', version: 1, displayName: 'RAG (Question Answering)', category: 'ai', subcategory: 'Retrieval', icon: 'book-open-check', color,
  description: 'Answer questions grounded in a knowledge base, with sources', inputs: main, outputs: main, credentials: llmCreds,
  properties: [
    { name: 'knowledgeBaseId', displayName: 'Knowledge base', type: 'knowledgeBase', default: '', required: true },
    modelProperty,
    { name: 'question', displayName: 'Question', type: 'text', default: '{{ $json.question }}', required: true },
    { name: 'topK', displayName: 'Context chunks', type: 'number', default: 5, min: 1, max: 20 },
    { name: 'systemPrompt', displayName: 'Instructions', type: 'text', default: 'Answer using only the provided context. If the answer is not in the context, say you do not know. Cite sources as [1], [2].' },
    ...llmOptions,
  ],
  async execute(ctx) {
    const out: Item[] = [];
    const items = each(ctx);
    for (let i = 0; i < items.length; i++) {
      const question = String(ctx.getParam('question', i));
      const matches = await ctx.services.knowledge.search(ctx.getParam<string>('knowledgeBaseId', i), question, Number(ctx.getParam('topK', i, 5)));
      const context = matches.map((m, k) => `[${k + 1}] (${m.documentName ?? m.documentId})\n${m.content}`).join('\n\n');
      const res = await chat(ctx, i, [
        { role: 'system', content: `${ctx.getParam<string>('systemPrompt', i)}\n\nContext:\n${context || '(no relevant context found)'}` },
        { role: 'user', content: question },
      ]);
      out.push({ json: { ...items[i]!.json, answer: res.content, sources: matches.map((m, k) => ({ ref: k + 1, document: m.documentName ?? m.documentId, score: m.score, excerpt: m.content.slice(0, 300) })) as never }, pairedItem: i });
    }
    return [out];
  },
});

export const aiMemoryNode = defineNode({
  type: 'simplyai.aiMemory', version: 1, displayName: 'AI Memory', category: 'ai', subcategory: 'Agents', icon: 'brain', color,
  description: 'Load, store or clear conversation memory for a session', inputs: main, outputs: main,
  properties: [
    { name: 'operation', displayName: 'Operation', type: 'options', default: 'load', noExpression: true, options: [{ name: 'Load messages', value: 'load' }, { name: 'Append message', value: 'append' }, { name: 'Clear session', value: 'clear' }] },
    { name: 'sessionId', displayName: 'Session ID', type: 'string', default: '{{ $json.sessionId }}', required: true },
    { name: 'role', displayName: 'Role', type: 'options', default: 'user', displayOptions: { show: { operation: ['append'] } }, options: [{ name: 'User', value: 'user' }, { name: 'Assistant', value: 'assistant' }, { name: 'System', value: 'system' }] },
    { name: 'content', displayName: 'Content', type: 'text', default: '{{ $json.message }}', displayOptions: { show: { operation: ['append'] } } },
    { name: 'limit', displayName: 'Messages to load', type: 'number', default: 20, displayOptions: { show: { operation: ['load'] } } },
  ],
  async execute(ctx) {
    const out: Item[] = [];
    const items = each(ctx);
    for (let i = 0; i < items.length; i++) {
      const session = ctx.getParam<string>('sessionId', i);
      if (!session) throw new NodeOperationError('Session ID is empty', { itemIndex: i });
      const op = ctx.getRawParam<string>('operation');
      if (op === 'load') {
        const messages = await ctx.services.memory.load(session, Number(ctx.getParam('limit', i, 20)));
        out.push({ json: { ...items[i]!.json, sessionId: session, messages: messages as never, transcript: messages.map((m) => `${m.role}: ${m.content}`).join('\n') }, pairedItem: i });
      } else if (op === 'append') {
        await ctx.services.memory.append(session, [{ role: ctx.getParam('role', i), content: String(ctx.getParam('content', i) ?? '') }]);
        out.push({ json: { ...items[i]!.json, sessionId: session, stored: true }, pairedItem: i });
      } else {
        await ctx.services.memory.clear(session);
        out.push({ json: { ...items[i]!.json, sessionId: session, cleared: true }, pairedItem: i });
      }
    }
    return [out];
  },
});

export const toolCallingNode = defineNode({
  type: 'simplyai.toolCalling', version: 1, displayName: 'Tool Calling', category: 'ai', subcategory: 'Agents', icon: 'wrench', color,
  description: 'Let the model choose a tool and arguments, then route to the matching output', inputs: main, outputs: main, credentials: llmCreds,
  dynamicOutputs: { parameter: 'tools', labelField: 'name', fallback: true },
  properties: [
    modelProperty,
    { name: 'prompt', displayName: 'Message', type: 'text', default: '{{ $json.message }}', required: true },
    { name: 'systemPrompt', displayName: 'System prompt', type: 'text', default: 'Choose the best tool to handle the request.' },
    {
      name: 'tools', displayName: 'Tools', type: 'fixedCollection', noExpression: true,
      default: [{ name: 'create_ticket', description: 'Create a support ticket', parameters: '{"type":"object","properties":{"title":{"type":"string"},"priority":{"type":"string","enum":["low","high"]}},"required":["title"]}' }],
      fields: [
        { name: 'name', displayName: 'Name', type: 'string', default: '' },
        { name: 'description', displayName: 'Description', type: 'string', default: '' },
        { name: 'parameters', displayName: 'Parameters JSON schema', type: 'json', default: '{"type":"object","properties":{}}' },
      ],
    },
    { name: 'fallbackOutput', displayName: 'Output "No tool" when the model answers directly', type: 'boolean', default: true, noExpression: true },
    ...llmOptions,
  ],
  docs: 'Each tool becomes an output. Items carry `toolCall: { name, arguments }`. Answers without a tool call go to the last output with `response`.',
  async execute(ctx) {
    const tools = (ctx.getRawParam<Array<{ name: string; description: string; parameters: string }>>('tools') ?? []).map((t) => ({
      name: t.name, description: t.description, parameters: (parseJsonParam(t.parameters, `parameters of ${t.name}`) ?? { type: 'object', properties: {} }) as Record<string, unknown>,
    }));
    const outs: Item[][] = tools.map(() => []);
    const none: Item[] = [];
    const items = each(ctx);
    for (let i = 0; i < items.length; i++) {
      const { provider, credentials } = await resolveLlm(ctx);
      const res = await ctx.services.llmChat({
        provider, credentials, model: ctx.getParam<string>('model', i), temperature: Number(ctx.getParam('temperature', i, 0.3)), maxTokens: Number(ctx.getParam('maxTokens', i, 1024)), tools,
        messages: [{ role: 'system', content: ctx.getParam<string>('systemPrompt', i) ?? '' }, { role: 'user', content: String(ctx.getParam('prompt', i)) }], signal: ctx.signal,
      });
      await ctx.services.recordUsage('AI_TOKENS', res.usage.inputTokens + res.usage.outputTokens);
      if (!res.toolCalls.length) none.push({ json: { ...items[i]!.json, response: res.content }, pairedItem: i });
      for (const call of res.toolCalls) {
        const idx = tools.findIndex((t) => t.name === call.name);
        (idx >= 0 ? outs[idx]! : none).push({ json: { ...items[i]!.json, toolCall: { name: call.name, arguments: call.arguments } as never }, pairedItem: i });
      }
    }
    return ctx.getRawParam('fallbackOutput') === false ? outs : [...outs, none];
  },
});

export const structuredOutputNode = defineNode({
  type: 'simplyai.structuredOutputParser', version: 1, displayName: 'Structured Output Parser', category: 'ai', subcategory: 'Analysis', icon: 'file-check-2', color,
  description: 'Parse and validate JSON produced by a model against a schema', inputs: main, outputs: [{ name: 'valid', label: 'Valid' }, { name: 'invalid', label: 'Invalid' }],
  properties: [
    { name: 'field', displayName: 'Field with model output', type: 'string', default: '{{ $json.response }}', required: true },
    { name: 'schema', displayName: 'JSON schema', type: 'json', default: '{\n  "type": "object",\n  "properties": { "title": { "type": "string" } },\n  "required": ["title"]\n}' },
    { name: 'target', displayName: 'Output field', type: 'string', default: 'parsed', noExpression: true },
  ],
  async execute(ctx) {
    const valid: Item[] = [], invalid: Item[] = [];
    const schema = (parseJsonParam(ctx.getRawParam('schema'), 'JSON schema') ?? {}) as Record<string, unknown>;
    const target = ctx.getRawParam<string>('target') || 'parsed';
    each(ctx).forEach((item, i) => {
      const raw = ctx.getParam<unknown>('field', i);
      try {
        const parsed = typeof raw === 'string' ? extractJson(raw) : raw;
        const errors = validateSchema(parsed, schema);
        (errors.length ? invalid : valid).push({ json: { ...item.json, [target]: parsed as never, ...(errors.length ? { validationErrors: errors } : {}) }, pairedItem: i });
      } catch (err) {
        invalid.push({ json: { ...item.json, validationErrors: [(err as Error).message] }, pairedItem: i });
      }
    });
    return [valid, invalid];
  },
});

export const aiNodes: NodeDefinition[] = [
  aiAgentNode, llmChatNode, textGenerationNode, classificationNode, summarizationNode, extractionNode, sentimentNode, embeddingsNode, vectorSearchNode, ragNode, aiMemoryNode, toolCallingNode, structuredOutputNode,
];

export { PROVIDER_BY_CREDENTIAL };
