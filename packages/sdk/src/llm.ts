/** Provider-agnostic LLM types shared between nodes, the agent runtime and providers. */

export type LlmProvider = 'openai' | 'anthropic' | 'gemini' | 'custom';

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: LlmToolCall[];
  toolCallId?: string;
  toolName?: string;
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  /** JSON schema of the arguments */
  parameters: Record<string, unknown>;
}

export interface LlmChatRequest {
  provider: LlmProvider;
  model: string;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: LlmToolDefinition[];
  /** ask the model to answer with JSON */
  jsonMode?: boolean;
  credentials: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface LlmChatResponse {
  content: string;
  toolCalls: LlmToolCall[];
  finishReason: string;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export interface LlmEmbedRequest {
  provider: LlmProvider;
  model: string;
  input: string[];
  credentials: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface LlmEmbedResponse {
  embeddings: number[][];
  usage: { inputTokens: number };
}
