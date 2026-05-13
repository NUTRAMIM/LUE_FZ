'use client'

type Stage = {
  stage: string
  hint?: string
  count: number
  pct: number
  drop?: number
  color: string
}

const STAGES: Stage[] = [
  { stage: 'Visitas únicas',         count: 1284, pct: 100.0,                 color: '#C4B5FD' },
  { stage: 'Sessões de chat',        count:  312, pct:  24.3, drop: -75.7,    color: '#A78BFA' },
  { stage: 'Conversa qualificada',   hint: '≥ 3 mensagens', count: 188, pct: 14.6, drop: -39.7, color: '#8B5CF6' },
  { stage: 'Lead capturado',         hint: 'contato confirmado', count: 47, pct: 3.7, drop: -75.0, color: '#7C3AED' },
  { stage: 'Aceito pelo vendedor',   count:   31, pct:   2.4, drop: -34.0,    color: '#6D28D9' },
  { stage: 'Fechado (marcado)',      count:    8, pct:   0.6, drop: -74.2,    color: '#5B21B6' },
]

const SUMMARY = {
  visToLead: '3,7%',
  leadToClose: '17,0%',
  cycleDays: '2,3',
}

export function FunilCaptura() {
  const max = Math.max(...STAGES.map((s) => s.count))
  return (
    <div className="card p-6">
      <div className="flex items-end justify-between mb-5">
        <div>
          <div className="eyebrow text-ink-500">PIPELINE · MAIO</div>
          <h2
            className="font-display font-bold text-ink-900 tracking-tight mt-1"
            style={{ fontSize: '20px' }}
          >
            Funil de captura
          </h2>
        </div>
        <div className="inline-flex rounded-xl bg-white border border-ink-200 p-0.5 text-[12px] font-semibold">
          <button className="px-2.5 py-1 rounded-lg text-ink-600">Hoje</button>
          <button className="px-2.5 py-1 rounded-lg text-ink-600">Semana</button>
          <button className="px-2.5 py-1 rounded-lg bg-ink-900 text-white">Mês</button>
        </div>
      </div>

      <ul className="space-y-4">
        {STAGES.map((s) => (
          <li
            key={s.stage}
            className="grid grid-cols-[14px_1fr_72px_56px] items-center gap-3"
          >
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{
                background: s.color,
                boxShadow: `0 0 0 3px ${s.color}22`,
              }}
            />
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-ink-800 truncate">
                {s.stage}
                {s.hint && (
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
              {s.pct.toFixed(1)}%
            </span>
            <span
              className="font-display font-bold tabular text-ink-900 text-right"
              style={{ fontSize: '17px' }}
            >
              {s.count.toLocaleString('pt-BR')}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 pt-4 border-t border-ink-100">
        <div className="eyebrow text-ink-400 mb-3">DROP-OFF ENTRE ETAPAS</div>
        <div className="grid grid-cols-5 gap-2">
          {STAGES.slice(1).map((s, i) => (
            <div
              key={i}
              className="text-center px-2 py-2 rounded-lg bg-ink-50 ring-1 ring-ink-100"
            >
              <div className="eyebrow text-ink-400">ETAPA {i + 2}</div>
              <div className="font-mono tabular text-[13px] font-semibold text-danger-700 mt-1">
                {s.drop?.toFixed(1)}%
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
            {SUMMARY.visToLead}
          </div>
        </div>
        <div>
          <div className="eyebrow text-ink-500">TAXA LEAD → FECHADO</div>
          <div
            className="font-display font-bold tabular text-ink-900 mt-1.5"
            style={{ fontSize: '22px' }}
          >
            {SUMMARY.leadToClose}
          </div>
        </div>
        <div>
          <div className="eyebrow text-ink-500">CICLO MÉDIO</div>
          <div
            className="font-display font-bold tabular text-ink-900 mt-1.5 flex items-baseline gap-1"
            style={{ fontSize: '22px' }}
          >
            {SUMMARY.cycleDays}
            <span className="text-ink-400 text-[15px]">dias</span>
          </div>
        </div>
      </div>
    </div>
  )
}
