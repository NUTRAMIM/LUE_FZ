'use client'

import { useId } from 'react'
import { Icon, Chip, type ChipTone } from './Icons'

/* ───────── Topbar ───────── */
function Topbar() {
  return (
    <div className="flex items-center justify-between mb-7">
      <div>
        <div className="eyebrow text-ink-500">PAINEL · OPERAÇÃO</div>
        <h1
          className="font-display font-bold text-ink-900 tracking-tight mt-1.5"
          style={{ fontSize: '26px', lineHeight: 1.1 }}
        >
          Visão geral · sexta, 12 mai
        </h1>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative">
          <Icon
            name="search"
            className="w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2"
          />
          <input
            placeholder="Buscar conversas, produtos, pedidos…"
            className="w-[300px] pl-9 pr-12 py-2.5 rounded-xl bg-white border border-ink-200 text-[13px] placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 eyebrow text-ink-400 bg-ink-50 px-1.5 py-0.5 rounded-md">
            ⌘K
          </span>
        </div>
        <button className="relative w-10 h-10 rounded-xl bg-white border border-ink-200 text-ink-600 hover:text-ink-900 hover:bg-ink-50 flex items-center justify-center">
          <Icon name="bell" className="w-4 h-4" />
          <span className="absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full bg-brand-600 ring-2 ring-white" />
        </button>
      </div>
    </div>
  )
}

/* ───────── Hero ───────── */
const ACTIVITY = [
  { t: '09:42', a: 'vis_4f1c', k: 'sessão iniciada', tag: 'CHAT' },
  { t: '09:39', a: '#2841', k: 'lead capturado', tag: 'LEAD' },
  { t: '09:36', a: '#2837', k: 'handoff → Camila R.', tag: 'HANDOFF' },
  { t: '09:31', a: 'vis_a02e', k: 'sessão expirou (180s)', tag: 'CHAT' },
] as const

function Hero() {
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
        {/* Left */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 eyebrow text-brand-200">
            <span
              className="live-dot"
              style={{
                background: '#A78BFA',
                boxShadow: '0 0 0 4px rgba(167,139,250,0.22)',
              }}
            />
            BOM DIA · 09:42
          </div>
          <h1
            className="font-display font-extrabold leading-[1.02] tracking-tight mt-3"
            style={{ fontSize: '48px' }}
          >
            Bem-vinda, Mariana.
          </h1>
          <p className="mt-3.5 text-[15px] text-brand-100/90 max-w-[44ch] leading-relaxed">
            Sua IA capturou{' '}
            <span className="font-semibold text-white">47 leads esta semana</span>
            . <span className="font-semibold text-white">31 aguardam contato</span> do
            seu time —{' '}
            <span className="font-semibold text-white">3 parados há &gt; 1h</span>.
          </p>

          {/* Inline glance numbers */}
          <div className="mt-7 flex items-stretch gap-7">
            <div>
              <div className="eyebrow text-brand-200">CAPTURADOS HOJE</div>
              <div
                className="font-display font-extrabold tabular mt-1.5"
                style={{ fontSize: '30px', lineHeight: 1 }}
              >
                47
                <span className="text-brand-300 text-[18px] ml-1">/60</span>
              </div>
            </div>
            <div className="w-px bg-white/15" />
            <div>
              <div className="eyebrow text-brand-200">TAXA DE CAPTURA</div>
              <div
                className="font-display font-extrabold tabular mt-1.5"
                style={{ fontSize: '30px', lineHeight: 1 }}
              >
                15,1
                <span className="text-brand-300 text-[18px] ml-0.5">%</span>
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

        {/* Right — activity ticker */}
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
                      <span className="font-mono font-semibold text-white">{e.a}</span>{' '}
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

/* ───────── PulseStripe ───────── */
const PULSE: Array<{ tone: ChipTone; icon: string; label: string; value: string; sub: string }> = [
  { tone: 'brand', icon: 'msgSq', label: 'Sessões IA ativas', value: '03', sub: 'IA RESPONDENDO  ·  p95 1,8s' },
  { tone: 'info', icon: 'eye', label: 'Visitantes na loja', value: '17', sub: 'PICO 09H–11H' },
  { tone: 'warn', icon: 'userX', label: 'Leads sem atribuição', value: '05', sub: 'AÇÃO  ATRIBUIR' },
  { tone: 'danger', icon: 'clock', label: 'Leads atrasados > 30min', value: '02', sub: 'STATUS  CRÍTICO' },
]

function PulseStripe() {
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

      <div className="card grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-ink-100 overflow-hidden">
        {PULSE.map((q) => (
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

/* ───────── Sparkline ───────── */
function Sparkline({
  points,
  color = '#7C3AED',
  width = 110,
  height = 34,
}: {
  points: number[]
  color?: string
  width?: number
  height?: number
}) {
  const id = useId()
  const gid = `g${id.replace(/:/g, '')}`
  const min = Math.min(...points)
  const max = Math.max(...points)
  const sx = (i: number) => (i / (points.length - 1)) * width
  const sy = (v: number) =>
    height - ((v - min) / Math.max(1, max - min)) * (height - 4) - 2
  const d = points
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`)
    .join(' ')
  const a = `${d} L${width},${height} L0,${height} Z`
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
    >
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={a} fill={`url(#${gid})`} />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/* ───────── StatCard ───────── */
type StatCardProps = {
  tone: ChipTone
  icon: string
  eyebrow: string
  value: string
  prefix?: string
  suffix?: string
  delta?: string
  deltaTone?: 'success' | 'danger' | 'slate' | 'info'
  context?: string
  spark?: number[]
  sparkColor?: string
}

function StatCard({
  tone,
  icon,
  eyebrow,
  value,
  prefix,
  suffix,
  delta,
  deltaTone = 'success',
  context,
  spark,
  sparkColor,
}: StatCardProps) {
  const deltaCls = {
    success: 'text-success-700 bg-success-50 ring-success-100',
    danger: 'text-danger-700 bg-danger-50 ring-danger-100',
    slate: 'text-ink-700 bg-ink-100 ring-ink-200',
    info: 'text-info-700 bg-info-50 ring-info-100',
  }[deltaTone]
  return (
    <div className="card card-hov p-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <Chip tone={tone} name={icon} />
          <span className="eyebrow text-ink-500">{eyebrow}</span>
        </div>
        {delta && (
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md tabular ring-1 ${deltaCls}`}
          >
            {delta}
          </span>
        )}
      </div>

      <div className="mt-5 flex items-end justify-between gap-4">
        <div className="flex items-baseline gap-1.5 min-w-0">
          {prefix && (
            <span className="font-display font-semibold text-ink-400 text-[18px] tabular">
              {prefix}
            </span>
          )}
          <span
            className="font-display font-extrabold tabular text-ink-900 leading-none"
            style={{ fontSize: '42px' }}
          >
            {value}
          </span>
          {suffix && (
            <span className="font-display font-semibold text-ink-400 text-[15px] tabular ml-0.5">
              {suffix}
            </span>
          )}
        </div>
        {spark && <Sparkline points={spark} color={sparkColor || '#7C3AED'} />}
      </div>

      {context && (
        <div className="mt-3 text-[12.5px] text-ink-500 truncate">{context}</div>
      )}
    </div>
  )
}

/* ───────── SectionHeader ───────── */
function SectionHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string
  title: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-end justify-between mb-4">
      <div>
        <div className="eyebrow text-ink-500">{eyebrow}</div>
        <h2
          className="font-display font-bold text-ink-900 tracking-tight mt-1"
          style={{ fontSize: '20px' }}
        >
          {title}
        </h2>
      </div>
      {action}
    </div>
  )
}

/* ───────── PainelDashboard ───────── */
export function PainelDashboard() {
  return (
    <div className="max-w-[1280px] mx-auto px-8 py-7">
      <Topbar />
      <Hero />
      <PulseStripe />

      <footer className="mt-12 mb-4 flex items-center justify-between text-[12px] text-ink-400">
        <div className="eyebrow">LUE FZ · v0.4.0 · BUILD 1284</div>
        <div className="eyebrow">DADOS · 09:42 · PT-BR · UTC−3</div>
      </footer>
    </div>
  )
}
