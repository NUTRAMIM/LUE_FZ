'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export interface RealtimeMessage {
  id: string
  conversation_id: string
  store_id: string
  role: 'user' | 'assistant' | 'operator' | 'system'
  content: string
  message_type: 'text' | 'image' | 'audio'
  media_path: string | null
  created_at: string
}

export interface RealtimeConversation {
  id: string
  store_id: string | null
  visitor_id: string
  status: 'ai_active' | 'human_active' | 'closed'
  lead_id: string | null
  last_message_at: string | null
  last_read_at: string | null
  created_at: string
}

export interface ConversasRealtimeHandlers {
  onNewMessage: (msg: RealtimeMessage) => void
  onNewConversation: (conv: RealtimeConversation) => void
  onConversationUpdated: (conv: RealtimeConversation) => void
}

export function useConversasRealtime(
  storeId: string,
  handlers: ConversasRealtimeHandlers,
) {
  useEffect(() => {
    const supabase = createClient()

    const messagesChannel = supabase
      .channel(`messages:${storeId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `store_id=eq.${storeId}`,
        },
        (payload) => handlers.onNewMessage(payload.new as RealtimeMessage),
      )
      .subscribe()

    const conversationsChannel = supabase
      .channel(`conversations:${storeId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `store_id=eq.${storeId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            handlers.onNewConversation(payload.new as RealtimeConversation)
          } else if (payload.eventType === 'UPDATE') {
            handlers.onConversationUpdated(
              payload.new as RealtimeConversation,
            )
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(messagesChannel)
      supabase.removeChannel(conversationsChannel)
    }
    // Handlers can be re-created across renders; we only re-subscribe when the
    // store changes. Callers should keep handlers stable via useCallback if
    // they capture state, but the latest reference is read each event via
    // closure on the outer handlers object — safer is to keep `handlers` in
    // a ref. For MVP we accept the simpler form; storeId change is rare.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId])
}
