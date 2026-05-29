'use client'

import { useState } from 'react'
import { sendMessage } from '@/actions/chat'
import type { ChatMessage } from '../ChatClient'

export function ChatInput({
  slug,
  sending,
  onSending,
  onError,
  onLocalAdd,
  onReplaceTemp,
  onCycleStart,
  onCycleRename,
  onCycleCancel,
}: {
  slug: string
  sending: boolean
  onSending: (s: boolean) => void
  onError: (e: string | null) => void
  onLocalAdd: (m: ChatMessage) => void
  onReplaceTemp: (tempId: string, realId: string) => void
  onCycleStart: (tempId: string, content: string) => void
  onCycleRename: (tempId: string, realId: string) => void
  onCycleCancel: (tempId: string) => void
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
    onCycleStart(tempId, trimmed)
    setText('')

    const result = await sendMessage({
      slug,
      text: trimmed,
      messageType: 'text',
    })

    if (!result.success) {
      onCycleCancel(tempId)
      onError(result.error ?? 'Erro ao enviar.')
    } else if (result.messageId) {
      onReplaceTemp(tempId, result.messageId)
      onCycleRename(tempId, result.messageId)
    }
    onSending(false)
  }

  const canSend = text.trim().length > 0 && !sending

  return (
    <footer
      className="flex items-end gap-2 bg-white px-3 py-2 shadow-inner"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)' }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={1}
        placeholder="Mensagem"
        className="max-h-32 flex-1 resize-none rounded-2xl bg-gray-100 px-4 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#075E54]"
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={!canSend}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#075E54] text-white transition-colors hover:bg-[#054d44] disabled:opacity-50"
        aria-label="Enviar"
      >
        <PaperPlaneIcon />
      </button>
    </footer>
  )
}

function PaperPlaneIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  )
}
