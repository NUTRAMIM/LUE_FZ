'use client'

import { useState } from 'react'
import type { ChatMessage } from '../ChatClient'
import type { TickState } from './cycle'
import { parseSegments, groupConsecutiveImages } from './message-segments'
import { ImageCarousel } from './ImageCarousel'
import { ImageLightbox } from './ImageLightbox'

function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function MessageBubble({
  message,
  tickState = 'idle',
}: {
  message: ChatMessage
  tickState?: TickState
}) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  const [lightbox, setLightbox] = useState<{ srcs: string[]; index: number } | null>(null)

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
    <div className={`mb-0.5 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`${bubbleMaxWidth} rounded-lg px-3 py-2 shadow-sm ${
          isUser ? 'bg-[#DCF8C6]' : 'bg-white'
        }`}
      >
        {/* Mídia legítima (mensagem do tipo image/audio com media_url) — comportamento atual preservado */}
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

        {/* Texto + imagens detectadas no content */}
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
          // imageGroup
          return (
            <ImageCarousel
              key={`g-${i}`}
              srcs={item.srcs}
              onImageClick={(index) => setLightbox({ srcs: item.srcs, index })}
            />
          )
        })}

        <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-gray-500">
          <span>{formatTime(message.created_at)}</span>
          {isUser && <TickIcon state={tickState} />}
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

function TickIcon({ state }: { state: TickState }) {
  if (state === 'clock') {
    return (
      <span className="text-gray-500" aria-label="enviando">
        <ClockSvg />
      </span>
    )
  }
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
      <circle cx="8" cy="8" r="6.5" />
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
      <path d="M9 9.5L17 2" />
    </svg>
  )
}
