type Role = 'user' | 'assistant' | 'operator' | 'system'

export const SWIPE_TRIGGER_PX = 60

export function normalizeMessageId(id: string): string {
  return id.replace(/-seg-\d+$/, '')
}

export function segmentIndexFromId(id: string): number | undefined {
  const match = id.match(/-seg-(\d+)$/)
  return match ? Number(match[1]) : undefined
}

export function replyAuthorForRole(role: Role): 'cliente' | 'loja' {
  return role === 'user' ? 'cliente' : 'loja'
}

export function replyPreviewText(message: {
  message_type: 'text' | 'image' | 'audio'
  content: string
}): string {
  if (message.message_type === 'image') return '📷 Imagem'
  if (message.message_type === 'audio') return '🎤 Áudio'
  return message.content
}

export function truncate(text: string, max = 80): string {
  if (text.length <= max) return text
  return text.slice(0, max).trimEnd() + '…'
}

export function shouldTriggerReply(dx: number): boolean {
  return dx >= SWIPE_TRIGGER_PX
}
