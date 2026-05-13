'use client'

import { useState } from 'react'
import { Icon } from '@/components/painel/Icons'

/* ───────── Types & mock data ───────── */

type Channel = 'WA' | 'SITE' | 'IG'
type Status = 'attending' | 'ia' | 'waiting' | 'sla' | 'closing'
type MsgFrom = 'them' | 'me' | 'ia'

type Message = {
  from: MsgFrom
  t: string
  text: string
  read?: boolean
}

type Tile = {
  id: string
  name: string
  initials: string
  avatarBg: string
  online: boolean
  ch: Channel
  ref: string
  status: Status
  elapsed: string
  unread: number
  pulse?: boolean
  typing?: 'them' | null
  messages: Message[]
  suggestion: string | null
}

type FilaEntry = {
  id: string
  name: string
  i: string
  c: string
  wait: string
  sla: boolean
  ch: Channel
  last: string
}

const CHANNEL: Record<Channel, { label: string; bg: string; short: string }> = {
  WA: { label: 'WhatsApp', bg: '#22C55E', short: 'WA' },
  SITE: { label: 'Site', bg: '#7C3AED', short: 'SITE' },
  IG: { label: 'Instagram', bg: '#EC4899', short: 'IG' },
}

const STATUS: Record<Status, { label: string; bg: string; fg: string; dot: string }> = {
  attending: { label: 'Atendendo', bg: 'bg-brand-50', fg: 'text-brand-700', dot: '#7C3AED' },
  ia: { label: 'IA atendendo', bg: 'bg-brand-100', fg: 'text-brand-800', dot: '#5B21B6' },
  waiting: { label: 'Cliente offline', bg: 'bg-warn-50', fg: 'text-warn-700', dot: '#F59E0B' },
  sla: { label: 'Atrasado SLA', bg: 'bg-danger-50', fg: 'text-danger-700', dot: '#EF4444' },
  closing: { label: 'Encerrando', bg: 'bg-success-50', fg: 'text-success-700', dot: '#10B981' },
}

const TILES: Tile[] = [
  {
    id: 't1',
    name: 'Renata Costa',
    initials: 'RC',
    avatarBg: '#A78BFA',
    online: true,
    ch: 'WA',
    ref: 'Pedido em rascunho · R$ 312',
    status: 'attending',
    elapsed: '12m',
    unread: 0,
    pulse: true,
    typing: 'them',
    messages: [
      { from: 'them', t: '09:34', text: 'Oi! Vi as hortênsias no site, tem em azul ainda?' },
      { from: 'me', t: '09:36', text: 'Oi Renata! Tem sim, ficamos com 14 unidades.', read: true },
      { from: 'me', t: '09:36', text: 'Quer fechar quantas?', read: true },
      { from: 'them', t: '09:38', text: 'Levaria 6. Posso pagar via Pix?' },
      { from: 'them', t: '09:39', text: 'E entrega pra Mooca, é zona de cobertura?' },
    ],
    suggestion: 'Sim, Mooca está na zona de cobertura — entrega R$ 18, fixa.',
  },
  {
    id: 't2',
    name: 'João Silva',
    initials: 'JS',
    avatarBg: '#FBBF24',
    online: true,
    ch: 'WA',
    ref: 'Orçamento · coroa de flores',
    status: 'attending',
    elapsed: '24m',
    unread: 2,
    typing: null,
    messages: [
      { from: 'me', t: '09:14', text: 'Bom dia João. Sobre a coroa, temos 3 opções de tamanho:', read: true },
      { from: 'me', t: '09:14', text: 'P (1m), M (1,4m), G (1,8m) — quer ver fotos?', read: true },
      { from: 'them', t: '09:31', text: 'Pode mandar as fotos da M e da G' },
      { from: 'them', t: '09:32', text: 'Precisamos pra amanhã 11h. Capela do Carmo, Mooca.' },
    ],
    suggestion: null,
  },
  {
    id: 't3',
    name: 'Bia Marques',
    initials: 'BM',
    avatarBg: '#34D399',
    online: true,
    ch: 'SITE',
    ref: 'Pedido #2841 · em trânsito',
    status: 'ia',
    elapsed: '3m',
    unread: 0,
    typing: null,
    messages: [
      { from: 'them', t: '09:39', text: 'Oi, queria saber se meu pedido #2841 já saiu pra entrega' },
      { from: 'ia', t: '09:39', text: 'Oi Bia! Seu pedido #2841 saiu às 9:21, o entregador chega entre 10:10 e 10:25.' },
      { from: 'them', t: '09:40', text: 'Show, valeu! Tem como avisar quando estiver próximo?' },
      { from: 'ia', t: '09:40', text: 'Claro — vou te mandar uma mensagem quando estiver a 5 min daí.' },
    ],
    suggestion: null,
  },
  {
    id: 't4',
    name: 'Carlos Pereira',
    initials: 'CP',
    avatarBg: '#60A5FA',
    online: false,
    ch: 'WA',
    ref: 'Dúvida · prazo de entrega',
    status: 'waiting',
    elapsed: '6m',
    unread: 0,
    typing: null,
    messages: [
      { from: 'them', t: '09:30', text: 'Bom dia. Vocês entregam em Santo André?' },
      { from: 'me', t: '09:33', text: 'Bom dia Carlos! Entregamos sim, com taxa de R$ 28.', read: true },
      { from: 'me', t: '09:33', text: 'Pedido feito até 14h chega no mesmo dia.', read: true },
    ],
    suggestion: null,
  },
  {
    id: 't5',
    name: 'Ana Beatriz',
    initials: 'AB',
    avatarBg: '#F87171',
    online: true,
    ch: 'IG',
    ref: 'Pedido #2839 · pedido de cancelamento',
    status: 'sla',
    elapsed: '18m',
    unread: 3,
    typing: null,
    messages: [
      { from: 'them', t: '09:21', text: 'Oi! Posso cancelar o pedido #2839? Ainda nao saiu né' },
      { from: 'them', t: '09:23', text: 'Olá??' },
      { from: 'them', t: '09:38', text: 'Tô esperando aqui, da pra responder?' },
    ],
    suggestion:
      'Pedido #2839 ainda não saiu — confirme o cancelamento e ofereça reembolso integral via Pix.',
  },
  {
    id: 't6',
    name: 'Lucia Fernandes',
    initials: 'LF',
    avatarBg: '#C4B5FD',
    online: false,
    ch: 'SITE',
    ref: 'Pedido #2837 · confirmação',
    status: 'closing',
    elapsed: '1m',
    unread: 0,
    typing: null,
    messages: [
      { from: 'them', t: '09:37', text: 'Pedido chegou perfeito, muito obrigada!' },
      { from: 'me', t: '09:38', text: 'Que ótimo Lucia! Volte sempre.', read: false },
      { from: 'them', t: '09:40', text: 'Vocês têm cartão de fidelidade?' },
    ],
    suggestion: null,
  },
]

const FILA: FilaEntry[] = [
  { id: 'q1', name: 'Helena Tavares', i: 'HT', c: '#A78BFA', wait: '15m', sla: true, ch: 'WA', last: 'Boa! Vocês entregam até as 14h?' },
  { id: 'q2', name: 'Pedro Nogueira', i: 'PN', c: '#FBBF24', wait: '12m', sla: false, ch: 'WA', last: 'Quero saber o preço do arranjo de gerbera' },
  { id: 'q3', name: 'Márcia Oliveira', i: 'MO', c: '#34D399', wait: '8m', sla: false, ch: 'SITE', last: 'Posso parcelar em 3x?' },
  { id: 'q4', name: 'Roberto Kim', i: 'RK', c: '#60A5FA', wait: '4m', sla: false, ch: 'WA', last: 'Tenho um cupom GANHE10, ainda vale?' },
  { id: 'q5', name: 'Vitor Sá', i: 'VS', c: '#F472B6', wait: '2m', sla: false, ch: 'IG', last: 'Vi seu post das tulipas, ainda tem?' },
]

const QUICK_REPLIES = [
  'Oi! Em que posso ajudar?',
  'Vou verificar e te respondo agora',
  'Pedido confirmado!',
  'Obrigada pelo contato',
  'Posso te chamar no WhatsApp?',
]

/* ───────── ChannelDot ───────── */

function ChannelDot({ k }: { k: Channel }) {
  const c = CHANNEL[k]
  return (
    <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold tracking-wide uppercase text-ink-600">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.bg }} />
      {c.short}
    </span>
  )
}

/* ───────── StatusPill ───────── */

function StatusPill({ s }: { s: Status }) {
  const x = STATUS[s]
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10.5px] font-semibold ${x.bg} ${x.fg}`}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: x.dot }} />
      {x.label}
    </span>
  )
}

/* ───────── Bubble ───────── */

function Bubble({ m }: { m: Message }) {
  if (m.from === 'them') {
    return (
      <div className="flex items-end gap-2 max-w-[88%]">
        <div className="bubble-them text-[13px] leading-snug">{m.text}</div>
        <span className="eyebrow text-ink-400 mb-0.5 tabular shrink-0">{m.t}</span>
      </div>
    )
  }
  if (m.from === 'ia') {
    return (
      <div className="flex items-end gap-2 max-w-[88%] ml-auto justify-end">
        <span className="eyebrow text-brand-400 mb-0.5 tabular shrink-0">{m.t}</span>
        <div className="flex flex-col items-end gap-1">
          <span className="eyebrow text-brand-600 inline-flex items-center gap-1">
            <Icon name="sparkle" className="w-3 h-3" />
            IA
          </span>
          <div className="bubble-ia text-[13px] leading-snug">{m.text}</div>
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-end gap-2 max-w-[88%] ml-auto justify-end">
      <span className="eyebrow text-ink-400 mb-0.5 tabular shrink-0 inline-flex items-center gap-1">
        {m.t}
        <Icon
          name={m.read ? 'check2' : 'check'}
          className={`w-3 h-3 ${m.read ? 'text-info-500' : 'text-ink-400'}`}
        />
      </span>
      <div className="bubble-me text-[13px] leading-snug">{m.text}</div>
    </div>
  )
}

/* ───────── ChatRail ───────── */

function ChatRail({
  selectedId,
  setSelectedId,
}: {
  selectedId: string
  setSelectedId: (id: string) => void
}) {
  const groups: { id: string; label: string; items: Tile[] }[] = [
    { id: 'attending', label: 'ATENDENDO', items: TILES.filter((t) => t.status === 'attending') },
    { id: 'sla', label: 'ATRASADO SLA', items: TILES.filter((t) => t.status === 'sla') },
    { id: 'ia', label: 'IA ATENDENDO', items: TILES.filter((t) => t.status === 'ia') },
    { id: 'waiting', label: 'AGUARDANDO', items: TILES.filter((t) => t.status === 'waiting') },
    { id: 'closing', label: 'ENCERRANDO', items: TILES.filter((t) => t.status === 'closing') },
  ].filter((g) => g.items.length > 0)

  const RailItem = ({ t }: { t: Tile }) => {
    const selected = t.id === selectedId
    const lastMsg = t.messages[t.messages.length - 1]
    const lastText = lastMsg
      ? (lastMsg.from === 'me' ? 'Você: ' : lastMsg.from === 'ia' ? 'IA: ' : '') + lastMsg.text
      : ''
    const time = lastMsg ? lastMsg.t : ''
    return (
      <button
        onClick={() => setSelectedId(t.id)}
        className={`w-full text-left relative px-3 py-2.5 flex gap-2.5 transition-colors ${
          selected ? 'bg-brand-50' : 'hover:bg-ink-50'
        }`}
      >
        {selected && (
          <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-brand-600" />
        )}
        <div className="relative shrink-0">
          <div
            className="w-10 h-10 rounded-full font-display font-bold text-white text-[12px] flex items-center justify-center"
            style={{ background: t.avatarBg }}
          >
            {t.initials}
          </div>
          <span
            className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white ${
              t.online ? 'bg-success-500' : 'bg-ink-300'
            }`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div
              className={`text-[13px] truncate ${
                selected ? 'font-bold text-brand-900' : 'font-semibold text-ink-900'
              } ${t.unread > 0 ? 'font-bold' : ''}`}
            >
              {t.name}
            </div>
            <span
              className={`text-[10.5px] tabular shrink-0 ${
                t.unread > 0 && !selected
                  ? 'text-brand-700 font-bold'
                  : 'text-ink-500'
              }`}
            >
              {time}
            </span>
          </div>
          <div
            className={`text-[11.5px] truncate mt-0.5 ${
              t.unread > 0 && !selected ? 'text-ink-800 font-semibold' : 'text-ink-500'
            }`}
          >
            {lastText}
          </div>
          <div className="mt-1 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <ChannelDot k={t.ch} />
              <span className="text-[10px] text-ink-400">· {t.elapsed}</span>
            </div>
            {t.unread > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10.5px] font-bold tabular bg-brand-600 text-white">
                {t.unread}
              </span>
            )}
            {t.typing === 'them' && (
              <span className="typing">
                <span />
                <span />
                <span />
              </span>
            )}
          </div>
        </div>
      </button>
    )
  }

  const QueueItem = ({ f }: { f: FilaEntry }) => (
    <button className="w-full text-left px-3 py-2.5 hover:bg-ink-50 flex gap-2.5">
      <div className="relative shrink-0">
        <div
          className="w-10 h-10 rounded-full font-display font-bold text-white text-[12px] flex items-center justify-center"
          style={{ background: f.c }}
        >
          {f.i}
        </div>
        {f.sla && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-danger-500 ring-2 ring-white flex items-center justify-center text-white">
            <Icon name="alert" className="w-2.5 h-2.5" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] font-semibold text-ink-900 truncate">{f.name}</div>
          <span
            className={`text-[10.5px] tabular shrink-0 ${
              f.sla ? 'text-danger-700 font-bold' : 'text-ink-500'
            }`}
          >
            {f.wait}
          </span>
        </div>
        <div className="text-[11.5px] text-ink-500 truncate mt-0.5">{f.last}</div>
        <div className="mt-1 flex items-center gap-1.5">
          <ChannelDot k={f.ch} />
          <span className="text-[10px] text-ink-400">· aguardando</span>
        </div>
      </div>
    </button>
  )

  return (
    <div className="card flex flex-col" style={{ height: 'calc(100vh - 138px)' }}>
      <div className="px-3.5 pt-3.5 pb-2 border-b border-ink-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-display font-bold text-ink-900 text-[15px]">
            Caixa de entrada
          </span>
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-md text-[11px] font-bold tabular bg-ink-100 text-ink-700">
            {TILES.length + FILA.length}
          </span>
        </div>
        <button
          className="w-7 h-7 rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-900 flex items-center justify-center"
          title="Nova conversa"
        >
          <Icon name="plus" className="w-4 h-4" />
        </button>
      </div>

      <div className="px-3.5 py-2.5 border-b border-ink-100">
        <div className="relative">
          <Icon
            name="search"
            className="w-3.5 h-3.5 text-ink-400 absolute left-2.5 top-1/2 -translate-y-1/2"
          />
          <input
            placeholder="Buscar conversas…"
            className="w-full pl-7 pr-3 py-1.5 rounded-lg bg-ink-50 text-[12.5px] placeholder:text-ink-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-brand-200"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {groups.map((g) => (
          <div key={g.id}>
            <div className="px-3.5 pt-3.5 pb-1.5 flex items-center justify-between">
              <span className="eyebrow text-ink-500">{g.label}</span>
              <span className="eyebrow text-ink-400 tabular">{g.items.length}</span>
            </div>
            <div className="divide-y divide-ink-100/70">
              {g.items.map((t) => (
                <RailItem key={t.id} t={t} />
              ))}
            </div>
          </div>
        ))}

        <div>
          <div className="px-3.5 pt-3.5 pb-1.5 flex items-center justify-between bg-warn-50/40">
            <span className="eyebrow text-warn-700">NA FILA</span>
            <span className="eyebrow text-warn-700 tabular">{FILA.length}</span>
          </div>
          <div className="divide-y divide-ink-100/70">
            {FILA.map((f) => (
              <QueueItem key={f.id} f={f} />
            ))}
          </div>
        </div>

        <div className="h-4" />
      </div>
    </div>
  )
}

/* ───────── FullChat ───────── */

function FullChat({ t }: { t: Tile }) {
  const [draft, setDraft] = useState('')
  const isIA = t.status === 'ia'
  const isSLA = t.status === 'sla'

  return (
    <div
      className="card flex flex-col overflow-hidden"
      style={{ height: 'calc(100vh - 138px)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-4 px-5 py-3.5 border-b border-ink-100 bg-white">
        <div className="relative shrink-0">
          <div
            className="w-11 h-11 rounded-full font-display font-bold text-white text-[14px] flex items-center justify-center"
            style={{ background: t.avatarBg }}
          >
            {t.initials}
          </div>
          <span
            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-white ${
              t.online ? 'bg-success-500' : 'bg-ink-300'
            }`}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <h2
              className="font-display font-bold text-ink-900 truncate"
              style={{ fontSize: '17px' }}
            >
              {t.name}
            </h2>
            <StatusPill s={t.status} />
          </div>
          <div className="flex items-center gap-2 mt-1 text-[12px] text-ink-500 min-w-0 whitespace-nowrap overflow-hidden">
            <ChannelDot k={t.ch} />
            <span className="text-ink-300">·</span>
            <span className="truncate">{t.ref}</span>
            <span className="text-ink-300 shrink-0">·</span>
            <span className="eyebrow inline-flex items-center gap-1 shrink-0">
              <Icon name="clock" className="w-3 h-3" />
              {t.elapsed}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg ring-1 ring-ink-200">
            <button
              className="w-8 h-8 rounded-md text-ink-600 hover:bg-ink-100 hover:text-ink-900 flex items-center justify-center"
              title="Nota interna"
            >
              <Icon name="note" className="w-4 h-4" />
            </button>
            <button
              className="w-8 h-8 rounded-md text-ink-600 hover:bg-ink-100 hover:text-ink-900 flex items-center justify-center"
              title="Transferir"
            >
              <Icon name="transfer" className="w-4 h-4" />
            </button>
            <button
              className="w-8 h-8 rounded-md text-danger-600 hover:bg-danger-50 hover:text-danger-700 flex items-center justify-center"
              title="Encerrar conversa"
            >
              <Icon name="end" className="w-4 h-4" />
            </button>
          </div>
          <button
            className="w-9 h-9 rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-900 flex items-center justify-center"
            title="Mais"
          >
            <Icon name="more" className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* SLA banner */}
      {isSLA && (
        <div className="px-5 py-2 bg-danger-50 border-b border-danger-100 flex items-center gap-2.5">
          <Icon name="alert" className="w-4 h-4 text-danger-700" />
          <span className="text-[12.5px] font-semibold text-danger-700">
            Cliente esperando há {t.elapsed} · acima do SLA de 5 min.
          </span>
          <button className="ml-auto text-[12px] font-semibold text-danger-700 hover:text-danger-800">
            Marcar como urgente
          </button>
        </div>
      )}

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto px-5 py-5 space-y-3"
        style={{ background: '#FAFAFD' }}
      >
        <div className="flex items-center gap-3 my-1">
          <div className="flex-1 h-px bg-ink-200/70" />
          <span className="eyebrow text-ink-400">HOJE · 12 DE MAIO</span>
          <div className="flex-1 h-px bg-ink-200/70" />
        </div>

        {t.messages.map((m, i) => (
          <div key={i} className={m.from === 'them' ? '' : 'flex justify-end'}>
            <Bubble m={m} />
          </div>
        ))}

        {t.typing === 'them' && (
          <div className="flex items-end gap-2 max-w-[60%]">
            <div className="bubble-them py-2.5 px-3">
              <span className="typing">
                <span />
                <span />
                <span />
              </span>
            </div>
            <span className="eyebrow text-ink-400 mb-0.5">
              {t.name.split(' ')[0]} está digitando
            </span>
          </div>
        )}
      </div>

      {/* IA suggestion */}
      {t.suggestion && !isIA && (
        <div className="mx-5 mb-3 rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white px-3.5 py-3 flex items-start gap-3">
          <span
            className="chip chip-brand shrink-0"
            style={{ width: 28, height: 28, borderRadius: 9 }}
          >
            <Icon name="sparkle" className="w-4 h-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="eyebrow text-brand-700">
              SUGESTÃO DA IA · BASEADA EM 4 PEDIDOS ANTERIORES
            </div>
            <div className="text-[13.5px] text-ink-900 mt-1 leading-snug">
              {t.suggestion}
            </div>
          </div>
          <div className="flex flex-col gap-1.5 shrink-0">
            <button
              onClick={() => t.suggestion && setDraft(t.suggestion)}
              className="text-[11.5px] font-semibold text-white bg-brand-600 hover:bg-brand-700 px-2.5 py-1.5 rounded-md"
            >
              Usar
            </button>
            <button className="text-[11.5px] font-semibold text-ink-600 hover:text-ink-900 px-2.5 py-1 rounded-md">
              Editar
            </button>
          </div>
        </div>
      )}

      {/* IA banner OR input */}
      {isIA ? (
        <div className="border-t border-ink-100 px-5 py-3.5 bg-gradient-to-r from-brand-50 to-brand-100/40 flex items-center gap-3">
          <span className="chip chip-brand">
            <Icon name="sparkle" className="w-4 h-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold text-ink-900">
              IA respondendo automaticamente
            </div>
            <div className="text-[12px] text-ink-600">
              v3.2 · seguindo o roteiro &ldquo;Pós-venda · status pedido&rdquo;
            </div>
          </div>
          <button className="text-[12.5px] font-semibold text-white bg-brand-600 hover:bg-brand-700 px-3.5 py-2 rounded-lg">
            Assumir conversa
          </button>
        </div>
      ) : (
        <div className="border-t border-ink-100 bg-white">
          {/* Quick replies */}
          <div className="px-3 pt-2.5 pb-1 flex items-center gap-1.5 overflow-x-auto">
            <span className="eyebrow text-ink-400 shrink-0 mr-1">RÁPIDAS</span>
            {QUICK_REPLIES.map((q, i) => (
              <button
                key={i}
                onClick={() => setDraft(q)}
                className="shrink-0 text-[11.5px] font-semibold text-ink-700 hover:text-brand-700 hover:bg-brand-50 px-2.5 py-1 rounded-md ring-1 ring-ink-200 whitespace-nowrap"
              >
                {q}
              </button>
            ))}
            <button className="shrink-0 text-[11.5px] font-semibold text-brand-700 hover:bg-brand-50 px-2 py-1 rounded-md whitespace-nowrap">
              + Editar
            </button>
          </div>
          {/* Input */}
          <div className="p-3">
            <div
              className={`flex items-end gap-1.5 rounded-2xl bg-ink-50 px-2 py-2 ring-1 ${
                isSLA
                  ? 'ring-danger-200'
                  : 'ring-transparent focus-within:ring-brand-200 focus-within:bg-white'
              }`}
            >
              <button className="w-9 h-9 rounded-lg text-ink-500 hover:text-ink-900 hover:bg-white flex items-center justify-center">
                <Icon name="paper" className="w-4 h-4" />
              </button>
              <button className="w-9 h-9 rounded-lg text-ink-500 hover:text-ink-900 hover:bg-white flex items-center justify-center">
                <Icon name="image" className="w-4 h-4" />
              </button>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={
                  isSLA
                    ? 'Responda agora — atrasado no SLA'
                    : 'Escrever resposta…  ↵ enviar  ·  shift+↵ nova linha'
                }
                rows={1}
                className="flex-1 bg-transparent px-2 py-2 text-[13.5px] placeholder:text-ink-400 focus:outline-none resize-none max-h-[120px]"
              />
              <button className="w-9 h-9 rounded-lg text-ink-500 hover:text-ink-900 hover:bg-white flex items-center justify-center">
                <Icon name="mic" className="w-4 h-4" />
              </button>
              <button
                disabled={!draft.trim()}
                className={`h-9 px-3.5 rounded-lg flex items-center gap-1.5 text-[12.5px] font-semibold transition-colors ${
                  draft.trim()
                    ? 'bg-brand-600 text-white hover:bg-brand-700'
                    : 'bg-ink-200 text-ink-400 cursor-not-allowed'
                }`}
              >
                Enviar <Icon name="send" className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ───────── MEATopbar ───────── */

function MEATopbar() {
  const attending = TILES.filter((t) => t.status === 'attending').length
  const waiting = TILES.filter((t) => t.status === 'waiting' || t.status === 'sla').length

  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="eyebrow text-ink-500 flex items-center gap-2">
          <span>OPERAÇÃO</span>
          <span className="text-ink-300">/</span>
          <span className="text-brand-600">CONVERSAS</span>
        </div>
        <h1
          className="font-display font-bold text-ink-900 tracking-tight mt-1 flex items-baseline gap-3"
          style={{ fontSize: '24px' }}
        >
          Conversas
          <span className="text-ink-400 font-medium text-[16px]">·</span>
          <span className="text-ink-500 font-medium text-[15px]">
            {attending} atendendo · {waiting + FILA.length} na fila
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-success-700 bg-success-50 ring-1 ring-success-100 px-2 py-0.5 rounded-md ml-1">
            <span className="live-dot" /> ao vivo
          </span>
        </h1>
      </div>

      <div className="flex items-center gap-2">
        <button className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12.5px] font-semibold text-ink-700 hover:bg-ink-50 ring-1 ring-ink-200 bg-white">
          <Icon name="filter" className="w-3.5 h-3.5" /> Filtros
        </button>
        <button className="inline-flex items-center gap-2 bg-ink-900 text-white text-[12.5px] font-semibold px-3 py-2 rounded-xl hover:bg-ink-800">
          <Icon name="plus" className="w-4 h-4" /> Nova conversa
        </button>
      </div>
    </div>
  )
}

/* ───────── ConversasView ───────── */

export function ConversasView() {
  const [selectedId, setSelectedId] = useState('t1')
  const selected = TILES.find((t) => t.id === selectedId) || TILES[0]

  return (
    <>
      <div className="px-6 pt-6 pb-4 border-b border-ink-200 bg-white/70 backdrop-blur sticky top-0 z-10">
        <MEATopbar />
      </div>
      <div
        className="px-6 py-5 grid gap-4"
        style={{ gridTemplateColumns: '340px 1fr' }}
      >
        <ChatRail selectedId={selectedId} setSelectedId={setSelectedId} />
        <FullChat t={selected} />
      </div>
    </>
  )
}
