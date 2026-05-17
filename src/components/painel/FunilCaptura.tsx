'use client'

import type { FunnelData } from '@/actions/painel'
import type { FunnelRange } from './formatters'
import { dropOffPct, formatIntBr, formatPercent1 } from './formatters'

const STAGE_META = [
  { stage: 'Visitas únicas', color: '#C4B5FD' },
  { stage: 'Sessões de chat', color: '#A78BFA' },
  { stage: 'Conversa qualificada', hint: '≥ 3 mensagens', color: '#8B5CF6' },
  { stage: 'Lead capturado', hint: 'contato confirmado', color: '#7C3AED' },
  { stage: 'Aceito pelo vendedor', color: '#6D28D9' },
  { stage: 'Fechado (marcado)', color: '#5B21B6' },
] as const

const RANGE_LABELS: Array<{ key: FunnelRange; label: string }> = [
  { key: 'day', label: 'Hoje' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mês' },
]

export function FunilCaptura({
  funnel,
  range,
  onRangeChange,
}: {
  funnel: FunnelData
  range: FunnelRange
  onRangeChange: (r: FunnelRange) => void
}) {
  const counts = [
    funnel.uniqueVisits,
    funnel.chatSessions,
    funnel.qualified,
    funnel.leadCaptured,
    funnel.vendorAccepted,
    funnel.closed,
  ]
  const max = Math.max(...counts, 1)
  const top = counts[0] || 1

  const stages = STAGE_META.map((meta, i) => ({
    ...meta,
    count: counts[i],
    pct: (counts[i] / top) * 100,
    drop: i === 0 ? undefined : dropOffPct(counts[i - 1], counts[i]),
  }))

  const visToLead = formatPercent1(
    funnel.uniqueVisits > 0
      ? (funnel.leadCaptured / funnel.uniqueVisits) * 100
      : 0,
  )
  const leadToClose = formatPercent1(
    funnel.leadCaptured > 0
      ? (funnel.closed / funnel.leadCaptured) * 100
      : 0,
  )

  return (
    <div className="card p-6">
      <div className="flex items-end justify-between mb-5">
        <div>
          <div className="eyebrow text-ink-500">PIPELINE</div>
          <h2
            className="font-display font-bold text-ink-900 tracking-tight mt-1"
            style={{ fontSize: '20px' }}
          >
            Funil de captura
          </h2>
        </div>
        <div className="inline-flex rounded-xl bg-white border border-ink-200 p-0.5 text-[12px] font-semibold">
          {RANGE_LABELS.map((r) => (
            <button
              key={r.key}
              onClick={() => onRangeChange(r.key)}
              className={
                r.key === range
                  ? 'px-2.5 py-1 rounded-lg bg-ink-900 text-white'
                  : 'px-2.5 py-1 rounded-lg text-ink-600'
              }
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <ul className="space-y-4">
        {stages.map((s) => (
          <li
            key={s.stage}
            className="grid grid-cols-[14px_1fr_72px_56px] items-center gap-3"
          >
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: s.color, boxShadow: `0 0 0 3px ${s.color}22` }}
            />
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-ink-800 truncate">
                {s.stage}
                {'hint' in s && s.hint && (
                  <span className="ml-2 eyebrow text-ink-400 font-normal">
                    {s.hint}
                  </span>
                )}
              </div>
              <div className="mt-2 h-[6px] rounded-full bg-ink-100 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(s.count / max) * 100}%`,
                    background: s.color,
                  }}
                />
              </div>
            </div>
            <span className="font-mono tabular text-[12px] text-right text-ink-500">
              {formatPercent1(s.pct)}
            </span>
            <span
              className="font-display font-bold tabular text-ink-900 text-right"
              style={{ fontSize: '17px' }}
            >
              {formatIntBr(s.count)}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 pt-4 border-t border-ink-100">
        <div className="eyebrow text-ink-400 mb-3">DROP-OFF ENTRE ETAPAS</div>
        <div className="grid grid-cols-5 gap-2">
          {stages.slice(1).map((s, i) => (
            <div
              key={s.stage}
              className="text-center px-2 py-2 rounded-lg bg-ink-50 ring-1 ring-ink-100"
            >
              <div className="eyebrow text-ink-400">ETAPA {i + 2}</div>
              <div className="font-mono tabular text-[13px] font-semibold text-danger-700 mt-1">
                {formatPercent1(s.drop ?? 0)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 pt-5 border-t border-ink-100 grid grid-cols-3 gap-6">
        <div>
          <div className="eyebrow text-ink-500">TAXA VIS → LEAD</div>
          <div
            className="font-display font-bold tabular text-ink-900 mt-1.5"
            style={{ fontSize: '22px' }}
          >
            {visToLead}
          </div>
        </div>
        <div>
          <div className="eyebrow text-ink-500">TAXA LEAD → FECHADO</div>
          <div
            className="font-display font-bold tabular text-ink-900 mt-1.5"
            style={{ fontSize: '22px' }}
          >
            {leadToClose}
          </div>
        </div>
        <div>
          <div className="eyebrow text-ink-500">CICLO MÉDIO</div>
          <div
            className="font-display font-bold tabular text-ink-900 mt-1.5 flex items-baseline gap-1"
            style={{ fontSize: '22px' }}
          >
            {formatIntBr(funnel.cycleDays)}
            <span className="text-ink-400 text-[15px]">dias</span>
          </div>
        </div>
      </div>
    </div>
  )
}
