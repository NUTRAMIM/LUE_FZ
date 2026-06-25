'use server'

import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { dispatchToN8n } from '@/lib/n8n'
import { signedReadUrl } from '@/lib/chat-media'
import { splitAIMessage } from '@/app/chat/[slug]/components/ai-split'
import {
  COOKIE_NAME,
  COOKIE_OPTIONS,
  buildVisitorCookieValue,
  generateVisitorId,
  parseVisitorCookieValue,
} from '@/lib/visitor-cookie'
import { isStoreSubscriptionActive } from '@/lib/subscription'
import {
  storeConversationLimit,
  conversationWithinQuota,
} from '@/lib/conversation-quota'

export interface ChatBootstrap {
  conversationId: string
  storeId: string
  storeName: string
  storeLogoUrl: string | null
  messages: Array<{
    id: string
    role: 'user' | 'assistant' | 'operator' | 'system'
    content: string
    message_type: 'text' | 'image' | 'audio'
    media_url: string | null
    created_at: string
    reply_to_message_id: string | null
  }>
}

async function getOrCreateVisitorId(): Promise<string> {
  const cookieStore = await cookies()
  const raw = cookieStore.get(COOKIE_NAME)?.value
  const existing = parseVisitorCookieValue(raw)
  if (existing) return existing

  // Cookie missing/invalid in a Server Component context — middleware
  // normally sets it for /chat/*. Server Actions (POST) can also set it.
  try {
    const newId = generateVisitorId()
    cookieStore.set(COOKIE_NAME, buildVisitorCookieValue(newId), COOKIE_OPTIONS)
    return newId
  } catch {
    // Fallback: middleware will set on next request; transient ID for this render.
    return generateVisitorId()
  }
}

async function resolveStoreBySlug(slug: string) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('store_settings')
    .select('id, store_name, chat_slug, logo_url')
    .eq('chat_slug', slug)
    .maybeSingle()
  if (error) {
    console.error('resolveStoreBySlug error', error)
    return null
  }
  return data
}

export async function ensureConversation(slug: string): Promise<ChatBootstrap> {
  const store = await resolveStoreBySlug(slug)
  if (!store) notFound()

  const visitorId = await getOrCreateVisitorId()
  const admin = createAdminClient()

  let { data: conversation } = await admin
    .from('conversations')
    .select('id')
    .eq('store_id', store.id)
    .eq('visitor_id', visitorId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!conversation) {
    const { data: created, error } = await admin
      .from('conversations')
      .insert({
        store_id: store.id,
        visitor_id: visitorId,
        status: 'ai_active',
      })
      .select('id')
      .single()
    if (error || !created) {
      console.error('create conversation error', error)
      throw new Error('Não foi possível iniciar a conversa.')
    }
    conversation = created
  }

  const { data: rows } = await admin
    .from('messages')
    .select('id, role, content, message_type, media_path, created_at, reply_to_message_id')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: true })
    .limit(200)

  const messages = await Promise.all(
    (rows ?? []).map(async (m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      message_type: m.message_type,
      media_url: await signedReadUrl(m.media_path),
      created_at: m.created_at,
      reply_to_message_id: m.reply_to_message_id,
    })),
  )

  return {
    conversationId: conversation.id,
    storeId: store.id,
    storeName: store.store_name,
    storeLogoUrl: store.logo_url ?? null,
    messages,
  }
}

export interface SendMessageInput {
  slug: string
  text: string
  mediaPath?: string
  messageType: 'text' | 'image' | 'audio'
  replyToMessageId?: string
  replyToSegmentIndex?: number
}

export interface SendMessageResult {
  success: boolean
  messageId?: string
  error?: string
}

export async function sendMessage(
  input: SendMessageInput,
): Promise<SendMessageResult> {
  const store = await resolveStoreBySlug(input.slug)
  if (!store) return { success: false, error: 'Loja não encontrada.' }

  const visitorId = await getOrCreateVisitorId()
  const admin = createAdminClient()

  const { data: conv } = await admin
    .from('conversations')
    .select('id, created_at')
    .eq('store_id', store.id)
    .eq('visitor_id', visitorId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!conv) return { success: false, error: 'Conversa não encontrada.' }

  const text = (input.text ?? '').slice(0, 20000)
  if (input.messageType === 'text' && text.trim().length === 0) {
    return { success: false, error: 'Mensagem vazia.' }
  }

  const { data: inserted, error: insertErr } = await admin
    .from('messages')
    .insert({
      conversation_id: conv.id,
      role: 'user',
      content: text,
      message_type: input.messageType,
      media_path: input.mediaPath ?? null,
      reply_to_message_id: input.replyToMessageId ?? null,
    })
    .select('id')
    .single()

  if (insertErr || !inserted) {
    console.error('insert message error', insertErr)
    return { success: false, error: 'Erro ao salvar mensagem.' }
  }

  // Gate de assinatura: a mensagem do visitante é sempre salva (o dono não
  // perde o lead), mas a IA só responde se a loja tiver assinatura ativa.
  const active = await isStoreSubscriptionActive(store.id)
  if (!active) {
    return { success: true, messageId: inserted.id }
  }

  // Cota mensal de conversas: as primeiras N conversas do mês recebem IA.
  // Esta conversa, se estiver além da cota, não dispara a IA (mensagem do
  // visitante segue salva). Conversas em andamento de meses anteriores passam.
  const convLimit = await storeConversationLimit(store.id)
  if (convLimit !== null) {
    const within = await conversationWithinQuota(
      store.id,
      conv.created_at,
      convLimit,
    )
    if (!within) {
      return { success: true, messageId: inserted.id }
    }
  }

  const mediaUrl = await signedReadUrl(input.mediaPath ?? null)

  let respondendoA:
    | { id_mensagem: string; autor: 'cliente' | 'loja'; conteudo: string }
    | undefined
  if (input.replyToMessageId) {
    const { data: quoted } = await admin
      .from('messages')
      .select('id, role, content')
      .eq('id', input.replyToMessageId)
      // Restringe a citação à conversa do próprio visitante: sem isto, um
      // visitante podia passar o UUID de uma mensagem de OUTRA loja/conversa
      // (admin client bypassa RLS) e receber o conteúdo dela de volta.
      .eq('conversation_id', conv.id)
      .maybeSingle()
    if (quoted) {
      // Mensagens da IA são divididas em segmentos só na exibição (um balão por
      // sentença/produto). Quando o cliente responde a um segmento específico,
      // reaplicamos o split na linha do banco e enviamos só aquele trecho — assim
      // o agente entende a referência ao balão, não ao grupo inteiro.
      let conteudo = quoted.content
      if (input.replyToSegmentIndex !== undefined && quoted.role !== 'user') {
        const seg = splitAIMessage(quoted.content)[input.replyToSegmentIndex]
        if (seg) conteudo = seg.content
      }
      respondendoA = {
        id_mensagem: quoted.id,
        autor: quoted.role === 'user' ? 'cliente' : 'loja',
        conteudo,
      }
    }
  }

  try {
    const res = await dispatchToN8n({
      mensagem: text,
      id_mensagem: inserted.id,
      id_conversa: conv.id,
      nome_loja: store.store_name,
      id_loja: store.id,
      tipo_de_mensagem: input.messageType,
      ...(mediaUrl ? { media_url: mediaUrl } : {}),
      ...(respondendoA ? { respondendo_a: respondendoA } : {}),
    })

    if (res && res.ok) {
      const data = (await res.json().catch(() => null)) as
        | { output?: string; messages?: string[]; ok?: boolean }
        | null
      // Three response shapes supported:
      //   {output: "..."} — n8n returns the agent's full text (simple flow)
      //   {messages: [...]} — n8n returns split chunks for the app to space out
      //   {ok: true} — n8n inserts assistant rows itself (no-op here)
      const parts =
        Array.isArray(data?.messages) && data.messages.length > 0
          ? data.messages
          : data?.output
            ? [data.output]
            : []
      for (let i = 0; i < parts.length; i++) {
        const content = (parts[i] ?? '').trim()
        if (!content) continue
        if (i > 0) {
          const waitMs = Math.min(Math.max(content.length * 30, 800), 8000)
          await new Promise((r) => setTimeout(r, waitMs))
        }
        await admin.from('messages').insert({
          conversation_id: conv.id,
          role: 'assistant',
          content,
          message_type: 'text',
        })
      }
    } else if (res) {
      console.error('dispatchToN8n non-ok', res.status)
    }
  } catch (e) {
    console.error('dispatchToN8n threw', e)
    await admin.from('messages').insert({
      conversation_id: conv.id,
      role: 'system',
      content: 'Estamos com instabilidade. Sua mensagem foi recebida.',
      message_type: 'text',
    })
  }

  return { success: true, messageId: inserted.id }
}

const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp']
const ALLOWED_AUDIO_MIME = ['audio/webm', 'audio/ogg']
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_AUDIO_BYTES = 2 * 1024 * 1024

export interface GetUploadUrlInput {
  slug: string
  mime: string
  size: number
}

export interface GetUploadUrlResult {
  success: boolean
  uploadUrl?: string
  mediaPath?: string
  token?: string
  error?: string
}

export async function getUploadUrl(
  input: GetUploadUrlInput,
): Promise<GetUploadUrlResult> {
  const store = await resolveStoreBySlug(input.slug)
  if (!store) return { success: false, error: 'Loja não encontrada.' }

  const visitorId = await getOrCreateVisitorId()
  const admin = createAdminClient()

  const { data: conv } = await admin
    .from('conversations')
    .select('id')
    .eq('store_id', store.id)
    .eq('visitor_id', visitorId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!conv) return { success: false, error: 'Conversa não encontrada.' }

  const isImage = ALLOWED_IMAGE_MIME.includes(input.mime)
  const isAudio = ALLOWED_AUDIO_MIME.includes(input.mime)
  if (!isImage && !isAudio) {
    return { success: false, error: 'Tipo de arquivo não suportado.' }
  }
  const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES
  if (input.size > maxBytes) {
    return { success: false, error: 'Arquivo excede o tamanho máximo.' }
  }

  const ext =
    input.mime === 'image/jpeg'
      ? 'jpg'
      : input.mime === 'image/png'
      ? 'png'
      : input.mime === 'image/webp'
      ? 'webp'
      : input.mime === 'audio/webm'
      ? 'webm'
      : 'ogg'

  const messageId = randomUUID()
  const path = `${store.id}/${conv.id}/${messageId}.${ext}`

  const { data, error } = await admin.storage
    .from('chat-media')
    .createSignedUploadUrl(path)

  if (error || !data) {
    console.error('createSignedUploadUrl error', error)
    return { success: false, error: 'Erro ao gerar URL de upload.' }
  }

  return {
    success: true,
    uploadUrl: data.signedUrl,
    mediaPath: path,
    token: data.token,
  }
}
