import { describe, expect, it } from 'vitest';
import { validateNodeParameters, testNode } from '@simplyai/sdk';
import { createDefaultRegistry, builtinIntegrations } from './index';
import { evaluateGroup } from './lib/conditions';
import { extractJson, validateSchema } from './lib/ai';

describe('registry', () => {
  const registry = createDefaultRegistry();
  it('registers every category of nodes', () => {
    const cats = new Set(registry.listNodes().map((n) => n.category));
    expect([...cats].sort()).toEqual(['ai', 'business', 'communication', 'developer', 'logic', 'transform', 'trigger']);
    expect(registry.listNodes().length).toBeGreaterThanOrEqual(70);
  });
  it('every node credential type exists', () => {
    for (const n of registry.listNodes()) for (const t of n.credentials?.types ?? []) expect(registry.getCredential(t), `${n.type} → ${t}`).toBeDefined();
  });
  it('integrations reference real nodes', () => {
    for (const i of builtinIntegrations) {
      for (const t of [...i.triggers, ...i.actions]) expect(registry.getNode(t)).toBeDefined();
      expect(i.triggers.length + i.actions.length, i.key).toBeGreaterThan(0);
    }
  });
  it('default parameters of nodes validate', () => {
    for (const n of registry.listNodes()) {
      const defaults = Object.fromEntries(n.properties.map((p) => [p.name, p.default]));
      const issues = validateNodeParameters(n, defaults).filter((i) => !/is required/.test(i.message));
      expect(issues, n.type).toEqual([]);
    }
  });
});

describe('helpers', () => {
  it('evaluates condition groups', () => {
    expect(evaluateGroup({ combinator: 'and', conditions: [{ left: 5, operator: 'gt', right: '3' }, { left: 'abc', operator: 'contains', right: 'b' }] })).toBe(true);
    expect(evaluateGroup({ combinator: 'or', conditions: [{ left: '', operator: 'isNotEmpty' }, { left: '2024-01-01', operator: 'before', right: '2025-01-01' }] })).toBe(true);
    expect(evaluateGroup({ conditions: [{ left: 'x', operator: 'regex', right: '/^X$/i' }] })).toBe(true);
  });
  it('extracts json from fenced model output and validates schema', () => {
    expect(extractJson('Sure!\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(validateSchema({ a: 'x' }, { type: 'object', properties: { a: { type: 'number' } }, required: ['b'] })).toHaveLength(2);
  });
});

describe('transform nodes', () => {
  const r = createDefaultRegistry();
  it('parses csv', async () => {
    const out = await testNode(r.requireNode('simplyai.csvParse'), { parameters: { field: 'csv' }, inputs: [[{ json: { csv: 'name,age\nAda,36\nAlan,41' } }]] });
    expect((out as never[][])[0]).toEqual([{ json: { name: 'Ada', age: 36 }, pairedItem: 0 }, { json: { name: 'Alan', age: 41 }, pairedItem: 0 }]);
  });
  it('converts xml', async () => {
    const out = await testNode(r.requireNode('simplyai.xml'), { parameters: { field: 'xml', target: 'data' }, inputs: [[{ json: { xml: '<order id="1"><total>9</total></order>' } }]] });
    expect((out as Array<Array<{ json: { data: unknown } }>>)[0]![0]!.json.data).toEqual({ order: { total: 9, '@_id': '1' } });
  });
  it('edits fields', async () => {
    const out = await testNode(r.requireNode('simplyai.editFields'), { parameters: { operations: [{ action: 'rename', field: 'a', newName: 'b.c' }, { action: 'remove', field: 'x' }] }, inputs: [[{ json: { a: 1, x: 2 } }]] });
    expect((out as Array<Array<{ json: unknown }>>)[0]![0]!.json).toEqual({ b: { c: 1 } });
  });
  it('sorts, dedupes and limits', async () => {
    const out = await testNode(r.requireNode('simplyai.sort'), { parameters: { field: 'n', order: 'desc', dedupeField: 'n', limit: 2 }, inputs: [[{ json: { n: 1 } }, { json: { n: 3 } }, { json: { n: 3 } }, { json: { n: 2 } }]] });
    expect((out as Array<Array<{ json: { n: number } }>>)[0]!.map((i) => i.json.n)).toEqual([3, 2]);
  });
});
