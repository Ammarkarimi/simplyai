/** Fetch wrapper for the SimplyAI API (same origin, cookie session + CSRF header). */
import { useWorkspaceStore } from '@/stores/workspace';

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly body: Record<string, unknown> = {}) {
    super(message);
  }
}

function cookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))?.split('=')[1];
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  form?: FormData;
  workspace?: string | null;
  raw?: boolean;
}

export async function api<T = any>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(`/api/v1${path}`, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  const headers: Record<string, string> = {};
  const ws = opts.workspace === undefined ? useWorkspaceStore.getState().workspaceId : opts.workspace;
  if (ws) headers['x-workspace-id'] = ws;
  const method = opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET');
  if (method !== 'GET') headers['x-csrf-token'] = decodeURIComponent(cookie('sai_csrf') ?? '');
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(url.pathname + url.search, { method, headers, body, credentials: 'include' });
  if (opts.raw) {
    if (!res.ok) throw new ApiError(`Request failed (${res.status})`, res.status);
    return res as unknown as T;
  }
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return { message: text }; } })() : null;
  if (!res.ok) throw new ApiError((data && (data.message as string)) || `Request failed (${res.status})`, res.status, data ?? {});
  return data as T;
}

export const get = <T = any>(path: string, query?: RequestOptions['query']) => api<T>(path, { query });
export const post = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const patch = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body: body ?? {} });
export const del = <T = any>(path: string, query?: RequestOptions['query']) => api<T>(path, { method: 'DELETE', query });

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}
