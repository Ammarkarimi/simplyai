import { addToDateSafe } from '../lib/time';
import { chunk, defineNode, NodeOperationError, getPath, type Item, type NodeDefinition } from '@simplyai/sdk';
import { conditionsProperty, evaluateGroup, CONDITION_OPERATORS, type ConditionGroup } from '../lib/conditions';

const main = [{ name: 'main' }];

export const ifNode = defineNode({
  type: 'simplyai.if', version: 1, displayName: 'If / Else', category: 'logic', subcategory: 'Flow', icon: 'git-branch', color: '#0ea5e9',
  description: 'Route items to true or false branches based on conditions',
  inputs: main, outputs: [{ name: 'true', label: 'True' }, { name: 'false', label: 'False' }],
  properties: [conditionsProperty()],
  docs: 'Items matching the conditions go to **True**, the rest to **False**. Combine conditions with AND / OR.',
  async execute(ctx) {
    const t: Item[] = [], f: Item[] = [];
    ctx.getInputItems().forEach((item, i) => (evaluateGroup(ctx.getParam<ConditionGroup>('conditions', i)) ? t : f).push(item));
    return [t, f];
  },
});

export const switchNode = defineNode({
  type: 'simplyai.switch', version: 1, displayName: 'Switch', category: 'logic', subcategory: 'Flow', icon: 'split', color: '#0ea5e9',
  description: 'Route items to different outputs by rules',
  inputs: main, outputs: main,
  dynamicOutputs: { parameter: 'rules', labelField: 'output', fallback: true },
  properties: [
    { name: 'value', displayName: 'Value to test', type: 'string', default: '{{ $json.status }}', required: true },
    {
      name: 'rules', displayName: 'Rules', type: 'fixedCollection', noExpression: true,
      default: [{ output: 'Open', operator: 'equals', compareTo: 'open' }, { output: 'Closed', operator: 'equals', compareTo: 'closed' }],
      fields: [
        { name: 'output', displayName: 'Output name', type: 'string', default: '' },
        { name: 'operator', displayName: 'Operator', type: 'options', default: 'equals', options: CONDITION_OPERATORS.map((o) => ({ name: o.name, value: o.value })) },
        { name: 'compareTo', displayName: 'Compare to', type: 'string', default: '' },
      ],
    },
    { name: 'fallbackOutput', displayName: 'Send unmatched items to Fallback output', type: 'boolean', default: true, noExpression: true },
    { name: 'allMatches', displayName: 'Send to all matching outputs', type: 'boolean', default: false, noExpression: true },
  ],
  async execute(ctx) {
    const rules = (ctx.getRawParam<Array<{ operator: string; compareTo: unknown }>>('rules') ?? []);
    const fallback = ctx.getParam<boolean>('fallbackOutput', 0, true);
    const all = ctx.getParam<boolean>('allMatches', 0, false);
    const outs: Item[][] = rules.map(() => []);
    const fb: Item[] = [];
    ctx.getInputItems().forEach((item, i) => {
      const value = ctx.getParam('value', i);
      const resolvedRules = ctx.getParam<Array<{ operator: string; compareTo: unknown }>>('rules', i) ?? [];
      let matched = false;
      for (let r = 0; r < resolvedRules.length; r++) {
        const rule = resolvedRules[r]!;
        if (evaluateGroup({ conditions: [{ left: value, operator: rule.operator, right: rule.compareTo }] })) {
          outs[r]!.push(item);
          matched = true;
          if (!all) break;
        }
      }
      if (!matched) fb.push(item);
    });
    return fallback ? [...outs, fb] : outs;
  },
});

export const mergeNode = defineNode({
  type: 'simplyai.merge', version: 1, displayName: 'Merge', category: 'logic', subcategory: 'Flow', icon: 'merge', color: '#0ea5e9',
  description: 'Combine data from two branches', inputs: [{ name: 'input1', label: 'Input 1' }, { name: 'input2', label: 'Input 2' }], outputs: main,
  properties: [
    {
      name: 'mode', displayName: 'Mode', type: 'options', default: 'append', noExpression: true,
      options: [
        { name: 'Append', value: 'append', description: 'Output items of input 1, then input 2' },
        { name: 'Combine by position', value: 'position', description: 'Merge item 1 with item 1, 2 with 2…' },
        { name: 'Combine by matching field', value: 'field', description: 'Join items with equal field values' },
        { name: 'Cartesian product', value: 'multiplex', description: 'Every combination of both inputs' },
        { name: 'Choose branch', value: 'chooseBranch', description: 'Wait for both, output one of them' },
      ],
    },
    { name: 'field1', displayName: 'Input 1 field', type: 'string', default: 'id', noExpression: true, displayOptions: { show: { mode: ['field'] } } },
    { name: 'field2', displayName: 'Input 2 field', type: 'string', default: 'id', noExpression: true, displayOptions: { show: { mode: ['field'] } } },
    { name: 'joinType', displayName: 'Keep', type: 'options', default: 'inner', noExpression: true, displayOptions: { show: { mode: ['field'] } }, options: [{ name: 'Matches only (inner)', value: 'inner' }, { name: 'All of input 1 (left)', value: 'left' }, { name: 'Everything (outer)', value: 'outer' }] },
    { name: 'branch', displayName: 'Output', type: 'options', default: 'input1', noExpression: true, displayOptions: { show: { mode: ['chooseBranch'] } }, options: [{ name: 'Input 1', value: 'input1' }, { name: 'Input 2', value: 'input2' }] },
  ],
  docs: 'Merge waits until both upstream branches finished (or were skipped), then combines whatever arrived.',
  async execute(ctx) {
    const a = ctx.getInputItems(0), b = ctx.getInputItems(1);
    const mode = ctx.getRawParam<string>('mode');
    switch (mode) {
      case 'append':
        return [[...a, ...b]];
      case 'position': {
        const n = Math.max(a.length, b.length);
        return [Array.from({ length: n }, (_, i) => ({ json: { ...(a[i]?.json ?? {}), ...(b[i]?.json ?? {}) } }))];
      }
      case 'field': {
        const f1 = ctx.getRawParam<string>('field1'), f2 = ctx.getRawParam<string>('field2');
        const join = ctx.getRawParam<string>('joinType');
        const index = new Map<string, Item[]>();
        for (const it of b) {
          const k = JSON.stringify(getPath(it.json, f2));
          index.set(k, [...(index.get(k) ?? []), it]);
        }
        const used = new Set<Item>();
        const out: Item[] = [];
        for (const it of a) {
          const matches = index.get(JSON.stringify(getPath(it.json, f1))) ?? [];
          if (matches.length) matches.forEach((m) => { used.add(m); out.push({ json: { ...it.json, ...m.json } }); });
          else if (join !== 'inner') out.push(it);
        }
        if (join === 'outer') b.filter((x) => !used.has(x)).forEach((x) => out.push(x));
        return [out];
      }
      case 'multiplex':
        return [a.flatMap((x) => b.map((y) => ({ json: { ...x.json, ...y.json } })))];
      case 'chooseBranch':
        return [ctx.getRawParam('branch') === 'input2' ? b : a];
      default:
        throw new NodeOperationError(`Unknown merge mode ${mode}`);
    }
  },
});

export const filterNode = defineNode({
  type: 'simplyai.filter', version: 1, displayName: 'Filter', category: 'logic', subcategory: 'Flow', icon: 'filter', color: '#0ea5e9',
  description: 'Keep only items matching conditions', inputs: main, outputs: [{ name: 'kept', label: 'Kept' }, { name: 'discarded', label: 'Discarded' }],
  properties: [conditionsProperty()],
  async execute(ctx) {
    const kept: Item[] = [], dropped: Item[] = [];
    ctx.getInputItems().forEach((item, i) => (evaluateGroup(ctx.getParam<ConditionGroup>('conditions', i)) ? kept : dropped).push(item));
    return [kept, dropped];
  },
});

export const loopNode = defineNode({
  type: 'simplyai.loop', version: 1, displayName: 'Loop Over Items', category: 'logic', subcategory: 'Flow', icon: 'repeat', color: '#0ea5e9',
  description: 'Process items in batches; connect the end of the loop body back to this node',
  inputs: main, outputs: [{ name: 'done', label: 'Done' }, { name: 'loop', label: 'Loop' }], loopOutput: 1,
  properties: [{ name: 'batchSize', displayName: 'Batch size', type: 'number', default: 1, min: 1, max: 10000, noExpression: true }],
  docs: 'Emits one batch at a time on **Loop**. Connect the last node of the loop body back into this node. When all batches are processed, the collected results are emitted on **Done**.',
  async execute(ctx) {
    const st = ctx.nodeState as { queue?: Item[]; results?: Item[]; iteration?: number; __continue?: boolean };
    const size = Math.max(1, Number(ctx.getRawParam('batchSize') ?? 1));
    if (!st.queue) {
      st.queue = [...ctx.getInputItems()];
      st.results = [];
      st.iteration = 0;
    } else {
      st.results!.push(...ctx.getInputItems());
    }
    if (st.queue.length) {
      const batch = st.queue.splice(0, size).map((it) => ({ ...it, json: { ...it.json } }));
      st.iteration = (st.iteration ?? 0) + 1;
      st.__continue = true;
      return [[], batch];
    }
    st.__continue = false;
    const results = st.results ?? [];
    delete st.queue;
    return [results, []];
  },
});

export const splitInBatches = defineNode({
  type: 'simplyai.splitInBatches', version: 1, displayName: 'Split in Batches', category: 'logic', subcategory: 'Flow', icon: 'layers', color: '#0ea5e9',
  description: 'Group items into batches (one output item per batch) for bulk APIs', inputs: main, outputs: main,
  properties: [
    { name: 'batchSize', displayName: 'Batch size', type: 'number', default: 10, min: 1, noExpression: true },
    { name: 'field', displayName: 'Output field', type: 'string', default: 'items', noExpression: true },
  ],
  async execute(ctx) {
    const size = Math.max(1, Number(ctx.getRawParam('batchSize')));
    const field = ctx.getRawParam<string>('field') || 'items';
    const batches = chunk(ctx.getInputItems(), size);
    return [batches.map((b, i) => ({ json: { [field]: b.map((x) => x.json), batchIndex: i, batchCount: batches.length } }))];
  },
});

export const waitNode = defineNode({
  type: 'simplyai.wait', version: 1, displayName: 'Wait', category: 'logic', subcategory: 'Flow', icon: 'hourglass', color: '#0ea5e9',
  description: 'Pause the workflow for a duration or until a date', inputs: main, outputs: main,
  properties: [
    { name: 'mode', displayName: 'Resume', type: 'options', default: 'interval', noExpression: true, options: [{ name: 'After time interval', value: 'interval' }, { name: 'At specific time', value: 'until' }] },
    { name: 'amount', displayName: 'Amount', type: 'number', default: 5, min: 0, displayOptions: { show: { mode: ['interval'] } } },
    { name: 'unit', displayName: 'Unit', type: 'options', default: 'seconds', displayOptions: { show: { mode: ['interval'] } }, options: ['seconds', 'minutes', 'hours', 'days'].map((u) => ({ name: u, value: u })) },
    { name: 'until', displayName: 'Date & time', type: 'string', default: '', placeholder: '2026-12-01T09:00:00Z', displayOptions: { show: { mode: ['until'] } } },
  ],
  docs: 'Short waits (≤ 1 minute) happen in the worker. Longer waits persist the execution as **Waiting** and resume automatically, surviving restarts.',
  async execute(ctx) {
    const mode = ctx.getParam<string>('mode');
    let until: Date;
    if (mode === 'until') {
      until = new Date(ctx.getParam<string>('until'));
      if (Number.isNaN(until.getTime())) throw new NodeOperationError('Invalid date for "Date & time"');
    } else {
      until = addToDateSafe(new Date(), Number(ctx.getParam('amount', 0, 0)), ctx.getParam<string>('unit', 0, 'seconds'));
    }
    return { control: 'wait', kind: 'time', until: until.toISOString() };
  },
});

export const approvalNode = defineNode({
  type: 'simplyai.approval', version: 1, displayName: 'Human Approval', category: 'logic', subcategory: 'Flow', icon: 'user-check', color: '#0ea5e9',
  description: 'Pause until a person approves or rejects in SimplyAI', inputs: main, outputs: [{ name: 'approved', label: 'Approved' }, { name: 'rejected', label: 'Rejected' }],
  properties: [{ name: 'message', displayName: 'Message for the approver', type: 'text', default: 'Please review and approve this step.' }],
  docs: 'The execution status becomes **Waiting**. Approvers with the Operator role or higher approve or reject on the execution page; the decision is added as `approval` to every item.',
  async execute(ctx) {
    return { control: 'wait', kind: 'approval', message: ctx.getParam<string>('message') };
  },
});

export const stopNode = defineNode({
  type: 'simplyai.stop', version: 1, displayName: 'Stop Workflow', category: 'logic', subcategory: 'Flow', icon: 'octagon', color: '#0ea5e9',
  description: 'Stop the execution successfully or with an error', inputs: main, outputs: [],
  properties: [
    { name: 'status', displayName: 'Stop with', type: 'options', default: 'success', noExpression: true, options: [{ name: 'Success', value: 'success' }, { name: 'Error', value: 'error' }] },
    { name: 'message', displayName: 'Message', type: 'string', default: '' },
  ],
  async execute(ctx) {
    return { control: 'stop', status: ctx.getParam<'success' | 'error'>('status'), message: ctx.getParam<string>('message') };
  },
});

export const executeWorkflowNode = defineNode({
  type: 'simplyai.executeWorkflow', version: 1, displayName: 'Execute Sub-workflow', category: 'logic', subcategory: 'Flow', icon: 'workflow', color: '#0ea5e9',
  description: 'Run another workflow and use its result', inputs: main, outputs: main, usableAsTool: true,
  properties: [
    { name: 'workflowId', displayName: 'Workflow', type: 'workflow', default: '', required: true },
    { name: 'mode', displayName: 'Mode', type: 'options', default: 'all', noExpression: true, options: [{ name: 'Run once with all items', value: 'all' }, { name: 'Run once for each item', value: 'each' }] },
    { name: 'waitForCompletion', displayName: 'Wait for completion', type: 'boolean', default: true, noExpression: true },
  ],
  docs: 'The sub-workflow starts at its manual trigger with the input items. Its last node output becomes this node output.',
  async execute(ctx) {
    const items = ctx.getInputItems();
    const wait = ctx.getRawParam<boolean>('waitForCompletion') !== false;
    if (ctx.getRawParam('mode') === 'each') {
      const out: Item[] = [];
      for (let i = 0; i < items.length; i++) {
        const res = await ctx.services.runSubWorkflow(ctx.getParam<string>('workflowId', i), [items[i]!], { waitForCompletion: wait, signal: ctx.signal });
        out.push(...res.map((r) => ({ ...r, pairedItem: i })));
      }
      return [out];
    }
    return [await ctx.services.runSubWorkflow(ctx.getParam<string>('workflowId'), items, { waitForCompletion: wait, signal: ctx.signal })];
  },
});

export const logicNodes: NodeDefinition[] = [ifNode, switchNode, mergeNode, filterNode, loopNode, splitInBatches, waitNode, approvalNode, stopNode, executeWorkflowNode];
