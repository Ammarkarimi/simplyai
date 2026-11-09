import type { NodeProperty } from '@simplyai/sdk';

export const CONDITION_OPERATORS = [
  { name: 'is equal to', value: 'equals' },
  { name: 'is not equal to', value: 'notEquals' },
  { name: 'contains', value: 'contains' },
  { name: 'does not contain', value: 'notContains' },
  { name: 'starts with', value: 'startsWith' },
  { name: 'ends with', value: 'endsWith' },
  { name: 'is greater than', value: 'gt' },
  { name: 'is greater than or equal', value: 'gte' },
  { name: 'is less than', value: 'lt' },
  { name: 'is less than or equal', value: 'lte' },
  { name: 'is empty', value: 'isEmpty' },
  { name: 'is not empty', value: 'isNotEmpty' },
  { name: 'is true', value: 'isTrue' },
  { name: 'is false', value: 'isFalse' },
  { name: 'matches regex', value: 'regex' },
  { name: 'is before (date)', value: 'before' },
  { name: 'is after (date)', value: 'after' },
] as const;

export interface Condition {
  left: unknown;
  operator: string;
  right?: unknown;
}

export interface ConditionGroup {
  combinator?: 'and' | 'or';
  conditions?: Condition[];
}

export const conditionsProperty = (name = 'conditions', displayName = 'Conditions'): NodeProperty => ({
  name,
  displayName,
  type: 'conditions',
  default: { combinator: 'and', conditions: [{ left: '', operator: 'equals', right: '' }] },
  description: 'Compare values. Use expressions such as {{ $json.status }} on the left side.',
});

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && v !== null && Object.keys(v).length === 0);

const toNum = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const toTime = (v: unknown) => new Date(v as string).getTime();

export function evaluateCondition(c: Condition): boolean {
  const { left, right } = c;
  switch (c.operator) {
    case 'equals': {
      const ln = toNum(left), rn = toNum(right);
      if (!Number.isNaN(ln) && !Number.isNaN(rn)) return ln === rn;
      if (typeof left === 'object' || typeof right === 'object') return JSON.stringify(left) === JSON.stringify(right);
      return String(left ?? '') === String(right ?? '');
    }
    case 'notEquals':
      return !evaluateCondition({ ...c, operator: 'equals' });
    case 'contains':
      return Array.isArray(left) ? left.some((x) => String(x) === String(right)) : String(left ?? '').includes(String(right ?? ''));
    case 'notContains':
      return !evaluateCondition({ ...c, operator: 'contains' });
    case 'startsWith':
      return String(left ?? '').startsWith(String(right ?? ''));
    case 'endsWith':
      return String(left ?? '').endsWith(String(right ?? ''));
    case 'gt':
      return toNum(left) > toNum(right);
    case 'gte':
      return toNum(left) >= toNum(right);
    case 'lt':
      return toNum(left) < toNum(right);
    case 'lte':
      return toNum(left) <= toNum(right);
    case 'isEmpty':
      return isEmpty(left);
    case 'isNotEmpty':
      return !isEmpty(left);
    case 'isTrue':
      return left === true || left === 'true' || left === 1 || left === '1';
    case 'isFalse':
      return left === false || left === 'false' || left === 0 || left === '0' || left === null || left === undefined || left === '';
    case 'regex': {
      const src = String(right ?? '');
      if (src.length > 500) return false;
      try {
        const m = src.match(/^\/(.*)\/([gimsuy]*)$/);
        return (m ? new RegExp(m[1]!, m[2]) : new RegExp(src)).test(String(left ?? ''));
      } catch {
        return false;
      }
    }
    case 'before':
      return toTime(left) < toTime(right);
    case 'after':
      return toTime(left) > toTime(right);
    default:
      throw new Error(`Unknown operator "${c.operator}"`);
  }
}

export function evaluateGroup(group: ConditionGroup | undefined): boolean {
  const list = group?.conditions ?? [];
  if (!list.length) return true;
  return group?.combinator === 'or' ? list.some(evaluateCondition) : list.every(evaluateCondition);
}
