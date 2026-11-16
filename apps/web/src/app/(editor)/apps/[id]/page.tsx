'use client';
import { use } from 'react';
import { AppBuilder } from '@/components/app-builder/builder';

export default function AppBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <AppBuilder appId={id} />;
}
