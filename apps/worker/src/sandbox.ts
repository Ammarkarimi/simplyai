/**
 * Runs user JavaScript in a separate Node.js process:
 *  - empty environment (no secrets), Node permission model when available
 *  - vm context without require/process, eval and Function disabled
 *  - data crosses the boundary only as JSON
 *  - memory cap (--max-old-space-size), wall clock timeout (SIGKILL), output size cap
 */
import { spawn, spawnSync } from 'node:child_process';
import type { Item } from '@simplyai/shared';
import { env } from '@simplyai/core';

const RUNNER = String.raw`
const vm = require('node:vm');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', async () => {
  const send = (o) => process.stdout.write('\u0000RESULT' + JSON.stringify(o) + '\n', () => process.exit(0));
  try {
    const { code, mode, timeoutMs } = JSON.parse(input);
    const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false }, name: 'simplyai-sandbox' });
    vm.runInContext('globalThis.__payload = ' + JSON.stringify(input) + ';', context);
    const prelude = [
      'const __in = JSON.parse(globalThis.__payload); delete globalThis.__payload;',
      'const __logs = [];',
      'const __fmt = (a) => a.map((x) => { try { return typeof x === "string" ? x : JSON.stringify(x); } catch { return String(x); } }).join(" ");',
      'const console = { log: (...a) => __logs.push(__fmt(a)), info: (...a) => __logs.push(__fmt(a)), warn: (...a) => __logs.push("[warn] " + __fmt(a)), error: (...a) => __logs.push("[error] " + __fmt(a)) };',
      'const items = __in.items; const $vars = Object.freeze(__in.vars || {});',
      'const $input = { all: () => items, first: () => items[0], last: () => items[items.length - 1], item: items[0] };',
    ].join('\n');
    const body = mode === 'each'
      ? 'const __out = []; for (let __i = 0; __i < items.length; __i++) { const item = items[__i]; const $json = item.json; const $itemIndex = __i; const __r = await (async () => {' + code + '\n})(); if (__r !== undefined && __r !== null) __out.push(__r); } return __out;'
      : 'const $json = items[0] ? items[0].json : {}; ' + code;
    const script = new vm.Script(prelude + '\n(async () => { const __result = await (async () => {' + body + '\n})(); return JSON.stringify({ result: __result === undefined ? null : __result, logs: __logs.slice(0, 200) }); })()', { filename: 'code.js' });
    const promise = script.runInContext(context, { timeout: timeoutMs, breakOnSigint: true });
    const json = await promise;
    send({ ok: true, payload: json });
  } catch (err) {
    send({ ok: false, error: { name: err && err.name, message: String(err && err.message || err), stack: String(err && err.stack || '').split('\n').filter((l) => l.includes('code.js')).join('\n') } });
  }
});
`;

let permissionFlag: string[] | null = null;
function permissionArgs(): string[] {
  if (permissionFlag) return permissionFlag;
  for (const flag of ['--permission', '--experimental-permission']) {
    const r = spawnSync(process.execPath, [flag, '-e', '0'], { env: {}, timeout: 5000 });
    if (r.status === 0) return (permissionFlag = [flag]);
  }
  return (permissionFlag = []);
}

export class SandboxError extends Error {
  override name = 'CodeError';
}

export interface SandboxOptions {
  mode: 'all' | 'each';
  timeoutMs?: number;
  memoryMb?: number;
  vars?: Record<string, string>;
  signal?: AbortSignal;
}

const MAX_OUTPUT = 20 * 1024 * 1024;

export function runInSandbox(code: string, items: Item[], opts: SandboxOptions): Promise<{ items: Item[]; logs: string[] }> {
  const timeoutMs = Math.min(opts.timeoutMs ?? env.sandboxTimeoutMs, 300_000);
  const memoryMb = opts.memoryMb ?? env.sandboxMemoryMb;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...permissionArgs(), `--max-old-space-size=${memoryMb}`, '--disallow-code-generation-from-strings', '-e', RUNNER], {
      env: {}, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    let out = '';
    let err = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (child.exitCode === null) child.kill('SIGKILL');
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new SandboxError(`Code execution timed out after ${timeoutMs}ms`))), timeoutMs + 1000);
    const onAbort = () => finish(() => reject(new SandboxError('Code execution was cancelled')));
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (c: Buffer) => {
      out += c.toString('utf8');
      if (out.length > MAX_OUTPUT) finish(() => reject(new SandboxError('Code output exceeded 20MB')));
    });
    child.stderr.on('data', (c: Buffer) => (err += c.toString('utf8').slice(0, 10_000)));
    child.on('error', (e) => finish(() => reject(e)));
    child.on('close', (codeExit, sig) => {
      finish(() => {
        const marker = out.lastIndexOf('\u0000RESULT');
        if (marker < 0) {
          const oom = /heap out of memory|Allocation failed/i.test(err);
          return reject(new SandboxError(oom ? `Code exceeded the ${memoryMb}MB memory limit` : `Code process exited unexpectedly (${sig ?? codeExit})${err ? `: ${err.split('\n')[0]}` : ''}`));
        }
        let parsed: { ok: boolean; payload?: string; error?: { name: string; message: string; stack?: string } };
        try {
          parsed = JSON.parse(out.slice(marker + 7));
        } catch {
          return reject(new SandboxError('Code returned an invalid result'));
        }
        if (!parsed.ok) {
          const e = new SandboxError(`${parsed.error?.name ?? 'Error'}: ${parsed.error?.message}`);
          e.stack = parsed.error?.stack;
          return reject(e);
        }
        const { result, logs } = JSON.parse(parsed.payload!) as { result: unknown; logs: string[] };
        resolve({ items: normalize(result), logs });
      });
    });
    child.stdin.end(JSON.stringify({ code, mode: opts.mode, timeoutMs, items, vars: opts.vars ?? {} }));
  });
}

function normalize(result: unknown): Item[] {
  if (result === null || result === undefined) return [];
  const arr = Array.isArray(result) ? result : [result];
  return arr.map((r) => {
    if (r && typeof r === 'object' && !Array.isArray(r) && 'json' in r && typeof (r as Item).json === 'object') return { json: (r as Item).json, ...((r as Item).binary ? { binary: (r as Item).binary } : {}) };
    if (r && typeof r === 'object' && !Array.isArray(r)) return { json: r as Record<string, unknown> };
    return { json: { value: r } };
  });
}
