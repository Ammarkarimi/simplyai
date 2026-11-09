'use client';
import { use } from 'react';
import { WorkflowEditor } from '@/components/editor/editor';

export default function WorkflowEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <WorkflowEditor workflowId={id} />;
}
