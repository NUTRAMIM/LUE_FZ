# Responder mensagem no chat (estilo WhatsApp)

**Data:** 2026-06-01
**Status:** aprovado para planejamento

## Objetivo

Permitir que o visitante responda a uma mensagem específica do chat, como no WhatsApp:

- **Mobile:** arrastar a bolha para a direita (swipe-to-reply).
- **Desktop:** botão de responder que aparece no hover da bolha.
- A resposta é enviada ao webhook do n8n de forma que o agente entenda que a mensagem está respondendo a uma mensagem anterior.
- A citação (autor + trecho) aparece **persistente** dentro da bolha enviada no histórico e, enquanto compõe, numa **barra acima do input**.
- Tocar na citação **rola até a mensagem original** (com flash de destaque).

## Decisões de produto

1. **Qualquer mensagem pode ser respondida** (do cliente ou do agente), exceto `system`.
2. **Citação persistente:** sobrevive ao reload — requer guardar `reply_to_message_id` no banco.
3. **Webhook recebe o conteúdo inteiro** da mensagem citada (sem truncar), em um objeto `respondendo_a` com `{ id_mensagem, autor, conteudo }`.
4. Tocar na citação rola até a mensagem original.

## Não-objetivos (YAGNI)

- Editar ou apagar mensagem.
- Reply aninhado visual (a bolha citada mostra apenas 1 nível).
- Citação de mídia com miniatura (mostra rótulo textual; ver "Mídia" abaixo).

## Arquitetura

### 1. Banco — `supabase/migrations/035_messages_reply_to.sql`

```sql
ALTER TABLE messages
  ADD COLUMN reply_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;
```

- `ON DELETE SET NULL`: se a mensagem citada for removida, a citação some sem quebrar a resposta.
- Atualizar `src/types/database.ts`: adicionar `reply_to_message_id: string | null` em `Row`, e `reply_to_message_id?: string | null` em `Insert`/`Update` da tabela `messages`.

### 2. Tipo `ChatMessage` e carga de dados

- `ChatMessage` (em `ChatClient.tsx`) ganha `reply_to_message_id: string | null`.
- `ensureConversation` (`src/actions/chat.ts`): incluir `reply_to_message_id` no `select` e no objeto retornado; adicionar o campo ao tipo `ChatBootstrap`.
- Realtime INSERT (`ChatClient.tsx`): ler `reply_to_message_id` do `payload.new` e incluir no `ChatMessage` montado.

### 3. Resolução da citação no cliente (constraint de segmentação)

A citação (autor + trecho exibido na bolha e na barra) é resolvida **no cliente**, procurando a mensagem citada na lista em memória — sem fetch extra.

**Constraint não óbvio:** mensagens da IA que chegam **ao vivo** são quebradas em segmentos por `splitAIMessage`, e cada bolha recebe um id sintético `${realId}-seg-${idx}` (ver `ChatClient.processAIQueue`). Já no reload, `ensureConversation` carrega a linha completa do banco com o id real e conteúdo inteiro (sem segmentar). Portanto:

- Ao **iniciar** uma resposta, normalizar o id do alvo removendo o sufixo `-seg-\d+$` para obter o id real do banco. Só esse id normalizado é gravado em `reply_to_message_id` (FK válida).
- Ao **resolver** a citação para exibição, construir um `Map` sobre `state.messages` chaveado pelo id normalizado (primeira ocorrência vence). O lookup usa o `reply_to_message_id` (já normalizado). Isso cobre tanto o caso reload (id real → mensagem completa) quanto o ao vivo (id normalizado → primeiro segmento).
- O trecho exibido na UI é truncado com reticências; o webhook usa o conteúdo completo buscado no servidor (ver item 5), então a possível diferença entre "primeiro segmento" e "conteúdo completo" não afeta o agente.

Helper puro: `normalizeMessageId(id: string): string` → remove `-seg-\d+$`. Testável.

### 4. Estado de resposta no `ChatClient`

- Novo estado `replyTo: ChatMessage | null`.
- Handler `handleStartReply(message)` → `setReplyTo(message)`.
- Handler `handleCancelReply()` → `setReplyTo(null)`.
- `storeName` é passado para `MessageList`/`MessageBubble`/`ChatInput` para rotular o autor citado.
- Resolver de citação (`Map` do item 3) passado a `MessageList`.

### 5. `sendMessage` (server action) + webhook

- `SendMessageInput` ganha `replyToMessageId?: string`.
- O `insert` grava `reply_to_message_id: input.replyToMessageId ?? null`.
- Antes de `dispatchToN8n`, se houver `replyToMessageId`, buscar a mensagem citada (`select id, role, content`) e montar:

```ts
respondendo_a: {
  id_mensagem: quoted.id,
  autor: quoted.role === 'user' ? 'cliente' : 'loja',
  conteudo: quoted.content, // inteiro, sem truncar
}
```

- `N8nDispatchPayload` (`src/lib/n8n.ts`) ganha campo opcional:

```ts
respondendo_a?: {
  id_mensagem: string
  autor: 'cliente' | 'loja'
  conteudo: string
}
```

- Helper puro `replyAuthorForRole(role): 'cliente' | 'loja'` (user→cliente; assistant/operator→loja). Testável e reutilizado pela UI (mapeando para rótulo).

### 6. `MessageBubble` — citação, gatilhos e navegação

- **Citação na bolha:** se `message.reply_to_message_id` resolve para uma mensagem, renderizar no topo da bolha um bloco clicável: borda colorida à esquerda, rótulo do autor ("Você" se o citado é `user`; senão `storeName`) e trecho truncado com reticências. Clique → navega até a original (item 7).
- **Container com `data-msgid={normalizeMessageId(message.id)}`** para o alvo de scroll.
- **Desktop (hover):** botão de responder (ícone seta-curva) visível ao passar o mouse na bolha; `onClick` → `onStartReply(message)`.
- **Mobile (swipe):** hook `useSwipeToReply` com pointer events.

### 7. Navegação ao tocar na citação

- No clique da citação, `querySelector('[data-msgid="<id>"]')` dentro do container da lista e `scrollIntoView({ behavior: 'smooth', block: 'center' })`.
- Flash de destaque: estado `highlightedId` no `MessageList` (ou via classe temporária) que aplica uma animação CSS curta (~1s) na bolha alvo, depois limpa.
- Se o alvo não existir (ex.: citada não carregada), no-op silencioso.

### 8. Hook `useSwipeToReply`

- Pointer events na linha da bolha: `pointerdown` registra início; `pointermove` calcula `dx`.
- Só ativa em arrasto majoritariamente horizontal (`|dx| > |dy|`) para não brigar com o scroll vertical; arrasto só para a direita (`dx > 0`), com `translateX` limitado (ex.: máx ~80px) e resistência.
- Ícone de responder revelado atrás da bolha, opacidade proporcional ao `dx`.
- Função pura de limiar `shouldTriggerReply(dx: number): boolean` (ex.: `dx >= 60`). Testável.
- Ao soltar: se passou do limiar, dispara `onStartReply` e faz snap-back animado; senão só volta.
- Só habilitado em ponteiro coarse (toque). Em desktop (hover/fine) o gatilho é o botão.

### 9. Barra de resposta acima do input (`ChatInput`)

- Props novas: `replyTo: ChatMessage | null`, `replyAuthorLabel: string`, `onCancelReply: () => void`.
- Quando `replyTo` setado: barra acima do `textarea` com borda colorida à esquerda, nome do autor, trecho cortado com reticências e botão "X" para cancelar.
- `handleSend` passa `replyToMessageId: normalizeMessageId(replyTo.id)` ao `sendMessage`; ao concluir (sucesso) limpa via `onCancelReply()`.
- A bolha local otimista (`onLocalAdd`) inclui `reply_to_message_id` para a citação aparecer na hora.

### Mídia

Ao responder uma mensagem de imagem/áudio, o trecho textual pode ficar vazio. Nesse caso o rótulo da citação mostra `📷 Imagem` / `🎤 Áudio` (derivado de `message_type`), tanto na bolha quanto na barra. No webhook, `conteudo` recebe o `content` real (pode ser string vazia) — aceitável; o agente recebe `id_mensagem` e `autor` de qualquer forma.

## Fluxo de dados (resumo)

1. Usuário arrasta/clica responder → `ChatClient.replyTo = message`.
2. Barra acima do input mostra a citação.
3. Usuário digita e envia → `ChatInput` chama `sendMessage({ ..., replyToMessageId })`.
4. Bolha otimista com `reply_to_message_id` aparece (citação já visível).
5. `sendMessage` grava a mensagem com FK, monta `respondendo_a` (conteúdo inteiro) e dispara ao n8n.
6. Realtime confirma o INSERT; `replaceTemp` troca o id temпорário pelo real.
7. No reload, `ensureConversation` recarrega com `reply_to_message_id` e a citação persiste.

## Testes (unit, padrão `__tests__`)

- `normalizeMessageId`: remove `-seg-N`, no-op em id real.
- `replyAuthorForRole`: user→cliente, assistant/operator→loja.
- Rótulo de citação para mídia: image→`📷 Imagem`, audio→`🎤 Áudio`, text→trecho.
- `shouldTriggerReply`: limiar de disparo do swipe.
- Truncamento do trecho exibido (reticências em conteúdo longo, intocado em curto).

Sem testes de gesto/DOM E2E nesta fase (verificação manual no navegador mobile/desktop).

## Arquivos afetados

- `supabase/migrations/035_messages_reply_to.sql` (novo)
- `src/types/database.ts`
- `src/actions/chat.ts` (`ensureConversation`, `sendMessage`, `SendMessageInput`, `ChatBootstrap`)
- `src/lib/n8n.ts` (`N8nDispatchPayload`)
- `src/app/chat/[slug]/ChatClient.tsx` (estado `replyTo`, `ChatMessage`, resolver)
- `src/app/chat/[slug]/components/MessageList.tsx` (resolver, highlight, scroll)
- `src/app/chat/[slug]/components/MessageBubble.tsx` (citação, botão, swipe)
- `src/app/chat/[slug]/components/ChatInput.tsx` (barra de resposta)
- `src/app/chat/[slug]/components/useSwipeToReply.ts` (novo)
- `src/app/chat/[slug]/components/reply-helpers.ts` (novo: `normalizeMessageId`, `replyAuthorForRole`, rótulo de mídia, `shouldTriggerReply`, truncamento)
- `src/app/chat/[slug]/components/__tests__/reply-helpers.test.ts` (novo)
