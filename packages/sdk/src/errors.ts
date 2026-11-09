import type { SerializedError } from '@simplyai/shared';

/** Error raised by a node because of invalid configuration or data. */
export class NodeOperationError extends Error {
  override name = 'NodeOperationError';
  constructor(
    message: string,
    public readonly options: { description?: string; itemIndex?: number; context?: Record<string, unknown> } = {},
  ) {
    super(message);
  }
}

/** Error returned by a remote API. */
export class NodeApiError extends Error {
  override name = 'NodeApiError';
  constructor(
    message: string,
    public readonly httpCode?: number,
    public readonly responseBody?: unknown,
  ) {
    super(message);
  }
}

export class SsrfBlockedError extends Error {
  override name = 'SsrfBlockedError';
}

export class ExecutionCancelledError extends Error {
  override name = 'ExecutionCancelledError';
  constructor(message = 'Execution was cancelled') {
    super(message);
  }
}

export class NodeTimeoutError extends Error {
  override name = 'NodeTimeoutError';
}

export function serializeError(err: unknown, extra: Partial<SerializedError> = {}): SerializedError {
  if (err instanceof NodeApiError) {
    return {
      name: err.name,
      message: err.message,
      httpCode: err.httpCode,
      stack: err.stack,
      context: err.responseBody !== undefined ? { response: truncate(err.responseBody) } : undefined,
      ...extra,
    };
  }
  if (err instanceof NodeOperationError) {
    return { name: err.name, message: err.message, description: err.options.description, stack: err.stack, context: err.options.context, ...extra };
  }
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack, ...extra };
  return { name: 'Error', message: typeof err === 'string' ? err : JSON.stringify(err), ...extra };
}

function truncate(v: unknown): unknown {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s && s.length > 4_000) return s.slice(0, 4_000) + '…';
  return v;
}
