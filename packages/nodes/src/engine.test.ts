import { describe, expect, it } from 'vitest';
import type { Item, WorkflowDefinition } from '@simplyai/shared';
import type { RuntimeServices } from '@simplyai/sdk';
import { WorkflowEngine, type NodeFinishedEvent } from '@simplyai/engine';
import { createDefaultRegistry } from './index';

const registry = createDefaultRegistry();

function services(overrides: Partial<RuntimeServices> = {}): RuntimeServices {
  return new Proxy(overrides as RuntimeServices, {
    get: (t, p: string) => (p in t ? (t as never)[p] : () => { throw new Error(`service ${p} not mocked`); }),
  });
}

function node(id: string, type: string, parameters: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return { id, name: id, type, position: { x: 0, y: 0 }, parameters, ...extra };
}
const edge = (source: string, target: string, sourceOutput = 0, targetInput = 0) => ({ source, target, sourceOutput, targetInput });

async function run(def: WorkflowDefinition, triggerItems?: Item[], opts: Partial<ConstructorParameters<typeof WorkflowEngine>[0]> = {}) {
  const events: NodeFinishedEvent[] = [];
  const engine = new WorkflowEngine({
    workflow: { id: 'wf', name: 'Test', workspaceId: 'ws' }, definition: def, execution: { id: 'ex', mode: 'MANUAL' },
    registry, services: services(), hooks: { nodeFinished: (e) => void events.push(e) }, ...opts,
  });
  const result = await engine.run({ triggerItems });
  return { result, events, engine };
}

describe('workflow engine', () => {
  it('runs a sequential chain and passes data', async () => {
    const { result } = await run({
      nodes: [node('t', 'simplyai.manualTrigger'), node('set', 'simplyai.set', { assignments: [{ name: 'greeting', type: 'string', value: 'Hi {{ $json.name }}' }] })],
      connections: [edge('t', 'set')],
    }, [{ json: { name: 'Ada' } }]);
    expect(result.status).toBe('SUCCESS');
    expect(result.output).toEqual([{ json: { name: 'Ada', greeting: 'Hi Ada' }, pairedItem: 0 }]);
  });

  it('branches with If and merges both branches (skipped branch does not block)', async () => {
    const def: WorkflowDefinition = {
      nodes: [
        node('t', 'simplyai.manualTrigger'),
        node('if', 'simplyai.if', { conditions: { combinator: 'and', conditions: [{ left: '{{ $json.amount }}', operator: 'gt', right: 100 }] } }),
        node('big', 'simplyai.set', { assignments: [{ name: 'tier', type: 'string', value: 'big' }] }),
        node('small', 'simplyai.set', { assignments: [{ name: 'tier', type: 'string', value: 'small' }] }),
        node('merge', 'simplyai.merge', { mode: 'append' }),
      ],
      connections: [edge('t', 'if'), edge('if', 'big', 0), edge('if', 'small', 1), edge('big', 'merge', 0, 0), edge('small', 'merge', 0, 1)],
    };
    const both = await run(def, [{ json: { amount: 500 } }, { json: { amount: 5 } }]);
    expect(both.result.output.map((i) => i.json.tier)).toEqual(['big', 'small']);
    const onlyBig = await run(def, [{ json: { amount: 500 } }]);
    expect(onlyBig.result.status).toBe('SUCCESS');
    expect(onlyBig.result.output.map((i) => i.json.tier)).toEqual(['big']);
    expect(onlyBig.events.find((e) => e.nodeId === 'small')).toBeUndefined();
  });

  it('routes with Switch including fallback', async () => {
    const { result } = await run({
      nodes: [
        node('t', 'simplyai.manualTrigger'),
        node('sw', 'simplyai.switch', { value: '{{ $json.s }}', rules: [{ output: 'A', operator: 'equals', compareTo: 'a' }] }),
        node('a', 'simplyai.set', { assignments: [{ name: 'route', type: 'string', value: 'A' }] }),
        node('fb', 'simplyai.set', { assignments: [{ name: 'route', type: 'string', value: 'fallback' }] }),
      ],
      connections: [edge('t', 'sw'), edge('sw', 'a', 0), edge('sw', 'fb', 1)],
    }, [{ json: { s: 'z' } }]);
    expect(result.output[0]!.json.route).toBe('fallback');
  });

  it('runs parallel branches concurrently', async () => {
    const def: WorkflowDefinition = {
      nodes: [node('t', 'simplyai.manualTrigger'), node('w1', 'simplyai.wait', { mode: 'interval', amount: 0.3, unit: 'seconds' }), node('w2', 'simplyai.wait', { mode: 'interval', amount: 0.3, unit: 'seconds' }), node('m', 'simplyai.merge')],
      connections: [edge('t', 'w1'), edge('t', 'w2'), edge('w1', 'm', 0, 0), edge('w2', 'm', 0, 1)],
    };
    const started = Date.now();
    const { result } = await run(def);
    expect(result.status).toBe('SUCCESS');
    expect(result.output).toHaveLength(2);
    expect(Date.now() - started).toBeLessThan(550);
  });

  it('loops over items in batches and emits collected results on done', async () => {
    const { result, events } = await run({
      nodes: [
        node('t', 'simplyai.manualTrigger'),
        node('loop', 'simplyai.loop', { batchSize: 2 }),
        node('body', 'simplyai.set', { assignments: [{ name: 'doubled', type: 'number', value: '{{ $json.n * 2 }}' }] }),
        node('after', 'simplyai.aggregate', { operation: 'field', field: 'doubled', target: 'values' }),
      ],
      connections: [edge('t', 'loop'), edge('loop', 'body', 1), edge('body', 'loop'), edge('loop', 'after', 0)],
    }, [1, 2, 3, 4, 5].map((n) => ({ json: { n } })));
    expect(result.status).toBe('SUCCESS');
    expect(result.output[0]!.json.values).toEqual([2, 4, 6, 8, 10]);
    expect(events.filter((e) => e.nodeId === 'body')).toHaveLength(3);
  });

  it('retries failing nodes and continues on fail', async () => {
    const def: WorkflowDefinition = {
      nodes: [
        node('t', 'simplyai.manualTrigger'),
        node('bad', 'simplyai.jsonParse', { field: 'raw' }, { settings: { retry: { enabled: true, maxTries: 2, waitBetweenMs: 10 }, continueOnFail: true } }),
        node('next', 'simplyai.set', { assignments: [{ name: 'after', type: 'boolean', value: 'true' }] }),
      ],
      connections: [edge('t', 'bad'), edge('bad', 'next')],
    };
    const { result, events } = await run(def, [{ json: { raw: '{not json' } }]);
    expect(result.status).toBe('SUCCESS');
    const bad = events.find((e) => e.nodeId === 'bad')!;
    expect(bad.attempts).toBe(2);
    expect(bad.status).toBe('FAILED');
    expect(result.output[0]!.json.after).toBe(true);
    expect((result.output[0]!.json.error as { message: string }).message).toMatch(/valid JSON/);
  });

  it('fails the execution and runs the in-workflow error handler', async () => {
    const { result, events } = await run({
      nodes: [
        node('t', 'simplyai.manualTrigger'),
        node('bad', 'simplyai.jsonParse', { field: 'raw' }),
        node('never', 'simplyai.set', { assignments: [] }),
        node('onError', 'simplyai.errorTrigger'),
        node('report', 'simplyai.set', { assignments: [{ name: 'alert', type: 'string', value: 'Failed at {{ $json.node.name }}' }] }),
      ],
      connections: [edge('t', 'bad'), edge('bad', 'never'), edge('onError', 'report')],
    }, [{ json: { raw: 'oops' } }]);
    expect(result.status).toBe('FAILED');
    expect(result.error?.nodeName).toBe('bad');
    expect(events.find((e) => e.nodeId === 'never')).toBeUndefined();
    expect(events.find((e) => e.nodeId === 'report')?.outputs?.[0]?.[0]?.json.alert).toBe('Failed at bad');
  });

  it('times out slow nodes', async () => {
    const { result } = await run({
      nodes: [node('t', 'simplyai.manualTrigger'), node('slow', 'simplyai.wait', { mode: 'interval', amount: 5, unit: 'seconds' }, { settings: { timeoutMs: 100 } })],
      connections: [edge('t', 'slow')],
    });
    expect(result.status).toBe('FAILED');
    expect(result.error?.message).toMatch(/timed out/);
  });

  it('can be cancelled', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const { result } = await run({
      nodes: [node('t', 'simplyai.manualTrigger'), node('slow', 'simplyai.wait', { mode: 'interval', amount: 5, unit: 'seconds' })],
      connections: [edge('t', 'slow')],
    }, undefined, { signal: ac.signal });
    expect(result.status).toBe('CANCELLED');
  });

  it('persists long waits and resumes, and supports human approval', async () => {
    const def: WorkflowDefinition = {
      nodes: [
        node('t', 'simplyai.manualTrigger'),
        node('approve', 'simplyai.approval', { message: 'ok?' }),
        node('yes', 'simplyai.set', { assignments: [{ name: 'result', type: 'string', value: 'approved' }] }),
        node('no', 'simplyai.set', { assignments: [{ name: 'result', type: 'string', value: 'rejected' }] }),
      ],
      connections: [edge('t', 'approve'), edge('approve', 'yes', 0), edge('approve', 'no', 1)],
    };
    const first = await run(def, [{ json: { id: 1 } }]);
    expect(first.result.status).toBe('WAITING');
    const state = JSON.parse(JSON.stringify(first.result.state));
    const engine2 = new WorkflowEngine({ workflow: { id: 'wf', name: 'T', workspaceId: 'ws' }, definition: def, execution: { id: 'ex', mode: 'MANUAL' }, registry, services: services() });
    const resumed = await engine2.resume(state, { approved: false });
    expect(resumed.status).toBe('SUCCESS');
    expect(resumed.output[0]!.json.result).toBe('rejected');
    expect((resumed.output[0]!.json.approval as { approved: boolean }).approved).toBe(false);

    const waitDef: WorkflowDefinition = { nodes: [node('t', 'simplyai.manualTrigger'), node('w', 'simplyai.wait', { mode: 'interval', amount: 2, unit: 'hours' }), node('after', 'simplyai.set', { assignments: [{ name: 'done', type: 'boolean', value: 'true' }] })], connections: [edge('t', 'w'), edge('w', 'after')] };
    const waiting = await run(waitDef);
    expect(waiting.result.status).toBe('WAITING');
    expect(new Date(waiting.result.waitUntil!).getTime()).toBeGreaterThan(Date.now() + 3_600_000);
    const e3 = new WorkflowEngine({ workflow: { id: 'wf', name: 'T', workspaceId: 'ws' }, definition: waitDef, execution: { id: 'ex', mode: 'MANUAL' }, registry, services: services() });
    expect((await e3.resume(JSON.parse(JSON.stringify(waiting.result.state)))).output[0]!.json.done).toBe(true);
  });

  it('stops workflow with error via Stop node', async () => {
    const { result } = await run({
      nodes: [node('t', 'simplyai.manualTrigger'), node('stop', 'simplyai.stop', { status: 'error', message: 'Invalid order {{ $json.id }}' }), node('after', 'simplyai.set', {})],
      connections: [edge('t', 'stop'), edge('stop', 'after')],
    }, [{ json: { id: 7 } }]);
    expect(result.status).toBe('FAILED');
    expect(result.error?.message).toBe('Invalid order 7');
  });

  it('resolves $() references to other nodes, variables and secrets', async () => {
    const { result } = await run({
      nodes: [
        node('t', 'simplyai.manualTrigger'),
        node('first', 'simplyai.set', { assignments: [{ name: 'x', type: 'number', value: '41' }] }),
        node('second', 'simplyai.set', { keepOnlySet: true, assignments: [{ name: 'y', type: 'number', value: "{{ $('first').item.json.x + 1 }}" }, { name: 'region', type: 'string', value: '{{ $vars.REGION }}' }, { name: 'auth', type: 'string', value: 'Bearer {{ $secrets.TOKEN }}' }] }),
      ],
      connections: [edge('t', 'first'), edge('first', 'second')],
    }, undefined, { variables: { REGION: 'eu' }, secrets: { TOKEN: 'abc123' } });
    expect(result.output[0]!.json).toEqual({ y: 42, region: 'eu', auth: 'Bearer abc123' });
  });

  it('runs only ancestors of a destination node (run to here)', async () => {
    const def: WorkflowDefinition = {
      nodes: [node('t', 'simplyai.manualTrigger'), node('a', 'simplyai.set', {}), node('b', 'simplyai.set', {}), node('c', 'simplyai.set', {})],
      connections: [edge('t', 'a'), edge('a', 'b'), edge('t', 'c')],
    };
    const events: string[] = [];
    const engine = new WorkflowEngine({ workflow: { id: 'wf', name: 'T', workspaceId: 'ws' }, definition: def, execution: { id: 'ex', mode: 'MANUAL' }, registry, services: services(), hooks: { nodeFinished: (e) => void events.push(e.nodeId) } });
    await engine.run({ destinationNodeId: 'a' });
    expect(events).toEqual(['t', 'a']);
  });

  it('executes code via the sandbox service', async () => {
    const svc = services({ runCode: async (_code, items) => items.map((i) => ({ json: { ...i.json, viaSandbox: true } })) });
    const engine = new WorkflowEngine({
      workflow: { id: 'wf', name: 'T', workspaceId: 'ws' }, execution: { id: 'ex', mode: 'MANUAL' }, registry, services: svc,
      definition: { nodes: [node('t', 'simplyai.manualTrigger'), node('code', 'simplyai.code', { code: 'return items' })], connections: [edge('t', 'code')] },
    });
    const r = await engine.run();
    expect(r.output[0]!.json.viaSandbox).toBe(true);
  });

  it('passes disabled nodes through', async () => {
    const { result } = await run({
      nodes: [node('t', 'simplyai.manualTrigger'), node('x', 'simplyai.set', { keepOnlySet: true, assignments: [] }, { disabled: true })],
      connections: [edge('t', 'x')],
    }, [{ json: { keep: 1 } }]);
    expect(result.output[0]!.json).toEqual({ keep: 1 });
  });
});
