#!/usr/bin/env node
/**
 * Dependency-free load test.
 *   node tests/load/run.mjs --url http://localhost:4000/webhook/demo-leads --method POST --body '{"name":"x","email":"x@y.co"}' --duration 30 --concurrency 50
 * Prints throughput and latency percentiles; exits non-zero if the error rate exceeds --max-error-rate (default 1%).
 */
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? 'true' : arr[i + 1]]] : acc), []));
const url = args.url ?? 'http://localhost:4000/api/v1/health';
const method = (args.method ?? 'GET').toUpperCase();
const body = args.body;
const duration = Number(args.duration ?? 15) * 1000;
const concurrency = Number(args.concurrency ?? 20);
const maxErrorRate = Number(args['max-error-rate'] ?? 0.01);
const headers = { 'content-type': 'application/json', ...(args.header ? Object.fromEntries([args.header.split(/:\s*/)]) : {}) };

const latencies = [];
const statuses = new Map();
let errors = 0;
const end = Date.now() + duration;

async function worker() {
  while (Date.now() < end) {
    const t = performance.now();
    try {
      const res = await fetch(url, { method, headers, body: method === 'GET' ? undefined : body });
      await res.arrayBuffer();
      statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
      if (res.status >= 500) errors++;
    } catch {
      errors++;
      statuses.set('network', (statuses.get('network') ?? 0) + 1);
    }
    latencies.push(performance.now() - t);
  }
}

console.log(`Load test: ${method} ${url} · ${concurrency} concurrent · ${duration / 1000}s`);
const started = Date.now();
await Promise.all(Array.from({ length: concurrency }, worker));
const elapsed = (Date.now() - started) / 1000;
latencies.sort((a, b) => a - b);
const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))]?.toFixed(1);
const total = latencies.length;
console.log(`requests: ${total} · throughput: ${(total / elapsed).toFixed(1)} req/s`);
console.log(`latency ms: p50 ${pct(50)} · p90 ${pct(90)} · p99 ${pct(99)} · max ${latencies.at(-1)?.toFixed(1)}`);
console.log('status codes:', Object.fromEntries(statuses));
const rate = total ? errors / total : 1;
console.log(`error rate: ${(rate * 100).toFixed(2)}%`);
process.exit(rate > maxErrorRate ? 1 : 0);
