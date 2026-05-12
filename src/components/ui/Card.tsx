import { cn } from '@/lib/utils'

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-2xl bg-white border border-slate-200/80',
        'shadow-[0_1px_2px_rgba(15,23,42,0.04)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
