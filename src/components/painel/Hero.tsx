'use client'

import Link from 'next/link'
import { Icon } from './Icons'
import type { PainelPulse, ActivityEvent } from '@/actions/painel'
import {
  captureRatePct,
  formatPercent1,
  formatLatency,
  formatPainelClock,
} from './formatters'

export function Hero({
  pulse,
  greeting,
  clock,
  activity,
  ownerName,
}: {
  pulse: PainelPulse
  greeting: string
  clock: string
  activity: ActivityEvent[]
  ownerName: string
}) {
  const captureRate = formatPercent1(
    captureRatePct(pulse.leadsToday, pulse.sessionsToday),
  )
  const hello = ownerName ? `Olá, ${ownerName}.` : 'Olá.'
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

      <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8 md:gap-10 p-5 sm:p-7 md:p-10">
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
          <div
            className="font-display font-extrabold leading-[1.02] tracking-tight mt-3 text-[32px] sm:text-[40px] md:text-[48px]"
          >
            {hello}
          </div>
          <p className="mt-3.5 text-[14px] sm:text-[15px] text-brand-100/90 max-w-[44ch] leading-relaxed">
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

          <div className="mt-6 md:mt-7 grid grid-cols-3 gap-4 sm:gap-6 md:flex md:items-stretch md:gap-7">
            <div className="min-w-0">
              <div className="eyebrow text-brand-200 truncate">CAPTURADOS HOJE</div>
              <div
                className="font-display font-extrabold tabular mt-1.5 text-[22px] sm:text-[26px] md:text-[30px] leading-none"
              >
                {pulse.leadsToday}
              </div>
            </div>
            <div className="hidden md:block w-px bg-white/15" />
            <div className="min-w-0 border-l border-white/15 pl-4 sm:pl-6 md:border-l-0 md:pl-0">
              <div className="eyebrow text-brand-200 truncate">TAXA DE CAPTURA</div>
              <div
                className="font-display font-extrabold tabular mt-1.5 text-[22px] sm:text-[26px] md:text-[30px] leading-none"
              >
                {captureRate}
              </div>
            </div>
            <div className="hidden md:block w-px bg-white/15" />
            <div className="min-w-0 border-l border-white/15 pl-4 sm:pl-6 md:border-l-0 md:pl-0">
              <div className="eyebrow text-brand-200 truncate">LATÊNCIA · p95</div>
              <div
                className="font-display font-extrabold tabular mt-1.5 text-[22px] sm:text-[26px] md:text-[30px] leading-none"
              >
                {formatLatency(pulse.aiLatencyP95Ms)}
              </div>
            </div>
          </div>

          <div className="mt-7 flex flex-wrap gap-2.5">
            <Link
              href="/leads"
              className="inline-flex items-center gap-2 bg-white text-brand-700 hover:bg-brand-50 transition-colors text-[13px] font-semibold px-4 py-2.5 rounded-xl"
            >
              Abrir fila de leads <Icon name="arrow" className="w-4 h-4" />
            </Link>
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
              {activity.length === 0 && (
                <li className="px-4 py-6 text-center text-[13px] text-brand-200/70">
                  Sem atividade na última hora
                </li>
              )}
              {activity.map((e) => (
                <li
                  key={`${e.tag}-${e.time}-${e.identifier}`}
                  className="px-4 py-3 flex items-center gap-3"
                >
                  <span className="eyebrow text-brand-300 tabular w-10 shrink-0">
                    {formatPainelClock(new Date(e.time))}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] leading-snug truncate">
                      <span className="font-mono font-semibold text-white">
                        {e.identifier}
                      </span>{' '}
                      <span className="text-brand-100/80">{e.label}</span>
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
