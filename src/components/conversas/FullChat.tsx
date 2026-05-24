'use client'

import { Icon } from '@/components/painel/Icons'
import type { ConversationRow, MessageRow } from '@/actions/conversas'
import {
  avatarColor,
  avatarInitials,
  formatRelativeTime,
} from './formatters'

interface FullChatProps {
  conversation: ConversationRow | null
  messages: MessageRow[]
  loading: boolean
}

const STATUS = {
  ai_active: {
    label: 'IA ATENDENDO',
    bg: 'bg-brand-100',
    fg: 'text-brand-800',
    dot: '#5B21B6',
  },
  closed: {
    label: 'ENCERRADA',
    bg: 'bg-ink-100',
    fg: 'text-ink-700',
    dot: '#94A3B8',
  },
} as const

function StatusPill({ status }: { status: 'ai_active' | 'closed' }) {
  const x = STATUS[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10.5px] font-semibold ${x.bg} ${x.fg}`}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: x.dot }} />
      {x.label}
    </span>
  )
}

const IMAGE_URL_RE = /https?:\/\/\S+?\.(?:jpe?g|png|webp|gif)(?:\?\S*)?/gi

type Segment = { type: 'text'; value: string } | { type: 'image'; src: string }

function parseSegments(text: string): Segment[] {
  const segments: Segment[] = []
  const re = new RegExp(IMAGE_URL_RE.source, IMAGE_URL_RE.flags)
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const chunk = text.slice(lastIndex, match.index)
      if (chunk.trim()) segments.push({ type: 'text', value: chunk.trim() })
    }
    segments.push({ type: 'image', src: match[0] })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    const tail = text.slice(lastIndex)
    if (tail.trim()) segments.push({ type: 'text', value: tail.trim() })
  }
  if (segments.length === 0 && text) segments.push({ type: 'text', value: text })
  return segments
}

function MessageContent({ content }: { content: string }) {
  const segments = parseSegments(content)
  return (
    <div className="flex flex-col gap-1.5">
      {segments.map((seg, i) =>
        seg.type === 'text' ? (
          <p key={`t-${i}`} className="whitespace-pre-wrap break-words">
            {seg.value}
          </p>
        ) : (
          <a
            key={`i-${i}-${seg.src}`}
            href={seg.src}
            target="_blank"
            rel="noreferrer"
            className="block"
          >
            <img
              src={seg.src}
              alt=""
              className="rounded-md max-w-[260px] block"
              loading="lazy"
            />
          </a>
        ),
      )}
    </div>
  )
}

function MessageBubble({ m }: { m: MessageRow }) {
  const time = new Date(m.created_at).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })

  if (m.role === 'system') {
    return (
      <div className="flex justify-center">
        <div className="text-[12px] text-ink-500 italic px-3 py-1 rounded-md bg-ink-50">
          {m.content}
        </div>
      </div>
    )
  }

  if (m.role === 'user') {
    return (
      <div className="flex items-end gap-2 max-w-[88%]">
        <div className="bubble-them text-[13px] leading-snug">
          {m.message_type === 'image' && m.media_url ? (
            <img
              src={m.media_url}
              alt=""
              className="rounded-md max-w-[260px] block"
            />
          ) : m.message_type === 'audio' && m.media_url ? (
            <audio controls src={m.media_url} className="max-w-[260px]" />
          ) : (
            <MessageContent content={m.content} />
          )}
        </div>
        <span className="eyebrow text-ink-400 mb-0.5 tabular shrink-0">{time}</span>
      </div>
    )
  }

  // assistant or operator
  const isIA = m.role === 'assistant'
  return (
    <div className="flex items-end gap-2 max-w-[88%] ml-auto justify-end">
      <span className="eyebrow text-ink-400 mb-0.5 tabular shrink-0">{time}</span>
      <div className="flex flex-col items-end gap-1">
        {isIA && (
          <span className="eyebrow text-brand-600 inline-flex items-center gap-1">
            <Icon name="sparkle" className="w-3 h-3" />
            IA
          </span>
        )}
        <div className={`${isIA ? 'bubble-ia' : 'bubble-me'} text-[13px] leading-snug`}>
          {m.message_type === 'image' && m.media_url ? (
            <img
              src={m.media_url}
              alt=""
              className="rounded-md max-w-[260px] block"
            />
          ) : m.message_type === 'audio' && m.media_url ? (
            <audio controls src={m.media_url} className="max-w-[260px]" />
          ) : (
            <MessageContent content={m.content} />
          )}
        </div>
      </div>
    </div>
  )
}

export function FullChat({ conversation, messages, loading }: FullChatProps) {
  if (!conversation) {
    return (
      <div
        className="card flex flex-col items-center justify-center"
        style={{ height: 'calc(100vh - 138px)' }}
      >
        <div className="text-[14px] text-ink-500">
          Selecione uma conversa pra visualizar.
        </div>
      </div>
    )
  }

  const t = conversation
  const initials = avatarInitials(t.visitor_name)
  const bg = avatarColor(t.visitor_id)
  const elapsed = formatRelativeTime(t.created_at)

  return (
    <div
      className="card flex flex-col overflow-hidden"
      style={{ height: 'calc(100vh - 138px)' }}
    >
      <div className="flex items-center gap-4 px-5 py-3.5 border-b border-ink-100 bg-white">
        <div className="relative shrink-0">
          <div
            className="w-11 h-11 rounded-full font-display font-bold text-white text-[14px] flex items-center justify-center"
            style={{ background: bg }}
          >
            {initials}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <h2
              className="font-display font-bold text-ink-900 truncate"
              style={{ fontSize: '17px' }}
            >
              {t.visitor_name}
            </h2>
            <StatusPill status={t.status} />
          </div>
          <div className="flex items-center gap-2 mt-1 text-[12px] text-ink-500 min-w-0 whitespace-nowrap overflow-hidden">
            <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold tracking-wide uppercase text-ink-600">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: '#7C3AED' }}
              />
              SITE
            </span>
            <span className="text-ink-300">·</span>
            <span className="eyebrow inline-flex items-center gap-1 shrink-0">
              <Icon name="clock" className="w-3 h-3" />
              iniciada {elapsed}
            </span>
          </div>
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto px-5 py-5 space-y-3"
        style={{ background: '#FAFAFD' }}
      >
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={`h-6 rounded-md bg-ink-100 animate-pulse ${
                  i % 2 === 0 ? 'w-1/2' : 'w-2/3 ml-auto'
                }`}
              />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center text-[12px] text-ink-500 py-10">
            Sem mensagens nesta conversa.
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={m.role === 'user' ? '' : 'flex justify-end'}>
              <MessageBubble m={m} />
            </div>
          ))
        )}
      </div>

      <div className="border-t border-ink-100 px-5 py-3.5 bg-gradient-to-r from-brand-50 to-brand-100/40 flex items-center gap-3">
        <span className="chip chip-brand">
          <Icon name="sparkle" className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-ink-900">
            Visualização
          </div>
          <div className="text-[12px] text-ink-600">
            Esta conversa é respondida automaticamente pela IA.
          </div>
        </div>
      </div>
    </div>
  )
}
