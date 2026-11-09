import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calculate, chunkText, cosineSimilarity, llmChat, llmEmbed, runAgentLoop } from './index';

describe('text utils', () => {
  it('chunks with overlap', () => {
    const text = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${'lorem ipsum '.repeat(10)}`).join('\n\n');
    const chunks = chunkText(text, 400, 50);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.length <= 450)).toBe(true);
  });
  it('cosine', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });
  it('calculator', () => {
    expect(calculate('2 + 3 * (4 - 1) ^ 2')).toBe(29);
    expect(() => calculate('process.exit()')).toThrow();
  });
});

describe('openai-compatible provider + agent loop', () => {
  let server: http.Server;
  let baseUrl = '';
  const calls: any[] = [];
  beforeAll(async () => {
    process.env.ALLOW_PRIVATE_NETWORK = 'true';
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const json = JSON.parse(body || '{}');
        calls.push({ url: req.url, json });
        res.setHeader('content-type', 'application/json');
        if (req.url === '/v1/embeddings') return res.end(JSON.stringify({ data: json.input.map((_: string, index: number) => ({ index, embedding: [index, 1] })), usage: { prompt_tokens: 3 } }));
        const hasToolResult = json.messages.some((m: any) => m.role === 'tool');
        const message = hasToolResult
          ? { role: 'assistant', content: `The answer is ${json.messages.find((m: any) => m.role === 'tool').content}` }
          : { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'calculator', arguments: '{"expression":"6*7"}' } }] };
        res.end(JSON.stringify({ model: json.model, choices: [{ message, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  });
  afterAll(() => server.close());

  it('runs tools until an answer', async () => {
    const result = await runAgentLoop({
      chat: (messages, tools) => llmChat({ provider: 'custom', model: 'local', credentials: { baseUrl }, messages, tools }),
      messages: [{ role: 'system', content: 'You can calculate.' }, { role: 'user', content: 'What is 6*7?' }],
      tools: [{ name: 'calculator', description: 'math', parameters: { type: 'object', properties: { expression: { type: 'string' } } }, execute: async (a) => calculate(String(a.expression)) }],
      maxIterations: 4,
    });
    expect(result.output).toBe('The answer is 42');
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
    expect(calls[0].json.tools[0].function.name).toBe('calculator');
  });

  it('pauses for approval then resumes', async () => {
    const tools = [{ name: 'calculator', description: 'math', requiresApproval: true, parameters: { type: 'object' }, execute: async (a: Record<string, unknown>) => calculate(String(a.expression)) }];
    const chat = (messages: never, t: never) => llmChat({ provider: 'custom', model: 'local', credentials: { baseUrl }, messages, tools: t });
    const first = await runAgentLoop({ chat, messages: [{ role: 'user', content: 'calc' }], tools, maxIterations: 4 });
    expect(first.pendingApproval?.toolName).toBe('calculator');
    const resumed = await runAgentLoop({ chat, messages: first.messages, tools, maxIterations: 4, approvedCallIds: new Set(['c1']) });
    expect(resumed.output).toBe('The answer is 42');
  });

  it('embeds in order', async () => {
    const r = await llmEmbed({ provider: 'custom', model: 'e', input: ['a', 'b'], credentials: { baseUrl } });
    expect(r.embeddings).toEqual([[0, 1], [1, 1]]);
  });
});
