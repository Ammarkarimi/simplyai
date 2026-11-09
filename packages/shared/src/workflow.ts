/** Core workflow definition types shared by the editor, API, engine and SDK. */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface BinaryData {
  fileName?: string;
  mimeType: string;
  /** base64 encoded payload (small files) */
  data?: string;
  /** reference to object storage (large files) */
  storageKey?: string;
  size?: number;
}

export interface Item {
  json: Record<string, unknown>;
  binary?: Record<string, BinaryData>;
  /** index of the input item this item was derived from */
  pairedItem?: number;
}

export interface NodeRetrySettings {
  enabled: boolean;
  maxTries: number;
  waitBetweenMs: number;
  backoff?: 'fixed' | 'exponential';
}

export interface NodeSettings {
  retry?: NodeRetrySettings;
  timeoutMs?: number;
  continueOnFail?: boolean;
  /** when continuing on fail, route errors to a dedicated "error" output */
  errorOutput?: boolean;
  alwaysOutputData?: boolean;
  executeOnce?: boolean;
}

export interface WorkflowNodeDef {
  /** stable identifier (nodeKey) */
  id: string;
  name: string;
  type: string;
  typeVersion?: number;
  position: { x: number; y: number };
  parameters: Record<string, unknown>;
  credentialId?: string | null;
  disabled?: boolean;
  notes?: string | null;
  settings?: NodeSettings;
}

export interface WorkflowConnectionDef {
  id?: string;
  source: string;
  sourceOutput: number;
  target: string;
  targetInput: number;
}

export interface WorkflowSettings {
  timeoutMs?: number;
  errorWorkflowId?: string | null;
  timezone?: string;
  saveSuccessfulExecutions?: boolean;
  /** maximum concurrently running nodes inside one execution */
  maxParallelism?: number;
}

export interface WorkflowAnnotation {
  id: string;
  text: string;
  color?: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
}

export interface WorkflowGroup {
  id: string;
  label: string;
  color?: string;
  position: { x: number; y: number };
  width: number;
  height: number;
}

export interface WorkflowMeta {
  annotations?: WorkflowAnnotation[];
  groups?: WorkflowGroup[];
  viewport?: { x: number; y: number; zoom: number };
}

export interface WorkflowDefinition {
  nodes: WorkflowNodeDef[];
  connections: WorkflowConnectionDef[];
  settings?: WorkflowSettings;
  meta?: WorkflowMeta;
}

export const EXECUTION_STATUSES = ['QUEUED', 'RUNNING', 'WAITING', 'SUCCESS', 'FAILED', 'CANCELLED'] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const EXECUTION_MODES = [
  'MANUAL', 'TRIGGER', 'WEBHOOK', 'SCHEDULE', 'POLL', 'FORM', 'CHAT', 'EVENT', 'API', 'RETRY', 'SUBWORKFLOW', 'ERROR',
] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export type NodeRunStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'WAITING' | 'CANCELLED';

export interface SerializedError {
  message: string;
  name?: string;
  stack?: string;
  nodeId?: string;
  nodeName?: string;
  httpCode?: number;
  description?: string;
  context?: Record<string, unknown>;
}
