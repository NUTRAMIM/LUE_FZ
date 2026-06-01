'use client'

import { useState, useEffect } from 'react'
import { sendMessage } from '@/actions/chat'
import type { ChatMessage } from '../ChatClient'
import {
  normalizeMessageId,
  segmentIndexFromId,
  replyAuthorForRole,
  replyPreviewText,
  truncate,
} from './reply-helpers'

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
  replyTo,
  storeName,
  onCancelReply,
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
  replyTo: ChatMessage | null
  storeName: string
  onCancelReply: () => void
}) {
  const [text, setText] = useState('')

  const [isDesktop, setIsDesktop] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)')
    setIsDesktop(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  async function handleSend() {
    const trimmed = text.trim()
    if (!trimmed) return
    const replyId = replyTo ? normalizeMessageId(replyTo.id) : undefined
    const replySegmentIndex = replyTo ? segmentIndexFromId(replyTo.id) : undefined
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
      reply_to_message_id: replyId ?? null,
    })
    onCycleStart(tempId, trimmed)
    setText('')
    onCancelReply()

    const result = await sendMessage({
      slug,
      text: trimmed,
      messageType: 'text',
      ...(replyId ? { replyToMessageId: replyId } : {}),
      ...(replySegmentIndex !== undefined
        ? { replyToSegmentIndex: replySegmentIndex }
        : {}),
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

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (isDesktop && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const canSend = text.trim().length > 0

  const replyLabel = replyTo
    ? replyAuthorForRole(replyTo.role) === 'cliente'
      ? 'Você'
      : storeName
    : ''

  return (
    <div className="bg-white">
      {replyTo && (
        <div className="reply-bar-in flex items-center gap-2 border-l-4 border-[#075E54] bg-gray-50 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-[#075E54]">{replyLabel}</p>
            <p className="truncate text-xs text-gray-600">
              {truncate(replyPreviewText(replyTo), 80)}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-black/5"
            aria-label="Cancelar resposta"
          >
            <CloseIcon />
          </button>
        </div>
      )}
      <footer
        className="flex items-end gap-2 px-3 py-2 shadow-inner"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)' }}
      >
        <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKey}
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
    </div>
  )
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
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
