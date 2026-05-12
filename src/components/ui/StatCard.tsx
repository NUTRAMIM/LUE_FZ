import { cn } from '@/lib/utils'
import { IconChip, type Tone } from './IconChip'

const valueTone: Record<Tone, string> = {
  brand: 'text-brand-600',
  success: 'text-success',
  info: 'text-info',
  warning: 'text-warning',
  danger: 'text-danger',
  neutral: 'text-slate-900',
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'brand',
  icon,
  emphasis = 'default',
}: {
  label: string
  value: React.ReactNode
  hint?: string
  tone?: Tone
  icon?: React.ReactNode
  emphasis?: 'default' | 'value'
}) {
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-2xl bg-white border border-slate-200/80 px-5 pt-4 pb-5',
        'shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-200',
        'hover:shadow-[0_12px_28px_-14px_rgba(124,58,237,0.22)] hover:-translate-y-px',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.10em] text-slate-500">
          {label}
        </p>
        {icon ? <IconChip tone={tone}>{icon}</IconChip> : null}
      </div>
      <p
        className={cn(
          'mt-3 font-display font-bold tabular-nums leading-none text-3xl',
          emphasis === 'value' ? valueTone[tone] : 'text-slate-900',
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-2 text-xs text-slate-500">{hint}</p> : null}
    </div>
  )
}
