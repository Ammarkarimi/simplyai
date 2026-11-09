import type {
  CredentialTypeDescription,
  IntegrationDescription,
  Item,
  NodeDescription,
  WorkflowNodeDef,
  ExecutionMode,
} from '@simplyai/shared';
import type { HttpRequestOptions, HttpResponse } from './http';
import type { LlmChatRequest, LlmChatResponse, LlmEmbedRequest, LlmEmbedResponse, LlmMessage } from './llm';

/** Signals a node can return instead of output data. */
export type ControlSignal =
  | { control: 'wait'; kind: 'time'; until: string; output?: Item[][] }
  | { control: 'wait'; kind: 'approval'; message?: string; output?: Item[][] }
  | { control: 'stop'; status: 'success' | 'error'; message?: string; output?: Item[][] };

export type NodeOutput = Item[][] | ControlSignal;

export function isControlSignal(v: unknown): v is ControlSignal {
  return !!v && typeof v === 'object' && !Array.isArray(v) && 'control' in (v as object);
}

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

export interface ResolvedCredential<T = Record<string, unknown>> {
  id: string;
  type: string;
  data: T;
}

export interface AgentRunRequest {
  agentId: string;
  input: string;
  sessionId?: string;
  signal?: AbortSignal;
}

export interface AgentRunResult {
  output: string;
  parsed?: unknown;
  steps: Array<Record<string, unknown>>;
  usage: { inputTokens: number; outputTokens: number };
  pendingApproval?: { toolName: string; arguments: Record<string, unknown> } | null;
}

export interface KnowledgeMatch {
  content: string;
  score: number;
  documentId: string;
  documentName?: string;
  chunkIndex: number;
}

export interface DataTableFilter {
  column: string;
  operator: 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'isEmpty' | 'isNotEmpty';
  value?: unknown;
}

/**
 * Services injected by the runtime (the worker). Nodes must use these instead
 * of reaching into the database or process environment directly.
 */
export interface RuntimeServices {
  getCredential(credentialId: string, acceptedTypes: string[]): Promise<ResolvedCredential>;
  /** authenticates an outgoing request with the given credential (refreshing OAuth tokens if needed) */
  authenticateRequest(credential: ResolvedCredential, request: HttpRequestOptions): Promise<HttpRequestOptions>;
  runSubWorkflow(workflowId: string, items: Item[], options: { waitForCompletion: boolean; signal?: AbortSignal }): Promise<Item[]>;
  runCode(code: string, items: Item[], options: { mode: 'all' | 'each'; timeoutMs?: number; signal?: AbortSignal }): Promise<Item[]>;
  llmChat(request: LlmChatRequest): Promise<LlmChatResponse>;
  llmEmbed(request: LlmEmbedRequest): Promise<LlmEmbedResponse>;
  runAgent(request: AgentRunRequest): Promise<AgentRunResult>;
  memory: {
    load(sessionId: string, limit: number): Promise<LlmMessage[]>;
    append(sessionId: string, messages: LlmMessage[]): Promise<void>;
    clear(sessionId: string): Promise<void>;
  };
  knowledge: {
    search(knowledgeBaseId: string, query: string, topK: number): Promise<KnowledgeMatch[]>;
    addText(knowledgeBaseId: string, name: string, text: string): Promise<{ documentId: string; chunks: number }>;
  };
  dataTables: {
    find(tableId: string, filters: DataTableFilter[], options?: { limit?: number }): Promise<Array<Record<string, unknown>>>;
    insert(tableId: string, rows: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>>;
    update(tableId: string, filters: DataTableFilter[], data: Record<string, unknown>): Promise<number>;
    upsert(tableId: string, matchColumn: string, row: Record<string, unknown>): Promise<Record<string, unknown>>;
    delete(tableId: string, filters: DataTableFilter[]): Promise<number>;
  };
  emitEvent(event: string, payload: Record<string, unknown>): Promise<number>;
  recordUsage(metric: 'AI_TOKENS', quantity: number): Promise<void>;
}

export interface ExecuteContext {
  node: WorkflowNodeDef;
  workflow: { id: string; name: string; workspaceId: string };
  execution: { id: string; mode: ExecutionMode };
  /** items received on each input port */
  inputs: Item[][];
  /** shorthand for inputs[port] ?? [] */
  getInputItems(port?: number): Item[];
  /** resolve a parameter (expressions evaluated against the given item) */
  getParam<T = unknown>(name: string, itemIndex?: number, fallback?: T): T;
  /** raw parameter value, expressions not resolved */
  getRawParam<T = unknown>(name: string): T;
  /** decrypted credential attached to the node */
  getCredential<T = Record<string, unknown>>(): Promise<ResolvedCredential<T>>;
  hasCredential(): boolean;
  /** SSRF-safe HTTP request */
  http<T = unknown>(options: HttpRequestOptions): Promise<HttpResponse<T>>;
  /** HTTP request authenticated with the node's credential */
  httpWithAuth<T = unknown>(options: HttpRequestOptions): Promise<HttpResponse<T>>;
  /** per-node state persisted across runs of the node within an execution (loops) */
  nodeState: Record<string, unknown>;
  /** workflow static data persisted across executions (trigger cursors) */
  staticData: Record<string, unknown>;
  runIndex: number;
  signal: AbortSignal;
  logger: Logger;
  services: RuntimeServices;
  /** continueOnFail is enabled for this node */
  continueOnFail: boolean;
}

export interface PollContext {
  node: WorkflowNodeDef;
  workflow: { id: string; name: string; workspaceId: string };
  getParam<T = unknown>(name: string, fallback?: T): T;
  getCredential<T = Record<string, unknown>>(): Promise<ResolvedCredential<T>>;
  http<T = unknown>(options: HttpRequestOptions): Promise<HttpResponse<T>>;
  httpWithAuth<T = unknown>(options: HttpRequestOptions): Promise<HttpResponse<T>>;
  /** persisted cursor for this trigger */
  state: Record<string, unknown>;
  /** true on the very first poll after activation: establish a cursor without emitting old items */
  isFirstPoll: boolean;
  logger: Logger;
  signal: AbortSignal;
}

export interface NodeDefinition extends NodeDescription {
  /** run the node. Trigger nodes default to passing their trigger items through. */
  execute?(ctx: ExecuteContext): Promise<NodeOutput>;
  /** polling triggers: return new items or null when nothing changed */
  poll?(ctx: PollContext): Promise<Item[] | null>;
}

export interface CredentialAuthResult {
  headers?: Record<string, string>;
  query?: Record<string, string>;
  /** replace the base URL (e.g. per-tenant domains) */
  baseUrl?: string;
}

export interface CredentialDefinition extends CredentialTypeDescription {
  /** apply authentication to an outgoing request */
  authenticate?(data: Record<string, unknown>): CredentialAuthResult;
  /** a request that should succeed when the credential is valid */
  test?(data: Record<string, unknown>, http: <T>(o: HttpRequestOptions) => Promise<HttpResponse<T>>): Promise<string | void>;
}

export type IntegrationDefinition = IntegrationDescription;
