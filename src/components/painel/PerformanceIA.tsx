'use client'

type Row = {
  metric: string
  d1: string
  d7: string
  delta?: string
  deltaTone?: 'success' | 'danger' | 'slate'
}

const ROWS: Row[] = [
  { metric: 'Sessões atendidas',       d1: '312',         d7: '2 104',  delta: '+12,1%',  deltaTone: 'success' },
  { metric: 'Mensagens da IA',         d1: '1 847',       d7: '12 308', delta: '+9,8%',   deltaTone: 'success' },
  { metric: 'Captura (lead/sessão)',   d1: '15,1%',       d7: '14,2%',  delta: '+0,9pp',  deltaTone: 'success' },
  { metric: 'Handoff p/ humano',       d1: '6,4%',        d7: '7,1%',   delta: '−0,7pp',  deltaTone: 'success' },
  { metric: 'Abandono mid-chat',       d1: '22,7%',       d7: '24,0%',  delta: '−1,3pp',  deltaTone: 'success' },
  { metric: 'Latência p50 / p95',      d1: '0,8 / 1,8s',  d7: '—',      delta: '—',       deltaTone: 'slate' },
  { metric: 'Tokens consumidos',       d1: '412k',        d7: '2,8M',   delta: '—',       deltaTone: 'slate' },
]

const deltaCls: Record<NonNullable<Row['deltaTone']>, string> = {
  success: 'text-success-700 bg-success-50 ring-success-100',
  danger:  'text-danger-700 bg-danger-50 ring-danger-100',
  slate:   'text-ink-500 bg-ink-50 ring-ink-100',
}

export function PerformanceIA() {
  return (
    <div className="card p-0 h-full">
      <div className="flex items-end justify-between px-6 pt-6 pb-5">
        <div>
          <div className="eyebrow text-ink-500">DESEMPENHO · IA</div>
          <h2
            className="font-display font-bold text-ink-900 tracking-tight mt-1"
            style={{ fontSize: '20px' }}
          >
            Performance da IA
          </h2>
        </div>
        <div className="inline-flex rounded-xl bg-white border border-ink-200 p-0.5 text-[12px] font-semibold">
          <button className="px-2.5 py-1 rounded-lg bg-ink-900 text-white">24h</button>
          <button className="px-2.5 py-1 rounded-lg text-ink-600">7d</button>
        </div>
      </div>

      <div className="overflow-hidden">
        <div className="grid grid-cols-[1fr_92px_92px_92px] eyebrow text-ink-400 px-6 py-2 bg-ink-50/60 border-y border-ink-100">
          <div>MÉTRICA</div>
          <div className="text-right">24H</div>
          <div className="text-right">7D</div>
          <div className="text-right">Δ</div>
        </div>
        <ul className="divide-y divide-ink-100">
          {ROWS.map((r) => (
            <li
              key={r.metric}
              className="grid grid-cols-[1fr_92px_92px_92px] items-center px-6 py-3"
            >
              <span className="text-[13.5px] text-ink-800">{r.metric}</span>
              <span className="font-mono tabular text-[13px] text-right text-ink-900">
                {r.d1}
              </span>
              <span className="font-mono tabular text-[13px] text-right text-ink-700">
                {r.d7}
              </span>
              <span className="text-right">
                <span
                  className={`inline-flex items-center gap-1 text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded-md tabular ring-1 ${deltaCls[r.deltaTone ?? 'slate']}`}
                >
                  {r.delta}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
