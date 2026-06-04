export type AISegmentKind = 'text' | 'product'

export interface AISegment {
  kind: AISegmentKind
  content: string
}

export const TEXT_DELAY_MS_PER_CHAR = 30
export const PRODUCT_DELAY_MS = 4_000
export const SENTENCES_PER_SEGMENT = 2

const PRODUCT_RE = /\[produto\]([\s\S]*?)\[\/produto\]/g
const SENTENCE_RE = /(?<=[^.?][.?])\s+/

export function splitAIMessage(content: string): AISegment[] {
  const segments: AISegment[] = []
  const re = new RegExp(PRODUCT_RE.source, PRODUCT_RE.flags)
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(content)) !== null) {
    if (match.index > lastIndex) {
      pushTextSegments(segments, content.slice(lastIndex, match.index))
    }
    const productContent = match[1].trim()
    if (productContent) {
      segments.push({ kind: 'product', content: productContent })
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < content.length) {
    pushTextSegments(segments, content.slice(lastIndex))
  }

  if (segments.length === 0 && content.trim()) {
    segments.push({ kind: 'text', content: content.trim() })
  }

  return segments
}

function pushTextSegments(out: AISegment[], chunk: string): void {
  const sentences = chunk
    .split(SENTENCE_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  for (let i = 0; i < sentences.length; i += SENTENCES_PER_SEGMENT) {
    const group = sentences.slice(i, i + SENTENCES_PER_SEGMENT).join(' ')
    if (group) out.push({ kind: 'text', content: group })
  }
}

interface SplittableMessage {
  id: string
  role: 'user' | 'assistant' | 'operator' | 'system'
  content: string
  message_type: 'text' | 'image' | 'audio'
}

// Reaplica o split nas mensagens carregadas do banco (reload), espelhando o
// que o realtime faz via enqueueAI. Sem delays — histórico aparece de uma vez.
export function expandInitialMessages<T extends SplittableMessage>(
  messages: T[],
): T[] {
  const out: T[] = []
  for (const m of messages) {
    const splittable =
      (m.role === 'assistant' || m.role === 'operator') &&
      m.message_type === 'text'
    if (!splittable) {
      out.push(m)
      continue
    }
    const segments = splitAIMessage(m.content)
    if (segments.length === 0) continue
    if (segments.length === 1) {
      out.push({ ...m, content: segments[0].content })
      continue
    }
    segments.forEach((seg, i) => {
      out.push({ ...m, id: `${m.id}-seg-${i}`, content: seg.content })
    })
  }
  return out
}

export function delayForSegment(seg: AISegment): number {
  if (seg.kind === 'product') return PRODUCT_DELAY_MS
  return seg.content.length * TEXT_DELAY_MS_PER_CHAR
}
