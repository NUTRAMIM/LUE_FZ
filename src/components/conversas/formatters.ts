const PALETTE = [
  '#A78BFA', '#FBBF24', '#34D399', '#60A5FA',
  '#F87171', '#C4B5FD', '#F472B6', '#22D3EE',
] as const

export function visitorName(
  visitorId: string,
  leadName: string | null,
): string {
  if (leadName && leadName.trim().length > 0) return leadName
  return `Visitante #${visitorId.replace(/-/g, '').slice(0, 6)}`
}

export function avatarColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }
  const idx = Math.abs(hash) % PALETTE.length
  return PALETTE[idx]
}

export function avatarInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const parts = trimmed.split(/\s+/)
  if (parts.length === 1) return parts[0][0].toUpperCase()
  const first = parts[0][0]
  const last = parts[parts.length - 1][0]
  return `${first}${last}`.toUpperCase()
}

export function formatRelativeTime(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return ''
  const then = new Date(iso)
  const diffSec = Math.floor((now.getTime() - then.getTime()) / 1000)
  if (diffSec < 60) return 'agora'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}min`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}h`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 2) return 'ontem'
  const dd = String(then.getUTCDate()).padStart(2, '0')
  const mm = String(then.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}`
}

export function previewPrefix(
  role: 'user' | 'assistant' | 'operator' | 'system' | null,
): string {
  if (role === 'user') return 'Visitante: '
  if (role === 'assistant') return 'IA: '
  if (role === 'operator') return 'Você: '
  return ''
}

export function truncatePreview(
  text: string | null,
  max: number,
): string {
  if (!text) return ''
  if (text.length <= max) return text
  return text.slice(0, max) + '…'
}
