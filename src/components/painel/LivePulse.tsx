'use client'

import type { PainelPulse } from '@/actions/painel'

export function LivePulse({
  pulse,
  visitors,
}: {
  pulse: PainelPulse
  visitors: number
}) {
  return (
    <div className="mt-12 -mx-8 px-8 py-3 border-t border-ink-100 bg-ink-50/60 font-mono text-[12px] text-ink-500 flex items-center gap-2 flex-wrap">
      <span className="live-dot" />
      <span className="font-semibold text-ink-700">LIVE</span>
      <span className="text-ink-300">·</span>
      <span>
        <span className="text-ink-700 font-semibold">
          {pulse.activeAiSessions}
        </span>{' '}
        sessões
      </span>
      <span className="text-ink-300">·</span>
      <span>
        <span className="text-ink-700 font-semibold">{visitors}</span>{' '}
        visitantes
      </span>
      <span className="text-ink-300">·</span>
      <span>
        IA p95 <span className="text-ink-700 font-semibold">1,8s</span>
      </span>
      <span className="text-ink-300">·</span>
      <span>
        fila{' '}
        <span className="text-ink-700 font-semibold">
          {pulse.awaitingContact}
        </span>
      </span>
      <span className="text-ink-300">·</span>
      <span>
        vendedores <span className="text-ink-700 font-semibold">2/4</span> ON
      </span>
      <span className="text-ink-300">·</span>
      <span>
        últ. evento <span className="text-ink-700 font-semibold">00:03s</span>
      </span>
      <span className="text-ink-300 ml-auto">·</span>
      <span className="eyebrow text-ink-400">LUE FZ v0.4.0 · BUILD 1284</span>
    </div>
  )
}
