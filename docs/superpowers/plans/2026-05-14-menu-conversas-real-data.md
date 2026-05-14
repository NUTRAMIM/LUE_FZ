# Menu Conversas — Real Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o mock de `ConversasView.tsx` por um menu de conversas read-only com dados reais do banco. O dono da loja observa em tempo real as conversas que a IA tem com visitantes do chat público, com contador de não lidas e Realtime via Supabase.

**Architecture:** Server Component (`/conversas/page.tsx`) faz fetch inicial via RPC e entrega para o `ConversasView` (client). Estado vive no client; novas mensagens chegam via Supabase Realtime filtrado por `messages.store_id` (destravado pela migration 019). Status binário (`IA ATENDENDO` / `ENCERRADA`); sem input de operador, sem botões de ação, sem FILA.

**Tech Stack:** Next.js 16 App Router + React 19, Supabase SSR client + Realtime, Tailwind 4 + design system violet existente, Vitest para helpers puros.

**Spec:** `docs/superpowers/specs/2026-05-14-menu-conversas-real-data-design.md`

**Branch:** `feat/painel-redesign-real-model` (já criada, já contém o spec)

---

## File Structure

**Create:**
- `supabase/migrations/020_conversations_last_read.sql`
- `supabase/migrations/021_list_conversations_rpc.sql`
- `src/lib/chat-media.ts`
- `src/actions/conversas.ts`
- `src/lib/realtime-conversas.ts`
- `src/components/conversas/formatters.ts`
- `src/components/conversas/__tests__/formatters.test.ts`
- `src/components/conversas/ChatRail.tsx`
- `src/components/conversas/FullChat.tsx`

**Modify:**
- `src/types/database.ts` — adicionar `store_id` em `messages` (já feito como parte da migration 019) e `last_read_at` em `conversations`.
- `src/actions/chat.ts` — trocar `signedReadUrl` interna por import de `src/lib/chat-media.ts`.
- `src/components/conversas/ConversasView.tsx` — rewrite total.
- `src/app/conversas/page.tsx` — virar Server Component que faz fetch inicial.

**Pré-existente (já no working tree, commitar antes de começar):**
- `supabase/migrations/019_messages_store_id.sql` (criada nas conversas anteriores)
- `src/types/database.ts` (campo `store_id` em messages, já editado)

---

### Task 0: Commit do trabalho pendente da migration 019

A migration 019 e a edição em `database.ts` já estão no working tree mas não foram commitadas. Precisam virar um commit limpo antes de começar o resto do plano, senão vai misturar com a 020.

**Files:**
- Existente: `supabase/migrations/019_messages_store_id.sql`
- Existente: `src/types/database.ts` (campo `store_id` em messages)

- [ ] **Step 1: Verificar estado**

Run: `git status --short`

Expected (ou similar — `package-lock.json` e `.claude/` podem variar):
```
 M package-lock.json
 M src/types/database.ts
?? .claude/
?? supabase/migrations/019_messages_store_id.sql
```

Se `src/types/database.ts` **não** estiver modificado, é porque a edição da migration 019 ainda não foi feita. Abrir o arquivo e confirmar que `messages.Row/Insert/Update` contém `store_id`. Se não contiver, parar e revisar antes de continuar.

- [ ] **Step 2: Adicionar e commitar só os arquivos da migration 019**

```bash
git add supabase/migrations/019_messages_store_id.sql src/types/database.ts
git commit -m "feat(db): add store_id to messages with auto-populate trigger and per-store RLS"
```

Expected: 1 commit criado.

**Não incluir** `package-lock.json` nem `.claude/` neste commit — eles são ruído fora deste escopo.

---

### Task 1: Migration 020 — `conversations.last_read_at`

**Files:**
- Create: `supabase/migrations/020_conversations_last_read.sql`

- [ ] **Step 1: Criar a migration**

Conteúdo de `supabase/migrations/020_conversations_last_read.sql`:

```sql
-- 020_conversations_last_read.sql
-- Tracks when the store owner last viewed a conversation, so we can compute
-- an unread-messages counter per conversation in the painel.

ALTER TABLE conversations
  ADD COLUMN last_read_at TIMESTAMPTZ;

-- Backfill: existing conversations count as already-read up to now, otherwise
-- every old conversation would appear with full unread counts after deploy.
UPDATE conversations
SET last_read_at = COALESCE(last_message_at, created_at);
```

- [ ] **Step 2: Confirmar arquivo criado**

Run: `ls supabase/migrations/020_conversations_last_read.sql`

Expected: arquivo listado, sem erro.

A aplicação real da migration (via Supabase Dashboard ou CLI) fica a cargo do dono do projeto — o padrão do repo é commitar o SQL e aplicar separadamente.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/020_conversations_last_read.sql
git commit -m "feat(db): add conversations.last_read_at for unread counter"
```

---

### Task 2: Migration 021 — RPC `list_conversations_for_store`

**Files:**
- Create: `supabase/migrations/021_list_conversations_rpc.sql`

- [ ] **Step 1: Criar a migration**

Conteúdo de `supabase/migrations/021_list_conversations_rpc.sql`:

```sql
-- 021_list_conversations_rpc.sql
-- RPC para o menu de conversas do painel: retorna lista da loja com preview
-- da última mensagem, contador de não lidas e nome do lead num único shot.
-- SECURITY INVOKER => respeita RLS (auth.uid() = store_id em conversations
-- e em messages, da migration 019).

CREATE OR REPLACE FUNCTION list_conversations_for_store(
  p_store_id UUID,
  p_status   TEXT
)
RETURNS TABLE (
  id                   UUID,
  visitor_id           TEXT,
  lead_name            TEXT,
  status               TEXT,
  last_message_at      TIMESTAMPTZ,
  last_message_preview TEXT,
  last_message_role    TEXT,
  unread_count         BIGINT,
  created_at           TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH last_msg AS (
    SELECT DISTINCT ON (m.conversation_id)
      m.conversation_id, m.content, m.role, m.created_at
    FROM messages m
    WHERE m.store_id = p_store_id
    ORDER BY m.conversation_id, m.created_at DESC
  ),
  unread AS (
    SELECT m.conversation_id, count(*) AS n
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.store_id = p_store_id
      AND m.created_at > COALESCE(c.last_read_at, c.created_at)
    GROUP BY m.conversation_id
  )
  SELECT
    c.id,
    c.visitor_id,
    l.name,
    c.status,
    c.last_message_at,
    lm.content,
    lm.role,
    COALESCE(u.n, 0),
    c.created_at
  FROM conversations c
  LEFT JOIN leads     l  ON l.id  = c.lead_id
  LEFT JOIN last_msg  lm ON lm.conversation_id = c.id
  LEFT JOIN unread    u  ON u.conversation_id  = c.id
  WHERE c.store_id = p_store_id
    AND c.status   = p_status
  ORDER BY c.last_message_at DESC NULLS LAST
  LIMIT 200;
$$;
```

- [ ] **Step 2: Confirmar arquivo criado**

Run: `ls supabase/migrations/021_list_conversations_rpc.sql`

Expected: arquivo listado.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/021_list_conversations_rpc.sql
git commit -m "feat(db): add list_conversations_for_store RPC for painel inbox"
```

---

### Task 3: Atualizar `database.ts` — `conversations.last_read_at`

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Adicionar `last_read_at` em `Row`, `Insert`, `Update` de conversations**

Editar `src/types/database.ts`. Localizar o bloco `conversations: { Row: { ... } }`:

Trocar:
```ts
      conversations: {
        Row: {
          id: string
          status: 'ai_active' | 'human_active' | 'closed'
          assigned_to: string | null
          lead_id: string | null
          visitor_id: string
          title: string | null
          metadata: Json
          last_message_at: string | null
          created_at: string
          updated_at: string
          store_id: string | null
        }
        Insert: {
          id?: string
          status?: 'ai_active' | 'human_active' | 'closed'
          assigned_to?: string | null
          lead_id?: string | null
          visitor_id: string
          title?: string | null
          metadata?: Json
          last_message_at?: string | null
          created_at?: string
          updated_at?: string
          store_id?: string | null
        }
        Update: {
          id?: string
          status?: 'ai_active' | 'human_active' | 'closed'
          assigned_to?: string | null
          lead_id?: string | null
          visitor_id?: string
          title?: string | null
          metadata?: Json
          last_message_at?: string | null
          updated_at?: string
          store_id?: string | null
        }
        Relationships: []
      }
```

Por:
```ts
      conversations: {
        Row: {
          id: string
          status: 'ai_active' | 'human_active' | 'closed'
          assigned_to: string | null
          lead_id: string | null
          visitor_id: string
          title: string | null
          metadata: Json
          last_message_at: string | null
          created_at: string
          updated_at: string
          store_id: string | null
          last_read_at: string | null
        }
        Insert: {
          id?: string
          status?: 'ai_active' | 'human_active' | 'closed'
          assigned_to?: string | null
          lead_id?: string | null
          visitor_id: string
          title?: string | null
          metadata?: Json
          last_message_at?: string | null
          created_at?: string
          updated_at?: string
          store_id?: string | null
          last_read_at?: string | null
        }
        Update: {
          id?: string
          status?: 'ai_active' | 'human_active' | 'closed'
          assigned_to?: string | null
          lead_id?: string | null
          visitor_id?: string
          title?: string | null
          metadata?: Json
          last_message_at?: string | null
          updated_at?: string
          store_id?: string | null
          last_read_at?: string | null
        }
        Relationships: []
      }
```

- [ ] **Step 2: Verificar tsc**

Run: `npx tsc --noEmit`

Expected: nenhum erro novo. Erros pré-existentes (ex.: `src/app/api/inventory/import/route.ts`) podem aparecer — ignorar se já existiam antes desta task.

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts
git commit -m "feat(types): add last_read_at to conversations row/insert/update"
```

---

### Task 4: Extrair `signedReadUrl` para `src/lib/chat-media.ts`

A action `getMessages` (Task 6) precisa gerar signed URLs para `media_path`. A função idêntica já existe em `src/actions/chat.ts:64-77`. Extrair pra `src/lib/chat-media.ts` e atualizar `chat.ts` pra importar.

**Files:**
- Create: `src/lib/chat-media.ts`
- Modify: `src/actions/chat.ts`

- [ ] **Step 1: Criar `src/lib/chat-media.ts`**

```ts
import { createAdminClient } from '@/lib/supabase/admin'

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24

export async function signedReadUrl(
  path: string | null,
): Promise<string | null> {
  if (!path) return null
  const admin = createAdminClient()
  const { data, error } = await admin.storage
    .from('chat-media')
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data) {
    console.error('signedReadUrl error', error)
    return null
  }
  return data.signedUrl
}
```

- [ ] **Step 2: Atualizar `src/actions/chat.ts`**

Em `src/actions/chat.ts`, remover a constante `SIGNED_URL_TTL_SECONDS` (linha 30) e a função `signedReadUrl` (linhas 64-77).

Adicionar import no topo do arquivo (depois dos imports existentes):
```ts
import { signedReadUrl } from '@/lib/chat-media'
```

O restante do arquivo continua igual — `signedReadUrl(...)` agora resolve pela importação.

- [ ] **Step 3: Rodar typecheck e testes**

Run: `npx tsc --noEmit && npm test`

Expected: tsc passa (sem erros novos); testes existentes continuam verdes.

- [ ] **Step 4: Sanity check manual no chat público**

Run: `npm run dev` em uma janela; abrir `/chat/<algum-slug>` no browser; mandar uma imagem; confirmar que aparece (ou seja, signed URL ainda funciona).

Se quebrar, reverter o passo 2 e investigar. Não seguir adiante quebrado.

Parar `npm run dev` quando confirmar.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-media.ts src/actions/chat.ts
git commit -m "refactor(chat): extract signedReadUrl to src/lib/chat-media.ts"
```

---

### Task 5: `formatters.ts` — helpers puros com TDD

**Files:**
- Create: `src/components/conversas/formatters.ts`
- Create: `src/components/conversas/__tests__/formatters.test.ts`

- [ ] **Step 1: Escrever os testes (falham — arquivo de origem não existe ainda)**

Criar `src/components/conversas/__tests__/formatters.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  visitorName,
  avatarColor,
  avatarInitials,
  formatRelativeTime,
  previewPrefix,
  truncatePreview,
} from '../formatters'

describe('visitorName', () => {
  it('uses lead_name when present', () => {
    expect(visitorName('any-uuid', 'João Silva')).toBe('João Silva')
  })

  it('falls back to "Visitante #" + first 6 chars when lead_name is null', () => {
    expect(visitorName('abc12345-6789-0000-1111-222222222222', null)).toBe(
      'Visitante #abc123',
    )
  })

  it('falls back when lead_name is empty string', () => {
    expect(visitorName('deadbeef-0000-0000-0000-000000000000', '')).toBe(
      'Visitante #deadbe',
    )
  })

  it('trims whitespace-only lead_name as missing', () => {
    expect(visitorName('feedface-1111-1111-1111-111111111111', '   ')).toBe(
      'Visitante #feedfa',
    )
  })
})

describe('avatarColor', () => {
  it('returns one of the palette colors', () => {
    const palette = [
      '#A78BFA', '#FBBF24', '#34D399', '#60A5FA',
      '#F87171', '#C4B5FD', '#F472B6', '#22D3EE',
    ]
    expect(palette).toContain(avatarColor('any-string'))
  })

  it('is deterministic — same input maps to same color', () => {
    expect(avatarColor('abc')).toBe(avatarColor('abc'))
  })

  it('different inputs can map to different colors', () => {
    const colors = new Set<string>()
    for (let i = 0; i < 20; i++) colors.add(avatarColor(`visitor-${i}`))
    expect(colors.size).toBeGreaterThan(1)
  })
})

describe('avatarInitials', () => {
  it('returns initials of two-word names', () => {
    expect(avatarInitials('João Silva')).toBe('JS')
  })

  it('returns first letter only for single-word names', () => {
    expect(avatarInitials('João')).toBe('J')
  })

  it('handles multiple words by taking first and last initials', () => {
    expect(avatarInitials('Maria da Silva')).toBe('MS')
  })

  it('returns "?" for empty input', () => {
    expect(avatarInitials('')).toBe('?')
  })

  it('uppercases lowercase names', () => {
    expect(avatarInitials('joão silva')).toBe('JS')
  })
})

describe('formatRelativeTime', () => {
  const now = new Date('2026-05-14T12:00:00Z')

  it('returns "agora" for < 60s', () => {
    expect(
      formatRelativeTime('2026-05-14T11:59:30Z', now),
    ).toBe('agora')
  })

  it('returns "Nmin" for < 1h', () => {
    expect(formatRelativeTime('2026-05-14T11:55:00Z', now)).toBe('5min')
  })

  it('returns "Nh" for < 24h', () => {
    expect(formatRelativeTime('2026-05-14T09:00:00Z', now)).toBe('3h')
  })

  it('returns "ontem" for 24-48h ago', () => {
    expect(formatRelativeTime('2026-05-13T12:00:00Z', now)).toBe('ontem')
  })

  it('returns DD/MM for older', () => {
    expect(formatRelativeTime('2026-05-01T12:00:00Z', now)).toBe('01/05')
  })

  it('returns empty string for null/undefined input', () => {
    expect(formatRelativeTime(null, now)).toBe('')
  })
})

describe('previewPrefix', () => {
  it('Visitante: for user role', () => {
    expect(previewPrefix('user')).toBe('Visitante: ')
  })

  it('IA: for assistant role', () => {
    expect(previewPrefix('assistant')).toBe('IA: ')
  })

  it('Você: for operator role', () => {
    expect(previewPrefix('operator')).toBe('Você: ')
  })

  it('empty for system role', () => {
    expect(previewPrefix('system')).toBe('')
  })

  it('empty for null', () => {
    expect(previewPrefix(null)).toBe('')
  })
})

describe('truncatePreview', () => {
  it('returns original string when shorter than max', () => {
    expect(truncatePreview('curto', 120)).toBe('curto')
  })

  it('truncates and appends "…" when longer than max', () => {
    const long = 'a'.repeat(130)
    const out = truncatePreview(long, 120)
    expect(out.length).toBe(121) // 120 + '…'
    expect(out.endsWith('…')).toBe(true)
  })

  it('returns "" for null/undefined', () => {
    expect(truncatePreview(null, 120)).toBe('')
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham por módulo ausente**

Run: `npm test -- formatters`

Expected: erro tipo `Cannot find module '../formatters'`.

- [ ] **Step 3: Implementar `formatters.ts`**

Criar `src/components/conversas/formatters.ts`:

```ts
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
```

- [ ] **Step 4: Rodar testes — verde**

Run: `npm test -- formatters`

Expected: todos os testes passando.

- [ ] **Step 5: Commit**

```bash
git add src/components/conversas/formatters.ts src/components/conversas/__tests__/formatters.test.ts
git commit -m "feat(conversas): add formatters (visitor name, avatar, time, preview)"
```

---

### Task 6: Server actions — `src/actions/conversas.ts`

**Files:**
- Create: `src/actions/conversas.ts`

- [ ] **Step 1: Criar o arquivo**

Conteúdo de `src/actions/conversas.ts`:

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { signedReadUrl } from '@/lib/chat-media'
import { visitorName, truncatePreview } from '@/components/conversas/formatters'

export interface ConversationRow {
  id: string
  visitor_id: string
  visitor_name: string
  status: 'ai_active' | 'closed'
  last_message_at: string | null
  last_message_preview: string | null
  last_message_role: 'user' | 'assistant' | 'operator' | 'system' | null
  unread_count: number
  created_at: string
}

export interface MessageRow {
  id: string
  role: 'user' | 'assistant' | 'operator' | 'system'
  content: string
  message_type: 'text' | 'image' | 'audio'
  media_url: string | null
  created_at: string
}

const PREVIEW_MAX = 120

export async function getConversations(
  filter: 'active' | 'closed',
): Promise<ConversationRow[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const status = filter === 'active' ? 'ai_active' : 'closed'
  const { data, error } = await supabase.rpc('list_conversations_for_store', {
    p_store_id: user.id,
    p_status: status,
  })

  if (error || !data) {
    console.error('getConversations error', error)
    return []
  }

  return (data as Array<{
    id: string
    visitor_id: string
    lead_name: string | null
    status: string
    last_message_at: string | null
    last_message_preview: string | null
    last_message_role: string | null
    unread_count: number
    created_at: string
  }>).map((r) => ({
    id: r.id,
    visitor_id: r.visitor_id,
    visitor_name: visitorName(r.visitor_id, r.lead_name),
    status: r.status as 'ai_active' | 'closed',
    last_message_at: r.last_message_at,
    last_message_preview: truncatePreview(r.last_message_preview, PREVIEW_MAX),
    last_message_role:
      (r.last_message_role as ConversationRow['last_message_role']) ?? null,
    unread_count: Number(r.unread_count ?? 0),
    created_at: r.created_at,
  }))
}

export async function getMessages(
  conversationId: string,
): Promise<MessageRow[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('messages')
    .select('id, role, content, message_type, media_path, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(500)

  if (error || !data) {
    console.error('getMessages error', error)
    return []
  }

  return await Promise.all(
    data.map(async (m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      message_type: m.message_type,
      media_url: await signedReadUrl(m.media_path),
      created_at: m.created_at,
    })),
  )
}

export async function markConversationRead(
  conversationId: string,
): Promise<{ success: boolean }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false }

  const { error } = await supabase
    .from('conversations')
    .update({ last_read_at: new Date().toISOString() })
    .eq('id', conversationId)

  if (error) {
    console.error('markConversationRead error', error)
    return { success: false }
  }
  return { success: true }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: nenhum erro novo. O RPC `list_conversations_for_store` não está nos tipos gerados, então o `as Array<...>` lida com isso (Supabase TS retorna `unknown` para RPCs não tipados — a anotação resolve).

- [ ] **Step 3: Sanity check manual via dev**

Run em janela separada: `npm run dev`

Em outra: `npx tsc --noEmit` (já feito). Não há teste automatizado dessas actions (mocking Supabase é alto custo — padrão do repo é não testar actions). Validação completa fica na Task 11 (QA manual).

Parar `npm run dev` quando confirmar que compila.

- [ ] **Step 4: Commit**

```bash
git add src/actions/conversas.ts
git commit -m "feat(conversas): add server actions (getConversations, getMessages, markConversationRead)"
```

---

### Task 7: Realtime hook — `src/lib/realtime-conversas.ts`

**Files:**
- Create: `src/lib/realtime-conversas.ts`

- [ ] **Step 1: Criar o hook**

Conteúdo de `src/lib/realtime-conversas.ts`:

```ts
'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export interface RealtimeMessage {
  id: string
  conversation_id: string
  store_id: string
  role: 'user' | 'assistant' | 'operator' | 'system'
  content: string
  message_type: 'text' | 'image' | 'audio'
  media_path: string | null
  created_at: string
}

export interface RealtimeConversation {
  id: string
  store_id: string | null
  visitor_id: string
  status: 'ai_active' | 'human_active' | 'closed'
  lead_id: string | null
  last_message_at: string | null
  last_read_at: string | null
  created_at: string
}

export interface ConversasRealtimeHandlers {
  onNewMessage: (msg: RealtimeMessage) => void
  onNewConversation: (conv: RealtimeConversation) => void
  onConversationUpdated: (conv: RealtimeConversation) => void
}

export function useConversasRealtime(
  storeId: string,
  handlers: ConversasRealtimeHandlers,
) {
  useEffect(() => {
    const supabase = createClient()

    const messagesChannel = supabase
      .channel(`messages:${storeId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `store_id=eq.${storeId}`,
        },
        (payload) => handlers.onNewMessage(payload.new as RealtimeMessage),
      )
      .subscribe()

    const conversationsChannel = supabase
      .channel(`conversations:${storeId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `store_id=eq.${storeId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            handlers.onNewConversation(payload.new as RealtimeConversation)
          } else if (payload.eventType === 'UPDATE') {
            handlers.onConversationUpdated(
              payload.new as RealtimeConversation,
            )
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(messagesChannel)
      supabase.removeChannel(conversationsChannel)
    }
    // Handlers can be re-created across renders; we only re-subscribe when the
    // store changes. Callers should keep handlers stable via useCallback if
    // they capture state, but the latest reference is read each event via
    // closure on the outer handlers object — safer is to keep `handlers` in
    // a ref. For MVP we accept the simpler form; storeId change is rare.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId])
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: sem erro novo.

- [ ] **Step 3: Commit**

```bash
git add src/lib/realtime-conversas.ts
git commit -m "feat(conversas): add useConversasRealtime hook for messages/conversations stream"
```

---

### Task 8: `ChatRail.tsx` — lista de conversas

**Files:**
- Create: `src/components/conversas/ChatRail.tsx`

- [ ] **Step 1: Criar o componente**

Conteúdo de `src/components/conversas/ChatRail.tsx`:

```tsx
'use client'

import { Icon } from '@/components/painel/Icons'
import type { ConversationRow } from '@/actions/conversas'
import {
  avatarColor,
  avatarInitials,
  formatRelativeTime,
  previewPrefix,
} from './formatters'

interface ChatRailProps {
  active: ConversationRow[]
  closed: ConversationRow[]
  closedExpanded: boolean
  onToggleClosed: () => void
  selectedId: string | null
  onSelect: (id: string) => void
  query: string
  onQueryChange: (q: string) => void
}

function matchesQuery(c: ConversationRow, q: string): boolean {
  if (!q) return true
  const needle = q.toLowerCase()
  return (
    c.visitor_name.toLowerCase().includes(needle) ||
    (c.last_message_preview ?? '').toLowerCase().includes(needle)
  )
}

function ConversationTile({
  c,
  selected,
  onSelect,
}: {
  c: ConversationRow
  selected: boolean
  onSelect: (id: string) => void
}) {
  const lastText =
    previewPrefix(c.last_message_role) + (c.last_message_preview ?? '')
  const time = formatRelativeTime(c.last_message_at)
  const initials = avatarInitials(c.visitor_name)
  const bg = avatarColor(c.visitor_id)
  const unread = c.unread_count > 0

  return (
    <button
      onClick={() => onSelect(c.id)}
      className={`w-full text-left relative px-3 py-2.5 flex gap-2.5 transition-colors ${
        selected ? 'bg-brand-50' : 'hover:bg-ink-50'
      }`}
    >
      {selected && (
        <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-brand-600" />
      )}
      <div className="relative shrink-0">
        <div
          className="w-10 h-10 rounded-full font-display font-bold text-white text-[12px] flex items-center justify-center"
          style={{ background: bg }}
        >
          {initials}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div
            className={`text-[13px] truncate ${
              selected ? 'font-bold text-brand-900' : 'font-semibold text-ink-900'
            } ${unread ? 'font-bold' : ''}`}
          >
            {c.visitor_name}
          </div>
          <span
            className={`text-[10.5px] tabular shrink-0 ${
              unread && !selected ? 'text-brand-700 font-bold' : 'text-ink-500'
            }`}
          >
            {time}
          </span>
        </div>
        <div
          className={`text-[11.5px] truncate mt-0.5 ${
            unread && !selected ? 'text-ink-800 font-semibold' : 'text-ink-500'
          }`}
        >
          {lastText || ' '}
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold tracking-wide uppercase text-ink-600">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: '#7C3AED' }}
            />
            SITE
          </span>
          {unread && (
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10.5px] font-bold tabular bg-brand-600 text-white">
              {c.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

export function ChatRail({
  active,
  closed,
  closedExpanded,
  onToggleClosed,
  selectedId,
  onSelect,
  query,
  onQueryChange,
}: ChatRailProps) {
  const activeFiltered = active.filter((c) => matchesQuery(c, query))
  const closedFiltered = closed.filter((c) => matchesQuery(c, query))

  return (
    <div className="card flex flex-col" style={{ height: 'calc(100vh - 138px)' }}>
      <div className="px-3.5 pt-3.5 pb-2 border-b border-ink-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-display font-bold text-ink-900 text-[15px]">
            Caixa de entrada
          </span>
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-md text-[11px] font-bold tabular bg-ink-100 text-ink-700">
            {active.length + closed.length}
          </span>
        </div>
      </div>

      <div className="px-3.5 py-2.5 border-b border-ink-100">
        <div className="relative">
          <Icon
            name="search"
            className="w-3.5 h-3.5 text-ink-400 absolute left-2.5 top-1/2 -translate-y-1/2"
          />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Buscar conversas…"
            className="w-full pl-7 pr-3 py-1.5 rounded-lg bg-ink-50 text-[12.5px] placeholder:text-ink-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-brand-200"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div>
          <div className="px-3.5 pt-3.5 pb-1.5 flex items-center justify-between">
            <span className="eyebrow text-ink-500">ATIVAS</span>
            <span className="eyebrow text-ink-400 tabular">
              {activeFiltered.length}
            </span>
          </div>
          {activeFiltered.length === 0 ? (
            <div className="px-3.5 py-6 text-[12px] text-ink-500">
              {active.length === 0
                ? 'Nenhuma conversa ainda. Quando alguém chamar pelo chat público, ela aparece aqui.'
                : 'Nada bate com a busca.'}
            </div>
          ) : (
            <div className="divide-y divide-ink-100/70">
              {activeFiltered.map((c) => (
                <ConversationTile
                  key={c.id}
                  c={c}
                  selected={c.id === selectedId}
                  onSelect={onSelect}
                />
              ))}
            </div>
          )}
        </div>

        <div className="mt-1 border-t border-ink-100">
          <button
            onClick={onToggleClosed}
            className="w-full px-3.5 py-2.5 flex items-center justify-between hover:bg-ink-50"
          >
            <span className="eyebrow text-ink-500">ENCERRADAS</span>
            <span className="eyebrow text-ink-400 tabular flex items-center gap-1">
              {closed.length > 0 && closedExpanded ? closedFiltered.length : ''}
              <Icon
                name={closedExpanded ? 'chevron-up' : 'chevron-down'}
                className="w-3 h-3"
              />
            </span>
          </button>
          {closedExpanded && (
            <div className="divide-y divide-ink-100/70">
              {closedFiltered.map((c) => (
                <ConversationTile
                  key={c.id}
                  c={c}
                  selected={c.id === selectedId}
                  onSelect={onSelect}
                />
              ))}
              {closedFiltered.length === 0 && (
                <div className="px-3.5 py-4 text-[12px] text-ink-500">
                  Nenhuma conversa encerrada.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="h-4" />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verificar os ícones existem**

Run: `grep -n "chevron-up\|chevron-down" src/components/painel/Icons.tsx | head -5`

Se não existirem, fallback: usar `'plus'` para fechado e `'minus'` para aberto, OU adicionar ícones em `Icons.tsx`. Se faltar, abrir `src/components/painel/Icons.tsx`, identificar o padrão dos paths SVG existentes, adicionar:

```tsx
'chevron-up':   <path d="M6 14l6-6 6 6" />,
'chevron-down': <path d="M6 10l6 6 6-6" />,
```

(Os paths exatos podem variar conforme a stroke/viewBox usada — copiar o padrão de um ícone vizinho.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`

Expected: sem erro novo.

- [ ] **Step 4: Commit**

```bash
git add src/components/conversas/ChatRail.tsx
# Se Icons.tsx foi mexido:
git add src/components/painel/Icons.tsx
git commit -m "feat(conversas): add ChatRail with active/closed groups and search"
```

---

### Task 9: `FullChat.tsx` — viewer da conversa

**Files:**
- Create: `src/components/conversas/FullChat.tsx`

- [ ] **Step 1: Criar o componente**

Conteúdo de `src/components/conversas/FullChat.tsx`:

```tsx
'use client'

import { Icon } from '@/components/painel/Icons'
import type { ConversationRow, MessageRow } from '@/actions/conversas'
import {
  avatarColor,
  avatarInitials,
  formatRelativeTime,
} from './formatters'

interface FullChatProps {
  conversation: ConversationRow | null
  messages: MessageRow[]
  loading: boolean
}

const STATUS = {
  ai_active: {
    label: 'IA ATENDENDO',
    bg: 'bg-brand-100',
    fg: 'text-brand-800',
    dot: '#5B21B6',
  },
  closed: {
    label: 'ENCERRADA',
    bg: 'bg-ink-100',
    fg: 'text-ink-700',
    dot: '#94A3B8',
  },
} as const

function StatusPill({ status }: { status: 'ai_active' | 'closed' }) {
  const x = STATUS[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10.5px] font-semibold ${x.bg} ${x.fg}`}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: x.dot }} />
      {x.label}
    </span>
  )
}

function MessageBubble({ m }: { m: MessageRow }) {
  const time = new Date(m.created_at).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })

  if (m.role === 'system') {
    return (
      <div className="flex justify-center">
        <div className="text-[12px] text-ink-500 italic px-3 py-1 rounded-md bg-ink-50">
          {m.content}
        </div>
      </div>
    )
  }

  if (m.role === 'user') {
    return (
      <div className="flex items-end gap-2 max-w-[88%]">
        <div className="bubble-them text-[13px] leading-snug">
          {m.message_type === 'image' && m.media_url ? (
            <img
              src={m.media_url}
              alt=""
              className="rounded-md max-w-[260px] block"
            />
          ) : m.message_type === 'audio' && m.media_url ? (
            <audio controls src={m.media_url} className="max-w-[260px]" />
          ) : (
            m.content
          )}
        </div>
        <span className="eyebrow text-ink-400 mb-0.5 tabular shrink-0">{time}</span>
      </div>
    )
  }

  // assistant or operator
  const isIA = m.role === 'assistant'
  return (
    <div className="flex items-end gap-2 max-w-[88%] ml-auto justify-end">
      <span className="eyebrow text-ink-400 mb-0.5 tabular shrink-0">{time}</span>
      <div className="flex flex-col items-end gap-1">
        {isIA && (
          <span className="eyebrow text-brand-600 inline-flex items-center gap-1">
            <Icon name="sparkle" className="w-3 h-3" />
            IA
          </span>
        )}
        <div className={`${isIA ? 'bubble-ia' : 'bubble-me'} text-[13px] leading-snug`}>
          {m.message_type === 'image' && m.media_url ? (
            <img
              src={m.media_url}
              alt=""
              className="rounded-md max-w-[260px] block"
            />
          ) : m.message_type === 'audio' && m.media_url ? (
            <audio controls src={m.media_url} className="max-w-[260px]" />
          ) : (
            m.content
          )}
        </div>
      </div>
    </div>
  )
}

export function FullChat({ conversation, messages, loading }: FullChatProps) {
  if (!conversation) {
    return (
      <div
        className="card flex flex-col items-center justify-center"
        style={{ height: 'calc(100vh - 138px)' }}
      >
        <div className="text-[14px] text-ink-500">
          Selecione uma conversa pra visualizar.
        </div>
      </div>
    )
  }

  const t = conversation
  const initials = avatarInitials(t.visitor_name)
  const bg = avatarColor(t.visitor_id)
  const elapsed = formatRelativeTime(t.created_at)

  return (
    <div
      className="card flex flex-col overflow-hidden"
      style={{ height: 'calc(100vh - 138px)' }}
    >
      <div className="flex items-center gap-4 px-5 py-3.5 border-b border-ink-100 bg-white">
        <div className="relative shrink-0">
          <div
            className="w-11 h-11 rounded-full font-display font-bold text-white text-[14px] flex items-center justify-center"
            style={{ background: bg }}
          >
            {initials}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <h2
              className="font-display font-bold text-ink-900 truncate"
              style={{ fontSize: '17px' }}
            >
              {t.visitor_name}
            </h2>
            <StatusPill status={t.status} />
          </div>
          <div className="flex items-center gap-2 mt-1 text-[12px] text-ink-500 min-w-0 whitespace-nowrap overflow-hidden">
            <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold tracking-wide uppercase text-ink-600">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: '#7C3AED' }}
              />
              SITE
            </span>
            <span className="text-ink-300">·</span>
            <span className="eyebrow inline-flex items-center gap-1 shrink-0">
              <Icon name="clock" className="w-3 h-3" />
              iniciada {elapsed}
            </span>
          </div>
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto px-5 py-5 space-y-3"
        style={{ background: '#FAFAFD' }}
      >
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={`h-6 rounded-md bg-ink-100 animate-pulse ${
                  i % 2 === 0 ? 'w-1/2' : 'w-2/3 ml-auto'
                }`}
              />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center text-[12px] text-ink-500 py-10">
            Sem mensagens nesta conversa.
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={m.role === 'user' ? '' : 'flex justify-end'}>
              <MessageBubble m={m} />
            </div>
          ))
        )}
      </div>

      <div className="border-t border-ink-100 px-5 py-3.5 bg-gradient-to-r from-brand-50 to-brand-100/40 flex items-center gap-3">
        <span className="chip chip-brand">
          <Icon name="sparkle" className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-ink-900">
            Visualização
          </div>
          <div className="text-[12px] text-ink-600">
            Esta conversa é respondida automaticamente pela IA.
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: sem erro novo.

- [ ] **Step 3: Commit**

```bash
git add src/components/conversas/FullChat.tsx
git commit -m "feat(conversas): add FullChat read-only viewer with media support"
```

---

### Task 10: Rewrite `ConversasView.tsx`

**Files:**
- Modify: `src/components/conversas/ConversasView.tsx` (rewrite total)

- [ ] **Step 1: Substituir o conteúdo do arquivo**

Substituir o conteúdo inteiro de `src/components/conversas/ConversasView.tsx` por:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/painel/Icons'
import {
  getConversations,
  getMessages,
  markConversationRead,
  type ConversationRow,
  type MessageRow,
} from '@/actions/conversas'
import { useConversasRealtime } from '@/lib/realtime-conversas'
import { ChatRail } from './ChatRail'
import { FullChat } from './FullChat'
import { previewPrefix, truncatePreview } from './formatters'

interface ConversasViewProps {
  storeId: string
  initialActive: ConversationRow[]
}

function previewFromContent(content: string): string {
  return truncatePreview(content, 120)
}

export function ConversasView({ storeId, initialActive }: ConversasViewProps) {
  const [active, setActive] = useState<ConversationRow[]>(initialActive)
  const [closed, setClosed] = useState<ConversationRow[]>([])
  const [closedLoaded, setClosedLoaded] = useState(false)
  const [closedExpanded, setClosedExpanded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(
    initialActive[0]?.id ?? null,
  )
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [query, setQuery] = useState('')

  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId

  // Load messages whenever selection changes; also mark as read
  useEffect(() => {
    if (!selectedId) {
      setMessages([])
      return
    }
    let cancelled = false
    setLoadingMessages(true)
    getMessages(selectedId).then((rows) => {
      if (cancelled) return
      setMessages(rows)
      setLoadingMessages(false)
    })
    markConversationRead(selectedId)
    setActive((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, unread_count: 0 } : c)),
    )
    setClosed((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, unread_count: 0 } : c)),
    )
    return () => {
      cancelled = true
    }
  }, [selectedId])

  // Lazy-load closed list on first expand
  useEffect(() => {
    if (!closedExpanded || closedLoaded) return
    let cancelled = false
    getConversations('closed').then((rows) => {
      if (cancelled) return
      setClosed(rows)
      setClosedLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [closedExpanded, closedLoaded])

  // Realtime
  useConversasRealtime(storeId, {
    onNewMessage: (msg) => {
      const preview = previewFromContent(msg.content)
      const role = msg.role as ConversationRow['last_message_role']
      const isSelected = msg.conversation_id === selectedIdRef.current

      setActive((prev) => {
        const idx = prev.findIndex((c) => c.id === msg.conversation_id)
        if (idx === -1) return prev
        const updated: ConversationRow = {
          ...prev[idx],
          last_message_at: msg.created_at,
          last_message_preview: preview,
          last_message_role: role,
          unread_count: isSelected ? 0 : prev[idx].unread_count + 1,
        }
        const next = [...prev]
        next.splice(idx, 1)
        return [updated, ...next]
      })

      if (isSelected) {
        setMessages((prev) => [
          ...prev,
          {
            id: msg.id,
            role: msg.role,
            content: msg.content,
            message_type: msg.message_type,
            media_url: null, // signed URL not generated client-side; image/audio will appear empty until a manual refresh. For text this is irrelevant.
            created_at: msg.created_at,
          },
        ])
        markConversationRead(msg.conversation_id)
      }
    },

    onNewConversation: (conv) => {
      const placeholder: ConversationRow = {
        id: conv.id,
        visitor_id: conv.visitor_id,
        visitor_name: `Visitante #${conv.visitor_id.replace(/-/g, '').slice(0, 6)}`,
        status: 'ai_active',
        last_message_at: conv.last_message_at,
        last_message_preview: null,
        last_message_role: null,
        unread_count: 0,
        created_at: conv.created_at,
      }
      setActive((prev) => {
        if (prev.some((c) => c.id === conv.id)) return prev
        return [placeholder, ...prev]
      })
    },

    onConversationUpdated: (conv) => {
      if (conv.status === 'closed') {
        // Move from active to closed (if closed list loaded)
        setActive((prev) => {
          const idx = prev.findIndex((c) => c.id === conv.id)
          if (idx === -1) return prev
          const row = prev[idx]
          if (closedLoaded) {
            setClosed((cprev) => [
              { ...row, status: 'closed' },
              ...cprev.filter((c) => c.id !== conv.id),
            ])
          }
          return prev.filter((c) => c.id !== conv.id)
        })
      } else if (conv.status === 'ai_active') {
        // Reopen (rare): move back from closed
        setClosed((prev) => {
          const idx = prev.findIndex((c) => c.id === conv.id)
          if (idx === -1) return prev
          const row = prev[idx]
          setActive((aprev) => [{ ...row, status: 'ai_active' }, ...aprev])
          return prev.filter((c) => c.id !== conv.id)
        })
      }
    },
  })

  const totalUnread = active.reduce((s, c) => s + c.unread_count, 0)
  const selected =
    active.find((c) => c.id === selectedId) ??
    closed.find((c) => c.id === selectedId) ??
    null

  return (
    <>
      <div className="px-6 pt-6 pb-4 border-b border-ink-200 bg-white/70 backdrop-blur sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div>
            <div className="eyebrow text-ink-500 flex items-center gap-2">
              <span>OPERAÇÃO</span>
              <span className="text-ink-300">/</span>
              <span className="text-brand-600">CONVERSAS</span>
            </div>
            <h1
              className="font-display font-bold text-ink-900 tracking-tight mt-1 flex items-baseline gap-3"
              style={{ fontSize: '24px' }}
            >
              Conversas
              <span className="text-ink-400 font-medium text-[16px]">·</span>
              <span className="text-ink-500 font-medium text-[15px]">
                {active.length} ativa{active.length === 1 ? '' : 's'}
                {totalUnread > 0 && ` · ${totalUnread} não lidas`}
              </span>
              <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-success-700 bg-success-50 ring-1 ring-success-100 px-2 py-0.5 rounded-md ml-1">
                <span className="live-dot" /> ao vivo
              </span>
            </h1>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 grid gap-4" style={{ gridTemplateColumns: '340px 1fr' }}>
        <ChatRail
          active={active}
          closed={closed}
          closedExpanded={closedExpanded}
          onToggleClosed={() => setClosedExpanded((v) => !v)}
          selectedId={selectedId}
          onSelect={setSelectedId}
          query={query}
          onQueryChange={setQuery}
        />
        <FullChat
          conversation={selected}
          messages={messages}
          loading={loadingMessages}
        />
      </div>
    </>
  )
}
```

Nota intencional sobre `media_url: null` no handler `onNewMessage`: o payload Realtime traz `media_path` mas o signed URL precisa ser gerado server-side. Para mensagens de texto (caso comum), isso é irrelevante. Para imagem/áudio chegando ao vivo, o usuário precisaria sair e voltar à conversa pra ver a mídia. Aceitável para MVP; ficar de olho durante o QA.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: sem erro novo. Pode aparecer warning de `Icon` não usado se o ícone direto não for usado — nesse caso, remover o import `Icon` do topo (`ConversasView` não usa Icon diretamente; só `ChatRail` e `FullChat` usam).

Se aparecer "Icon is declared but never used", remover a linha do import:
```ts
import { Icon } from '@/components/painel/Icons'
```

- [ ] **Step 3: Commit**

```bash
git add src/components/conversas/ConversasView.tsx
git commit -m "feat(conversas): rewrite ConversasView with real data + Realtime"
```

---

### Task 11: `page.tsx` — Server Component que busca dados iniciais

**Files:**
- Modify: `src/app/conversas/page.tsx`

- [ ] **Step 1: Substituir conteúdo**

Substituir `src/app/conversas/page.tsx` por:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getConversations } from '@/actions/conversas'
import { ConversasView } from '@/components/conversas/ConversasView'

export const dynamic = 'force-dynamic'

export default async function ConversasPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const initialActive = await getConversations('active')

  return <ConversasView storeId={user.id} initialActive={initialActive} />
}
```

`export const dynamic = 'force-dynamic'` impede Next.js de tentar cachear a página estaticamente (faria pouco sentido pra um inbox).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: sem erro novo.

- [ ] **Step 3: Commit**

```bash
git add src/app/conversas/page.tsx
git commit -m "feat(conversas): wire page.tsx to fetch active conversations server-side"
```

---

### Task 12: QA manual + smoke test

**Files:** (nenhum modificado — só validação)

Pré-requisito: as migrations 019, 020 e 021 precisam estar **aplicadas no banco** (Supabase Dashboard SQL Editor ou CLI). Os arquivos `.sql` no repo são fonte da verdade mas não auto-aplicam. Aplicar nessa ordem.

- [ ] **Step 1: Aplicar as migrations no banco**

No Supabase Dashboard → SQL Editor, executar em ordem o conteúdo de:
1. `supabase/migrations/019_messages_store_id.sql`
2. `supabase/migrations/020_conversations_last_read.sql`
3. `supabase/migrations/021_list_conversations_rpc.sql`

Cada uma deve completar sem erro. Se `019` der erro de `conversations.store_id IS NULL` no `SET NOT NULL` (linha 17), há conversas legadas sem `store_id` — investigar e backfillar antes.

- [ ] **Step 2: Subir dev e logar como dono de uma loja**

Run: `npm run dev`

Abrir `http://localhost:3000/login`, entrar com uma conta que tenha row em `store_settings`. Navegar para `/conversas`.

- [ ] **Step 3: Confirmar lista carrega**

Expected:
- Aparece grupo "ATIVAS" com as conversas `ai_active` da loja, ordenadas por última mensagem desc.
- Cada tile mostra avatar (cor consistente), nome ("Visitante #xxxxxx" se sem lead), preview com prefixo ("Visitante: ..." ou "IA: ..."), hora relativa, chip SITE.
- Topbar mostra "N ativas" e "M não lidas" (se houver).
- Lista vazia: empty state "Nenhuma conversa ainda…".

Se algo não bate, parar e investigar antes de continuar.

- [ ] **Step 4: Confirmar viewer carrega**

Clicar numa conversa.

Expected:
- Right pane mostra header com avatar, nome, pill "IA ATENDENDO", chip SITE, "iniciada Xh".
- Mensagens carregam ordenadas por tempo asc.
- `role='user'` aparece à esquerda; `role='assistant'` à direita com chip sparkle "IA"; `role='system'` centralizado em italic.
- Mídias (imagem/áudio) renderizam se houver `media_path`.
- Footer fixo: "Visualização — Esta conversa é respondida automaticamente pela IA."
- Badge unread some da rail (foi zerado).

- [ ] **Step 5: Confirmar Realtime**

Em outra aba, abrir `/chat/<slug-da-mesma-loja>` (chat público anônimo). Mandar uma mensagem como visitante.

Expected no painel:
- A conversa do visitante sobe para o topo de "ATIVAS".
- Preview da última mensagem atualiza.
- Se a conversa **não** estiver selecionada → badge unread incrementa.
- Se **estiver** selecionada → a bubble aparece direto no viewer (sem reload).
- Em alguns segundos a IA deve responder (via n8n) → outra bubble aparece (assistant) no viewer; preview da rail atualiza pra "IA: ...".

- [ ] **Step 6: Confirmar grupo Encerradas**

Se houver conversas com `status='closed'` na loja, expandir o grupo "ENCERRADAS" no rail.

Expected: lista carrega via `getConversations('closed')` na primeira expansão; depois é client-side.

Se não houver, fazer `UPDATE conversations SET status='closed' WHERE id='<algum-id-de-teste>'` no SQL Editor e refrescar a página.

- [ ] **Step 7: Confirmar isolamento entre lojas**

Criar/usar outra conta de outra loja. Logar com ela. Confirmar que **não vê** conversas da primeira loja — RLS funcionando.

Se vir, há um bug crítico em RLS. Parar e investigar imediatamente. Não fazer deploy.

- [ ] **Step 8: Commit final (se houver pequenos ajustes de QA)**

Se durante o QA você fez correções pontuais (typo, ícone faltando, etc.), commitar agora:

```bash
git add -A
git commit -m "fix(conversas): ajustes de QA"
```

Se nada foi mudado, este step é no-op.

- [ ] **Step 9: Resumo final**

Verificar:
- 9 commits criados ao longo das tasks (1 da 019 já pendente + 1 da 020 + 1 da 021 + 1 dos types + 1 do chat-media + 1 dos formatters + 1 das actions + 1 do realtime hook + 1 do ChatRail + 1 do FullChat + 1 do ConversasView + 1 do page.tsx = ~12).
- `npx tsc --noEmit` passa sem novos erros.
- `npm test` passa.

Se tudo OK, plano concluído. Próximo passo é abrir PR ou continuar com Leva 2 (operador responde, lead capture, etc — fora do escopo deste plano).
