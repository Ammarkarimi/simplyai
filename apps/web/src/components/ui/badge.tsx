import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap', {
  variants: {
    variant: {
      default: 'bg-accent text-accent-foreground ring-primary/15',
      secondary: 'bg-muted text-muted-foreground ring-border',
      success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
      warning: 'bg-amber-50 text-amber-700 ring-amber-600/20',
      destructive: 'bg-red-50 text-red-700 ring-red-600/15',
      info: 'bg-sky-50 text-sky-700 ring-sky-600/15',
      outline: 'bg-transparent text-foreground ring-border',
    },
  },
  defaultVariants: { variant: 'default' },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

const STATUS: Record<string, { variant: VariantProps<typeof badgeVariants>['variant']; label: string; dot: string }> = {
  QUEUED: { variant: 'secondary', label: 'Queued', dot: 'bg-slate-400' },
  RUNNING: { variant: 'info', label: 'Running', dot: 'bg-sky-500 animate-pulse' },
  WAITING: { variant: 'warning', label: 'Waiting', dot: 'bg-amber-500' },
  SUCCESS: { variant: 'success', label: 'Success', dot: 'bg-emerald-500' },
  FAILED: { variant: 'destructive', label: 'Failed', dot: 'bg-red-500' },
  CANCELLED: { variant: 'secondary', label: 'Cancelled', dot: 'bg-slate-400' },
  SKIPPED: { variant: 'secondary', label: 'Skipped', dot: 'bg-slate-300' },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { variant: 'secondary' as const, label: status, dot: 'bg-slate-400' };
  return (
    <Badge variant={s.variant}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {s.label}
    </Badge>
  );
}
