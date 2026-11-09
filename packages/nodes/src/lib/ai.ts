import { NodeOperationError, type ExecuteContext, type LlmProvider, type NodeProperty } from '@simplyai/sdk';

export const LLM_CREDENTIAL_TYPES = ['openAiApi', 'anthropicApi', 'googleGeminiApi', 'customLlmApi'];
export const EMBEDDING_CREDENTIAL_TYPES = ['openAiApi', 'googleGeminiApi', 'customLlmApi'];

export const PROVIDER_BY_CREDENTIAL: Record<string, LlmProvider> = {
  openAiApi: 'openai',
  anthropicApi: 'anthropic',
  googleGeminiApi: 'gemini',
  customLlmApi: 'custom',
};

export const modelProperty: NodeProperty = {
  name: 'model',
  displayName: 'Model',
  type: 'string',
  required: true,
  default: 'gpt-4o-mini',
  description: 'Model id for the selected provider, e.g. gpt-4o-mini, gemini-2.0-flash or your custom model name',
};

export const llmOptions: NodeProperty[] = [
  { name: 'temperature', displayName: 'Temperature', type: 'number', default: 0.3, min: 0, max: 2 },
  { name: 'maxTokens', displayName: 'Max tokens', type: 'number', default: 1024, min: 1, max: 200000 },
];

export async function resolveLlm(ctx: ExecuteContext) {
  const cred = await ctx.getCredential();
  const provider = PROVIDER_BY_CREDENTIAL[cred.type];
  if (!provider) throw new NodeOperationError(`Credential type ${cred.type} is not a language model provider`);
  return { provider, credentials: cred.data };
}

export async function chat(
  ctx: ExecuteContext,
  itemIndex: number,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  opts: { jsonMode?: boolean } = {},
) {
  const { provider, credentials } = await resolveLlm(ctx);
  const res = await ctx.services.llmChat({
    provider,
    credentials,
    model: ctx.getParam<string>('model', itemIndex),
    temperature: Number(ctx.getParam('temperature', itemIndex, 0.3)),
    maxTokens: Number(ctx.getParam('maxTokens', itemIndex, 1024)),
    messages,
    jsonMode: opts.jsonMode,
    signal: ctx.signal,
  });
  await ctx.services.recordUsage('AI_TOKENS', res.usage.inputTokens + res.usage.outputTokens);
  return res;
}

/** Extract JSON from a model answer (handles ```json fences and surrounding prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1]! : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        /* fallthrough */
      }
    }
    throw new NodeOperationError('The model did not return valid JSON', { context: { response: text.slice(0, 500) } });
  }
}

/** Minimal JSON-schema validation (type, required, properties, items, enum). */
export function validateSchema(value: unknown, schema: Record<string, unknown>, path = '$'): string[] {
  const errors: string[] = [];
  const type = schema.type as string | string[] | undefined;
  const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value === 'number' && Number.isInteger(value) ? 'integer' : typeof value;
  if (type) {
    const types = Array.isArray(type) ? type : [type];
    const ok = types.some((t) => t === actual || (t === 'number' && actual === 'integer'));
    if (!ok) return [`${path} should be ${types.join(' or ')} but is ${actual}`];
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) errors.push(`${path} must be one of ${JSON.stringify(schema.enum)}`);
  if (actual === 'object' && value) {
    for (const r of (schema.required as string[] | undefined) ?? []) if ((value as Record<string, unknown>)[r] === undefined) errors.push(`${path}.${r} is required`);
    for (const [k, sub] of Object.entries((schema.properties as Record<string, Record<string, unknown>> | undefined) ?? {})) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) errors.push(...validateSchema(v, sub, `${path}.${k}`));
    }
  }
  if (actual === 'array' && schema.items) (value as unknown[]).forEach((v, i) => errors.push(...validateSchema(v, schema.items as Record<string, unknown>, `${path}[${i}]`)));
  return errors;
}
