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

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'operator' | 'system'
  content: string
  message_type: 'text' | 'image' | 'audio'
  media_url: string | null
  created_at: string
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
  // espelho mutável de cycle pra dispatchCycle ler sem stale closure
  cycleRef.current = cycle

  const [now, setNow] = useState<number>(() => Date.now())

  const pendingTempsRef = useRef<Array<{ tempId: string; content: string }>>([])

  const dispatchCycle = useCallback((action: CycleAction) => {
    const res = cycleReducer(cycleRef.current, action)
    cycleRef.current = res.cycle
    setCycle(res.cycle)
    if (res.releaseAI) {
      dispatch({ type: 'add', message: res.releaseAI })
    }
  }, [])

  // 500ms = metade do menor threshold (3s do relógio); garante transição visível sem custo grande
  useEffect(() => {
    if (cycle === null) return
    const id = setInterval(() => {
      const n = Date.now()
      setNow(n)
      dispatchCycle({ type: 'tickElapsed', now: n })
    }, 500)
    return () => clearInterval(id)
  }, [cycle, dispatchCycle])

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

  const isTyping = isTypingActive(cycle, now)

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
      />
      {state.error && (
        <div className="bg-red-50 px-4 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
    </div>
  )
}
