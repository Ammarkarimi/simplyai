import { describe, expect, it } from 'vitest';
import { runInSandbox } from './sandbox';

const items = [{ json: { a: 1 } }, { json: { a: 2 } }];

describe('code sandbox', () => {
  it('runs code for all items', async () => {
    const r = await runInSandbox('console.log("hi", items.length); return items.map(i => ({ json: { b: i.json.a * 10 } }))', items, { mode: 'all' });
    expect(r.items).toEqual([{ json: { b: 10 } }, { json: { b: 20 } }]);
    expect(r.logs).toEqual(['hi 2']);
  });
  it('runs code per item and supports async', async () => {
    const r = await runInSandbox('await new Promise(r => setTimeout(r, 1)); return { doubled: $json.a * 2 }', items, { mode: 'each' }).catch((e) => e);
    // timers do not exist in the sandbox: the error is reported as a normal code error
    expect(String(r.message ?? '')).toMatch(/setTimeout is not defined/);
    const ok = await runInSandbox('return { doubled: $json.a * 2, i: $itemIndex }', items, { mode: 'each' });
    expect(ok.items).toEqual([{ json: { doubled: 2, i: 0 } }, { json: { doubled: 4, i: 1 } }]);
  });
  it('has no access to process, require or the host realm', async () => {
    for (const code of [
      'return { v: typeof process }',
      'return { v: typeof require }',
    ]) expect((await runInSandbox(code, items, { mode: 'all' })).items[0]!.json.v).toBe('undefined');
    await expect(runInSandbox('return eval("1+1")', items, { mode: 'all' })).rejects.toThrow(/Code generation from strings disallowed|EvalError/);
    await expect(runInSandbox('return this.constructor.constructor("return process")()', items, { mode: 'all' })).rejects.toThrow();
    await expect(runInSandbox('return console.log.constructor("return process")()', items, { mode: 'all' })).rejects.toThrow();
  });
  it('enforces timeouts and memory limits', async () => {
    await expect(runInSandbox('while (true) {}', items, { mode: 'all', timeoutMs: 300 })).rejects.toThrow(/timed out/);
    await expect(runInSandbox('const a = []; while (true) a.push(new Array(1e6).fill(1));', items, { mode: 'all', timeoutMs: 20000, memoryMb: 32 })).rejects.toThrow(/memory|exited/);
  }, 30000);
  it('reports user errors', async () => {
    await expect(runInSandbox('throw new Error("boom")', items, { mode: 'all' })).rejects.toThrow('Error: boom');
  });
});
