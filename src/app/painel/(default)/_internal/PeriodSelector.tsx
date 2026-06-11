'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { Periodo } from '@/lib/admin-usage'

const OPCOES: { value: Periodo; label: string }[] = [
  { value: 'dia', label: 'Dia' },
  { value: 'semana', label: 'Semana' },
  { value: 'mes', label: 'Mês' },
]

export function PeriodSelector({ active }: { active: Periodo }) {
  const pathname = usePathname()
  return (
    <div className="inline-flex items-center gap-1 rounded-xl bg-ink-100 p-1">
      {OPCOES.map((o) => {
        const is = o.value === active
        return (
          <Link
            key={o.value}
            href={`${pathname}?periodo=${o.value}`}
            scroll={false}
            className={`px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors ${
              is
                ? 'bg-white text-ink-900 shadow-[0_1px_2px_rgba(15,23,42,0.06)]'
                : 'text-ink-500 hover:text-ink-900'
            }`}
          >
            {o.label}
          </Link>
        )
      })}
    </div>
  )
}
