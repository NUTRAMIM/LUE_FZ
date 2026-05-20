'use server'

import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'
import { signedReadUrl } from '@/lib/chat-media'
import { visitorName, truncatePreview } from '@/components/conversas/formatters'

export interface ConversationRow {
  id: string
  visitor_id: string
  visitor_name: string
  status: 'ai_active' | 'closed'
  last_message_at: string | null
  last_message_preview: string | null
  last_message_role: 'user' | 'assistant' | 'operator' | 'system' | null
  unread_count: number
  created_at: string
}

export interface MessageRow {
  id: string
  role: 'user' | 'assistant' | 'operator' | 'system'
  content: string
  message_type: 'text' | 'image' | 'audio'
  media_url: string | null
  created_at: string
}

const PREVIEW_MAX = 120

export async function getConversations(
  filter: 'active' | 'closed',
): Promise<ConversationRow[]> {
  const supabase = await createClient()
  const user = await getAuthedUser()
  if (!user) return []

  const status = filter === 'active' ? 'ai_active' : 'closed'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(
    'list_conversations_for_store',
    { p_store_id: user.id, p_status: status },
  )

  if (error || !data) {
    console.error('getConversations error', error)
    return []
  }

  return (data as Array<{
    id: string
    visitor_id: string
    lead_name: string | null
    status: string
    last_message_at: string | null
    last_message_preview: string | null
    last_message_role: string | null
    unread_count: number
    created_at: string
  }>).map((r) => ({
    id: r.id,
    visitor_id: r.visitor_id,
    visitor_name: visitorName(r.visitor_id, r.lead_name),
    status: r.status as 'ai_active' | 'closed',
    last_message_at: r.last_message_at,
    last_message_preview: truncatePreview(r.last_message_preview, PREVIEW_MAX),
    last_message_role:
      (r.last_message_role as ConversationRow['last_message_role']) ?? null,
    unread_count: Number(r.unread_count ?? 0),
    created_at: r.created_at,
  }))
}

export async function getMessages(
  conversationId: string,
): Promise<MessageRow[]> {
  const supabase = await createClient()
  const user = await getAuthedUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('messages')
    .select('id, role, content, message_type, media_path, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(500)

  if (error || !data) {
    console.error('getMessages error', error)
    return []
  }

  return await Promise.all(
    data.map(async (m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      message_type: m.message_type,
      media_url: await signedReadUrl(m.media_path),
      created_at: m.created_at,
    })),
  )
}

export async function markConversationRead(
  conversationId: string,
): Promise<{ success: boolean }> {
  const supabase = await createClient()
  const user = await getAuthedUser()
  if (!user) return { success: false }

  const { error } = await supabase
    .from('conversations')
    .update({ last_read_at: new Date().toISOString() })
    .eq('id', conversationId)

  if (error) {
    console.error('markConversationRead error', error)
    return { success: false }
  }
  return { success: true }
}
