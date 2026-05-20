import { cn } from '@/lib/utils'

export type BadgeTone = 'brand' | 'success' | 'info' | 'warning' | 'danger' | 'neutral'

const tones: Record<BadgeTone, string> = {
  brand:   'bg-brand-100 text-brand-700',
  success: 'bg-success-soft text-success',
  info:    'bg-info-soft text-info',
  warning: 'bg-warning-soft text-warning',
  danger:  'bg-danger-soft text-danger',
  neutral: 'bg-slate-100 text-slate-600',
}

export function Badge({
  tone = 'neutral',
  className,
  children,
  ...props
}: {
  tone?: BadgeTone
  className?: string
  children: React.ReactNode
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        tones[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}
