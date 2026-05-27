# Chat: carrossel arrastável para múltiplas imagens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando o agente n8n responde com 2+ URLs de imagem consecutivas no mesmo content da mensagem, renderizá-las no chat público como carrossel arrastável horizontalmente (bullets estilo Instagram, setas no hover desktop, lightbox ao tocar).

**Architecture:** Toda a mudança fica em `src/app/chat/[slug]/components/`. Adicionamos um helper puro de agrupamento (`message-segments.ts`), dois componentes novos (`ImageCarousel.tsx`, `ImageLightbox.tsx`), e refatoramos `MessageBubble.tsx` pra consumi-los. Sem mudança no schema do banco, no server action ou no workflow do n8n.

**Tech Stack:** Next.js 16 (App Router) + React 19 + Tailwind 4 + `embla-carousel-react@^8` (nova dep). Testes: vitest + testing-library (já no projeto, mas usados só pra testes puros até agora).

**Spec:** `docs/superpowers/specs/2026-05-27-chat-carrossel-imagens-design.md`

---

## File Structure

| Arquivo | Status | Responsabilidade |
|---|---|---|
| `src/app/chat/[slug]/components/message-segments.ts` | **CRIAR** | Lógica pura de parsing/agrupamento de segments (extraída do `MessageBubble.tsx`) |
| `src/app/chat/[slug]/components/__tests__/message-segments.test.ts` | **CRIAR** | Testes puros do parser + agrupador |
| `src/app/chat/[slug]/components/ImageCarousel.tsx` | **CRIAR** | Carrossel Embla + bullets + setas hover. Recebe `srcs[]` e dispara `onImageClick(index)` |
| `src/app/chat/[slug]/components/ImageLightbox.tsx` | **CRIAR** | Overlay fullscreen via `createPortal`. ESC/click fora/X fecham. Embla interno se múltiplas |
| `src/app/chat/[slug]/components/MessageBubble.tsx` | **MODIFICAR** | Consome helper + componentes novos. Ganha state pro lightbox |
| `package.json` | **MODIFICAR** | Adiciona `embla-carousel-react@^8` |

**Nota sobre testes:** o projeto hoje tem vitest configurado com `environment: 'node'` (vitest.config.ts:8) e zero testes de componente. Cobrimos com TDD apenas o helper puro (Task 2) — onde a lógica de agrupamento mora — e validamos os componentes com type-check + smoke test manual no dev server (Task 7). Adicionar suite de testes de componente exigiria mudar o ambiente do vitest pra jsdom, mockar Embla e configurar setup global; é trabalho fora do escopo desta feature.

---

## Task 1: Instalar dependência

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (npm gera)

- [ ] **Step 1: Instalar embla-carousel-react**

Run: `npm install embla-carousel-react@^8`

Expected: linha adicionada em `dependencies` do `package.json` com versão `^8.x.x`. `package-lock.json` atualizado.

- [ ] **Step 2: Validar que o build passa**

Run: `npx tsc --noEmit`

Expected: exit 0, sem novos erros.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add embla-carousel-react"
```

---

## Task 2: Helper de parsing/agrupamento de segments (TDD)

Move `parseSegments` (hoje em `MessageBubble.tsx:8-34`) pra arquivo dedicado e adiciona `groupConsecutiveImages`. Mantém comportamento atual + nova função.

**Files:**
- Create: `src/app/chat/[slug]/components/message-segments.ts`
- Create: `src/app/chat/[slug]/components/__tests__/message-segments.test.ts`

- [ ] **Step 1: Escrever os testes (vão falhar — arquivo ainda não existe)**

```ts
// src/app/chat/[slug]/components/__tests__/message-segments.test.ts
import { describe, it, expect } from 'vitest'
import { parseSegments, groupConsecutiveImages } from '../message-segments'

describe('parseSegments', () => {
  it('retorna texto único quando não há URL de imagem', () => {
    const { segments, hasImage } = parseSegments('olá tudo bem?')
    expect(hasImage).toBe(false)
    expect(segments).toEqual([{ type: 'text', value: 'olá tudo bem?' }])
  })

  it('detecta URL de imagem isolada', () => {
    const { segments, hasImage } = parseSegments('https://x.com/a.jpg')
    expect(hasImage).toBe(true)
    expect(segments).toEqual([{ type: 'image', src: 'https://x.com/a.jpg' }])
  })

  it('intercala texto e múltiplas imagens preservando ordem', () => {
    const text = 'veja: https://x.com/a.jpg e https://x.com/b.png aqui'
    const { segments } = parseSegments(text)
    expect(segments).toEqual([
      { type: 'text', value: 'veja:' },
      { type: 'image', src: 'https://x.com/a.jpg' },
      { type: 'text', value: 'e' },
      { type: 'image', src: 'https://x.com/b.png' },
      { type: 'text', value: 'aqui' },
    ])
  })

  it('reconhece jpg, jpeg, png, webp, gif com querystring', () => {
    const { segments } = parseSegments(
      'a https://x.com/1.jpg b https://x.com/2.jpeg?w=100 c https://x.com/3.PNG d https://x.com/4.webp e https://x.com/5.gif',
    )
    const images = segments.filter((s) => s.type === 'image')
    expect(images).toHaveLength(5)
  })
})

describe('groupConsecutiveImages', () => {
  it('mantém array vazio', () => {
    expect(groupConsecutiveImages([])).toEqual([])
  })

  it('preserva texto isolado', () => {
    expect(groupConsecutiveImages([{ type: 'text', value: 'oi' }])).toEqual([
      { type: 'text', value: 'oi' },
    ])
  })

  it('mantém uma imagem solitária como image', () => {
    expect(
      groupConsecutiveImages([{ type: 'image', src: 'a.jpg' }]),
    ).toEqual([{ type: 'image', src: 'a.jpg' }])
  })

  it('agrupa 2+ imagens consecutivas em imageGroup', () => {
    expect(
      groupConsecutiveImages([
        { type: 'image', src: 'a.jpg' },
        { type: 'image', src: 'b.jpg' },
        { type: 'image', src: 'c.jpg' },
      ]),
    ).toEqual([{ type: 'imageGroup', srcs: ['a.jpg', 'b.jpg', 'c.jpg'] }])
  })

  it('mantém imagens separadas por texto como isoladas', () => {
    expect(
      groupConsecutiveImages([
        { type: 'image', src: 'a.jpg' },
        { type: 'text', value: 'meio' },
        { type: 'image', src: 'b.jpg' },
      ]),
    ).toEqual([
      { type: 'image', src: 'a.jpg' },
      { type: 'text', value: 'meio' },
      { type: 'image', src: 'b.jpg' },
    ])
  })

  it('agrupa só onde há ≥2 consecutivas, mantendo isoladas como isoladas', () => {
    expect(
      groupConsecutiveImages([
        { type: 'text', value: 'a' },
        { type: 'image', src: '1.jpg' },
        { type: 'image', src: '2.jpg' },
        { type: 'text', value: 'b' },
        { type: 'image', src: '3.jpg' },
      ]),
    ).toEqual([
      { type: 'text', value: 'a' },
      { type: 'imageGroup', srcs: ['1.jpg', '2.jpg'] },
      { type: 'text', value: 'b' },
      { type: 'image', src: '3.jpg' },
    ])
  })
})
```

- [ ] **Step 2: Rodar testes para confirmar que falham**

Run: `npx vitest run src/app/chat/[slug]/components/__tests__/message-segments.test.ts`

Expected: FAIL com `Cannot find module '../message-segments'`.

- [ ] **Step 3: Criar `message-segments.ts` com a implementação**

```ts
// src/app/chat/[slug]/components/message-segments.ts

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
```

- [ ] **Step 4: Rodar testes para confirmar que passam**

Run: `npx vitest run src/app/chat/[slug]/components/__tests__/message-segments.test.ts`

Expected: PASS — todos os testes verdes.

- [ ] **Step 5: Commit**

```bash
git add src/app/chat/[slug]/components/message-segments.ts src/app/chat/[slug]/components/__tests__/message-segments.test.ts
git commit -m "feat(chat): extract segments parser + add image grouping helper"
```

---

## Task 3: Componente ImageCarousel

Carrossel arrastável com Embla. Sem testes formais (ver "Nota sobre testes"); validação no smoke test final.

**Files:**
- Create: `src/app/chat/[slug]/components/ImageCarousel.tsx`

- [ ] **Step 1: Criar `ImageCarousel.tsx`**

```tsx
// src/app/chat/[slug]/components/ImageCarousel.tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import useEmblaCarousel from 'embla-carousel-react'

interface ImageCarouselProps {
  srcs: string[]
  onImageClick: (index: number) => void
}

export function ImageCarousel({ srcs, onImageClick }: ImageCarouselProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: 'start',
    containScroll: 'trimSnaps',
  })
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [scrollSnaps, setScrollSnaps] = useState<number[]>([])

  const onSelect = useCallback(() => {
    if (!emblaApi) return
    setSelectedIndex(emblaApi.selectedScrollSnap())
  }, [emblaApi])

  useEffect(() => {
    if (!emblaApi) return
    setScrollSnaps(emblaApi.scrollSnapList())
    emblaApi.on('select', onSelect)
    emblaApi.on('reInit', onSelect)
    onSelect()
    return () => {
      emblaApi.off('select', onSelect)
      emblaApi.off('reInit', onSelect)
    }
  }, [emblaApi, onSelect])

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi])
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi])
  const scrollTo = useCallback(
    (i: number) => emblaApi?.scrollTo(i),
    [emblaApi],
  )

  return (
    <div className="group relative my-1">
      <div className="overflow-hidden rounded" ref={emblaRef}>
        <div className="flex">
          {srcs.map((src, i) => (
            <div key={`${i}-${src}`} className="min-w-0 flex-[0_0_100%]">
              <button
                type="button"
                onClick={() => onImageClick(i)}
                className="block w-full"
              >
                <img
                  src={src}
                  alt=""
                  loading="lazy"
                  className="max-h-80 w-full object-cover"
                />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Setas desktop — só aparecem no hover */}
      <button
        type="button"
        onClick={scrollPrev}
        aria-label="Imagem anterior"
        className="absolute left-1 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/40 p-1 text-white opacity-0 transition group-hover:opacity-100 md:block"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      <button
        type="button"
        onClick={scrollNext}
        aria-label="Próxima imagem"
        className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/40 p-1 text-white opacity-0 transition group-hover:opacity-100 md:block"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
      </button>

      {/* Bullets */}
      {scrollSnaps.length > 1 && (
        <div className="mt-1.5 flex justify-center gap-1">
          {scrollSnaps.map((_, i) => (
            <button
              type="button"
              key={i}
              onClick={() => scrollTo(i)}
              aria-label={`Ir para imagem ${i + 1}`}
              className={`h-1.5 w-1.5 rounded-full transition ${
                i === selectedIndex ? 'bg-gray-700' : 'bg-gray-300'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Validar com type-check**

Run: `npx tsc --noEmit`

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/chat/[slug]/components/ImageCarousel.tsx
git commit -m "feat(chat): add ImageCarousel component with Embla"
```

---

## Task 4: Componente ImageLightbox

Overlay fullscreen via portal. Suporta navegação (ESC / setas teclado / clique fora) e Embla interno quando múltiplas imagens.

**Files:**
- Create: `src/app/chat/[slug]/components/ImageLightbox.tsx`

- [ ] **Step 1: Criar `ImageLightbox.tsx`**

```tsx
// src/app/chat/[slug]/components/ImageLightbox.tsx
'use client'

import { useEffect, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import useEmblaCarousel from 'embla-carousel-react'

interface ImageLightboxProps {
  srcs: string[]
  startIndex: number
  onClose: () => void
}

export function ImageLightbox({ srcs, startIndex, onClose }: ImageLightboxProps) {
  const multiple = srcs.length > 1
  const [emblaRef, emblaApi] = useEmblaCarousel({
    startIndex,
    align: 'center',
    containScroll: 'trimSnaps',
  })
  const [selectedIndex, setSelectedIndex] = useState(startIndex)

  // Trava o scroll do body enquanto montado
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Listeners de teclado
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (multiple && e.key === 'ArrowLeft') emblaApi?.scrollPrev()
      if (multiple && e.key === 'ArrowRight') emblaApi?.scrollNext()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [emblaApi, multiple, onClose])

  // Atualiza bullets do lightbox
  const onSelect = useCallback(() => {
    if (!emblaApi) return
    setSelectedIndex(emblaApi.selectedScrollSnap())
  }, [emblaApi])

  useEffect(() => {
    if (!emblaApi) return
    emblaApi.on('select', onSelect)
    emblaApi.on('reInit', onSelect)
    onSelect()
    return () => {
      emblaApi.off('select', onSelect)
      emblaApi.off('reInit', onSelect)
    }
  }, [emblaApi, onSelect])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        className="absolute right-3 top-3 z-10 rounded-full bg-black/50 p-2 text-white"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>

      {multiple ? (
        <div
          className="h-full w-full overflow-hidden"
          ref={emblaRef}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex h-full">
            {srcs.map((src, i) => (
              <div
                key={`${i}-${src}`}
                className="flex h-full min-w-0 flex-[0_0_100%] items-center justify-center"
              >
                <img
                  src={src}
                  alt=""
                  className="max-h-[90vh] max-w-[95vw] object-contain"
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <img
          src={srcs[0]}
          alt=""
          className="max-h-[90vh] max-w-[95vw] object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      )}

      {multiple && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          {srcs.map((_, i) => (
            <button
              type="button"
              key={i}
              onClick={() => emblaApi?.scrollTo(i)}
              aria-label={`Ir para imagem ${i + 1}`}
              className={`h-2 w-2 rounded-full transition ${
                i === selectedIndex ? 'bg-white' : 'bg-white/40'
              }`}
            />
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}
```

- [ ] **Step 2: Validar com type-check**

Run: `npx tsc --noEmit`

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/chat/[slug]/components/ImageLightbox.tsx
git commit -m "feat(chat): add ImageLightbox with portal + keyboard nav"
```

---

## Task 5: Integrar no MessageBubble

Refatora `MessageBubble.tsx` pra usar o helper e os componentes novos. Imagem isolada também passa pelo lightbox (mudança de comportamento documentada no spec).

**Files:**
- Modify: `src/app/chat/[slug]/components/MessageBubble.tsx`

- [ ] **Step 1: Substituir o conteúdo de `MessageBubble.tsx`**

```tsx
// src/app/chat/[slug]/components/MessageBubble.tsx
'use client'

import { useState } from 'react'
import type { ChatMessage } from '../ChatClient'
import { parseSegments, groupConsecutiveImages } from './message-segments'
import { ImageCarousel } from './ImageCarousel'
import { ImageLightbox } from './ImageLightbox'

function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  const [lightbox, setLightbox] = useState<{ srcs: string[]; index: number } | null>(null)

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
  const isTypedImage = message.message_type === 'image'

  const { segments, hasImage } =
    content && !isTypedImage
      ? parseSegments(content)
      : { segments: content ? [{ type: 'text' as const, value: content }] : [], hasImage: false }

  const renderItems = groupConsecutiveImages(segments)
  const bubbleMaxWidth = hasImage ? 'max-w-[88%] sm:max-w-sm' : 'max-w-[75%]'

  return (
    <div className={`mb-0.5 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`${bubbleMaxWidth} rounded-lg px-3 py-2 shadow-sm ${
          isUser ? 'bg-[#DCF8C6]' : 'bg-white'
        }`}
      >
        {/* Mídia legítima (mensagem do tipo image/audio com media_url) — comportamento atual preservado */}
        {isTypedImage && message.media_url && (
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

        {/* Texto + imagens detectadas no content */}
        {renderItems.map((item, i) => {
          if (item.type === 'text') {
            return (
              <p
                key={`t-${i}`}
                className="whitespace-pre-wrap break-words text-sm text-gray-900"
              >
                {item.value}
              </p>
            )
          }
          if (item.type === 'image') {
            return (
              <button
                type="button"
                key={`i-${i}-${item.src}`}
                onClick={() => setLightbox({ srcs: [item.src], index: 0 })}
                className="my-1 block w-full"
              >
                <img
                  src={item.src}
                  alt=""
                  className="max-h-80 w-full rounded object-cover"
                  loading="lazy"
                />
              </button>
            )
          }
          // imageGroup
          return (
            <ImageCarousel
              key={`g-${i}`}
              srcs={item.srcs}
              onImageClick={(index) => setLightbox({ srcs: item.srcs, index })}
            />
          )
        })}

        <p className="mt-1 text-right text-[10px] text-gray-500">
          {formatTime(message.created_at)}
        </p>
      </div>

      {lightbox && (
        <ImageLightbox
          srcs={lightbox.srcs}
          startIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Validar com type-check**

Run: `npx tsc --noEmit`

Expected: exit 0.

- [ ] **Step 3: Rodar suite de testes pra garantir que o helper continua passando e nada quebrou**

Run: `npm test`

Expected: todos os testes verdes (incluindo os do `message-segments`).

- [ ] **Step 4: Commit**

```bash
git add src/app/chat/[slug]/components/MessageBubble.tsx
git commit -m "feat(chat): render image carousel + lightbox in message bubbles"
```

---

## Task 6: Smoke test no dev server

Validação manual end-to-end. Sem código, mas obrigatório antes de declarar pronto (regra do projeto: "If you can't test the UI, say so explicitly rather than claiming success").

**Files:** nenhum.

- [ ] **Step 1: Subir o dev server**

Run: `npm run dev` (background OK)

Expected: server escutando em `http://localhost:3000`.

- [ ] **Step 2: Abrir uma conversa com mensagem do agente que contenha 3+ URLs de imagem consecutivas**

Opções pra forçar:
- Mandar pergunta de produto no chat público (`/chat/<slug>`) e esperar agente responder com imagens; OU
- Inserir manualmente uma row de teste via Supabase SQL Editor:
  ```sql
  insert into messages (conversation_id, role, content, message_type)
  values (
    '<conversation_id>',
    'assistant',
    'olha esses modelos pra voce: https://placedog.net/600/400?id=1 https://placedog.net/600/400?id=2 https://placedog.net/600/400?id=3',
    'text'
  );
  ```

Verificar:
- [ ] Carrossel aparece com 3 slides na bolha do agente
- [ ] Bullets visíveis embaixo, ativo no slide 1
- [ ] Arrastar com mouse (desktop) ou swipe (mobile/devtools mobile mode) muda o slide
- [ ] Setas `‹ ›` aparecem ao passar mouse no carrossel (desktop)
- [ ] Clicar na imagem abre lightbox no slide certo
- [ ] No lightbox: ESC fecha, clique no fundo escuro fecha, X fecha, setas ←/→ navegam, swipe navega

- [ ] **Step 3: Testar imagem isolada**

Inserir mensagem com 1 imagem só:
```sql
insert into messages (conversation_id, role, content, message_type)
values ('<conv>', 'assistant', 'esse aqui: https://placedog.net/600/400?id=42', 'text');
```

Verificar:
- [ ] Renderiza como `<img>` único (sem bullets, sem carrossel)
- [ ] Clicar abre lightbox de 1 slide (sem bullets, sem setas)

- [ ] **Step 4: Testar regressão de mídia legítima**

Mandar uma foto pelo input do chat (cliente envia imagem). Verificar:
- [ ] Continua renderizando com `<a target="_blank">` (abre em nova aba), comportamento intencionalmente preservado pra `message_type='image'`.

- [ ] **Step 5: Limpar dados de teste**

```sql
delete from messages where content like '%placedog.net%';
```

- [ ] **Step 6: Commit (se houver pequenos ajustes de CSS feitos durante o smoke)**

Se nada mudou, pular. Senão:
```bash
git add -A
git commit -m "fix(chat): smoke-test adjustments"
```

---

## Self-Review

**Cobertura do spec:**
- ✅ Múltiplas imagens consecutivas → carrossel → Task 5 (consome `imageGroup` de Task 2)
- ✅ Imagens isoladas continuam como `<img>` → Task 5 (consome `image` de Task 2)
- ✅ Bullets estilo Instagram → Task 3
- ✅ Setas no hover desktop → Task 3 (`group-hover:opacity-100`)
- ✅ Drag mobile/desktop nativo do Embla → Task 3 (default do `useEmblaCarousel`)
- ✅ Lightbox ao tocar → Task 4 + Task 5 (state `lightbox`)
- ✅ Lightbox: ESC, click fora, X, setas teclado, swipe → Task 4
- ✅ `message_type='image'` preserva comportamento atual → Task 5 (condicional `isTypedImage`)
- ✅ Embla via `embla-carousel-react@^8` → Task 1
- ✅ Helper puro testado → Task 2 (TDD completo)
- ✅ Componentes validados via type-check + smoke → Task 3, 4, 5, 6

**Lacuna conhecida vs spec:** o spec sugeriu uma suite de testes de componente em `MessageBubble.test.tsx`. Pulamos formalmente (justificativa nos arquivos: vitest do projeto está em `environment: 'node'` e não há precedente de testes de componente). Smoke test cobre a validação. Se quiser a suite formal depois, é trabalho derivado.

**Consistência de tipos:** `Segment` e `RenderItem` definidos em Task 2 batem com o uso em Task 5. `ImageCarouselProps` em Task 3 bate com o uso em Task 5. `ImageLightboxProps` em Task 4 bate com o uso em Task 5. ✅

**Sem placeholders:** zero TBD/TODO. Todos os steps têm código ou comando explícito.
