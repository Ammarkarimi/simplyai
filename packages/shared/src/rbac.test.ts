import { describe, expect, it } from 'vitest';
import { SYSTEM_ROLES, roleHas, permissionsForScopes } from './rbac';
import { isPropertyVisible, resolveOutputs } from './nodes';
import { slugify, truncateJson } from './utils';

describe('rbac', () => {
  const role = (k: string) => SYSTEM_ROLES.find((r) => r.key === k)!.permissions;
  it('viewer can read but not edit', () => {
    expect(roleHas(role('viewer'), 'workflow:read')).toBe(true);
    expect(roleHas(role('viewer'), 'workflow:update')).toBe(false);
    expect(roleHas(role('viewer'), 'workflow:execute')).toBe(false);
  });
  it('operator can execute but not edit', () => {
    expect(roleHas(role('operator'), ['workflow:execute', 'execution:manage'])).toBe(true);
    expect(roleHas(role('operator'), 'workflow:update')).toBe(false);
  });
  it('only owner manages billing', () => {
    expect(roleHas(role('owner'), 'billing:manage')).toBe(true);
    expect(roleHas(role('admin'), 'billing:manage')).toBe(false);
  });
  it('maps API key scopes to permissions', () => {
    expect(permissionsForScopes(['workflows:read'])).toEqual(['workflow:read']);
  });
});

describe('node helpers', () => {
  it('evaluates display options', () => {
    const prop = { displayOptions: { show: { operation: ['send'] } } };
    expect(isPropertyVisible(prop, { operation: 'send' })).toBe(true);
    expect(isPropertyVisible(prop, { operation: 'get' })).toBe(false);
  });
  it('resolves dynamic outputs', () => {
    const desc = {
      outputs: [{ name: 'main' }],
      dynamicOutputs: { parameter: 'rules', labelField: 'output', fallback: true },
    } as never;
    expect(resolveOutputs(desc, { rules: [{ output: 'A' }, { output: 'B' }] }).map((p) => p.label)).toEqual(['A', 'B', 'Fallback']);
  });
});

describe('utils', () => {
  it('slugifies', () => expect(slugify('Ácme Corp!! Team')).toBe('acme-corp-team'));
  it('truncates big json', () => expect(truncateJson({ a: 'x'.repeat(100) }, 50).truncated).toBe(true));
});
