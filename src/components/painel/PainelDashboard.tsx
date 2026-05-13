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
  { t: '09:42', a: 'Renata C.', k: 'iniciou conversa', tag: 'CONVERSA' },
  { t: '09:38', a: 'Pedido #2841', k: 'foi confirmado', tag: 'PEDIDO' },
  { t: '09:31', a: 'Bia M.', k: 'enviou áudio', tag: 'CONVERSA' },
  { t: '09:24', a: 'Lead WhatsApp', k: 'capturado', tag: 'LEAD' },
]

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
            Sua loja está com{' '}
            <span className="font-semibold text-white">
              3 conversas em atendimento
            </span>{' '}
            agora e{' '}
            <span className="font-semibold text-white">
              2 atrasadas no SLA
            </span>
            . Comece pelo topo da fila.
          </p>

          {/* Inline glance numbers */}
          <div className="mt-7 flex items-stretch gap-7">
            <div>
              <div className="eyebrow text-brand-200">CONVERTIDO HOJE</div>
              <div
                className="font-display font-extrabold tabular mt-1.5"
                style={{ fontSize: '30px', lineHeight: 1 }}
              >
                R$ 4.218
              </div>
            </div>
            <div className="w-px bg-white/15" />
            <div>
              <div className="eyebrow text-brand-200">CONVERSAS · HOJE</div>
              <div
                className="font-display font-extrabold tabular mt-1.5"
                style={{ fontSize: '30px', lineHeight: 1 }}
              >
                28
                <span className="text-brand-300 text-[18px] ml-1">/40</span>
              </div>
            </div>
            <div className="w-px bg-white/15" />
            <div>
              <div className="eyebrow text-brand-200">RESPOSTA MÉDIA</div>
              <div
                className="font-display font-extrabold tabular mt-1.5"
                style={{ fontSize: '30px', lineHeight: 1 }}
              >
                4m12
                <span className="text-brand-300 text-[16px] ml-0.5">s</span>
              </div>
            </div>
          </div>

          <div className="mt-7 flex flex-wrap gap-2.5">
            <button className="inline-flex items-center gap-2 bg-white text-brand-700 hover:bg-brand-50 transition-colors text-[13px] font-semibold px-4 py-2.5 rounded-xl">
              Abrir fila de conversas{' '}
              <Icon name="arrow" className="w-4 h-4" />
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
                      <span className="font-semibold text-white">{e.a}</span>{' '}
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

/* ───────── QueueStripe ───────── */
const QUEUE: Array<{ tone: ChipTone; icon: string; label: string; value: string; sub: string }> = [
  { tone: 'info', icon: 'clock', label: 'Aguardando', value: '12', sub: 'TEMPO MÁX  15M' },
  { tone: 'brand', icon: 'msgSq', label: 'Atendendo', value: '03', sub: 'EQUIPE  4 ONLINE' },
  { tone: 'warn', icon: 'userX', label: 'Sem atendente', value: '05', sub: 'AÇÃO  REDIRECIONAR' },
  { tone: 'danger', icon: 'alert', label: 'Atrasadas SLA', value: '02', sub: 'STATUS  CRÍTICO' },
]

function QueueStripe() {
  return (
    <section className="mt-10">
      <div className="flex items-end justify-between mb-4">
        <div>
          <div className="eyebrow text-ink-500">OPERAÇÃO · TEMPO REAL</div>
          <h2
            className="font-display font-bold text-ink-900 tracking-tight mt-1"
            style={{ fontSize: '20px' }}
          >
            Minha fila hoje
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
        {QUEUE.map((q) => (
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

/* ───────── Funnel ───────── */
const FUNNEL = [
  { stage: 'Novo lead', count: 84, color: '#C4B5FD' },
  { stage: 'Em conversa', count: 31, color: '#A78BFA' },
  { stage: 'Proposta enviada', count: 12, color: '#8B5CF6' },
  { stage: 'Aguardando pagamento', count: 6, color: '#7C3AED' },
  { stage: 'Fechado', count: 4, color: '#5B21B6' },
]

function Funnel() {
  const max = Math.max(...FUNNEL.map((f) => f.count))
  return (
    <div className="card p-6 h-full">
      <div className="flex items-end justify-between mb-5">
        <div>
          <div className="eyebrow text-ink-500">PIPELINE · MAIO</div>
          <h2
            className="font-display font-bold text-ink-900 tracking-tight mt-1"
            style={{ fontSize: '20px' }}
          >
            Funil por estágio
          </h2>
        </div>
        <button className="text-[12.5px] font-semibold text-brand-700 hover:text-brand-800 inline-flex items-center gap-1">
          Ver tudo <Icon name="arrow" className="w-3.5 h-3.5" />
        </button>
      </div>

      <ul className="space-y-4">
        {FUNNEL.map((f) => (
          <li
            key={f.stage}
            className="grid grid-cols-[14px_1fr_56px] items-center gap-3"
          >
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{
                background: f.color,
                boxShadow: `0 0 0 3px ${f.color}22`,
              }}
            />
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-ink-800 truncate">
                {f.stage}
              </div>
              <div className="mt-2 h-[6px] rounded-full bg-ink-100 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(f.count / max) * 100}%`,
                    background: f.color,
                  }}
                />
              </div>
            </div>
            <span
              className="font-display font-bold tabular text-ink-900 text-right"
              style={{ fontSize: '17px' }}
            >
              {f.count}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-6 pt-5 border-t border-ink-100 grid grid-cols-2 gap-6">
        <div>
          <div className="eyebrow text-ink-500">TAXA DE CONVERSÃO</div>
          <div
            className="font-display font-bold tabular text-ink-900 mt-1.5 flex items-baseline gap-1"
            style={{ fontSize: '22px' }}
          >
            4,8<span className="text-ink-400 text-[15px]">%</span>
          </div>
        </div>
        <div>
          <div className="eyebrow text-ink-500">CICLO MÉDIO</div>
          <div
            className="font-display font-bold tabular text-ink-900 mt-1.5 flex items-baseline gap-1"
            style={{ fontSize: '22px' }}
          >
            2,3<span className="text-ink-400 text-[15px]">dias</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ───────── EmptyConversas ───────── */
function EmptyConversas() {
  return (
    <div className="card p-6 h-full flex flex-col">
      <div className="flex items-end justify-between mb-5">
        <div>
          <div className="eyebrow text-ink-500">ATIVIDADE · ÚLT. 24H</div>
          <h2
            className="font-display font-bold text-ink-900 tracking-tight mt-1"
            style={{ fontSize: '20px' }}
          >
            Conversas recentes
          </h2>
        </div>
        <button className="text-[12.5px] font-semibold text-ink-500 hover:text-ink-900 inline-flex items-center gap-1">
          Histórico <Icon name="arrow" className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center text-center px-2 py-8">
        <div className="max-w-[34ch]">
          <div className="relative inline-block mb-5">
            <div className="w-14 h-14 rounded-2xl bg-brand-50 ring-1 ring-brand-100 text-brand-700 flex items-center justify-center">
              <Icon name="inbox" className="w-6 h-6" />
            </div>
          </div>
          <div className="font-display font-bold text-ink-900 text-[17px]">
            Tudo limpo por aqui
          </div>
          <p className="mt-2 text-[13.5px] text-ink-500 leading-relaxed">
            Quando um cliente iniciar um chat pela sua URL pública, ele
            aparecerá aqui em tempo real — com prévia da última mensagem.
          </p>

          <div className="mt-5 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-ink-50 border border-ink-200">
            <span className="eyebrow text-ink-500">URL DO CHAT</span>
            <span className="font-mono text-[12px] text-ink-800 truncate max-w-[18ch]">
              lue.fz/zaira
            </span>
            <span className="w-px h-4 bg-ink-200" />
            <button className="text-[12px] font-semibold text-brand-700 hover:text-brand-800">
              Copiar
            </button>
          </div>
        </div>
      </div>
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
      <QueueStripe />

      {/* Resultado do mês */}
      <section className="mt-10">
        <SectionHeader
          eyebrow="DESEMPENHO · MAIO"
          title="Resultado do mês"
          action={
            <div className="inline-flex rounded-xl bg-white border border-ink-200 p-0.5 text-[12px] font-semibold">
              <button className="px-2.5 py-1 rounded-lg bg-ink-900 text-white">
                Mês
              </button>
              <button className="px-2.5 py-1 rounded-lg text-ink-600">
                Semana
              </button>
              <button className="px-2.5 py-1 rounded-lg text-ink-600">
                Hoje
              </button>
            </div>
          }
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            tone="success"
            icon="receipt"
            eyebrow="RECEITA DO MÊS"
            prefix="R$"
            value="47.832"
            delta="+12,4%"
            deltaTone="success"
            context="vs abril · projeção R$ 58.400"
            spark={[20, 22, 21, 24, 28, 27, 30, 33, 32, 36, 40, 44]}
            sparkColor="#10B981"
          />
          <StatCard
            tone="slate"
            icon="trend"
            eyebrow="TICKET MÉDIO"
            prefix="R$"
            value="248"
            delta="−R$ 12"
            deltaTone="danger"
            context="vs R$ 260 em abril"
            spark={[260, 258, 255, 252, 250, 255, 248, 251, 247, 250, 246, 248]}
            sparkColor="#6B7088"
          />
          <StatCard
            tone="brand"
            icon="userPlus"
            eyebrow="LEADS NOVOS"
            value="84"
            suffix="leads"
            delta="+8"
            deltaTone="success"
            context="esta semana · 12/dia em média"
            spark={[2, 3, 4, 3, 5, 7, 6, 8, 7, 10, 9, 12]}
            sparkColor="#7C3AED"
          />
        </div>
      </section>

      {/* Operação / Estoque */}
      <section className="mt-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            tone="warn"
            icon="mailWarn"
            eyebrow="LEADS SEM RESPOSTA"
            value="07"
            delta="ALERTA"
            deltaTone="slate"
            context="última pendência há 2h"
          />
          <StatCard
            tone="slate"
            icon="timer"
            eyebrow="TEMPO MÉDIO DE RESPOSTA"
            value="4m"
            suffix="12s"
            delta="DENTRO DA META"
            deltaTone="success"
            context="meta < 5m"
          />
          <StatCard
            tone="danger"
            icon="boxAlert"
            eyebrow="ESTOQUE CRÍTICO"
            value="09"
            suffix="SKUs"
            delta="−3 hoje"
            deltaTone="danger"
            context="2 esgotados · 7 abaixo do mínimo"
          />
        </div>
      </section>

      {/* Funnel + Recentes */}
      <section className="mt-10 grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-4">
        <Funnel />
        <EmptyConversas />
      </section>

      <footer className="mt-12 mb-4 flex items-center justify-between text-[12px] text-ink-400">
        <div className="eyebrow">LUE FZ · v0.4.0 · BUILD 1284</div>
        <div className="eyebrow">DADOS · 09:42 · PT-BR · UTC−3</div>
      </footer>
    </div>
  )
}
