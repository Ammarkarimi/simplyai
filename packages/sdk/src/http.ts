/**
 * Outbound HTTP client used by every node. Protects against SSRF by validating
 * every resolved IP address at connect time (including redirects), enforces
 * timeouts and response size limits.
 */
import dns from 'node:dns';
import net from 'node:net';
import { Agent, fetch as undiciFetch, FormData } from 'undici';
import { NodeApiError, SsrfBlockedError } from './errors';

const blockList = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blockList.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96]] as const)
  blockList.addSubnet(addr, prefix, 'ipv6');

export function privateNetworkAllowed(): boolean {
  return process.env.ALLOW_PRIVATE_NETWORK === 'true';
}

export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return false;
  if (family === 6) {
    const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return blockList.check(mapped[1]!, 'ipv4');
    return blockList.check(address, 'ipv6');
  }
  return blockList.check(address, 'ipv4');
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

function safeLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '');
    const list = addresses as dns.LookupAddress[];
    if (!privateNetworkAllowed()) {
      const bad = list.find((a) => isBlockedAddress(a.address));
      if (bad) return callback(new SsrfBlockedError(`Request to ${hostname} (${bad.address}) is blocked: private network address`), '');
    }
    if (options.all) return callback(null, list);
    const first = list[0];
    if (!first) return callback(new Error(`Could not resolve ${hostname}`) as NodeJS.ErrnoException, '');
    callback(null, first.address, first.family);
  });
}

let sharedAgent: Agent | undefined;
function agent(): Agent {
  sharedAgent ??= new Agent({
    connect: { lookup: safeLookup as never, timeout: 15_000 },
    keepAliveTimeout: 10_000,
    connections: 256,
  });
  return sharedAgent;
}

export function assertUrlAllowed(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SsrfBlockedError(`Protocol ${url.protocol} is not allowed`);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!privateNetworkAllowed()) {
    if (net.isIP(host) && isBlockedAddress(host)) throw new SsrfBlockedError(`Request to ${host} is blocked: private network address`);
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal'))
      throw new SsrfBlockedError(`Request to ${host} is blocked`);
  }
  return url;
}

export type HttpBody = string | Buffer | Uint8Array | URLSearchParams | FormData | Record<string, unknown> | unknown[] | null | undefined;

export interface HttpRequestOptions {
  url: string;
  method?: string;
  headers?: Record<string, string | undefined>;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: HttpBody;
  /** how to encode an object body (default json) */
  bodyType?: 'json' | 'form' | 'raw';
  responseType?: 'auto' | 'json' | 'text' | 'buffer';
  timeoutMs?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
  /** throw NodeApiError on status >= 400 (default true) */
  throwOnError?: boolean;
  signal?: AbortSignal;
}

export interface HttpResponse<T = unknown> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: T;
  url: string;
}

export const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

export async function httpRequest<T = unknown>(opts: HttpRequestOptions): Promise<HttpResponse<T>> {
  const url = assertUrlAllowed(opts.url);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null) url.searchParams.append(k, String(v));
  const method = (opts.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers ?? {})) if (v !== undefined) headers[k.toLowerCase()] = v;
  headers['user-agent'] ??= 'SimplyAI/1.0';

  let body: string | Buffer | Uint8Array | URLSearchParams | FormData | undefined;
  const b = opts.body;
  if (b !== undefined && b !== null && method !== 'GET' && method !== 'HEAD') {
    if (typeof b === 'string' || b instanceof Uint8Array || b instanceof URLSearchParams || b instanceof FormData) body = b as never;
    else if (opts.bodyType === 'form') {
      body = new URLSearchParams(Object.entries(b as Record<string, unknown>).map(([k, v]): [string, string] => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    } else {
      body = JSON.stringify(b);
      headers['content-type'] ??= 'application/json';
    }
  }

  const timeoutMs = opts.timeoutMs ?? 30_000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal;
  const maxRedirects = opts.maxRedirects ?? 5;

  let current = url;
  let res: Awaited<ReturnType<typeof undiciFetch>>;
  let redirects = 0;
  let currentMethod = method;
  let currentBody = body;
  for (;;) {
    try {
      res = await undiciFetch(current, { method: currentMethod, headers, body: currentBody as never, redirect: 'manual', signal, dispatcher: agent() });
    } catch (err) {
      const cause = (err as { cause?: unknown }).cause;
      if (cause instanceof SsrfBlockedError) throw cause;
      if (timeoutSignal.aborted) throw new NodeApiError(`Request timed out after ${timeoutMs}ms`);
      throw new NodeApiError(`Request failed: ${(cause as Error)?.message ?? (err as Error).message}`);
    }
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get('location') && redirects < maxRedirects) {
      redirects++;
      current = assertUrlAllowed(new URL(res.headers.get('location')!, current).toString());
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && currentMethod === 'POST')) {
        currentMethod = 'GET';
        currentBody = undefined;
      }
      await res.body?.cancel();
      continue;
    }
    break;
  }

  const buf = await readLimited(res, opts.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
  const respHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => (respHeaders[k] = v));
  const contentType = respHeaders['content-type'] ?? '';
  let parsed: unknown;
  const rt = opts.responseType ?? 'auto';
  if (rt === 'buffer') parsed = buf;
  else {
    const text = buf.toString('utf8');
    if (rt === 'json' || (rt === 'auto' && /json/i.test(contentType))) {
      try {
        parsed = text.length ? JSON.parse(text) : null;
      } catch {
        if (rt === 'json') throw new NodeApiError('Response is not valid JSON', res.status, text.slice(0, 500));
        parsed = text;
      }
    } else parsed = text;
  }
  if (res.status >= 400 && opts.throwOnError !== false) {
    throw new NodeApiError(`${method} ${current.host}${current.pathname} failed with status ${res.status}${describeApiError(parsed)}`, res.status, parsed);
  }
  return { status: res.status, statusText: res.statusText, headers: respHeaders, body: parsed as T, url: current.toString() };
}

async function readLimited(res: { body: ReadableStream<Uint8Array> | null }, max: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new NodeApiError(`Response exceeded the maximum size of ${max} bytes`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function describeApiError(body: unknown): string {
  if (!body) return '';
  if (typeof body === 'string') return `: ${body.slice(0, 200)}`;
  const b = body as Record<string, unknown>;
  const msg = b.message ?? (b.error as Record<string, unknown>)?.message ?? b.error_description ?? b.error ?? b.detail;
  return msg ? `: ${typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 200)}` : '';
}

export { FormData };
