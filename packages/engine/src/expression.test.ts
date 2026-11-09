import { describe, expect, it } from 'vitest';
import { evaluateExpression, resolveDeep, resolveTemplate } from './expression';
import { createRedactor } from './redact';

const ctx = { $json: { name: 'Ada', items: [{ id: 1, price: 10 }, { id: 2, price: 5 }], nested: { a: { b: 'deep' } } }, $vars: { REGION: 'eu' } };

describe('expressions', () => {
  it('reads paths and returns raw values for single expressions', () => {
    expect(resolveTemplate('{{ $json.name }}', ctx)).toBe('Ada');
    expect(resolveTemplate('{{ $json.items }}', ctx)).toEqual(ctx.$json.items);
    expect(resolveTemplate('Hello {{ $json.name }} from {{ $vars.REGION }}', ctx)).toBe('Hello Ada from eu');
  });
  it('supports arithmetic, ternary, arrow functions and methods', () => {
    expect(evaluateExpression('$json.items.map(i => i.price).reduce((a, b) => a + b, 0)', ctx)).toBe(15);
    expect(evaluateExpression('$json.name.toUpperCase() + "!"', ctx)).toBe('ADA!');
    expect(evaluateExpression('$json.items.length > 1 ? "many" : "one"', ctx)).toBe('many');
    expect(evaluateExpression('$json.missing?.value ?? "fallback"', ctx)).toBe('fallback');
    expect(evaluateExpression('`${$json.name}-${1 + 1}`', ctx)).toBe('Ada-2');
    expect(evaluateExpression('({ a: 1, b: [1, 2] }).b.length', ctx)).toBe(2);
    expect(evaluateExpression('Math.max(1, 5, 3)', ctx)).toBe(5);
    expect(evaluateExpression('JSON.stringify($json.nested.a)', ctx)).toBe('{"b":"deep"}');
  });
  it('blocks prototype and global access', () => {
    expect(() => evaluateExpression('$json.constructor', ctx)).toThrow(/not allowed/);
    expect(() => evaluateExpression('$json.name.constructor("return process")()', ctx)).toThrow();
    expect(() => evaluateExpression('$json["__proto__"]', ctx)).toThrow(/not allowed/);
    expect(() => evaluateExpression('process.env', ctx)).toThrow(/not defined/);
    expect(() => evaluateExpression('globalThis', ctx)).toThrow(/not defined/);
    expect(() => evaluateExpression('require("fs")', ctx)).toThrow(/not defined/);
    expect(() => evaluateExpression('$json.name.__defineGetter__', ctx)).toThrow(/not allowed/);
    expect(() => evaluateExpression('"a".repeat(100000000)', ctx)).toThrow(/too long/);
  });
  it('resolves nested parameter objects', () => {
    expect(resolveDeep({ a: '{{ $json.name }}', b: ['{{ 1 + 1 }}', 'x'] }, ctx)).toEqual({ a: 'Ada', b: [2, 'x'] });
  });
  it('formats dates', () => {
    expect(evaluateExpression('$date.format("2024-03-05T10:20:00Z", "YYYY/MM/DD HH:mm")', ctx)).toBe('2024/03/05 10:20');
    expect(evaluateExpression('$date.add("2024-01-31T00:00:00Z", 1, "day")', ctx)).toBe('2024-02-01T00:00:00.000Z');
  });
});

describe('redactor', () => {
  it('replaces secret values deeply', () => {
    const r = createRedactor(['supersecret', 'abc']);
    expect(r({ a: 'token supersecret', b: ['supersecret'], c: 'abc' })).toEqual({ a: 'token [REDACTED]', b: ['[REDACTED]'], c: 'abc' });
  });
});
