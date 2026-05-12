import { cn } from '@/lib/utils'

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-11 w-full rounded-lg border border-slate-200 bg-white px-3.5 text-sm text-slate-900',
        'placeholder:text-slate-400',
        'focus:outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-100',
        'transition-all duration-150',
        className,
      )}
      {...props}
    />
  )
}

export function Label({
  className,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        'block text-[11px] font-semibold uppercase tracking-[0.10em] text-slate-600 mb-1.5',
        className,
      )}
      {...props}
    >
      {children}
    </label>
  )
}
