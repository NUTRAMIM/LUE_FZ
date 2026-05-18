'use client'

import { Icon, Chip, type ChipTone } from './Icons'
import type { PainelPulse } from '@/actions/painel'
import { formatLatency } from './formatters'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function PulseStripe({
  pulse,
  visitors,
}: {
  pulse: PainelPulse
  visitors: number
}) {
  const cards: Array<{
    tone: ChipTone
    icon: string
    label: string
    value: string
    sub: string
  }> = [
    {
      tone: 'brand',
      icon: 'msgSq',
      label: 'Sessões IA ativas',
      value: pad(pulse.activeAiSessions),
      sub: `IA RESPONDENDO  ·  p95 ${formatLatency(pulse.aiLatencyP95Ms)}`,
    },
    {
      tone: 'info',
      icon: 'eye',
      label: 'Visitantes na loja',
      value: pad(visitors),
      sub: 'AO VIVO',
    },
    {
      tone: 'warn',
      icon: 'userX',
      label: 'Leads sem atribuição',
      value: pad(pulse.awaitingContact),
      sub: 'AÇÃO  ATRIBUIR',
    },
  ]

  return (
    <section className="mt-10">
      <div className="flex items-end justify-between mb-4">
        <div>
          <div className="eyebrow text-ink-500">OPERAÇÃO · TEMPO REAL</div>
          <h2
            className="font-display font-bold text-ink-900 tracking-tight mt-1"
            style={{ fontSize: '20px' }}
          >
            Pulso ao vivo
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-success-700 bg-success-50 ring-1 ring-success-100 px-2 py-1 rounded-md">
            <span className="live-dot" /> Atualizando ao vivo
          </span>
          <button className="text-[12.5px] font-semibold text-ink-600 hover:text-ink-900 inline-flex items-center gap-1 px-2 py-1">
            Filtrar <Icon name="chev" className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="card grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-ink-100 overflow-hidden">
        {cards.map((q) => (
          <div key={q.label} className="p-6 relative">
            <div className="flex items-center gap-2.5">
              <Chip tone={q.tone} name={q.icon} />
              <span className="text-[13px] font-semibold text-ink-700">
                {q.label}
              </span>
            </div>
            <div
              className="mt-4 font-display font-extrabold tabular text-ink-900 leading-none"
              style={{ fontSize: '56px' }}
            >
              {q.value}
            </div>
            <div className="eyebrow text-ink-400 mt-3">{q.sub}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
