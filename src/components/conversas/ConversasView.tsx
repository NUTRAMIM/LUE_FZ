'use client'

import { useEffect, useRef, useState } from 'react'
import {
  getConversations,
  getMessages,
  markConversationRead,
  type ConversationRow,
  type MessageRow,
} from '@/actions/conversas'
import { useConversasRealtime } from '@/lib/realtime-conversas'
import { ChatRail } from './ChatRail'
import { FullChat } from './FullChat'
import { truncatePreview } from './formatters'

interface ConversasViewProps {
  storeId: string
  initialActive: ConversationRow[]
  initialClosed?: ConversationRow[]
  initialSelectedId?: string | null
}

function previewFromContent(content: string): string {
  return truncatePreview(content, 120)
}

export function ConversasView({
  storeId,
  initialActive,
  initialClosed = [],
  initialSelectedId = null,
}: ConversasViewProps) {
  const [active, setActive] = useState<ConversationRow[]>(initialActive)
  const [closed, setClosed] = useState<ConversationRow[]>(initialClosed)
  // Se as encerradas já vieram pré-carregadas (deep-link de lead), evita o
  // fetch lazy e mantém a seção aberta pra a conversa alvo aparecer no rail.
  const [closedLoaded, setClosedLoaded] = useState(initialClosed.length > 0)
  const [closedExpanded, setClosedExpanded] = useState(initialClosed.length > 0)
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId ?? initialActive[0]?.id ?? null,
  )
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [query, setQuery] = useState('')

  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId

  // Load messages whenever selection changes; also mark as read.
  useEffect(() => {
    if (!selectedId) {
      setMessages([])
      return
    }
    let cancelled = false
    setLoadingMessages(true)
    getMessages(selectedId).then((rows) => {
      if (cancelled) return
      setMessages(rows)
      setLoadingMessages(false)
    })
    markConversationRead(selectedId)
    setActive((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, unread_count: 0 } : c)),
    )
    setClosed((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, unread_count: 0 } : c)),
    )
    return () => {
      cancelled = true
    }
  }, [selectedId])

  // Lazy-load closed list on first expand.
  useEffect(() => {
    if (!closedExpanded || closedLoaded) return
    let cancelled = false
    getConversations('closed').then((rows) => {
      if (cancelled) return
      setClosed(rows)
      setClosedLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [closedExpanded, closedLoaded])

  // Realtime: new messages and conversation lifecycle events.
  useConversasRealtime(storeId, {
    onNewMessage: (msg) => {
      const preview = previewFromContent(msg.content)
      const role = msg.role as ConversationRow['last_message_role']
      const isSelected = msg.conversation_id === selectedIdRef.current

      setActive((prev) => {
        const idx = prev.findIndex((c) => c.id === msg.conversation_id)
        if (idx === -1) return prev
        const updated: ConversationRow = {
          ...prev[idx],
          last_message_at: msg.created_at,
          last_message_preview: preview,
          last_message_role: role,
          unread_count: isSelected ? 0 : prev[idx].unread_count + 1,
        }
        const next = [...prev]
        next.splice(idx, 1)
        return [updated, ...next]
      })

      if (isSelected) {
        // Realtime payload doesn't include a signed media URL — for image/audio
        // the user would need to reopen the conversation to see the asset.
        // Text messages (the common case) appear immediately.
        setMessages((prev) => [
          ...prev,
          {
            id: msg.id,
            role: msg.role,
            content: msg.content,
            message_type: msg.message_type,
            media_url: null,
            created_at: msg.created_at,
          },
        ])
        markConversationRead(msg.conversation_id)
      }
    },

    onNewConversation: (conv) => {
      const placeholder: ConversationRow = {
        id: conv.id,
        visitor_id: conv.visitor_id,
        visitor_name: `Visitante #${conv.visitor_id.replace(/-/g, '').slice(0, 6)}`,
        status: 'ai_active',
        last_message_at: conv.last_message_at,
        last_message_preview: null,
        last_message_role: null,
        unread_count: 0,
        created_at: conv.created_at,
      }
      setActive((prev) => {
        if (prev.some((c) => c.id === conv.id)) return prev
        return [placeholder, ...prev]
      })
    },

    onConversationUpdated: (conv) => {
      if (conv.status === 'closed') {
        setActive((prev) => {
          const idx = prev.findIndex((c) => c.id === conv.id)
          if (idx === -1) return prev
          const row = prev[idx]
          if (closedLoaded) {
            setClosed((cprev) => [
              { ...row, status: 'closed' },
              ...cprev.filter((c) => c.id !== conv.id),
            ])
          }
          return prev.filter((c) => c.id !== conv.id)
        })
      } else if (conv.status === 'ai_active') {
        setClosed((prev) => {
          const idx = prev.findIndex((c) => c.id === conv.id)
          if (idx === -1) return prev
          const row = prev[idx]
          setActive((aprev) => [{ ...row, status: 'ai_active' }, ...aprev])
          return prev.filter((c) => c.id !== conv.id)
        })
      }
    },
  })

  const totalUnread = active.reduce((s, c) => s + c.unread_count, 0)
  const selected =
    active.find((c) => c.id === selectedId) ??
    closed.find((c) => c.id === selectedId) ??
    null

  const hasSelection = selectedId !== null

  return (
    <>
      <div
        className={`px-4 sm:px-6 pt-4 sm:pt-6 pb-3 sm:pb-4 border-b border-ink-200 bg-white/70 backdrop-blur sticky top-0 z-10 ${
          hasSelection ? 'hidden md:block' : ''
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <div className="eyebrow text-ink-500 flex items-center gap-2">
              <span>OPERAÇÃO</span>
              <span className="text-ink-300">/</span>
              <span className="text-brand-600">CONVERSAS</span>
            </div>
            <h1 className="font-display font-bold text-ink-900 tracking-tight mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[20px] sm:text-[24px]">
              Conversas
              <span className="text-ink-400 font-medium text-[14px] sm:text-[16px]">·</span>
              <span className="text-ink-500 font-medium text-[13px] sm:text-[15px]">
                {active.length} ativa{active.length === 1 ? '' : 's'}
                {totalUnread > 0 && ` · ${totalUnread} não lidas`}
              </span>
              <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-success-700 bg-success-50 ring-1 ring-success-100 px-2 py-0.5 rounded-md">
                <span className="live-dot" /> ao vivo
              </span>
            </h1>
          </div>
        </div>
      </div>

      <div className="px-3 sm:px-6 py-3 sm:py-5 grid gap-4 md:grid-cols-[340px_1fr]">
        <div className={hasSelection ? 'hidden md:block' : 'block'}>
          <ChatRail
            active={active}
            closed={closed}
            closedExpanded={closedExpanded}
            onToggleClosed={() => setClosedExpanded((v) => !v)}
            selectedId={selectedId}
            onSelect={setSelectedId}
            query={query}
            onQueryChange={setQuery}
          />
        </div>
        <div className={hasSelection ? 'block' : 'hidden md:block'}>
          <FullChat
            conversation={selected}
            messages={messages}
            loading={loadingMessages}
            onBack={() => setSelectedId(null)}
          />
        </div>
      </div>
    </>
  )
}
