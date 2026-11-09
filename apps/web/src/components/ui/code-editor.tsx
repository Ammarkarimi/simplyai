'use client';
import dynamic from 'next/dynamic';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { sql } from '@codemirror/lang-sql';
import { cn } from '@/lib/utils';

const CodeMirror = dynamic(() => import('@uiw/react-codemirror'), { ssr: false, loading: () => <div className="h-24 animate-pulse rounded-lg bg-muted" /> });

export function CodeEditor({ value, onChange, language = 'javascript', minHeight = 120, className, readOnly }: {
  value: string; onChange?: (v: string) => void; language?: string; minHeight?: number; className?: string; readOnly?: boolean;
}) {
  const ext = language === 'json' ? [json()] : language === 'sql' ? [sql()] : language === 'javascript' ? [javascript()] : [];
  return (
    <div className={cn('overflow-hidden rounded-lg border bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring/40', className)}>
      <CodeMirror value={value} onChange={onChange} extensions={ext} readOnly={readOnly} minHeight={`${minHeight}px`} maxHeight="480px" basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: !readOnly }} />
    </div>
  );
}
