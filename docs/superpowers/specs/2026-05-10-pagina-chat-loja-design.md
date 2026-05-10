# Página de Chat da Loja — Design

**Data:** 2026-05-10
**Branch sugerida:** `feat/chat-loja`
**Status:** spec aprovada, pronta para plano

## Objetivo

Entregar uma página pública `/chat/<slug>` com visual estilo WhatsApp onde clientes finais conversam com o atendimento (IA + lojista no futuro) de uma loja específica. A loja expõe esta URL no seu painel `/loja` para divulgar aos clientes. As mensagens trafegam via webhook para o n8n; respostas chegam de volta via Supabase Realtime.

**Não-objetivos desta entrega:**
- Tela do lojista responder/visualizar conversas em tempo real (`/painel`) — fica para próxima feature.
- Suporte multi-canal (WhatsApp/Instagram).
- Suite de testes E2E (Playwright/Cypress).

## Decisões já tomadas (brainstorming)

| Pergunta | Decisão |
|---|---|
| Modelo de risco | Cliente A nunca vê conversa de B; URL pública não expõe área autenticada do lojista |
| Identificação do visitante | Anônimo via cookie httpOnly assinado; IA captura contato durante a conversa |
| Tipos de mensagem | Texto + imagem + áudio (estilo WhatsApp completo) |
| Resposta da IA | Supabase Realtime (n8n insere em `messages`, frontend escuta) |
| Slug da loja | ID interno curto (8 chars `[a-z0-9]`) — coluna `chat_slug` em `store_settings` |
| Onde expor a URL | Card no topo de `/loja` |
| Escopo | Só lado do cliente; painel do lojista responder fica para depois |
| Arquitetura | Opção B — server actions + endpoints `/api/chat/*` (não SDK direto no client) |

## Arquitetura

### Componentes novos

- `src/app/chat/[slug]/page.tsx` — server component. Resolve loja, lê cookie, devolve dados iniciais.
- `src/app/chat/[slug]/ChatClient.tsx` — client component. UI tipo WhatsApp + Realtime + gravação de áudio.
- `src/app/chat/[slug]/components/` — `ChatHeader`, `MessageList`, `MessageBubble`, `ChatInput`.
- `src/actions/chat.ts` — server actions: `sendMessage()`, `getUploadUrl()`, `ensureConversation()`.
- `src/lib/visitor-cookie.ts` — gera/valida cookie `lue_visitor` assinado com HMAC-SHA256.
- `src/lib/chat-slug.ts` — geração e helpers de slug.
- `src/components/loja/ChatUrlCard.tsx` — card de URL no `/loja`.

### Componentes alterados

- `src/middleware.ts` — adicionar `/chat` à lista de rotas públicas no matcher (junto com `widget|api`).
- `src/lib/n8n.ts` — expandir payload (ver Seção "Webhook").
- `src/app/loja/page.tsx` — incluir `<ChatUrlCard />` no topo.

### Schema (migration `012_chat_slug_and_media.sql`)

```sql
-- 1. Slug curto único por loja
ALTER TABLE store_settings
  ADD COLUMN chat_slug TEXT UNIQUE;

UPDATE store_settings
SET chat_slug = lower(substring(md5(random()::text || id::text) for 8))
WHERE chat_slug IS NULL;

ALTER TABLE store_settings
  ALTER COLUMN chat_slug SET NOT NULL;

CREATE INDEX idx_store_settings_chat_slug ON store_settings (chat_slug);

-- 2. conversations: ligar à loja
ALTER TABLE conversations
  ADD COLUMN store_id UUID REFERENCES store_settings(id) ON DELETE CASCADE;

CREATE INDEX idx_conversations_store_visitor
  ON conversations (store_id, visitor_id);

-- 3. messages: tipo + path da mídia
ALTER TABLE messages
  ADD COLUMN message_type TEXT NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text', 'image', 'audio')),
  ADD COLUMN media_path TEXT;

-- 4. RLS de conversations: lojista só vê as próprias (preparando painel futuro)
DROP POLICY "conversations_read" ON conversations;
CREATE POLICY "conversations_read_owner" ON conversations
  FOR SELECT USING (auth.uid() = store_id);
CREATE POLICY "conversations_read_anon" ON conversations
  FOR SELECT USING (auth.role() = 'anon');

-- 5. Trigger para gerar chat_slug em novos store_settings
CREATE OR REPLACE FUNCTION generate_chat_slug()
RETURNS TRIGGER AS $$
DECLARE
  candidate TEXT;
  attempt INT := 0;
BEGIN
  IF NEW.chat_slug IS NOT NULL THEN
    RETURN NEW;
  END IF;
  LOOP
    candidate := lower(substring(md5(random()::text || NEW.id::text || attempt::text) for 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM store_settings WHERE chat_slug = candidate);
    attempt := attempt + 1;
    IF attempt >= 5 THEN
      candidate := lower(substring(replace(gen_random_uuid()::text, '-', '') for 8));
      EXIT;
    END IF;
  END LOOP;
  NEW.chat_slug := candidate;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_store_settings_chat_slug
  BEFORE INSERT ON store_settings
  FOR EACH ROW EXECUTE FUNCTION generate_chat_slug();
```

### Bucket Storage

- Bucket privado `chat-media`.
- Path: `{store_id}/{conversation_id}/{message_id}.{ext}`.
- Read sempre via signed URL (TTL 24h) gerada server-side.

## Modelo de segurança

### Cookie `lue_visitor`

- `httpOnly`, `secure`, `sameSite=lax`, `path=/chat`, `maxAge=365 dias`.
- Valor: `{visitor_id}.{hmac_sha256(visitor_id, SESSION_SECRET)}`.
- `visitor_id` = UUID v4 gerado server-side na primeira visita.
- Nova env var: `SESSION_SECRET` (32+ bytes random, base64).
- Validação HMAC antes de qualquer ação. Inválido ou ausente → gera novo (= conversa nova).

### Por que isolamento funciona

1. O `conversation_id` que o visitante conhece é exclusivamente o que o servidor lhe entregou. Não vem de input do cliente em nenhum endpoint.
2. Server actions sempre rederivam `(store_id, visitor_id)` do cookie e do slug — cliente nunca passa `conversation_id` ou `visitor_id` no body.
3. RLS de `messages` segue `select USING (true)`, mas o `conversation_id` é UUID v4 (122 bits aleatórios), inadivinhável.
4. Realtime subscription do client é montada com filter `conversation_id=eq.<X>` recebido do server. Trocar `<X>` no DevTools faz a subscription apontar para um id que o usuário não conhece e não pode adivinhar — sem efeito prático.
5. Cookie é httpOnly, JS no browser não lê e não troca.

### Isolamento da área autenticada

- Páginas `/chat/*` usam Supabase **anon key**, nunca tocam cookies de sessão `sb-*`.
- Middleware explicitamente não roda lógica de auth para `/chat/*`.
- 404 em `/chat/<slug>` inexistente é genérico (`notFound()` do Next), sem revelar se loja existe.

### Rate limit (mínimo)

- 30 mensagens/min por `visitor_id`, 100/h por IP.
- Implementação: tabela `rate_limit (key TEXT, window_start TIMESTAMPTZ, count INT)` com cleanup periódico.
- Violação: HTTP 429 + mensagem inline "Muitas mensagens. Aguarde um instante."

## Página `/chat/[slug]` — UI

### Layout (mobile-first, full-screen)

```
┌─────────────────────────────────┐
│ ← [avatar] Nome da Loja         │  header verde-escuro #075E54
│           online                │
├─────────────────────────────────┤
│                                 │  background padrão WhatsApp #ECE5DD
│  [bolha cinza ←]                │  (cor + leve textura)
│  Olá! Como posso ajudar?        │
│                          14:32  │
│                                 │
│              [bolha verde →]    │  user #DCF8C6
│              quero uma camiseta │
│                          14:33  │
├─────────────────────────────────┤
│ [📎] [____input____] [🎤|➤]    │  footer branco
└─────────────────────────────────┘
```

### Componentes internos

- `ChatHeader` — nome da loja, status fixo "online".
- `MessageList` — auto-scroll ao final em nova mensagem; carrega últimas 200 inicialmente; sem virtualização nesta versão.
- `MessageBubble` — variantes:
  - `text` — bolha + horário.
  - `image` — thumbnail clicável (abre lightbox em fullscreen).
  - `audio` — player com play/pause + barra de progresso simples (sem waveform na v1).
- `ChatInput` — textarea auto-grow (max 4 linhas), botão anexo (📎), botão dinâmico que vira mic (🎤) quando vazio e enviar (➤) quando tem texto.

### Gravação de áudio

- API `MediaRecorder` (formato `webm;codecs=opus`).
- Hold-to-record: segura o botão para gravar, solta para finalizar.
- Timer durante gravação, botão cancelar (deslizar pra esquerda no mobile, X no desktop).
- Limites: max 60s, max 2MB.
- Preview antes de enviar (tocar/cancelar/enviar).
- Detecção: se `navigator.mediaDevices?.getUserMedia` ausente, esconde botão mic.

### Anexo de imagem

- `<input type="file" accept="image/jpeg,image/png,image/webp">`.
- Limites: max 5MB; redimensiona client-side se largura >1920px (canvas).
- Preview com botão remover antes de enviar.

### Estado

- `useReducer` simples: `{ messages, sending, recording, error, conversationId }`.
- Sem libs de estado externas.

### Realtime

- `useEffect` na mount cria channel filtrado por `conversation_id=eq.${id}`, evento INSERT.
- Cleanup na unmount.
- Reconect automático do supabase-js. Após 30s sem reconectar: banner "reconectando..." + refetch via server action.

## Webhook (`dispatchToN8n` expandido)

```ts
export async function dispatchToN8n(payload: {
  mensagem: string             // conteúdo textual; vazio se mídia sem caption
  id_mensagem: string          // UUID da row em messages (idempotência)
  id_conversa: string          // UUID da conversation
  nome_loja: string            // store_settings.store_name
  id_loja: string              // store_settings.id (= auth.users.id)
  tipo_de_mensagem: 'text' | 'image' | 'audio'
  media_url?: string           // signed URL TTL 24h, presente se tipo != text
}): Promise<Response | null>
```

**Headers:** `Content-Type: application/json`, `X-Webhook-Secret: ${N8N_WEBHOOK_SECRET}`.

**Resposta esperada:** 2xx. n8n NÃO precisa responder com a resposta da IA — insere direto em `messages` via service_role e o Realtime entrega ao cliente.

**Falha 5xx:** log no servidor + insere mensagem `role:'system'` "Estamos com instabilidade. Sua mensagem foi recebida." Sem retry automático nesta versão.

**Idempotência:** n8n recebe `id_mensagem` estável; em retries deve detectar duplicata e ignorar.

## Card de URL no `/loja`

```
┌──────────────────────────────────────────────────┐
│  💬 URL do seu chat                              │
│                                                   │
│  ┌──────────────────────────────────┐            │
│  │ https://lue.app/chat/a3f9k2      │ [Copiar] │
│  └──────────────────────────────────┘            │
│                                                   │
│  Compartilhe este link com seus clientes para    │
│  iniciarem uma conversa com o atendimento da     │
│  sua loja.                                        │
│                                                   │
│  [📱 Ver QR Code]                                │
└──────────────────────────────────────────────────┘
```

- `<ChatUrlCard />` é server component; lê `chat_slug` do `store_settings` do user autenticado.
- URL completa montada com nova env var `NEXT_PUBLIC_APP_URL` (fallback `window.location.origin`).
- Botão "Copiar" = client component pequeno usando `navigator.clipboard.writeText` com feedback "Copiado!" por 2s.
- "Ver QR Code" abre modal/expande inline um SVG via lib `qrcode` (~30kb).
- Posição: acima do form atual de `/loja`, antes de "Nome da Loja".

## Erros e edge cases

| Cenário | Tratamento |
|---|---|
| Slug não existe (`/chat/xxxx`) | `notFound()` do Next → 404 padrão. Sem dica se loja existe. |
| Cookie inválido/ausente | Gera novo `visitor_id`, seta cookie, inicia conversa nova. Nunca erro. |
| n8n offline (5xx) | Mensagem do user fica salva. Insere `role:'system'` "Estamos com instabilidade. Sua mensagem foi recebida." Sem retry nesta versão. |
| Upload de mídia >limite | Validação client-side primeiro; server re-valida em `getUploadUrl`. Erro inline. |
| MediaRecorder não suportado (Safari iOS antigo) | Esconde botão mic na mount. |
| Permissão de microfone negada | Toast: "Permita acesso ao microfone para gravar áudio." |
| Conversa órfã (loja deletada) | `ON DELETE CASCADE`. Cliente cai em 404 na próxima ação. |
| Realtime desconecta | Auto-reconnect; após 30s, banner + refetch. |
| Race: 2 mensagens muito rápidas | `id_mensagem` único + ordem por `created_at`. |
| XSS via conteúdo de mensagem | React escapa por padrão. Nunca `dangerouslySetInnerHTML`. |
| Slug colide na geração | Função SQL: 5 retries; depois UUID truncado. Probabilidade ~0 (36^8). |
| Rate limit excedido | HTTP 429 + erro inline. |

## Estratégia de testes

### Manuais (lista de teste)

1. Lojista entra em `/loja` → vê URL e copia → cola em aba anônima → carrega `/chat/<slug>`.
2. Manda "oi" → aparece na tela do cliente, dispara n8n (verificar com webhook.site temporário).
3. n8n insere resposta via SQL → resposta aparece em <1s no cliente sem reload.
4. Abre `/chat/<slug>` em outro browser → conversa diferente (visitor isolado).
5. URL inválida `/chat/zzzz` → 404.
6. Anexa imagem → preview → envia → aparece como bolha clicável.
7. Grava áudio 5s → preview → envia → aparece como player que toca.
8. Tira o cookie no DevTools → próxima mensagem inicia conversa nova (não quebra).
9. Tenta editar `conversation_id` no payload de uma request → server ignora (vem só do cookie).

### Automatizados (mínimo)

- Unit test `src/lib/visitor-cookie.ts` — assinar/validar HMAC, edge cases (assinatura quebrada, sem ponto, etc.).
- Unit test `dispatchToN8n` — shape do payload; erro silencioso quando URL ausente; header secret presente quando configurado.

Sem framework de E2E nesta entrega.

## Variáveis de ambiente novas

- `SESSION_SECRET` — base64, 32+ bytes. Usado para HMAC do cookie `lue_visitor`.
- `NEXT_PUBLIC_APP_URL` — base URL pública (ex.: `https://lue.app`). Para montar URL do chat no card.

## Ordem de implementação (sugerida; o plano detalha)

1. Migration `012` + bucket Storage `chat-media`.
2. `src/lib/visitor-cookie.ts` + tests.
3. Server actions em `src/actions/chat.ts`.
4. `src/lib/n8n.ts` expandido + tests.
5. Página `/chat/[slug]` server component.
6. `ChatClient.tsx` + componentes (`Header`, `MessageList`, `MessageBubble`, `ChatInput`).
7. Realtime subscription.
8. Upload + gravação de mídia.
9. `ChatUrlCard` + integração em `/loja`.
10. Middleware (liberar `/chat`).
11. Manual test pass.
