# Reply-to-Message (estilo WhatsApp) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir responder a uma mensagem específica do chat (swipe no mobile, botão no desktop), com citação persistente na bolha, barra de composição acima do input, navegação até a original e envio do contexto de resposta ao webhook do n8n.

**Architecture:** Coluna `reply_to_message_id` (FK auto-referente) em `messages`. A citação é resolvida no cliente a partir das mensagens em memória, com ids normalizados (removendo o sufixo `-seg-N` dos segmentos da IA ao vivo). O server action busca a mensagem citada e envia `respondendo_a` (conteúdo inteiro) ao n8n. Helpers puros isolam a lógica testável; um hook isola o gesto de swipe.

**Tech Stack:** Next.js (App Router, server actions), React 19, TypeScript, Supabase (Postgres + Realtime), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-01-chat-reply-message-design.md`

---

## File Structure

- `src/app/chat/[slug]/components/reply-helpers.ts` (novo) — funções puras: `normalizeMessageId`, `replyAuthorForRole`, `replyPreviewText`, `truncate`, `shouldTriggerReply`, `SWIPE_TRIGGER_PX`.
- `src/app/chat/[slug]/components/__tests__/reply-helpers.test.ts` (novo) — testes das funções puras.
- `supabase/migrations/035_messages_reply_to.sql` (novo) — coluna FK.
- `src/types/database.ts` (modificar) — tipos da tabela `messages`.
- `src/lib/n8n.ts` (modificar) — campo `respondendo_a` no payload.
- `src/actions/chat.ts` (modificar) — `ChatBootstrap`, `ensureConversation`, `SendMessageInput`, `sendMessage`.
- `src/app/chat/[slug]/ChatClient.tsx` (modificar) — tipo `ChatMessage`, carregar `reply_to_message_id`, estado `replyTo`, handlers, props.
- `src/app/chat/[slug]/components/useSwipeToReply.ts` (novo) — hook do gesto.
- `src/app/chat/[slug]/components/MessageBubble.tsx` (modificar) — citação, botão desktop, swipe.
- `src/app/chat/[slug]/components/MessageList.tsx` (modificar) — resolver de citação, scroll + highlight, props.
- `src/app/chat/[slug]/components/ChatInput.tsx` (modificar) — barra de resposta.
- `src/app/globals.css` (modificar) — animação de highlight.

---

## Task 1: Helpers puros de reply

**Files:**
- Create: `src/app/chat/[slug]/components/reply-helpers.ts`
- Test: `src/app/chat/[slug]/components/__tests__/reply-helpers.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/app/chat/[slug]/components/__tests__/reply-helpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  normalizeMessageId,
  replyAuthorForRole,
  replyPreviewText,
  truncate,
  shouldTriggerReply,
  SWIPE_TRIGGER_PX,
} from '../reply-helpers'

describe('normalizeMessageId', () => {
  it('remove o sufixo -seg-N de segmentos da IA', () => {
    expect(normalizeMessageId('abc-123-seg-0')).toBe('abc-123')
    expect(normalizeMessageId('abc-123-seg-12')).toBe('abc-123')
  })
  it('mantém id real intocado', () => {
    expect(normalizeMessageId('abc-123')).toBe('abc-123')
    expect(normalizeMessageId('temp-1700000000000')).toBe('temp-1700000000000')
  })
})

describe('replyAuthorForRole', () => {
  it('mapeia user para cliente', () => {
    expect(replyAuthorForRole('user')).toBe('cliente')
  })
  it('mapeia assistant e operator para loja', () => {
    expect(replyAuthorForRole('assistant')).toBe('loja')
    expect(replyAuthorForRole('operator')).toBe('loja')
  })
})

describe('replyPreviewText', () => {
  it('rotula imagem e áudio', () => {
    expect(replyPreviewText({ message_type: 'image', content: '' })).toBe('📷 Imagem')
    expect(replyPreviewText({ message_type: 'audio', content: '' })).toBe('🎤 Áudio')
  })
  it('usa o content em mensagens de texto', () => {
    expect(replyPreviewText({ message_type: 'text', content: 'olá' })).toBe('olá')
  })
})

describe('truncate', () => {
  it('mantém texto curto', () => {
    expect(truncate('curto', 80)).toBe('curto')
  })
  it('corta com reticências em texto longo', () => {
    const long = 'a'.repeat(100)
    const out = truncate(long, 80)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBe(81)
  })
})

describe('shouldTriggerReply', () => {
  it('dispara no limiar e acima', () => {
    expect(shouldTriggerReply(SWIPE_TRIGGER_PX)).toBe(true)
    expect(shouldTriggerReply(SWIPE_TRIGGER_PX + 10)).toBe(true)
  })
  it('não dispara abaixo do limiar', () => {
    expect(shouldTriggerReply(SWIPE_TRIGGER_PX - 1)).toBe(false)
    expect(shouldTriggerReply(0)).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- reply-helpers`
Expected: FAIL — "Failed to resolve import '../reply-helpers'".

- [ ] **Step 3: Implementar os helpers**

Criar `src/app/chat/[slug]/components/reply-helpers.ts`:

```ts
type Role = 'user' | 'assistant' | 'operator' | 'system'

export const SWIPE_TRIGGER_PX = 60

export function normalizeMessageId(id: string): string {
  return id.replace(/-seg-\d+$/, '')
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
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- reply-helpers`
Expected: PASS (todos os testes verdes).

- [ ] **Step 5: Commit**

```bash
git add "src/app/chat/[slug]/components/reply-helpers.ts" "src/app/chat/[slug]/components/__tests__/reply-helpers.test.ts"
git commit -m "feat(chat): pure helpers for reply-to-message"
```

---

## Task 2: Migration + tipos do banco

**Files:**
- Create: `supabase/migrations/035_messages_reply_to.sql`
- Modify: `src/types/database.ts:125-162`

- [ ] **Step 1: Criar a migration**

Criar `supabase/migrations/035_messages_reply_to.sql`:

```sql
-- 035_messages_reply_to.sql
-- Adds messages.reply_to_message_id so a message can quote/reply to an earlier
-- message in the same conversation (WhatsApp-style reply). ON DELETE SET NULL so
-- removing the quoted message does not break the reply.

ALTER TABLE messages
  ADD COLUMN reply_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;
```

- [ ] **Step 2: Atualizar os tipos gerados**

Em `src/types/database.ts`, na tabela `messages`, adicionar `reply_to_message_id` em `Row`, `Insert` e `Update`.

No bloco `Row` (após `latency_ms: number | null`):
```ts
          latency_ms: number | null
          reply_to_message_id: string | null
```

No bloco `Insert` (após `latency_ms?: number | null`):
```ts
          latency_ms?: number | null
          reply_to_message_id?: string | null
```

No bloco `Update` (após `latency_ms?: number | null`):
```ts
          latency_ms?: number | null
          reply_to_message_id?: string | null
```

- [ ] **Step 3: Aplicar a migration no Supabase**

Se houver Supabase local: `npx supabase migration up`. Caso o projeto use banco remoto, aplicar o SQL no painel do Supabase (SQL Editor) colando o conteúdo da migration. Confirmar que a coluna existe:
Run (psql/SQL editor): `select column_name from information_schema.columns where table_name='messages' and column_name='reply_to_message_id';`
Expected: 1 linha retornada.

- [ ] **Step 4: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem novos erros relacionados a `messages`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/035_messages_reply_to.sql src/types/database.ts
git commit -m "feat(chat): add reply_to_message_id column and types"
```

---

## Task 3: Payload do webhook (`respondendo_a`)

**Files:**
- Modify: `src/lib/n8n.ts:5-13`

- [ ] **Step 1: Adicionar o campo opcional ao tipo do payload**

Em `src/lib/n8n.ts`, substituir a interface `N8nDispatchPayload` por:

```ts
export interface N8nDispatchPayload {
  mensagem: string
  id_mensagem: string
  id_conversa: string
  nome_loja: string
  id_loja: string
  tipo_de_mensagem: 'text' | 'image' | 'audio'
  media_url?: string
  respondendo_a?: {
    id_mensagem: string
    autor: 'cliente' | 'loja'
    conteudo: string
  }
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem novos erros.

- [ ] **Step 3: Commit**

```bash
git add src/lib/n8n.ts
git commit -m "feat(chat): add respondendo_a to n8n webhook payload"
```

---

## Task 4: Server action — carregar e gravar reply, montar `respondendo_a`

**Files:**
- Modify: `src/actions/chat.ts` (`ChatBootstrap` ~22-30, `ensureConversation` ~97-113, `SendMessageInput` ~124-129, `sendMessage` ~137-234)

- [ ] **Step 1: Adicionar `reply_to_message_id` ao tipo `ChatBootstrap`**

Em `src/actions/chat.ts`, no array `messages` de `ChatBootstrap`, adicionar o campo após `created_at: string`:

```ts
  messages: Array<{
    id: string
    role: 'user' | 'assistant' | 'operator' | 'system'
    content: string
    message_type: 'text' | 'image' | 'audio'
    media_url: string | null
    created_at: string
    reply_to_message_id: string | null
  }>
```

- [ ] **Step 2: Carregar a coluna em `ensureConversation`**

No `select` das mensagens, adicionar `reply_to_message_id`:

```ts
  const { data: rows } = await admin
    .from('messages')
    .select('id, role, content, message_type, media_path, created_at, reply_to_message_id')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: true })
    .limit(200)
```

E no `map` que monta `messages`, adicionar o campo:

```ts
  const messages = await Promise.all(
    (rows ?? []).map(async (m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      message_type: m.message_type,
      media_url: await signedReadUrl(m.media_path),
      created_at: m.created_at,
      reply_to_message_id: m.reply_to_message_id,
    })),
  )
```

- [ ] **Step 3: Adicionar `replyToMessageId` ao input do envio**

Substituir `SendMessageInput`:

```ts
export interface SendMessageInput {
  slug: string
  text: string
  mediaPath?: string
  messageType: 'text' | 'image' | 'audio'
  replyToMessageId?: string
}
```

- [ ] **Step 4: Gravar a FK e montar `respondendo_a`**

Em `sendMessage`, no `insert` da mensagem do usuário, adicionar o campo:

```ts
  const { data: inserted, error: insertErr } = await admin
    .from('messages')
    .insert({
      conversation_id: conv.id,
      role: 'user',
      content: text,
      message_type: input.messageType,
      media_path: input.mediaPath ?? null,
      reply_to_message_id: input.replyToMessageId ?? null,
    })
    .select('id')
    .single()
```

Logo antes do bloco `try { const res = await dispatchToN8n({...`, buscar a mensagem citada:

```ts
  let respondendoA:
    | { id_mensagem: string; autor: 'cliente' | 'loja'; conteudo: string }
    | undefined
  if (input.replyToMessageId) {
    const { data: quoted } = await admin
      .from('messages')
      .select('id, role, content')
      .eq('id', input.replyToMessageId)
      .maybeSingle()
    if (quoted) {
      respondendoA = {
        id_mensagem: quoted.id,
        autor: quoted.role === 'user' ? 'cliente' : 'loja',
        conteudo: quoted.content,
      }
    }
  }
```

E na chamada `dispatchToN8n`, espalhar o objeto (após o spread de `media_url`):

```ts
    const res = await dispatchToN8n({
      mensagem: text,
      id_mensagem: inserted.id,
      id_conversa: conv.id,
      nome_loja: store.store_name,
      id_loja: store.id,
      tipo_de_mensagem: input.messageType,
      ...(mediaUrl ? { media_url: mediaUrl } : {}),
      ...(respondendoA ? { respondendo_a: respondendoA } : {}),
    })
```

- [ ] **Step 5: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem novos erros.

- [ ] **Step 6: Commit**

```bash
git add src/actions/chat.ts
git commit -m "feat(chat): persist reply FK and send respondendo_a to n8n"
```

---

## Task 5: `ChatMessage` + carregar `reply_to_message_id` no cliente

**Files:**
- Modify: `src/app/chat/[slug]/ChatClient.tsx` (interface `ChatMessage` ~20-27, realtime handler ~221-282)

- [ ] **Step 1: Adicionar o campo ao tipo `ChatMessage`**

Em `src/app/chat/[slug]/ChatClient.tsx`, na interface `ChatMessage`, adicionar após `created_at: string`:

```ts
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'operator' | 'system'
  content: string
  message_type: 'text' | 'image' | 'audio'
  media_url: string | null
  created_at: string
  reply_to_message_id: string | null
}
```

- [ ] **Step 2: Ler o campo no handler do realtime**

No handler de `postgres_changes`, o tipo de `row` ganha o campo e o `msg` montado também. Atualizar o cast de `payload.new` para incluir `reply_to_message_id: string | null` e adicionar o campo ao objeto `msg`:

No objeto `row` (cast):
```ts
          const row = payload.new as {
            id: string
            conversation_id: string
            role: ChatMessage['role']
            content: string
            message_type: ChatMessage['message_type']
            media_path: string | null
            created_at: string
            reply_to_message_id: string | null
          }
```

No objeto `msg`:
```ts
          const msg: ChatMessage = {
            id: row.id,
            role: row.role,
            content: row.content,
            message_type: row.message_type,
            media_url,
            created_at: row.created_at,
            reply_to_message_id: row.reply_to_message_id,
          }
```

- [ ] **Step 3: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: erros esperados em outros pontos que ainda criam `ChatMessage` sem o campo (ex.: `ChatInput.tsx` no `onLocalAdd`). Serão corrigidos nas tasks seguintes. Confirmar que NÃO há erro dentro de `ChatClient.tsx`.

- [ ] **Step 4: Commit**

```bash
git add "src/app/chat/[slug]/ChatClient.tsx"
git commit -m "feat(chat): carry reply_to_message_id through ChatMessage and realtime"
```

---

## Task 6: Estado `replyTo` e handlers no `ChatClient`

**Files:**
- Modify: `src/app/chat/[slug]/ChatClient.tsx` (corpo do componente ~107-379)

- [ ] **Step 1: Adicionar import e estado**

Adicionar import no topo:
```ts
import { normalizeMessageId } from './components/reply-helpers'
```

Após `const [now, setNow] = useState<number>(() => Date.now())`, adicionar:
```ts
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
```

(Se `useState` ainda não estiver importado de 'react', já está — o arquivo já usa `useState`.)

- [ ] **Step 2: Adicionar handlers**

Após `handleCycleCancel`, adicionar:

```ts
  const handleStartReply = useCallback((message: ChatMessage) => {
    setReplyTo(message)
  }, [])

  const handleCancelReply = useCallback(() => {
    setReplyTo(null)
  }, [])

  const messageById = new Map<string, ChatMessage>()
  for (const m of state.messages) {
    const key = normalizeMessageId(m.id)
    if (!messageById.has(key)) messageById.set(key, m)
  }
```

- [ ] **Step 3: Passar props para `MessageList` e `ChatInput`**

Atualizar o JSX:

```tsx
      <MessageList
        messages={state.messages}
        scrollAnchorRef={scrollAnchor}
        cycle={cycle}
        now={now}
        isTyping={isTyping}
        storeName={storeName}
        messageById={messageById}
        onStartReply={handleStartReply}
      />
      <ChatInput
        slug={slug}
        sending={state.sending}
        onSending={(sending) => dispatch({ type: 'sending', sending })}
        onError={(error) => dispatch({ type: 'error', error })}
        onLocalAdd={(message) => dispatch({ type: 'add', message })}
        onReplaceTemp={(tempId, realId) =>
          dispatch({ type: 'replaceTemp', tempId, realId })
        }
        onCycleStart={handleCycleStart}
        onCycleRename={handleCycleRename}
        onCycleCancel={handleCycleCancel}
        replyTo={replyTo}
        storeName={storeName}
        onCancelReply={handleCancelReply}
      />
```

- [ ] **Step 4: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: erros esperados em `MessageList`/`ChatInput` (props ainda não declaradas) — corrigidos nas próximas tasks. Sem erros novos dentro de `ChatClient.tsx`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/chat/[slug]/ChatClient.tsx"
git commit -m "feat(chat): replyTo state and handlers in ChatClient"
```

---

## Task 7: Hook `useSwipeToReply`

**Files:**
- Create: `src/app/chat/[slug]/components/useSwipeToReply.ts`

- [ ] **Step 1: Implementar o hook**

Criar `src/app/chat/[slug]/components/useSwipeToReply.ts`:

```ts
import { useRef, useState, useCallback } from 'react'
import { shouldTriggerReply } from './reply-helpers'

const MAX_DRAG_PX = 80

export function useSwipeToReply(onTrigger: () => void) {
  const [dx, setDx] = useState(0)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const activeRef = useRef(false)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return
    startRef.current = { x: e.clientX, y: e.clientY }
    activeRef.current = false
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const start = startRef.current
    if (!start) return
    const rawDx = e.clientX - start.x
    const rawDy = e.clientY - start.y
    if (!activeRef.current) {
      if (Math.abs(rawDx) <= Math.abs(rawDy) || rawDx <= 0) {
        if (Math.abs(rawDy) > 10) startRef.current = null
        return
      }
      activeRef.current = true
    }
    const clamped = Math.max(0, Math.min(rawDx, MAX_DRAG_PX))
    setDx(clamped)
  }, [])

  const finish = useCallback(() => {
    if (activeRef.current && shouldTriggerReply(dx)) {
      onTrigger()
    }
    startRef.current = null
    activeRef.current = false
    setDx(0)
  }, [dx, onTrigger])

  return {
    dx,
    swipeHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
    },
  }
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem novos erros neste arquivo.

- [ ] **Step 3: Commit**

```bash
git add "src/app/chat/[slug]/components/useSwipeToReply.ts"
git commit -m "feat(chat): useSwipeToReply gesture hook"
```

---

## Task 8: `MessageBubble` — citação, botão desktop e swipe

**Files:**
- Modify: `src/app/chat/[slug]/components/MessageBubble.tsx`

- [ ] **Step 1: Imports e props**

No topo, adicionar imports:
```ts
import type { ChatMessage } from '../ChatClient'
import { useSwipeToReply } from './useSwipeToReply'
import { replyPreviewText, truncate } from './reply-helpers'
```
(`ChatMessage` já é importado — não duplicar.)

Atualizar a assinatura de `MessageBubble`:
```ts
export function MessageBubble({
  message,
  tickState = 'idle',
  quoted = null,
  quotedLabel = '',
  onStartReply,
  onQuoteClick,
}: {
  message: ChatMessage
  tickState?: TickState
  quoted?: ChatMessage | null
  quotedLabel?: string
  onStartReply?: (message: ChatMessage) => void
  onQuoteClick?: (targetId: string) => void
}) {
```

- [ ] **Step 2: Hook de swipe dentro do componente**

Logo após a linha do `useState` do `lightbox`, adicionar:
```ts
  const { dx, swipeHandlers } = useSwipeToReply(() => onStartReply?.(message))
```

- [ ] **Step 3: Renderizar a linha com swipe, citação, botão**

Substituir o `return` principal (o bloco `<div className={\`mb-0.5 flex ...\`}>` ... até o fechamento antes do `{lightbox && (`) por:

```tsx
  return (
    <div
      data-msgid={message.id.replace(/-seg-\d+$/, '')}
      className={`group relative mb-0.5 flex items-center ${
        isUser ? 'justify-end' : 'justify-start'
      }`}
    >
      {dx > 0 && (
        <span
          className="absolute left-1 text-[#075E54]"
          style={{ opacity: Math.min(dx / 60, 1) }}
          aria-hidden="true"
        >
          <ReplyIcon />
        </span>
      )}

      {!isUser && onStartReply && (
        <button
          type="button"
          onClick={() => onStartReply(message)}
          className="order-2 ml-1 hidden h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-black/5 group-hover:flex"
          aria-label="Responder"
        >
          <ReplyIcon />
        </button>
      )}

      <div
        {...swipeHandlers}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, touchAction: 'pan-y' }}
        className={`${bubbleMaxWidth} ${isUser ? 'order-1' : ''} rounded-lg px-3 py-2 shadow-sm ${
          isUser ? 'bg-[#DCF8C6]' : 'bg-white'
        }`}
      >
        {quoted && (
          <button
            type="button"
            onClick={() => onQuoteClick?.(quoted.id.replace(/-seg-\d+$/, ''))}
            className="mb-1 block w-full rounded border-l-4 border-[#075E54] bg-black/5 px-2 py-1 text-left"
          >
            <span className="block text-xs font-semibold text-[#075E54]">
              {quotedLabel}
            </span>
            <span className="block truncate text-xs text-gray-600">
              {truncate(replyPreviewText(quoted), 90)}
            </span>
          </button>
        )}

        {isUser && onStartReply && (
          <button
            type="button"
            onClick={() => onStartReply(message)}
            className="float-right -mr-1 -mt-0.5 ml-1 hidden h-6 w-6 items-center justify-center rounded-full text-gray-500 hover:bg-black/5 group-hover:flex"
            aria-label="Responder"
          >
            <ReplyIcon />
          </button>
        )}

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
          return (
            <ImageCarousel
              key={`g-${i}`}
              srcs={item.srcs}
              onImageClick={(index) => setLightbox({ srcs: item.srcs, index })}
            />
          )
        })}

        <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-gray-500">
          <span>{formatTime(message.created_at)}</span>
          <TickIcon state={isUser ? tickState : 'blue'} />
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

- [ ] **Step 4: Adicionar o ícone de resposta**

No fim do arquivo, adicionar o componente:
```tsx
function ReplyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="9 17 4 12 9 7" />
      <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
    </svg>
  )
}
```

- [ ] **Step 5: Verificar typecheck e testes existentes da bolha**

Run: `npx tsc --noEmit`
Expected: sem erros novos em `MessageBubble.tsx` (erros restantes só em `MessageList.tsx`).
Run: `npm test -- MessageBubble`
Expected: testes existentes passam (props novas são opcionais; se algum teste falhar por mudança estrutural, ajustar o seletor no teste sem alterar comportamento).

- [ ] **Step 6: Commit**

```bash
git add "src/app/chat/[slug]/components/MessageBubble.tsx"
git commit -m "feat(chat): quote block, desktop reply button and swipe in MessageBubble"
```

---

## Task 9: `MessageList` — resolver, scroll e highlight

**Files:**
- Modify: `src/app/chat/[slug]/components/MessageList.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Animação de highlight no CSS**

Em `src/app/globals.css`, adicionar ao final:
```css
@keyframes reply-flash {
  0% { background-color: rgba(7, 94, 84, 0.18); }
  100% { background-color: transparent; }
}
.reply-flash {
  animation: reply-flash 1s ease-out;
  border-radius: 0.5rem;
}
```

- [ ] **Step 2: Reescrever `MessageList`**

Substituir o conteúdo de `src/app/chat/[slug]/components/MessageList.tsx` por:

```tsx
'use client'

import { useRef, useState, type RefObject } from 'react'
import type { ChatMessage } from '../ChatClient'
import { MessageBubble } from './MessageBubble'
import { tickStateFor, type Cycle } from './cycle'
import { groupMessagesByDay } from './group-by-day'
import { normalizeMessageId, replyAuthorForRole } from './reply-helpers'

export function MessageList({
  messages,
  scrollAnchorRef,
  cycle,
  now,
  isTyping,
  storeName,
  messageById,
  onStartReply,
}: {
  messages: ChatMessage[]
  scrollAnchorRef: RefObject<HTMLDivElement | null>
  cycle: Cycle | null
  now: number
  isTyping: boolean
  storeName: string
  messageById: Map<string, ChatMessage>
  onStartReply: (message: ChatMessage) => void
}) {
  const groups = groupMessagesByDay(messages, now)
  const containerRef = useRef<HTMLDivElement>(null)
  const [, setHighlightId] = useState<string | null>(null)

  function handleQuoteClick(targetId: string) {
    const el = containerRef.current?.querySelector<HTMLElement>(
      `[data-msgid="${targetId}"]`,
    )
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.remove('reply-flash')
    // reflow para reiniciar a animação caso clique de novo no mesmo alvo
    void el.offsetWidth
    el.classList.add('reply-flash')
    setHighlightId(targetId)
    window.setTimeout(() => {
      el.classList.remove('reply-flash')
      setHighlightId(null)
    }, 1000)
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-3 py-2"
      style={{
        backgroundImage: "url('/chat-bg-pattern.svg')",
        backgroundRepeat: 'repeat',
        backgroundSize: '280px 280px',
      }}
    >
      {messages.length === 0 && (
        <p className="mt-8 text-center text-sm text-gray-500">
          Comece a conversa enviando uma mensagem.
        </p>
      )}
      {groups.map((g) => (
        <div key={g.label + '-' + g.messages[0].id}>
          <DateSeparator label={g.label} />
          {g.messages.map((m) => {
            const quoted = m.reply_to_message_id
              ? messageById.get(m.reply_to_message_id) ?? null
              : null
            const quotedLabel = quoted
              ? replyAuthorForRole(quoted.role) === 'cliente'
                ? 'Você'
                : storeName
              : ''
            return (
              <MessageBubble
                key={m.id}
                message={m}
                tickState={tickStateFor(m.id, cycle, now)}
                quoted={quoted}
                quotedLabel={quotedLabel}
                onStartReply={onStartReply}
                onQuoteClick={handleQuoteClick}
              />
            )
          })}
        </div>
      ))}
      {isTyping && <TypingBubble />}
      <div ref={scrollAnchorRef} />
    </div>
  )
}

function DateSeparator({ label }: { label: string }) {
  return (
    <div className="my-2 flex justify-center">
      <span className="rounded-md bg-white/85 px-3 py-1 text-[11px] font-medium text-gray-600 shadow-sm">
        {label}
      </span>
    </div>
  )
}

function TypingBubble() {
  return (
    <div className="mb-0.5 flex justify-start" aria-label="digitando">
      <div className="rounded-lg bg-white px-3 py-2 shadow-sm">
        <span className="typing">
          <span />
          <span />
          <span />
        </span>
      </div>
    </div>
  )
}
```

Nota: `normalizeMessageId` é importado porque `messageById` (montado no `ChatClient`) usa chaves normalizadas; `reply_to_message_id` já é um id real (sem sufixo), então o `get` direto resolve. O import garante consistência caso o lookup precise normalizar no futuro — se o lint reclamar de import não usado, removê-lo.

- [ ] **Step 3: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros (toda a cadeia de props agora bate).

- [ ] **Step 4: Commit**

```bash
git add "src/app/chat/[slug]/components/MessageList.tsx" src/app/globals.css
git commit -m "feat(chat): resolve quotes, scroll-to and flash highlight in MessageList"
```

---

## Task 10: `ChatInput` — barra de resposta e envio com FK

**Files:**
- Modify: `src/app/chat/[slug]/components/ChatInput.tsx`

- [ ] **Step 1: Imports e props**

No topo, adicionar imports:
```ts
import type { ChatMessage } from '../ChatClient'
import {
  normalizeMessageId,
  replyAuthorForRole,
  replyPreviewText,
  truncate,
} from './reply-helpers'
```
(`ChatMessage` já é importado — não duplicar.)

Atualizar a assinatura, adicionando as três props ao final do objeto de props e à lista desestruturada:

```ts
export function ChatInput({
  slug,
  sending,
  onSending,
  onError,
  onLocalAdd,
  onReplaceTemp,
  onCycleStart,
  onCycleRename,
  onCycleCancel,
  replyTo,
  storeName,
  onCancelReply,
}: {
  slug: string
  sending: boolean
  onSending: (s: boolean) => void
  onError: (e: string | null) => void
  onLocalAdd: (m: ChatMessage) => void
  onReplaceTemp: (tempId: string, realId: string) => void
  onCycleStart: (tempId: string, content: string) => void
  onCycleRename: (tempId: string, realId: string) => void
  onCycleCancel: (tempId: string) => void
  replyTo: ChatMessage | null
  storeName: string
  onCancelReply: () => void
}) {
```

- [ ] **Step 2: Incluir FK e reply na lógica de envio**

Dentro de `handleSend`, capturar o alvo no início (após `if (!trimmed) return`):
```ts
    const replyId = replyTo ? normalizeMessageId(replyTo.id) : undefined
```

No `onLocalAdd`, incluir `reply_to_message_id`:
```ts
    onLocalAdd({
      id: tempId,
      role: 'user',
      content: trimmed,
      message_type: 'text',
      media_url: null,
      created_at: new Date().toISOString(),
      reply_to_message_id: replyId ?? null,
    })
```

Limpar a barra logo após `setText('')`:
```ts
    setText('')
    onCancelReply()
```

Passar `replyToMessageId` ao `sendMessage`:
```ts
    const result = await sendMessage({
      slug,
      text: trimmed,
      messageType: 'text',
      ...(replyId ? { replyToMessageId: replyId } : {}),
    })
```

- [ ] **Step 3: Renderizar a barra de resposta**

Envolver o `<footer>` num fragmento com a barra acima. Substituir o `return (` do componente por:

```tsx
  const replyLabel = replyTo
    ? replyAuthorForRole(replyTo.role) === 'cliente'
      ? 'Você'
      : storeName
    : ''

  return (
    <div className="bg-white">
      {replyTo && (
        <div className="flex items-center gap-2 border-l-4 border-[#075E54] bg-gray-50 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-[#075E54]">{replyLabel}</p>
            <p className="truncate text-xs text-gray-600">
              {truncate(replyPreviewText(replyTo), 80)}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-black/5"
            aria-label="Cancelar resposta"
          >
            <CloseIcon />
          </button>
        </div>
      )}
      <footer
        className="flex items-end gap-2 px-3 py-2 shadow-inner"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)' }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKey}
          rows={1}
          placeholder="Mensagem"
          className="max-h-32 flex-1 resize-none rounded-2xl bg-gray-100 px-4 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#075E54]"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#075E54] text-white transition-colors hover:bg-[#054d44] disabled:opacity-50"
          aria-label="Enviar"
        >
          <PaperPlaneIcon />
        </button>
      </footer>
    </div>
  )
}
```

- [ ] **Step 4: Adicionar o ícone de fechar**

Antes de `function PaperPlaneIcon()`, adicionar:
```tsx
function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}
```

- [ ] **Step 5: Verificar typecheck e suíte completa**

Run: `npx tsc --noEmit`
Expected: sem erros.
Run: `npm test`
Expected: todos os testes passam.

- [ ] **Step 6: Commit**

```bash
git add "src/app/chat/[slug]/components/ChatInput.tsx"
git commit -m "feat(chat): reply composer bar and reply-aware send"
```

---

## Task 11: Verificação manual (golden path + edge cases)

**Files:** nenhum (verificação)

- [ ] **Step 1: Subir o dev server**

Run: `npm run dev`
Abrir `http://localhost:3000/chat/<slug-de-uma-loja>` (usar um slug existente em `store_settings.chat_slug`).

- [ ] **Step 2: Desktop — botão de responder**

Com mouse: passar o hover sobre uma bolha → botão de responder aparece. Clicar → barra de citação surge acima do input com autor + trecho. Digitar e enviar → a bolha enviada mostra a citação no topo; a barra some.

- [ ] **Step 3: Mobile — swipe-to-reply**

No DevTools, ativar emulação de toque (device toolbar). Arrastar uma bolha para a direita → ícone de resposta aparece atrás; ao passar ~60px e soltar → barra de citação surge. Verificar que arrasto vertical ainda rola a lista (não dispara reply).

- [ ] **Step 4: Navegação pela citação**

Clicar na citação dentro de uma bolha enviada → a lista rola até a mensagem original com um flash de destaque (~1s).

- [ ] **Step 5: Persistência**

Recarregar a página → a citação continua visível dentro da bolha (carregada do banco).

- [ ] **Step 6: Mídia e webhook**

Responder uma mensagem de imagem → citação mostra "📷 Imagem".
Se `N8N_WEBHOOK_URL` estiver configurado, confirmar no log do n8n que o payload inclui `respondendo_a: { id_mensagem, autor, conteudo }` com o conteúdo inteiro da mensagem citada. Sem webhook configurado (echo mode), pular esta checagem.

- [ ] **Step 7: Cancelar resposta**

Iniciar uma resposta, clicar no "X" da barra → barra some, envio volta a ser mensagem normal (sem citação).

---

## Self-Review Notes

- **Cobertura do spec:** migration + tipos (T2), webhook `respondendo_a` conteúdo inteiro (T3, T4), carregar/gravar FK (T4, T5), estado replyTo (T6), swipe (T7, T8), citação na bolha + botão desktop (T8), resolver + scroll + highlight (T9), barra de composição (T10), normalização `-seg-N` (T1, usado em T6/T8/T10), mídia rótulo (T1/T8/T10), verificação manual (T11). Todos os itens do spec têm task.
- **Consistência de tipos:** `respondendo_a`/`respondendoA` com shape idêntico em n8n.ts e chat.ts; `reply_to_message_id` consistente em database.ts, ChatBootstrap, ChatMessage, realtime, insert; props `quoted`/`quotedLabel`/`onStartReply`/`onQuoteClick`/`messageById`/`storeName` casam entre ChatClient→MessageList→MessageBubble; `replyTo`/`onCancelReply`/`storeName` casam entre ChatClient→ChatInput.
- **Sem placeholders:** todo passo de código tem código completo.
