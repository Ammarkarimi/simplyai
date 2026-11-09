'use client';
import { memo, useState } from 'react';
import { Handle, NodeResizer, Position, type NodeProps, type Node } from '@xyflow/react';
import { AlertCircle, CheckCircle2, Hourglass, Loader2, PauseCircle, Zap } from 'lucide-react';
import { resolveOutputs, isPropertyVisible, type NodeDescription } from '@simplyai/shared';
import { NodeIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import { useEditor, type GroupData, type NoteData, type WfNodeData } from '@/stores/editor';

export function nodeIssues(desc: NodeDescription, data: WfNodeData): string[] {
  const issues: string[] = [];
  for (const p of desc.properties) {
    if (!p.required || !isPropertyVisible(p, data.parameters)) continue;
    const v = data.parameters[p.name];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) issues.push(`${p.displayName} is required`);
  }
  if (desc.credentials?.required && !data.credentialId) issues.push('Credential not selected');
  return issues;
}

function subtitle(data: WfNodeData, desc?: { properties: { name: string; options?: { name: string; value: unknown }[] }[] }): string | null {
  const op = data.parameters.operation;
  if (op && desc) return desc.properties.find((p) => p.name === 'operation')?.options?.find((o) => o.value === op)?.name ?? String(op);
  if (data.parameters.mode && desc) return desc.properties.find((p) => p.name === 'mode')?.options?.find((o) => o.value === data.parameters.mode)?.name ?? null;
  return null;
}

export const WorkflowNode = memo(function WorkflowNode({ id, data, selected }: NodeProps<Node<WfNodeData, 'wf'>>) {
  const desc = useEditor((s) => s.catalog.get(data.type));
  const run = useEditor((s) => s.runStatus[id]);
  if (!desc) {
    return (
      <div className="w-[220px] rounded-xl border-2 border-dashed border-red-300 bg-red-50 p-3 text-xs text-red-700">
        <Handle type="target" position={Position.Left} id="in-0" />
        Unknown node <b>{data.type}</b>
        <Handle type="source" position={Position.Right} id="out-0" />
      </div>
    );
  }
  const outputs = [...resolveOutputs(desc, data.parameters)];
  if (data.settings?.continueOnFail && data.settings?.errorOutput) outputs.push({ name: 'error', label: 'Error' });
  const inputs = desc.inputs;
  const isTrigger = !!desc.trigger;
  const issues = nodeIssues(desc, data);
  const sub = subtitle(data, desc);
  const ports = Math.max(inputs.length, outputs.length, 1);
  const status = run?.status;
  return (
    <div
      className={cn(
        'group relative w-[230px] border bg-card shadow-soft transition-shadow',
        isTrigger ? 'rounded-l-[28px] rounded-r-xl' : 'rounded-xl',
        selected ? 'border-primary ring-4 ring-primary/15' : 'hover:shadow-md',
        data.disabled && 'opacity-50 grayscale',
        status === 'RUNNING' && 'animate-pulse-ring border-violet-400',
        status === 'SUCCESS' && 'border-emerald-400',
        status === 'FAILED' && 'border-red-400 ring-4 ring-red-100',
        status === 'WAITING' && 'border-amber-400',
      )}
      style={{ minHeight: 30 + ports * 22 }}
    >
      {inputs.map((p, i) => (
        <Handle key={p.name} type="target" position={Position.Left} id={`in-${i}`} style={{ top: `${((i + 1) / (inputs.length + 1)) * 100}%` }} title={p.label ?? p.name} />
      ))}
      <div className="flex items-center gap-2.5 p-3">
        <NodeIcon icon={desc.icon} color={desc.color} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-tight">{data.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">{sub ?? desc.displayName}</p>
        </div>
        {isTrigger && <Zap className="h-3.5 w-3.5 shrink-0 text-violet-500" />}
      </div>
      {outputs.length > 1 && (
        <div className="pointer-events-none absolute inset-y-0 right-2 flex flex-col justify-around py-1 text-right">
          {outputs.map((p) => <span key={p.name} className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{p.label ?? p.name}</span>)}
        </div>
      )}
      {outputs.map((p, i) => (
        <Handle key={`${p.name}-${i}`} type="source" position={Position.Right} id={`out-${i}`} style={{ top: `${((i + 1) / (outputs.length + 1)) * 100}%`, background: p.name === 'error' ? '#ef4444' : undefined }} title={p.label ?? p.name} />
      ))}
      <div className="absolute -top-2.5 right-2 flex gap-1">
        {issues.length > 0 && !status && <span title={issues.join('\n')} className="flex h-5 items-center gap-1 rounded-full bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800"><AlertCircle className="h-3 w-3" />{issues.length}</span>}
        {status === 'RUNNING' && <span className="flex h-5 items-center rounded-full bg-violet-100 px-1.5 text-violet-700"><Loader2 className="h-3 w-3 animate-spin" /></span>}
        {status === 'SUCCESS' && <span className="flex h-5 items-center gap-1 rounded-full bg-emerald-100 px-1.5 text-[10px] font-medium text-emerald-700"><CheckCircle2 className="h-3 w-3" />{run?.itemsOut ?? 0}{(run?.runs ?? 0) > 1 ? ` · ${run!.runs}×` : ''}</span>}
        {status === 'FAILED' && <span title={run?.error?.message} className="flex h-5 items-center gap-1 rounded-full bg-red-100 px-1.5 text-[10px] font-medium text-red-700"><AlertCircle className="h-3 w-3" />error</span>}
        {status === 'WAITING' && <span className="flex h-5 items-center rounded-full bg-amber-100 px-1.5 text-amber-700"><Hourglass className="h-3 w-3" /></span>}
        {data.disabled && <span className="flex h-5 items-center rounded-full bg-slate-100 px-1.5 text-slate-600"><PauseCircle className="h-3 w-3" /></span>}
      </div>
      {data.notes && <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground line-clamp-2">{data.notes}</p>}
    </div>
  );
});

const NOTE_COLORS: Record<string, string> = { yellow: 'bg-amber-50 border-amber-200', violet: 'bg-violet-50 border-violet-200', blue: 'bg-sky-50 border-sky-200', green: 'bg-emerald-50 border-emerald-200', pink: 'bg-pink-50 border-pink-200' };

export const NoteNode = memo(function NoteNode({ id, data, selected }: NodeProps<Node<NoteData, 'note'>>) {
  const [editing, setEditing] = useState(false);
  const update = useEditor((s) => s.updateNote);
  return (
    <div className={cn('h-full w-full rounded-xl border p-3 text-[13px] shadow-sm', NOTE_COLORS[data.color ?? 'yellow'] ?? NOTE_COLORS.yellow)} onDoubleClick={() => setEditing(true)}>
      <NodeResizer isVisible={selected} minWidth={160} minHeight={70} lineClassName="!border-primary/40" handleClassName="!h-2 !w-2 !rounded-sm !border-primary !bg-white" />
      {editing ? (
        <textarea autoFocus className="nodrag h-full w-full resize-none bg-transparent outline-none" defaultValue={data.text} onBlur={(e) => { update(id, { text: e.target.value }); setEditing(false); }} />
      ) : (
        <p className="h-full overflow-hidden whitespace-pre-wrap text-slate-700">{data.text}</p>
      )}
      {selected && !editing && (
        <div className="absolute -top-8 left-0 flex gap-1 rounded-lg border bg-card p-1 shadow">
          {Object.keys(NOTE_COLORS).map((c) => <button key={c} aria-label={c} onClick={() => update(id, { color: c })} className={cn('h-4 w-4 rounded-full border', NOTE_COLORS[c])} />)}
        </div>
      )}
    </div>
  );
});

const GROUP_COLORS: Record<string, string> = { violet: 'border-violet-300 bg-violet-50/40', blue: 'border-sky-300 bg-sky-50/40', green: 'border-emerald-300 bg-emerald-50/40', slate: 'border-slate-300 bg-slate-50/50' };

export const GroupNode = memo(function GroupNode({ id, data, selected }: NodeProps<Node<GroupData, 'group'>>) {
  const update = useEditor((s) => s.updateNote);
  return (
    <div className={cn('h-full w-full rounded-2xl border-2 border-dashed', GROUP_COLORS[data.color ?? 'violet'] ?? GROUP_COLORS.violet)}>
      <NodeResizer isVisible={selected} minWidth={200} minHeight={120} lineClassName="!border-primary/40" handleClassName="!h-2 !w-2 !rounded-sm !border-primary !bg-white" />
      <input className="nodrag m-2 rounded bg-transparent px-1 text-xs font-semibold uppercase tracking-wide text-slate-600 outline-none focus:bg-white" value={data.label} onChange={(e) => update(id, { label: e.target.value })} />
      {selected && (
        <div className="absolute -top-8 left-0 flex gap-1 rounded-lg border bg-card p-1 shadow">
          {Object.keys(GROUP_COLORS).map((c) => <button key={c} aria-label={c} onClick={() => update(id, { color: c })} className={cn('h-4 w-4 rounded-full border', GROUP_COLORS[c])} />)}
        </div>
      )}
    </div>
  );
});

export const nodeTypes = { wf: WorkflowNode, note: NoteNode, group: GroupNode };
