'use client'

import { Icon } from './Icons'
import type { PainelPulse } from '@/actions/painel'
import { captureRatePct, formatPercent1 } from './formatters'

const ACTIVITY = [
  { t: '09:42', a: 'vis_4f1c', k: 'sessão iniciada', tag: 'CHAT' },
  { t: '09:39', a: '#2841', k: 'lead capturado', tag: 'LEAD' },
  { t: '09:36', a: '#2837', k: 'handoff → Camila R.', tag: 'HANDOFF' },
] as const

export function Hero({
  pulse,
  greeting,
  clock,
}: {
  pulse: PainelPulse
  greeting: string
  clock: string
}) {
  const captureRate = formatPercent1(
    captureRatePct(pulse.leadsToday, pulse.sessionsToday),
  )
  return (
    <div className="relative overflow-hidden rounded-3xl text-white hero-surface">
      <div className="hero-grain" />
      <div
        className="hero-ring"
        style={{ width: 520, height: 520, right: -180, top: -220 }}
      />
      <div
        className="hero-ring"
        style={{ width: 340, height: 340, right: -80, top: -100 }}
      />

      <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10 p-8 md:p-10">
        <div className="min-w-0">
          <div className="flex items-center gap-2 eyebrow text-brand-200">
            <span
              className="live-dot"
              style={{
                background: '#A78BFA',
                boxShadow: '0 0 0 4px rgba(167,139,250,0.22)',
              }}
            />
            {greeting} · {clock}
          </div>
          <h1
            className="font-display font-extrabold leading-[1.02] tracking-tight mt-3"
            style={{ fontSize: '48px' }}
          >
            Bem-vinda, Mariana.
          </h1>
          <p className="mt-3.5 text-[15px] text-brand-100/90 max-w-[44ch] leading-relaxed">
            Sua IA capturou{' '}
            <span className="font-semibold text-white">
              {pulse.leadsWeek} leads esta semana
            </span>
            .{' '}
            <span className="font-semibold text-white">
              {pulse.awaitingContact} aguardam contato
            </span>{' '}
            do seu time —{' '}
            <span className="font-semibold text-white">
              {pulse.stale1h} parados há &gt; 1h
            </span>
            .
          </p>

          <div className="mt-7 flex items-stretch gap-7">
            <div>
              <div className="eyebrow text-brand-200">CAPTURADOS HOJE</div>
              <div
                className="font-display font-extrabold tabular mt-1.5"
                style={{ fontSize: '30px', lineHeight: 1 }}
              >
                {pulse.leadsToday}
              </div>
            </div>
            <div className="w-px bg-white/15" />
            <div>
              <div className="eyebrow text-brand-200">TAXA DE CAPTURA</div>
              <div
                className="font-display font-extrabold tabular mt-1.5"
                style={{ fontSize: '30px', lineHeight: 1 }}
              >
                {captureRate}
              </div>
            </div>
            <div className="w-px bg-white/15" />
            <div>
              <div className="eyebrow text-brand-200">LATÊNCIA IA · p95</div>
              <div
                className="font-display font-extrabold tabular mt-1.5"
                style={{ fontSize: '30px', lineHeight: 1 }}
              >
                1,8
                <span className="text-brand-300 text-[16px] ml-0.5">s</span>
              </div>
            </div>
          </div>

          <div className="mt-7 flex flex-wrap gap-2.5">
            <button className="inline-flex items-center gap-2 bg-white text-brand-700 hover:bg-brand-50 transition-colors text-[13px] font-semibold px-4 py-2.5 rounded-xl">
              Abrir fila de leads <Icon name="arrow" className="w-4 h-4" />
            </button>
            <button className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/15 transition-colors text-white text-[13px] font-semibold px-4 py-2.5 rounded-xl ring-1 ring-white/15">
              Ver relatório do dia
            </button>
          </div>
        </div>

        <div className="relative">
          <div className="rounded-2xl bg-white/[0.06] ring-1 ring-white/10 backdrop-blur-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-3.5 pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <span className="live-dot" />
                <span className="eyebrow text-brand-100">ATIVIDADE AO VIVO</span>
              </div>
              <span className="eyebrow text-brand-200/80">ÚLT. 1H</span>
            </div>
            <ul className="divide-y divide-white/10">
              {ACTIVITY.map((e, i) => (
                <li key={i} className="px-4 py-3 flex items-center gap-3">
                  <span className="eyebrow text-brand-300 tabular w-10 shrink-0">
                    {e.t}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] leading-snug truncate">
                      <span className="font-mono font-semibold text-white">
                        {e.a}
                      </span>{' '}
                      <span className="text-brand-100/80">{e.k}</span>
                    </div>
                  </div>
                  <span className="eyebrow text-brand-200/70">{e.tag}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
