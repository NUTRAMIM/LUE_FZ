export type Segment =
  | { type: 'text'; value: string }
  | { type: 'image'; src: string }
  | { type: 'video'; src: string }

export type MediaItem =
  | { type: 'image'; src: string }
  | { type: 'video'; src: string }

export type RenderItem =
  | { type: 'text'; value: string }
  | { type: 'image'; src: string }
  | { type: 'video'; src: string }
  | { type: 'mediaGroup'; items: MediaItem[] }

const MEDIA_URL_RE =
  /https?:\/\/\S+?\.(?:jpe?g|png|webp|gif|mp4|webm|mov)(?:\?\S*)?/gi
const VIDEO_EXT_RE = /\.(?:mp4|webm|mov)(?:\?\S*)?$/i

function mediaSegment(url: string): Segment {
  return VIDEO_EXT_RE.test(url)
    ? { type: 'video', src: url }
    : { type: 'image', src: url }
}

export function parseSegments(
  text: string,
): { segments: Segment[]; hasMedia: boolean } {
  const segments: Segment[] = []
  const re = new RegExp(MEDIA_URL_RE.source, MEDIA_URL_RE.flags)
  let lastIndex = 0
  let match: RegExpExecArray | null
  let hasMedia = false
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const chunk = text.slice(lastIndex, match.index)
      if (chunk.trim()) segments.push({ type: 'text', value: chunk.trim() })
    }
    segments.push(mediaSegment(match[0]))
    hasMedia = true
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    const tail = text.slice(lastIndex)
    if (tail.trim()) segments.push({ type: 'text', value: tail.trim() })
  }
  if (segments.length === 0 && text) segments.push({ type: 'text', value: text })
  return { segments, hasMedia }
}

export function groupConsecutiveMedia(segments: Segment[]): RenderItem[] {
  const out: RenderItem[] = []
  let buffer: MediaItem[] = []

  const flush = () => {
    if (buffer.length === 0) return
    if (buffer.length === 1) {
      out.push(buffer[0])
    } else {
      out.push({ type: 'mediaGroup', items: buffer })
    }
    buffer = []
  }

  for (const seg of segments) {
    if (seg.type === 'image' || seg.type === 'video') {
      buffer.push(seg)
    } else {
      flush()
      out.push(seg)
    }
  }
  flush()

  return out
}
