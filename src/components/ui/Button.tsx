import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 ' +
    'shadow-[0_6px_18px_-6px_rgba(124,58,237,0.55)] focus-visible:ring-brand-400',
  secondary:
    'bg-white text-slate-900 border border-slate-200 hover:bg-slate-50 ' +
    'active:bg-slate-100 focus-visible:ring-brand-300',
  ghost:
    'bg-transparent text-slate-700 hover:bg-slate-100 active:bg-slate-200 ' +
    'focus-visible:ring-brand-300',
  danger:
    'bg-danger text-white hover:brightness-95 active:brightness-90 ' +
    'focus-visible:ring-danger',
}

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs rounded-lg gap-1.5',
  md: 'h-10 px-4 text-sm rounded-lg gap-2',
  lg: 'h-11 px-5 text-sm rounded-xl gap-2',
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: { variant?: Variant; size?: Size } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center font-semibold transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
