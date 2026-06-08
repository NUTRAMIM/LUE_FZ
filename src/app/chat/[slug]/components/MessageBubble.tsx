'use client'

import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../ChatClient'
import type { TickState } from './cycle'
import { parseSegments, groupConsecutiveImages } from './message-segments'
import { ImageCarousel } from './ImageCarousel'
import { ImageLightbox } from './ImageLightbox'
import { useSwipeToReply } from './useSwipeToReply'
import { replyPreviewText, truncate } from './reply-helpers'

function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Mensagens longas no chat público são truncadas em 15 linhas; o resto fica
// atrás de um "Ler mais". Usamos -webkit-line-clamp pra cortar exatamente em
// 15 linhas renderizadas, independente do line-height real.
const MAX_LINES = 15

export function MessageBubble({
  message,
  tickState = 'idle',
  quoted = null,
  quotedLabel = '',
  groupedWithPrev = false,
  onStartReply,
  onQuoteClick,
}: {
  message: ChatMessage
  tickState?: TickState
  quoted?: ChatMessage | null
  quotedLabel?: string
  groupedWithPrev?: boolean
  onStartReply?: (message: ChatMessage) => void
  onQuoteClick?: (targetId: string) => void
}) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  const [lightbox, setLightbox] = useState<{ srcs: string[]; index: number } | null>(null)
  const { dx, swipeHandlers } = useSwipeToReply(() => onStartReply?.(message))

  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded

  // Detecta se o corpo passa de 15 linhas pra decidir se mostra o "Ler mais".
  // Compara a altura total com a visível (clamp), então só mede quando colapsado
  // — expandido as duas se igualam e esconderiam o botão "Ler menos".
  // ResizeObserver re-mede quando imagens carregam e mudam a altura.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const measure = () => {
      if (expandedRef.current) return
      setOverflowing(el.scrollHeight > el.clientHeight + 1)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  if (isSystem) {
    return (
      <div className="my-2 flex justify-center">
        <span className="rounded-md bg-yellow-50 px-3 py-1 text-xs text-yellow-800 shadow-sm">
          {message.content}
        </span>
      </div>
    )
  }

  const content = message.content ?? ''
  const isTypedImage = message.message_type === 'image'

  const { segments, hasImage } =
    content && !isTypedImage
      ? parseSegments(content)
      : { segments: content ? [{ type: 'text' as const, value: content }] : [], hasImage: false }

  const renderItems = groupConsecutiveImages(segments)
  const bubbleMaxWidth = hasImage ? 'max-w-[88%] sm:max-w-sm' : 'max-w-[75%]'

  return (
    <div
      data-msgid={message.id.replace(/-seg-\d+$/, '')}
      className={`group relative ${groupedWithPrev ? 'mt-0.5' : 'mt-2'} flex items-center ${
        isUser ? 'justify-end' : 'justify-start'
      }`}
    >
      {dx > 0 && (
        <span
          className="absolute left-1 text-[#075E54]"
          style={{ opacity: Math.min(dx / 60, 1) }}
          aria-hidden="true"
        >
          <ReplyIcon />
        </span>
      )}

      {!isUser && onStartReply && (
        <button
          type="button"
          onClick={() => onStartReply(message)}
          className="order-2 ml-1 hidden h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-black/5 group-hover:flex"
          aria-label="Responder"
        >
          <ReplyIcon />
        </button>
      )}

      <div
        {...swipeHandlers}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, touchAction: 'pan-y' }}
        className={`${bubbleMaxWidth} ${isUser ? 'order-1' : ''} rounded-lg px-3 py-2 shadow-sm ${
          isUser ? 'bg-[#DCF8C6]' : 'bg-white'
        }`}
      >
        {quoted && (
          <button
            type="button"
            onClick={() => onQuoteClick?.(quoted.id.replace(/-seg-\d+$/, ''))}
            className="mb-1 block w-full rounded border-l-4 border-[#075E54] bg-black/5 px-2 py-1 text-left"
          >
            <span className="block text-xs font-semibold text-[#075E54]">
              {quotedLabel}
            </span>
            <span className="block truncate text-xs text-gray-600">
              {truncate(replyPreviewText(quoted), 90)}
            </span>
          </button>
        )}

        {isUser && onStartReply && (
          <button
            type="button"
            onClick={() => onStartReply(message)}
            className="float-right -mr-1 -mt-0.5 ml-1 hidden h-6 w-6 items-center justify-center rounded-full text-gray-500 hover:bg-black/5 group-hover:flex"
            aria-label="Responder"
          >
            <ReplyIcon />
          </button>
        )}

        <div
          ref={bodyRef}
          style={
            !expanded
              ? {
                  display: '-webkit-box',
                  WebkitBoxOrient: 'vertical',
                  WebkitLineClamp: MAX_LINES,
                  overflow: 'hidden',
                }
              : undefined
          }
        >
          {isTypedImage && message.media_url && (
            <a
              href={message.media_url}
              target="_blank"
              rel="noreferrer"
              className="mb-1 block"
            >
              <img
                src={message.media_url}
                alt=""
                className="max-h-80 w-full rounded object-cover"
                loading="lazy"
              />
            </a>
          )}
          {message.message_type === 'audio' && message.media_url && (
            <audio controls src={message.media_url} className="max-w-full" />
          )}

          {renderItems.map((item, i) => {
            if (item.type === 'text') {
              return (
                <p
                  key={`t-${i}`}
                  className="whitespace-pre-wrap break-words text-sm text-gray-900"
                >
                  {item.value}
                </p>
              )
            }
            if (item.type === 'image') {
              return (
                <button
                  type="button"
                  key={`i-${i}-${item.src}`}
                  onClick={() => setLightbox({ srcs: [item.src], index: 0 })}
                  className="my-1 block w-full"
                >
                  <img
                    src={item.src}
                    alt=""
                    className="max-h-80 w-full rounded object-cover"
                    loading="lazy"
                  />
                </button>
              )
            }
            return (
              <ImageCarousel
                key={`g-${i}`}
                srcs={item.srcs}
                onImageClick={(index) => setLightbox({ srcs: item.srcs, index })}
              />
            )
          })}
        </div>

        {overflowing && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-xs font-semibold text-[#075E54] hover:underline"
          >
            {expanded ? 'Ler menos' : 'Ler mais'}
          </button>
        )}

        <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-gray-500">
          <span>{formatTime(message.created_at)}</span>
          <TickIcon state={isUser ? tickState : 'blue'} />
        </p>
      </div>

      {lightbox && (
        <ImageLightbox
          srcs={lightbox.srcs}
          startIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}

function ReplyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="9 17 4 12 9 7" />
      <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
    </svg>
  )
}

function TickIcon({ state }: { state: TickState }) {
  if (state === 'clock') {
    return (
      <span className="text-gray-500" aria-label="enviando">
        <ClockSvg />
      </span>
    )
  }
  // idle = blue: mensagens já no banco (carregadas no load) ficam como "lidas".
  const color = state === 'blue' || state === 'idle' ? '#34B7F1' : '#8696A0'
  const label = state === 'blue' || state === 'idle' ? 'lida' : 'entregue'
  return (
    <span style={{ color }} aria-label={label}>
      <DoubleCheckSvg />
    </span>
  )
}

function ClockSvg() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="1.5" y="1.5" width="13" height="13" rx="3" ry="3" />
      <path d="M8 4.5V8L10.5 9.5" strokeLinecap="round" />
    </svg>
  )
}

function DoubleCheckSvg() {
  return (
    <svg
      viewBox="0 0 18 12"
      width="14"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 6.5L4 9.5L10 2" />
      <path d="M8 6.5L11 9.5L17 2" />
    </svg>
  )
}
