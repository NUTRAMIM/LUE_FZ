'use client'

import { useState } from 'react'
import type { ChatMessage } from '../ChatClient'
import { parseSegments, groupConsecutiveImages } from './message-segments'
import { ImageCarousel } from './ImageCarousel'
import { ImageLightbox } from './ImageLightbox'

function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function MessageBubble({ message }: { message: ChatMessage }) {
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

        <p className="mt-1 text-right text-[10px] text-gray-500">
          {formatTime(message.created_at)}
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
