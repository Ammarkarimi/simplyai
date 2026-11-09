import type { Item } from '@simplyai/shared';
import { NodeOperationError } from './errors';

/** Wrap plain objects into items. */
export function toItems(data: unknown, pairedItem?: number): Item[] {
  if (data === undefined || data === null) return [];
  const arr = Array.isArray(data) ? data : [data];
  return arr.map((d) => ({ json: isPlainObject(d) ? (d as Record<string, unknown>) : { value: d }, ...(pairedItem !== undefined ? { pairedItem } : {}) }));
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}

/** Read a dotted path such as "user.address.city" or "items[0].id". */
export function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.replace(/\[(\w+)\]/g, '.$1').split('.').filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (p === '__proto__' || p === 'constructor' || p === 'prototype') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Write a dotted path, creating intermediate objects. */
export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.replace(/\[(\w+)\]/g, '.$1').split('.').filter(Boolean);
  if (parts.some((p) => p === '__proto__' || p === 'constructor' || p === 'prototype')) throw new NodeOperationError(`Invalid field path "${path}"`);
  let cur: Record<string, unknown> = obj;
  parts.forEach((p, i) => {
    if (i === parts.length - 1) cur[p] = value;
    else {
      if (!isPlainObject(cur[p]) && !Array.isArray(cur[p])) cur[p] = {};
      cur = cur[p] as Record<string, unknown>;
    }
  });
}

export function deletePath(obj: Record<string, unknown>, path: string): void {
  const parts = path.split('.');
  const last = parts.pop()!;
  const parent = parts.length ? getPath(obj, parts.join('.')) : obj;
  if (parent && typeof parent === 'object') delete (parent as Record<string, unknown>)[last];
}

export function parseJsonParam(value: unknown, name: string): unknown {
  if (typeof value !== 'string') return value;
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    throw new NodeOperationError(`Parameter "${name}" is not valid JSON`);
  }
}

export function keyValueToObject(entries: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(entries)) {
    for (const e of entries as Array<{ key?: unknown; name?: unknown; value?: unknown }>) {
      const k = String(e.key ?? e.name ?? '').trim();
      if (k) out[k] = e.value === undefined || e.value === null ? '' : typeof e.value === 'string' ? e.value : JSON.stringify(e.value);
    }
  } else if (isPlainObject(entries)) {
    for (const [k, v] of Object.entries(entries)) out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

export function deepClone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('Aborted'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason ?? new Error('Aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
