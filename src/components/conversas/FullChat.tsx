'use client'

import { useState } from 'react'
import { Icon } from '@/components/painel/Icons'
import type { ConversationRow, MessageRow } from '@/actions/conversas'
import {
  parseSegments,
  groupConsecutiveImages,
} from '@/app/chat/[slug]/components/message-segments'
import { ImageCarousel } from '@/app/chat/[slug]/components/ImageCarousel'
import { ImageLightbox } from '@/app/chat/[slug]/components/ImageLightbox'
import {
  avatarColor,
  avatarInitials,
  formatRelativeTime,
} from './formatters'

interface FullChatProps {
  conversation: ConversationRow | null
  messages: MessageRow[]
  loading: boolean
  onBack?: () => void
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

function MessageContent({
  content,
  onImageClick,
}: {
  content: string
  onImageClick: (srcs: string[], index: number) => void
}) {
  const { segments } = parseSegments(content)
  const renderItems = groupConsecutiveImages(segments)
  return (
    <div className="flex flex-col gap-1.5">
      {renderItems.map((item, i) => {
        if (item.type === 'text') {
          return (
            <p key={`t-${i}`} className="whitespace-pre-wrap break-words">
              {item.value}
            </p>
          )
        }
        if (item.type === 'image') {
          return (
            <button
              type="button"
              key={`i-${i}-${item.src}`}
              onClick={() => onImageClick([item.src], 0)}
              className="block"
            >
              <img
                src={item.src}
                alt=""
                className="rounded-md max-w-[260px] block"
                loading="lazy"
              />
            </button>
          )
        }
        // imageGroup — carrossel
        return (
          <div key={`g-${i}`} className="max-w-[260px]">
            <ImageCarousel
              srcs={item.srcs}
              onImageClick={(idx) => onImageClick(item.srcs, idx)}
            />
          </div>
        )
      })}
    </div>
  )
}

function MessageBubble({ m }: { m: MessageRow }) {
  const [lightbox, setLightbox] = useState<{ srcs: string[]; index: number } | null>(null)
  const openLightbox = (srcs: string[], index: number) =>
    setLightbox({ srcs, index })

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

  const lightboxEl = lightbox && (
    <ImageLightbox
      srcs={lightbox.srcs}
      startIndex={lightbox.index}
      onClose={() => setLightbox(null)}
    />
  )

  if (m.role === 'user') {
    return (
      <div className="flex items-end gap-2 max-w-[88%]">
        <div className="bubble-them text-[13px] leading-snug">
          {m.message_type === 'image' && m.media_url ? (
            <button
              type="button"
              onClick={() => openLightbox([m.media_url!], 0)}
              className="block"
            >
              <img
                src={m.media_url}
                alt=""
                className="rounded-md max-w-[260px] block"
              />
            </button>
          ) : m.message_type === 'audio' && m.media_url ? (
            <audio controls src={m.media_url} className="max-w-[260px]" />
          ) : (
            <MessageContent content={m.content} onImageClick={openLightbox} />
          )}
        </div>
        <span className="eyebrow text-ink-400 mb-0.5 tabular shrink-0">{time}</span>
        {lightboxEl}
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
            <button
              type="button"
              onClick={() => openLightbox([m.media_url!], 0)}
              className="block"
            >
              <img
                src={m.media_url}
                alt=""
                className="rounded-md max-w-[260px] block"
              />
            </button>
          ) : m.message_type === 'audio' && m.media_url ? (
            <audio controls src={m.media_url} className="max-w-[260px]" />
          ) : (
            <MessageContent content={m.content} onImageClick={openLightbox} />
          )}
        </div>
      </div>
      {lightboxEl}
    </div>
  )
}

export function FullChat({ conversation, messages, loading, onBack }: FullChatProps) {
  if (!conversation) {
    return (
      <div className="card hidden md:flex flex-col items-center justify-center h-[calc(100vh-138px)]">
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
    <div className="card flex flex-col overflow-hidden h-[calc(100dvh-120px)] md:h-[calc(100vh-138px)]">
      <div className="flex items-center gap-3 sm:gap-4 px-3 sm:px-5 py-3 sm:py-3.5 border-b border-ink-100 bg-white">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Voltar para a lista"
            className="md:hidden -ml-1 w-9 h-9 shrink-0 rounded-lg text-ink-700 hover:bg-ink-50 active:bg-ink-100 flex items-center justify-center"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
        )}
        <div className="relative shrink-0">
          <div
            className="w-10 h-10 sm:w-11 sm:h-11 rounded-full font-display font-bold text-white text-[13px] sm:text-[14px] flex items-center justify-center"
            style={{ background: bg }}
          >
            {initials}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <h2
              className="font-display font-bold text-ink-900 truncate text-[15px] sm:text-[17px]"
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
        className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 sm:py-5 space-y-3"
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

      <div className="border-t border-ink-100 px-3 sm:px-5 py-3 sm:py-3.5 bg-gradient-to-r from-brand-50 to-brand-100/40 flex items-center gap-3">
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
