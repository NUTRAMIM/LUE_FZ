export function BrandHero({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  action?: React.ReactNode
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-brand-gradient p-6 md:p-8 text-white shadow-[0_24px_60px_-30px_rgba(76,29,149,0.55)]">
      {/* Decorative orbs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-28 -right-20 h-72 w-72 rounded-full bg-white/12 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -left-10 h-64 w-64 rounded-full bg-fuchsia-300/20 blur-3xl"
      />
      {/* Subtle grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage:
            'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          {eyebrow && (
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/70">
              {eyebrow}
            </p>
          )}
          <h2 className="mt-1 font-display text-2xl font-bold tracking-tight md:text-3xl">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-1 text-sm text-white/80 md:text-base">{subtitle}</p>
          )}
        </div>
        {action}
      </div>
    </div>
  )
}
