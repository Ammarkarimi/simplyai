/**
 * Safe expression language used in node parameters: `{{ $json.email }}`.
 * Expressions are parsed with jsep and interpreted against a whitelist; there
 * is no eval/Function, no prototype access and no access to Node globals.
 */
import jsep from 'jsep';
import jsepArrow from '@jsep-plugin/arrow';
import jsepObject from '@jsep-plugin/object';
import jsepTemplate from '@jsep-plugin/template';

jsep.plugins.register(jsepArrow as never, jsepObject as never, jsepTemplate as never);

export class ExpressionError extends Error {
  override name = 'ExpressionError';
}

type Node = jsep.Expression & Record<string, unknown>;

const FORBIDDEN_PROPS = new Set([
  '__proto__', 'prototype', 'constructor', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__',
  'valueOf', 'call', 'apply', 'bind', 'caller', 'callee', 'arguments',
]);

const STRING_METHODS = new Set([
  'toUpperCase', 'toLowerCase', 'trim', 'trimStart', 'trimEnd', 'split', 'slice', 'substring', 'replace', 'replaceAll',
  'includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf', 'padStart', 'padEnd', 'charAt', 'concat', 'repeat',
  'at', 'toString', 'localeCompare', 'normalize', 'match', 'search',
]);
const ARRAY_METHODS = new Set([
  'map', 'filter', 'find', 'findIndex', 'some', 'every', 'join', 'slice', 'includes', 'indexOf', 'reduce', 'concat',
  'flat', 'flatMap', 'at', 'toSorted', 'toReversed', 'keys', 'values', 'entries', 'forEach', 'toString', 'lastIndexOf',
]);
const NUMBER_METHODS = new Set(['toFixed', 'toString', 'toPrecision', 'toLocaleString']);
const DATE_METHODS = new Set([
  'toISOString', 'getTime', 'getFullYear', 'getMonth', 'getDate', 'getDay', 'getHours', 'getMinutes', 'getSeconds',
  'getUTCFullYear', 'getUTCMonth', 'getUTCDate', 'getUTCDay', 'getUTCHours', 'getUTCMinutes', 'toLocaleDateString',
  'toLocaleTimeString', 'toLocaleString', 'toDateString', 'toString', 'valueOf',
]);

const MAX_STRING = 5_000_000;
const MAX_STEPS = 200_000;

/** Safe callables exposed to every expression. */
export const expressionGlobals: Record<string, unknown> = {
  Math: Object.freeze({
    abs: Math.abs, ceil: Math.ceil, floor: Math.floor, round: Math.round, max: Math.max, min: Math.min, pow: Math.pow,
    sqrt: Math.sqrt, random: Math.random, sign: Math.sign, trunc: Math.trunc, log: Math.log, log10: Math.log10, PI: Math.PI, E: Math.E,
  }),
  JSON: Object.freeze({ stringify: (v: unknown, _r?: unknown, s?: number) => JSON.stringify(v, null, s), parse: (s: string) => JSON.parse(s) }),
  Object: Object.freeze({
    keys: (o: object) => Object.keys(o ?? {}),
    values: (o: object) => Object.values(o ?? {}),
    entries: (o: object) => Object.entries(o ?? {}),
    fromEntries: (e: Iterable<[string, unknown]>) => Object.fromEntries(e),
    assign: (...objs: object[]) => Object.assign({}, ...objs),
  }),
  Array: Object.freeze({ isArray: Array.isArray, from: (v: Iterable<unknown>) => Array.from(v).slice(0, 100_000) }),
  Number: Object.assign((v: unknown) => Number(v), { isFinite: Number.isFinite, isInteger: Number.isInteger, parseFloat, parseInt }),
  String: (v: unknown) => String(v),
  Boolean: (v: unknown) => Boolean(v),
  parseInt: (v: string, r?: number) => parseInt(v, r),
  parseFloat: (v: string) => parseFloat(v),
  isNaN: (v: number) => Number.isNaN(Number(v)),
  encodeURIComponent,
  decodeURIComponent,
  encodeURI,
  Date: Object.freeze({ now: () => Date.now(), parse: (s: string) => Date.parse(s) }),
  undefined: undefined,
  $if: (cond: unknown, a: unknown, b: unknown) => (cond ? a : b),
  $ifEmpty: (v: unknown, d: unknown) => (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) ? d : v),
  $toDate: (v: string | number) => new Date(v),
  $date: Object.freeze({
    now: () => new Date().toISOString(),
    add: (d: string | number | Date, amount: number, unit: string) => addToDate(new Date(d), amount, unit).toISOString(),
    diff: (a: string | number | Date, b: string | number | Date, unit = 'ms') => diffDates(new Date(a), new Date(b), unit),
    format: (d: string | number | Date, fmt: string, timeZone?: string) => formatDate(new Date(d), fmt, timeZone),
    startOf: (d: string | number | Date, unit: string) => startOf(new Date(d), unit).toISOString(),
  }),
};

const UNIT_MS: Record<string, number> = { ms: 1, second: 1000, seconds: 1000, minute: 60_000, minutes: 60_000, hour: 3_600_000, hours: 3_600_000, day: 86_400_000, days: 86_400_000, week: 604_800_000, weeks: 604_800_000 };

export function addToDate(d: Date, amount: number, unit: string): Date {
  const r = new Date(d.getTime());
  if (unit.startsWith('month')) r.setUTCMonth(r.getUTCMonth() + amount);
  else if (unit.startsWith('year')) r.setUTCFullYear(r.getUTCFullYear() + amount);
  else r.setTime(r.getTime() + amount * (UNIT_MS[unit] ?? 1));
  return r;
}

function diffDates(a: Date, b: Date, unit: string): number {
  return (a.getTime() - b.getTime()) / (UNIT_MS[unit] ?? 1);
}

function startOf(d: Date, unit: string): Date {
  const r = new Date(d.getTime());
  if (unit === 'day') r.setUTCHours(0, 0, 0, 0);
  else if (unit === 'hour') r.setUTCMinutes(0, 0, 0);
  else if (unit === 'month') { r.setUTCDate(1); r.setUTCHours(0, 0, 0, 0); }
  else if (unit === 'year') { r.setUTCMonth(0, 1); r.setUTCHours(0, 0, 0, 0); }
  return r;
}

/** Format tokens: YYYY MM DD HH mm ss SSS, plus ISO / date / time presets. */
export function formatDate(d: Date, fmt: string, timeZone = 'UTC'): string {
  if (Number.isNaN(d.getTime())) throw new ExpressionError('Invalid date');
  if (fmt === 'ISO') return d.toISOString();
  if (fmt === 'unix') return String(Math.floor(d.getTime() / 1000));
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'long', 
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  const monthName = new Intl.DateTimeFormat('en-US', { timeZone, month: 'long' }).format(d);
  const tokens: Record<string, string> = {
    YYYY: parts.year!, MMMM: monthName, MMM: monthName.slice(0, 3), MM: parts.month!, DD: parts.day!, dddd: parts.weekday!,
    HH: parts.hour === '24' ? '00' : parts.hour!, mm: parts.minute!, ss: parts.second!, SSS: String(d.getUTCMilliseconds()).padStart(3, '0'),
  };
  return fmt.replace(/YYYY|MMMM|MMM|MM|DD|dddd|HH|mm|ss|SSS/g, (t) => tokens[t] ?? t);
}

interface Scope {
  vars: Record<string, unknown>;
  parent?: Scope;
}

class Interpreter {
  private steps = 0;
  constructor(private readonly root: Record<string, unknown>) {}

  run(node: Node): unknown {
    return this.eval(node, { vars: {} });
  }

  private lookup(name: string, scope: Scope | undefined): unknown {
    for (let s = scope; s; s = s.parent) if (Object.prototype.hasOwnProperty.call(s.vars, name)) return s.vars[name];
    if (Object.prototype.hasOwnProperty.call(this.root, name)) return this.root[name];
    if (Object.prototype.hasOwnProperty.call(expressionGlobals, name)) return expressionGlobals[name];
    throw new ExpressionError(`${name} is not defined`);
  }

  private eval(node: Node, scope: Scope): unknown {
    if (++this.steps > MAX_STEPS) throw new ExpressionError('Expression is too complex');
    switch (node.type) {
      case 'Literal':
        return node.value;
      case 'Identifier':
        if (node.name === 'true') return true;
        if (node.name === 'false') return false;
        if (node.name === 'null') return null;
        return this.lookup(node.name as string, scope);
      case 'ThisExpression':
        throw new ExpressionError('"this" is not supported');
      case 'ArrayExpression':
        return (node.elements as Node[]).map((e) => (e ? this.eval(e, scope) : undefined));
      case 'ObjectExpression': {
        const out: Record<string, unknown> = {};
        for (const p of node.properties as Node[]) {
          const key = p.computed ? String(this.eval(p.key as Node, scope)) : ((p.key as Node).name as string) ?? String((p.key as Node).value);
          if (FORBIDDEN_PROPS.has(key)) throw new ExpressionError(`Property "${key}" is not allowed`);
          out[key] = p.shorthand ? this.lookup(key, scope) : this.eval(p.value as Node, scope);
        }
        return out;
      }
      case 'TemplateLiteral': {
        const quasis = node.quasis as Node[];
        const exprs = node.expressions as Node[];
        let s = '';
        quasis.forEach((q, i) => {
          s += (q.value as { cooked: string }).cooked;
          if (i < exprs.length) s += stringify(this.eval(exprs[i]!, scope));
        });
        return s;
      }
      case 'UnaryExpression': {
        const v = this.eval(node.argument as Node, scope);
        switch (node.operator) {
          case '!': return !v;
          case '-': return -(v as number);
          case '+': return +(v as number);
          case '~': return ~(v as number);
          case 'typeof': return typeof v;
          default: throw new ExpressionError(`Operator ${node.operator} is not supported`);
        }
      }
      case 'BinaryExpression':
      case 'LogicalExpression':
        return this.binary(node, scope);
      case 'ConditionalExpression':
        return this.eval(node.test as Node, scope) ? this.eval(node.consequent as Node, scope) : this.eval(node.alternate as Node, scope);
      case 'MemberExpression': {
        const obj = this.eval(node.object as Node, scope);
        const prop = this.propName(node, scope);
        return this.getMember(obj, prop, !!node.optional);
      }
      case 'CallExpression':
        return this.call(node, scope);
      case 'ArrowFunctionExpression': {
        const params = ((node.params as Node[] | null) ?? []).map((p) => p.name as string);
        const body = node.body as Node;
        return (...args: unknown[]) => {
          const vars: Record<string, unknown> = {};
          params.forEach((p, i) => (vars[p] = args[i]));
          return this.eval(body, { vars, parent: scope });
        };
      }
      case 'SequenceExpression':
      case 'Compound': {
        const list = (node.expressions ?? node.body) as Node[];
        let last: unknown;
        for (const e of list) last = this.eval(e, scope);
        return last;
      }
      default:
        throw new ExpressionError(`Unsupported syntax: ${node.type}`);
    }
  }

  private propName(node: Node, scope: Scope): string | number {
    const prop = node.computed ? this.eval(node.property as Node, scope) : ((node.property as Node).name as string);
    const key = typeof prop === 'number' ? prop : String(prop);
    if (typeof key === 'string' && FORBIDDEN_PROPS.has(key)) throw new ExpressionError(`Access to "${key}" is not allowed`);
    return key;
  }

  private getMember(obj: unknown, prop: string | number, optional: boolean): unknown {
    if (obj === null || obj === undefined) {
      if (optional) return undefined;
      throw new ExpressionError(`Cannot read "${prop}" of ${obj}`);
    }
    if (typeof obj === 'string') {
      if (prop === 'length') return obj.length;
      if (typeof prop === 'number' || /^\d+$/.test(String(prop))) return obj[Number(prop)];
      if (STRING_METHODS.has(String(prop))) return (obj as unknown as Record<string, unknown>)[prop];
      return undefined;
    }
    if (Array.isArray(obj)) {
      if (prop === 'length') return obj.length;
      if (typeof prop === 'number' || /^-?\d+$/.test(String(prop))) return obj[Number(prop)];
      if (ARRAY_METHODS.has(String(prop))) return (obj as unknown as Record<string, unknown>)[prop];
      return undefined;
    }
    if (typeof obj === 'number') return NUMBER_METHODS.has(String(prop)) ? (obj as unknown as Record<string, unknown>)[prop] : undefined;
    if (obj instanceof Date) return DATE_METHODS.has(String(prop)) ? (obj as unknown as Record<string, unknown>)[prop] : undefined;
    if (typeof obj === 'object' || typeof obj === 'function') {
      return Object.prototype.hasOwnProperty.call(obj, prop) ? (obj as Record<string | number, unknown>)[prop] : undefined;
    }
    return undefined;
  }

  private call(node: Node, scope: Scope): unknown {
    const callee = node.callee as Node;
    const args = (node.arguments as Node[]).map((a) => this.eval(a, scope));
    let fn: unknown;
    let thisArg: unknown;
    if (callee.type === 'MemberExpression') {
      thisArg = this.eval(callee.object as Node, scope);
      const prop = this.propName(callee, scope);
      fn = this.getMember(thisArg, prop, !!callee.optional);
      if (fn === undefined && callee.optional) return undefined;
      if (typeof thisArg === 'string' && prop === 'repeat' && Number(args[0]) * thisArg.length > MAX_STRING)
        throw new ExpressionError('String is too long');
    } else {
      fn = this.eval(callee, scope);
    }
    if (typeof fn !== 'function') throw new ExpressionError(`${describe(callee)} is not a function`);
    const result = (fn as (...a: unknown[]) => unknown).apply(thisArg, args);
    if (typeof result === 'string' && result.length > MAX_STRING) throw new ExpressionError('String is too long');
    return result;
  }

  private binary(node: Node, scope: Scope): unknown {
    const op = node.operator as string;
    if (op === '&&') return this.eval(node.left as Node, scope) && this.eval(node.right as Node, scope);
    if (op === '||') return this.eval(node.left as Node, scope) || this.eval(node.right as Node, scope);
    if (op === '??') return this.eval(node.left as Node, scope) ?? this.eval(node.right as Node, scope);
    const l = this.eval(node.left as Node, scope) as never;
    const r = this.eval(node.right as Node, scope) as never;
    switch (op) {
      case '+': {
        const v = (l as number) + (r as number);
        if (typeof v === 'string' && (v as string).length > MAX_STRING) throw new ExpressionError('String is too long');
        return v;
      }
      case '-': return l - r;
      case '*': return l * r;
      case '/': return l / r;
      case '%': return l % r;
      case '**': return (l as number) ** (r as number);
      case '==': return l == r;
      case '!=': return l != r;
      case '===': return l === r;
      case '!==': return l !== r;
      case '<': return l < r;
      case '>': return l > r;
      case '<=': return l <= r;
      case '>=': return l >= r;
      case 'in': return r !== null && typeof r === 'object' && Object.prototype.hasOwnProperty.call(r, l);
      default: throw new ExpressionError(`Operator ${op} is not supported`);
    }
  }
}

function describe(n: Node): string {
  if (n.type === 'Identifier') return n.name as string;
  if (n.type === 'MemberExpression') return `${describe(n.object as Node)}.${(n.property as Node).name ?? '?'}`;
  return 'expression';
}

function stringify(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return v instanceof Date ? v.toISOString() : JSON.stringify(v);
  return String(v);
}

const astCache = new Map<string, Node>();
function parse(code: string): Node {
  let ast = astCache.get(code);
  if (!ast) {
    if (code.length > 10_000) throw new ExpressionError('Expression is too long');
    try {
      ast = jsep(code) as Node;
    } catch (err) {
      throw new ExpressionError(`Invalid expression "${code}": ${(err as Error).message}`);
    }
    if (astCache.size > 5_000) astCache.clear();
    astCache.set(code, ast);
  }
  return ast;
}

export function evaluateExpression(code: string, context: Record<string, unknown>): unknown {
  return new Interpreter(context).run(parse(code.trim()));
}

const TEMPLATE_RE = /\{\{([\s\S]+?)\}\}/g;
const SINGLE_RE = /^\s*\{\{([\s\S]+?)\}\}\s*$/;

export function isExpression(value: unknown): value is string {
  return typeof value === 'string' && value.includes('{{') && value.includes('}}');
}

/**
 * Resolve a template string. A string that is a single `{{ expr }}` returns the
 * raw value (object, number…); mixed text is interpolated into a string.
 */
export function resolveTemplate(value: string, context: Record<string, unknown>): unknown {
  const single = value.match(SINGLE_RE);
  if (single && single[1]!.indexOf('}}') === -1) return evaluateExpression(single[1]!, context);
  return value.replace(TEMPLATE_RE, (_m, code: string) => stringify(evaluateExpression(code, context)));
}

/** Deeply resolve every expression inside a parameter value. */
export function resolveDeep(value: unknown, context: Record<string, unknown>, depth = 0): unknown {
  if (depth > 20) return value;
  if (typeof value === 'string') return isExpression(value) ? resolveTemplate(value, context) : value;
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, context, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveDeep(v, context, depth + 1);
    return out;
  }
  return value;
}
