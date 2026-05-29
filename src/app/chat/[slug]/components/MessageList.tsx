import type { RefObject } from 'react'
import type { ChatMessage } from '../ChatClient'
import { MessageBubble } from './MessageBubble'
import { tickStateFor, type Cycle } from './cycle'

export function MessageList({
  messages,
  scrollAnchorRef,
  cycle,
  now,
  isTyping,
}: {
  messages: ChatMessage[]
  scrollAnchorRef: RefObject<HTMLDivElement | null>
  cycle: Cycle | null
  now: number
  isTyping: boolean
}) {
  return (
    <div
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
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          tickState={tickStateFor(m.id, cycle, now)}
        />
      ))}
      {isTyping && <TypingBubble />}
      <div ref={scrollAnchorRef} />
    </div>
  )
}

function TypingBubble() {
  return (
    <div className="mb-0.5 flex justify-start" aria-label="digitando">
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
