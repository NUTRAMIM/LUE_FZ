# Menu Conversas — read-only viewer com dados reais

**Data:** 2026-05-14
**Branch base:** `feat/painel-redesign-real-model`

## Objetivo

Substituir os dados mockados de `ConversasView.tsx` por dados reais do banco. O painel `/conversas` vira uma ferramenta de **observabilidade read-only**: o dono da loja assiste em tempo real as conversas que a IA tem com visitantes do chat público (`/chat/<slug>`). Não envia mensagens, não muda status, não escala — só visualiza.

## Decisões de produto

- **Modelo de operação:** todas as conversas são respondidas pela IA. O humano só observa.
- **Sem input no rodapé**, sem botões Assumir/Encerrar/Transferir/Nota, sem quick replies, sem FILA, sem card "Sugestão da IA", sem banner SLA, sem indicadores online/typing.
- **Status visíveis:** apenas `IA ATENDENDO` (`ai_active`) e `ENCERRADA` (`closed`). Pills `attending`, `waiting`, `sla`, `closing` do mock são removidas.
- **Canal:** chip hardcoded "SITE" — única origem hoje. Não introduz coluna `channel`.
- **Nome do visitante:** se `conversations.lead_id` existir → `leads.name`. Senão, fallback `Visitante #{primeiros 6 chars do visitor_id}`.
- **Lead capture continua responsabilidade do n8n** — fora do escopo deste menu.
- **Unread:** mensagens com `created_at > conversations.last_read_at`, contando **todas** as roles (visitor + assistant). Conceito: "tem atividade nova aqui".

## Mudanças de banco

### Migration 019 (já criada — referência)

`supabase/migrations/019_messages_store_id.sql` já adiciona `messages.store_id` denormalizado, com trigger `BEFORE INSERT` que popula a partir de `conversations.store_id`. Isso destrava:
- Realtime filtrado por loja (`filter: store_id=eq.<id>`)
- RLS por dono (`messages_read_owner: auth.uid() = store_id`)
- Índice `idx_messages_store_created (store_id, created_at DESC)` para o RPC abaixo

### Migration 020 — `conversations.last_read_at`

```sql
-- 020_conversations_last_read.sql
-- Tracks when the store owner last viewed a conversation, so we can compute
-- an unread-messages counter per conversation in the painel.

ALTER TABLE conversations
  ADD COLUMN last_read_at TIMESTAMPTZ;

UPDATE conversations
SET last_read_at = COALESCE(last_message_at, created_at);
```

Sem `NOT NULL` — backfill cobre o existente; novas conversas nascem com NULL e o RPC trata via `COALESCE(c.last_read_at, c.created_at)`.

### Migration 021 — RPC `list_conversations_for_store`

```sql
-- 021_list_conversations_rpc.sql
-- RPC para o menu de conversas: lista de conversas da loja com preview da
-- última mensagem, contador de não lidas e nome do lead num único shot.
-- SECURITY INVOKER => respeita RLS (auth.uid() = store_id em conversations e messages).

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

Aproveita `DISTINCT ON` (índice `idx_messages_conversation` de migration 002) e o índice `idx_messages_store_created` da migration 019.

### Tipos TS

Atualizar `src/types/database.ts`:
- `conversations.Row/Insert/Update`: adicionar `last_read_at: string | null` (Insert/Update opcional).

## Backend — server actions

Arquivo novo: `src/actions/conversas.ts`.

Todas as actions usam **server client autenticado** (não o admin). RLS de migration 019 (`messages_read_owner`) e RLS existente de `conversations` (`conversations_read_owner`) fazem o trabalho de scoping por loja.

### Tipos públicos

```ts
export interface ConversationRow {
  id: string
  visitor_id: string
  visitor_name: string             // resolvido server-side (lead_name OU "Visitante #xxxxxx")
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
  media_url: string | null         // signed URL (TTL 24h)
  created_at: string
}
```

### `getConversations(filter: 'active' | 'closed'): Promise<ConversationRow[]>`

1. Pega `user.id` via `supabase.auth.getUser()`. Sem user → retorna `[]`.
2. `supabase.rpc('list_conversations_for_store', { p_store_id: user.id, p_status: filter === 'active' ? 'ai_active' : 'closed' })`.
3. Mapeia cada linha: se `lead_name` truthy usa direto, senão `Visitante #${visitor_id.slice(0, 6)}`. Preview trunca em 120 chars.

### `getMessages(conversationId: string): Promise<MessageRow[]>`

1. Select em `messages` filtrado por `conversation_id`, ordenado `created_at asc`, limit 500. RLS protege.
2. Gera signed URLs para `media_path` reutilizando lógica de `signedReadUrl` de `src/actions/chat.ts` (extrair para `src/lib/chat-media.ts`).

### `markConversationRead(conversationId: string): Promise<{ success: boolean }>`

`UPDATE conversations SET last_read_at = now() WHERE id = $1`. RLS `conversations_update` exige autenticação (definido em migration 002). Fire-and-forget na UI.

## Frontend

### Estrutura de arquivos

```
src/app/conversas/page.tsx              ← Server Component, carrega user + initial data
src/components/conversas/
  ConversasView.tsx                     ← Client Component (rewrite total)
  ChatRail.tsx                          ← lista + grupos + busca
  FullChat.tsx                          ← viewer da conversa selecionada
  formatters.ts                         ← avatar color/initials, time formatting, preview prefix
src/actions/conversas.ts                ← actions descritas acima
src/lib/realtime-conversas.ts           ← hook useConversasRealtime(storeId, handlers)
src/lib/chat-media.ts                   ← signedReadUrl extraído de chat.ts
```

### `page.tsx` (Server Component)

```tsx
export default async function ConversasPage() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const initialActive = await getConversations('active')
  return <ConversasView storeId={user.id} initialActive={initialActive} />
}
```

### `ConversasView.tsx` — estado

```ts
const [active, setActive] = useState<ConversationRow[]>(initialActive)
const [closed, setClosed] = useState<ConversationRow[]>([])
const [closedExpanded, setClosedExpanded] = useState(false)
const [selectedId, setSelectedId] = useState<string | null>(initialActive[0]?.id ?? null)
const [messages, setMessages] = useState<MessageRow[]>([])
const [query, setQuery] = useState('')
const [loadingMessages, setLoadingMessages] = useState(false)
```

- `useEffect` em `selectedId`: chama `getMessages`, depois `markConversationRead` (zera `unread_count` da row localmente).
- `useEffect` em `closedExpanded`: na primeira expansão (`closed.length === 0`), chama `getConversations('closed')`.

### Realtime — `useConversasRealtime(storeId, handlers)`

Cria 2 channels Supabase com cleanup:

```ts
// channel A: messages
supabase.channel(`messages:${storeId}`)
  .on('postgres_changes', {
    event: 'INSERT', schema: 'public', table: 'messages',
    filter: `store_id=eq.${storeId}`,
  }, payload => handlers.onNewMessage(payload.new))
  .subscribe()

// channel B: conversations
supabase.channel(`conversations:${storeId}`)
  .on('postgres_changes', {
    event: '*', schema: 'public', table: 'conversations',
    filter: `store_id=eq.${storeId}`,
  }, payload => {
    if (payload.eventType === 'INSERT') handlers.onNewConversation(payload.new)
    if (payload.eventType === 'UPDATE') handlers.onConversationUpdated(payload.new)
  })
  .subscribe()
```

Handlers em `ConversasView`:
- **`onNewMessage(msg)`:**
  - Update `active[i]` da conversa pai: `last_message_at = msg.created_at`, `last_message_preview = msg.content.slice(0, 120)`, `last_message_role = msg.role`. Re-ordena pro topo.
  - Se `msg.conversation_id === selectedId`: append em `messages`, chama `markConversationRead` (já tá vendo).
  - Senão: `unread_count += 1`.
- **`onNewConversation(conv)`:** prepend em `active` com `unread_count = 0` e preview vazio (será preenchido pelo `onNewMessage` que vem logo depois).
- **`onConversationUpdated(conv)`:** se `status` virou `closed` e `closedExpanded`, move da `active` pra `closed`. Senão só remove de `active`.

### `ChatRail`

- Dois grupos: **ATIVAS** (sempre aberto) e **ENCERRADAS** (colapsado por default; expande dispara carregamento se vazio).
- Header: "Caixa de entrada" + badge total.
- Busca client-side: filtra por `visitor_name` ou `last_message_preview` (case-insensitive).
- Cada tile mostra:
  - Avatar circular: cor derivada de `hashColor(visitor_id)` (paleta fixa), iniciais do `visitor_name`.
  - Nome (bold se unread > 0).
  - Hora da última msg (relativa: "agora", "5min", "2h", "ontem", "12/05").
  - Preview com prefixo: `"Visitante: ..."` se `last_message_role === 'user'`, `"IA: ..."` se `'assistant'`, sem prefixo se `'system'`.
  - Chip SITE.
  - Badge unread se `unread_count > 0`.
- Empty state: "Nenhuma conversa ainda. Quando alguém chamar pelo chat público, ela aparece aqui."

### `FullChat`

- Header: avatar grande, `visitor_name`, `StatusPill` (`IA ATENDENDO` ou `ENCERRADA`), chip SITE, tempo desde `created_at`.
- Sem botões de ação no topo (Nota/Transferir/Encerrar removidos).
- Body: lista de bubbles ordenadas por `created_at asc`:
  - `role === 'user'` → bubble esquerda.
  - `role === 'assistant'` → bubble IA direita (com chip sparkle).
  - `role === 'operator'` → bubble direita normal (futuro-proof; hoje não é gerado).
  - `role === 'system'` → bubble cinza centralizada.
  - `message_type === 'image'`: render `<img src={media_url}>` no lugar do `content`.
  - `message_type === 'audio'`: render `<audio controls src={media_url}>`.
- Footer banner fixo (substitui textarea): "Visualização — esta conversa é respondida automaticamente pela IA."
- Empty state quando `selectedId === null`: "Selecione uma conversa pra visualizar."
- Loading state durante `loadingMessages`: skeleton de 3 bubbles.

### Topbar

- "Conversas" + contadores em tempo real:
  - `${active.length} ativas`
  - `${active.reduce((s,c)=>s+c.unread_count, 0)} não lidas` (se > 0)
- Botões "Filtros" e "Nova conversa" do mock são **removidos** (não há fluxo de criar conversa pelo painel).
- Indicador live (dot pulsante) mantido.

## O que sai da UI atual

| Removido | Motivo |
|----------|--------|
| `FILA` + `QueueItem` + `FilaEntry` | Sem conceito de fila no modelo view-only |
| Card "Sugestão da IA" | Removido por decisão de produto |
| Textarea + send + mic + paperclip + image button + quick replies | Sem envio do operador |
| Banner SLA, botão "Marcar como urgente" | Sem SLA — IA responde |
| Botões "Nota", "Transferir", "Encerrar", "Assumir conversa" | Sem ações de operador |
| Tipo `Channel` (IG/WA) variantes | Apenas SITE existe |
| Status `attending`, `waiting`, `sla`, `closing` | Não derivam do schema view-only |
| `online`, `typing` indicators | Sem presence |
| Botões "Filtros", "Nova conversa" no topbar | Sem filtros adicionais, sem criação pelo painel |

## Fora do escopo (futuro)

- **Lead capture automático** pelo n8n para popular `conversations.lead_id` e exibir nomes reais em vez de "Visitante #xxxxxx".
- **Integrações WA/Instagram** — adicionariam `channel TEXT` em `conversations` e habilitariam os chips dos respectivos canais.
- **Operador respondendo** (envia mensagens, troca status, assume/encerra) — implica reverter a remoção do input e dos botões de ação.
- **Sugestão da IA** sob demanda — workflow n8n dedicado.
- **Presence** (online/typing) — Supabase Realtime Presence.
- **Filtros e busca server-side** — hoje 200 conversas client-side cobre.

## Riscos / pegadinhas

- **Migration 020 não exige NOT NULL** — código deve sempre usar `COALESCE(last_read_at, created_at)`. O RPC já faz; `markConversationRead` sempre escreve `now()`.
- **Lead join via PostgREST** dentro do RPC: testar que `leads.name` aparece quando `lead_id` existe e é NULL quando não.
- **Realtime + Supabase RLS:** o cliente precisa estar autenticado pra Realtime entregar eventos com RLS — `auth.uid()` precisa bater com `store_id` do filtro. Usar `supabase` browser client com sessão ativa.
- **Cleanup de channels:** se o componente desmontar, ambos canais precisam ser removidos. `useConversasRealtime` retorna cleanup que chama `supabase.removeChannel(...)` para os dois.
- **Race entre `onNewConversation` e `onNewMessage`:** a primeira mensagem pode chegar antes do INSERT da conversa propagar (improvável mas possível). Tratar `onNewMessage` para conversa desconhecida fazendo refetch leve via `getConversations('active')` (debounced) ou só ignorar até o INSERT chegar.
- **Realtime payload não tem `visitor_name` resolvido:** o evento de `conversations` carrega a row crua (`lead_id` mas não `leads.name`). Estratégia: em `onNewConversation`, usar fallback "Visitante #xxxxxx" — lead capture acontece depois via UPDATE. Em `onConversationUpdated`, se `lead_id` ficou setado e antes era null, refetchar `getConversations('active')` debounced (rara, custo aceitável). Alternativa mais limpa para o futuro: chamar o RPC com `WHERE id = <conv_id>` para single-row refetch.
- **Realtime publication:** `messages` e `conversations` já estão em `supabase_realtime` (migration 002). Sem trabalho extra.
