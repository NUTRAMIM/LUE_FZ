'use client'

import { useRef, type RefObject } from 'react'
import type { ChatMessage } from '../ChatClient'
import { MessageBubble } from './MessageBubble'
import { tickStateFor, type Cycle } from './cycle'
import { groupMessagesByDay } from './group-by-day'
import { replyAuthorForRole } from './reply-helpers'

export function MessageList({
  messages,
  scrollAnchorRef,
  cycle,
  now,
  isTyping,
  storeName,
  messageById,
  onStartReply,
}: {
  messages: ChatMessage[]
  scrollAnchorRef: RefObject<HTMLDivElement | null>
  cycle: Cycle | null
  now: number
  isTyping: boolean
  storeName: string
  messageById: Map<string, ChatMessage>
  onStartReply: (message: ChatMessage) => void
}) {
  const groups = groupMessagesByDay(messages, now)
  const containerRef = useRef<HTMLDivElement>(null)

  function handleQuoteClick(targetId: string) {
    const el = containerRef.current?.querySelector<HTMLElement>(
      `[data-msgid="${targetId}"]`,
    )
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.remove('reply-flash')
    // reflow para reiniciar a animação caso clique de novo no mesmo alvo
    void el.offsetWidth
    el.classList.add('reply-flash')
    window.setTimeout(() => {
      el.classList.remove('reply-flash')
    }, 1000)
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-3 py-2"
      style={{
        backgroundImage: "url('/chat-bg-pattern.svg')",
        backgroundRepeat: 'repeat',
        backgroundSize: '280px 280px',
      }}
    >
      {messages.length === 0 && (
        <p className="mt-8 text-center text-sm text-gray-500">
          Comece a conversa enviando uma mensagem.
        </p>
      )}
      {groups.map((g) => (
        <div key={g.label + '-' + g.messages[0].id}>
          <DateSeparator label={g.label} />
          {g.messages.map((m, i) => {
            const quoted = m.reply_to_message_id
              ? messageById.get(m.reply_to_message_id) ?? null
              : null
            const quotedLabel = quoted
              ? replyAuthorForRole(quoted.role) === 'cliente'
                ? 'Você'
                : storeName
              : ''
            const prev = i > 0 ? g.messages[i - 1] : null
            const groupedWithPrev =
              !!prev &&
              prev.role !== 'system' &&
              m.role !== 'system' &&
              (prev.role === 'user') === (m.role === 'user')
            return (
              <MessageBubble
                key={m.id}
                message={m}
                tickState={tickStateFor(m.id, cycle, now)}
                quoted={quoted}
                quotedLabel={quotedLabel}
                groupedWithPrev={groupedWithPrev}
                onStartReply={onStartReply}
                onQuoteClick={handleQuoteClick}
              />
            )
          })}
        </div>
      ))}
      {isTyping && <TypingBubble />}
      <div ref={scrollAnchorRef} />
    </div>
  )
}

function DateSeparator({ label }: { label: string }) {
  return (
    <div className="my-2 flex justify-center">
      <span className="rounded-md bg-white/85 px-3 py-1 text-[11px] font-medium text-gray-600 shadow-sm">
        {label}
      </span>
    </div>
  )
}

function TypingBubble() {
  return (
    <div className="mt-2 flex justify-start" aria-label="digitando">
      <div className="rounded-lg bg-white px-3 py-2 shadow-sm">
        <span className="typing">
          <span />
          <span />
          <span />
        </span>
      </div>
    </div>
  )
}
