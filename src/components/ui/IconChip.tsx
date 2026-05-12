import { cn } from '@/lib/utils'

export type Tone = 'brand' | 'success' | 'info' | 'warning' | 'danger' | 'neutral'

const toneStyles: Record<Tone, { bg: string; text: string; halo: string }> = {
  brand:   { bg: 'bg-brand-100',    text: 'text-brand-600', halo: 'bg-brand-400/35' },
  success: { bg: 'bg-success-soft', text: 'text-success',   halo: 'bg-success/30' },
  info:    { bg: 'bg-info-soft',    text: 'text-info',      halo: 'bg-info/30' },
  warning: { bg: 'bg-warning-soft', text: 'text-warning',   halo: 'bg-warning/30' },
  danger:  { bg: 'bg-danger-soft',  text: 'text-danger',    halo: 'bg-danger/30' },
  neutral: { bg: 'bg-slate-100',    text: 'text-slate-500', halo: 'bg-slate-300/30' },
}

export function IconChip({
  tone = 'brand',
  children,
  className,
}: {
  tone?: Tone
  children: React.ReactNode
  className?: string
}) {
  const s = toneStyles[tone]
  return (
    <div className={cn('relative inline-flex', className)}>
      <span
        aria-hidden
        className={cn('absolute inset-0 -m-1.5 rounded-2xl blur-md', s.halo)}
      />
      <span
        className={cn(
          'relative inline-flex h-10 w-10 items-center justify-center rounded-xl',
          s.bg,
          s.text,
        )}
      >
        {children}
      </span>
    </div>
  )
}
