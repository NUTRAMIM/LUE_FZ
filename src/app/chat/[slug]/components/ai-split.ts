export type AISegmentKind = 'text' | 'product'

export interface AISegment {
  kind: AISegmentKind
  content: string
}

export const TEXT_DELAY_MS_PER_CHAR = 30
export const PRODUCT_DELAY_MS = 4_000
export const FAST_PRODUCT_DELAY_MS = 1_500
export const PRODUCT_BURST_THRESHOLD = 8
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

export function delayForSegment(seg: AISegment, productCount = 0): number {
  if (seg.kind === 'product') {
    return productCount > PRODUCT_BURST_THRESHOLD
      ? FAST_PRODUCT_DELAY_MS
      : PRODUCT_DELAY_MS
  }
  return seg.content.length * TEXT_DELAY_MS_PER_CHAR
}
