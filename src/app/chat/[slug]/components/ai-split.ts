export type AISegmentKind = 'text' | 'product'

export interface AISegment {
  kind: AISegmentKind
  content: string
}

export const TEXT_DELAY_MS_PER_CHAR = 30
export const PRODUCT_DELAY_MS = 4_000

const PRODUCT_RE = /\[produto\]([\s\S]*?)\[\/produto\]/g
const SENTENCE_RE = /(?<=[^.]\.)\s+/

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
  const sentences = chunk.split(SENTENCE_RE)
  for (const s of sentences) {
    const trimmed = s.trim()
    if (trimmed) out.push({ kind: 'text', content: trimmed })
  }
}

export function delayForSegment(seg: AISegment): number {
  if (seg.kind === 'product') return PRODUCT_DELAY_MS
  return seg.content.length * TEXT_DELAY_MS_PER_CHAR
}
