import type { ChatMessage } from '../ChatClient'

export interface MessageGroup {
  label: string
  messages: ChatMessage[]
}

export function groupMessagesByDay(
  messages: ChatMessage[],
  now: number,
): MessageGroup[] {
  if (messages.length === 0) return []

  const groups: MessageGroup[] = []
  let currentKey: string | null = null
  let currentGroup: MessageGroup | null = null

  for (const msg of messages) {
    const d = new Date(msg.created_at)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    if (key !== currentKey) {
      currentGroup = { label: labelFor(d, now), messages: [] }
      groups.push(currentGroup)
      currentKey = key
    }
    currentGroup!.messages.push(msg)
  }

  return groups
}

function labelFor(d: Date, now: number): string {
  const today = new Date(now)
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)

  if (isSameDay(d, today)) return 'Hoje'
  if (isSameDay(d, yesterday)) return 'Ontem'

  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}
