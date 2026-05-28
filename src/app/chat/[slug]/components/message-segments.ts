export type Segment =
  | { type: 'text'; value: string }
  | { type: 'image'; src: string }

export type RenderItem =
  | { type: 'text'; value: string }
  | { type: 'image'; src: string }
  | { type: 'imageGroup'; srcs: string[] }

const IMAGE_URL_RE =
  /https?:\/\/\S+?\.(?:jpe?g|png|webp|gif)(?:\?\S*)?/gi

export function parseSegments(
  text: string,
): { segments: Segment[]; hasImage: boolean } {
  const segments: Segment[] = []
  const re = new RegExp(IMAGE_URL_RE.source, IMAGE_URL_RE.flags)
  let lastIndex = 0
  let match: RegExpExecArray | null
  let hasImage = false
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const chunk = text.slice(lastIndex, match.index)
      if (chunk.trim()) segments.push({ type: 'text', value: chunk.trim() })
    }
    segments.push({ type: 'image', src: match[0] })
    hasImage = true
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    const tail = text.slice(lastIndex)
    if (tail.trim()) segments.push({ type: 'text', value: tail.trim() })
  }
  if (segments.length === 0 && text) segments.push({ type: 'text', value: text })
  return { segments, hasImage }
}

export function groupConsecutiveImages(segments: Segment[]): RenderItem[] {
  const out: RenderItem[] = []
  let buffer: string[] = []

  const flush = () => {
    if (buffer.length === 0) return
    if (buffer.length === 1) {
      out.push({ type: 'image', src: buffer[0] })
    } else {
      out.push({ type: 'imageGroup', srcs: buffer })
    }
    buffer = []
  }

  for (const seg of segments) {
    if (seg.type === 'image') {
      buffer.push(seg.src)
    } else {
      flush()
      out.push(seg)
    }
  }
  flush()

  return out
}
