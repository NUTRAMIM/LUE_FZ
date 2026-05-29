import type { RefObject } from 'react'
import type { ChatMessage } from '../ChatClient'
import { MessageBubble } from './MessageBubble'
import { tickStateFor, type Cycle } from './cycle'
import { groupMessagesByDay } from './group-by-day'

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
  const groups = groupMessagesByDay(messages, now)

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
      {groups.map((g) => (
        <div key={g.label + '-' + g.messages[0].id}>
          <DateSeparator label={g.label} />
          {g.messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              tickState={tickStateFor(m.id, cycle, now)}
            />
          ))}
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
