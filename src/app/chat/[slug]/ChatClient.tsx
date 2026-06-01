'use client'

import { useReducer, useEffect, useRef, useState, useCallback } from 'react'
import { createClient as createBrowserSupabase } from '@/lib/supabase/client'
import { ChatHeader } from './components/ChatHeader'
import { MessageList } from './components/MessageList'
import { ChatInput } from './components/ChatInput'
import {
  cycleReducer,
  isTypingActive,
  type Cycle,
  type CycleAction,
} from './components/cycle'
import {
  splitAIMessage,
  delayForSegment,
  type AISegment,
} from './components/ai-split'
import { normalizeMessageId } from './components/reply-helpers'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'operator' | 'system'
  content: string
  message_type: 'text' | 'image' | 'audio'
  media_url: string | null
  created_at: string
  reply_to_message_id: string | null
}

interface AIQueue {
  segments: AISegment[]
  segIdx: number
  nextEmitAt: number
  sourceMsg: ChatMessage
}

interface State {
  messages: ChatMessage[]
  sending: boolean
  error: string | null
}

type Action =
  | { type: 'add'; message: ChatMessage }
  | { type: 'replaceTemp'; tempId: string; realId: string }
  | { type: 'sending'; sending: boolean }
  | { type: 'error'; error: string | null }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'add': {
      if (state.messages.some((m) => m.id === action.message.id)) return state
      // Realtime entrega o INSERT da msg do user antes do server action
      // retornar (o action espera n8n responder). Se encontrarmos uma temp-
      // do mesmo conteúdo, trocamos no lugar pra evitar a bolha duplicada
      // visível no intervalo entre INSERT e replaceTemp.
      if (action.message.role === 'user') {
        const dupTempIdx = state.messages.findIndex(
          (m) =>
            m.id.startsWith('temp-') &&
            m.role === 'user' &&
            m.message_type === action.message.message_type &&
            m.content === action.message.content,
        )
        if (dupTempIdx !== -1) {
          const next = state.messages.slice()
          next[dupTempIdx] = action.message
          return { ...state, messages: next }
        }
      }
      return { ...state, messages: [...state.messages, action.message] }
    }
    case 'replaceTemp':
      if (state.messages.some((m) => m.id === action.realId)) {
        return {
          ...state,
          messages: state.messages.filter((m) => m.id !== action.tempId),
        }
      }
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.tempId ? { ...m, id: action.realId } : m,
        ),
      }
    case 'sending':
      return { ...state, sending: action.sending }
    case 'error':
      return { ...state, error: action.error }
  }
}

export function ChatClient({
  slug,
  storeId,
  conversationId,
  storeName,
  storeLogoUrl,
  initialMessages,
}: {
  slug: string
  storeId: string
  conversationId: string
  storeName: string
  storeLogoUrl: string | null
  initialMessages: ChatMessage[]
}) {
  const [state, dispatch] = useReducer(reducer, {
    messages: initialMessages,
    sending: false,
    error: null,
  })

  const [cycle, setCycle] = useState<Cycle | null>(null)
  const cycleRef = useRef<Cycle | null>(null)
  // espelho mutável de cycle pra dispatchCycle ler sem stale closure (sincroniza pós-render)
  useEffect(() => {
    cycleRef.current = cycle
  }, [cycle])

  const [aiQueue, setAiQueue] = useState<AIQueue | null>(null)
  const aiQueueRef = useRef<AIQueue | null>(null)
  useEffect(() => {
    aiQueueRef.current = aiQueue
  }, [aiQueue])

  const [now, setNow] = useState<number>(() => Date.now())

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)

  const pendingTempsRef = useRef<Array<{ tempId: string; content: string }>>([])

  const enqueueAI = useCallback((msg: ChatMessage) => {
    const segments = splitAIMessage(msg.content)
    if (segments.length === 0) {
      // empty msg, nothing to render
      return
    }
    if (segments.length === 1) {
      // single segment: emit immediately, no queue overhead
      const seg = segments[0]
      const adjusted: ChatMessage = { ...msg, content: seg.content }
      dispatch({ type: 'add', message: adjusted })
      return
    }
    const now = Date.now()
    const queue: AIQueue = {
      segments,
      segIdx: 0,
      nextEmitAt: now + delayForSegment(segments[0]),
      sourceMsg: msg,
    }
    aiQueueRef.current = queue
    setAiQueue(queue)
  }, [])

  const dispatchCycle = useCallback(
    (action: CycleAction) => {
      const res = cycleReducer(cycleRef.current, action)
      cycleRef.current = res.cycle
      setCycle(res.cycle)
      if (res.releaseAI) {
        enqueueAI(res.releaseAI)
      }
    },
    [enqueueAI],
  )

  const processAIQueue = useCallback((now: number) => {
    const q = aiQueueRef.current
    if (!q) return
    if (now < q.nextEmitAt) return

    const seg = q.segments[q.segIdx]
    const adjusted: ChatMessage = {
      ...q.sourceMsg,
      id: `${q.sourceMsg.id}-seg-${q.segIdx}`,
      content: seg.content,
    }
    dispatch({ type: 'add', message: adjusted })

    const nextIdx = q.segIdx + 1
    if (nextIdx >= q.segments.length) {
      aiQueueRef.current = null
      setAiQueue(null)
      return
    }
    const next: AIQueue = {
      ...q,
      segIdx: nextIdx,
      nextEmitAt: now + delayForSegment(q.segments[nextIdx]),
    }
    aiQueueRef.current = next
    setAiQueue(next)
  }, [])

  // 500ms = metade do menor threshold (3s do relógio); garante transição visível sem custo grande
  useEffect(() => {
    if (cycle === null && aiQueue === null) return
    const id = setInterval(() => {
      const n = Date.now()
      setNow(n)
      dispatchCycle({ type: 'tickElapsed', now: n })
      processAIQueue(n)
    }, 500)
    return () => clearInterval(id)
  }, [cycle, aiQueue, dispatchCycle, processAIQueue])

  const visitorKeyRef = useRef(crypto.randomUUID())

  useEffect(() => {
    const supabase = createBrowserSupabase()
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload) => {
          const row = payload.new as {
            id: string
            conversation_id: string
            role: ChatMessage['role']
            content: string
            message_type: ChatMessage['message_type']
            media_path: string | null
            created_at: string
            reply_to_message_id: string | null
          }

          let media_url: string | null = null
          if (row.media_path) {
            const res = await fetch('/api/chat/media-url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: row.media_path }),
            })
            if (res.ok) {
              const j = await res.json()
              media_url = j.url ?? null
            }
          }

          const msg: ChatMessage = {
            id: row.id,
            role: row.role,
            content: row.content,
            message_type: row.message_type,
            media_url,
            created_at: row.created_at,
            reply_to_message_id: row.reply_to_message_id,
          }

          // findIndex pega o tempId mais antigo com esse content (FIFO).
          // Assume INSERTs chegam na ordem dos sends — verdadeiro pro Supabase realtime.
          if (row.role === 'user') {
            const idx = pendingTempsRef.current.findIndex(
              (p) => p.content === row.content,
            )
            if (idx !== -1) {
              const { tempId } = pendingTempsRef.current[idx]
              pendingTempsRef.current.splice(idx, 1)
              dispatchCycle({
                type: 'renameInCycle',
                tempId,
                realId: row.id,
              })
            }
            dispatch({ type: 'add', message: msg })
            return
          }

          if (row.role === 'assistant' || row.role === 'operator') {
            dispatchCycle({
              type: 'holdOrRelease',
              msg,
              now: Date.now(),
            })
            return
          }

          dispatch({ type: 'add', message: msg })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId, dispatchCycle])

  useEffect(() => {
    const supabase = createBrowserSupabase()
    const channel = supabase.channel(`store:${storeId}:visitors`, {
      config: { presence: { key: visitorKeyRef.current } },
    })
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channel.track({ online_at: new Date().toISOString() })
      }
    })
    return () => {
      supabase.removeChannel(channel)
    }
  }, [storeId])

  const isTyping = isTypingActive(cycle, now) || aiQueue !== null

  const scrollAnchor = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollAnchor.current?.scrollIntoView({ behavior: 'smooth' })
  }, [state.messages.length, isTyping])

  const handleCycleStart = useCallback(
    (tempId: string, content: string) => {
      pendingTempsRef.current.push({ tempId, content })
      dispatchCycle({
        type: 'startOrExtend',
        userMsgId: tempId,
        now: Date.now(),
      })
    },
    [dispatchCycle],
  )

  const handleCycleRename = useCallback(
    (tempId: string, realId: string) => {
      pendingTempsRef.current = pendingTempsRef.current.filter(
        (p) => p.tempId !== tempId,
      )
      dispatchCycle({ type: 'renameInCycle', tempId, realId })
    },
    [dispatchCycle],
  )

  const handleCycleCancel = useCallback(
    (tempId: string) => {
      pendingTempsRef.current = pendingTempsRef.current.filter(
        (p) => p.tempId !== tempId,
      )
      dispatchCycle({ type: 'cancelFor', userMsgId: tempId })
    },
    [dispatchCycle],
  )

  const handleStartReply = useCallback((message: ChatMessage) => {
    setReplyTo(message)
  }, [])

  const handleCancelReply = useCallback(() => {
    setReplyTo(null)
  }, [])

  const messageById = new Map<string, ChatMessage>()
  for (const m of state.messages) {
    const key = normalizeMessageId(m.id)
    if (!messageById.has(key)) messageById.set(key, m)
  }

  return (
    <div className="flex h-dvh flex-col bg-[#ECE5DD]">
      <ChatHeader
        storeName={storeName}
        logoUrl={storeLogoUrl}
        isTyping={isTyping}
      />
      <MessageList
        messages={state.messages}
        scrollAnchorRef={scrollAnchor}
        cycle={cycle}
        now={now}
        isTyping={isTyping}
        storeName={storeName}
        messageById={messageById}
        onStartReply={handleStartReply}
      />
      <ChatInput
        slug={slug}
        sending={state.sending}
        onSending={(sending) => dispatch({ type: 'sending', sending })}
        onError={(error) => dispatch({ type: 'error', error })}
        onLocalAdd={(message) => dispatch({ type: 'add', message })}
        onReplaceTemp={(tempId, realId) =>
          dispatch({ type: 'replaceTemp', tempId, realId })
        }
        onCycleStart={handleCycleStart}
        onCycleRename={handleCycleRename}
        onCycleCancel={handleCycleCancel}
        replyTo={replyTo}
        storeName={storeName}
        onCancelReply={handleCancelReply}
      />
      {state.error && (
        <div className="bg-red-50 px-4 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
    </div>
  )
}
