'use client'

import { useReducer, useEffect, useRef } from 'react'
import { createClient as createBrowserSupabase } from '@/lib/supabase/client'
import { ChatHeader } from './components/ChatHeader'
import { MessageList } from './components/MessageList'
import { ChatInput } from './components/ChatInput'

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
    case 'add':
      if (state.messages.some((m) => m.id === action.message.id)) return state
      return { ...state, messages: [...state.messages, action.message] }
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
  conversationId,
  storeName,
  initialMessages,
}: {
  slug: string
  conversationId: string
  storeName: string
  initialMessages: ChatMessage[]
}) {
  const [state, dispatch] = useReducer(reducer, {
    messages: initialMessages,
    sending: false,
    error: null,
  })

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

          dispatch({
            type: 'add',
            message: {
              id: row.id,
              role: row.role,
              content: row.content,
              message_type: row.message_type,
              media_url,
              created_at: row.created_at,
            },
          })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId])

  const scrollAnchor = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollAnchor.current?.scrollIntoView({ behavior: 'smooth' })
  }, [state.messages.length])

  return (
    <div className="flex h-dvh flex-col bg-[#ECE5DD]">
      <ChatHeader storeName={storeName} />
      <MessageList messages={state.messages} scrollAnchorRef={scrollAnchor} />
      <ChatInput
        slug={slug}
        conversationId={conversationId}
        sending={state.sending}
        onSending={(sending) => dispatch({ type: 'sending', sending })}
        onError={(error) => dispatch({ type: 'error', error })}
        onLocalAdd={(message) => dispatch({ type: 'add', message })}
        onReplaceTemp={(tempId, realId) =>
          dispatch({ type: 'replaceTemp', tempId, realId })
        }
      />
      {state.error && (
        <div className="bg-red-50 px-4 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
    </div>
  )
}
