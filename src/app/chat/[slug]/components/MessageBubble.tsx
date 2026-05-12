import type { ChatMessage } from '../ChatClient'

function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const IMAGE_URL_RE =
  /https?:\/\/\S+?\.(?:jpe?g|png|webp|gif)(?:\?\S*)?/gi

type Segment = { type: 'text'; value: string } | { type: 'image'; src: string }

function parseSegments(text: string): { segments: Segment[]; hasImage: boolean } {
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

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  if (isSystem) {
    return (
      <div className="my-2 flex justify-center">
        <span className="rounded-md bg-yellow-50 px-3 py-1 text-xs text-yellow-800 shadow-sm">
          {message.content}
        </span>
      </div>
    )
  }

  const content = message.content ?? ''
  const { segments, hasImage } =
    content && message.message_type !== 'image'
      ? parseSegments(content)
      : { segments: content ? [{ type: 'text' as const, value: content }] : [], hasImage: false }

  const bubbleMaxWidth = hasImage ? 'max-w-[88%] sm:max-w-sm' : 'max-w-[75%]'

  return (
    <div className={`my-1 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`${bubbleMaxWidth} rounded-lg px-3 py-2 shadow-sm ${
          isUser ? 'bg-[#DCF8C6]' : 'bg-white'
        }`}
      >
        {message.message_type === 'image' && message.media_url && (
          <a
            href={message.media_url}
            target="_blank"
            rel="noreferrer"
            className="mb-1 block"
          >
            <img
              src={message.media_url}
              alt=""
              className="max-h-80 w-full rounded object-cover"
              loading="lazy"
            />
          </a>
        )}
        {message.message_type === 'audio' && message.media_url && (
          <audio controls src={message.media_url} className="max-w-full" />
        )}
        {segments.map((seg, i) =>
          seg.type === 'text' ? (
            <p
              key={`t-${i}`}
              className="whitespace-pre-wrap break-words text-sm text-gray-900"
            >
              {seg.value}
            </p>
          ) : (
            <a
              key={`i-${i}-${seg.src}`}
              href={seg.src}
              target="_blank"
              rel="noreferrer"
              className="my-1 block"
            >
              <img
                src={seg.src}
                alt=""
                className="max-h-80 w-full rounded object-cover"
                loading="lazy"
              />
            </a>
          ),
        )}
        <p className="mt-1 text-right text-[10px] text-gray-500">
          {formatTime(message.created_at)}
        </p>
      </div>
    </div>
  )
}
