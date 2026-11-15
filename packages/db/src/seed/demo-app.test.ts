import { describe, expect, it } from 'vitest';
import { appDefinitionSchema } from '@simplyai/shared';
import { leadManagerApp, leadScoringWorkflow } from './demo-app';

describe('demo app', () => {
  it('is a valid app definition wired to its workflow and table', () => {
    const def = leadManagerApp('table1', 'wf1');
    const r = appDefinitionSchema.safeParse(def);
    expect(r.success, r.success ? '' : r.error.issues[0]?.message).toBe(true);
    expect(def.queries.find((q) => q.name === 'scoreLead')?.workflowId).toBe('wf1');
    expect(def.queries.filter((q) => q.kind === 'dataTable').every((q) => q.tableId === 'table1')).toBe(true);
    expect(leadScoringWorkflow().nodes[0]!.type).toBe('simplyai.appTrigger');
  });
});
