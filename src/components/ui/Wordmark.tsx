import { cn } from '@/lib/utils'

const sizes = {
  sm: 'text-lg',
  md: 'text-2xl',
  lg: 'text-4xl',
} as const

export function Wordmark({
  size = 'md',
  className,
}: {
  size?: keyof typeof sizes
  className?: string
}) {
  return (
    <span
      className={cn(
        'font-display font-extrabold tracking-[-0.04em] leading-none',
        sizes[size],
        className,
      )}
    >
      <span className="bg-brand-gradient bg-clip-text text-transparent">L</span>UE
    </span>
  )
}
