'use client'

import { useState } from 'react'
import { sendMessage } from '@/actions/chat'
import type { ChatMessage } from '../ChatClient'

export function ChatInput({
  slug,
  conversationId,
  sending,
  onSending,
  onError,
  onLocalAdd,
}: {
  slug: string
  conversationId: string
  sending: boolean
  onSending: (s: boolean) => void
  onError: (e: string | null) => void
  onLocalAdd: (m: ChatMessage) => void
}) {
  const [text, setText] = useState('')

  async function handleSend() {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    onSending(true)
    onError(null)

    const tempId = `temp-${Date.now()}`
    onLocalAdd({
      id: tempId,
      role: 'user',
      content: trimmed,
      message_type: 'text',
      media_url: null,
      created_at: new Date().toISOString(),
    })
    setText('')

    const result = await sendMessage({
      slug,
      text: trimmed,
      messageType: 'text',
    })

    if (!result.success) {
      onError(result.error ?? 'Erro ao enviar.')
    }
    onSending(false)
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <footer className="flex items-end gap-2 bg-white px-3 py-2 shadow-inner">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKey}
        rows={1}
        placeholder="Mensagem"
        className="max-h-32 flex-1 resize-none rounded-2xl bg-gray-100 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#075E54]"
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={!text.trim() || sending}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-[#075E54] text-white disabled:opacity-50"
        aria-label="Enviar"
      >
        ➤
      </button>
    </footer>
  )
}
