# Chat: Status de Entrega, Indicador "Digitando" e Enter no Input — Design

**Data:** 2026-05-29
**Status:** Aprovado para implementação
**Escopo:** Três mudanças visuais e de comportamento no chat público (`/chat/[slug]`), todas no lado do lead:

- **A.** `Enter` no campo de mensagem passa a quebrar linha; o único jeito de enviar é o botão (avião).
- **B.** Toda mensagem do lead exibe um ciclo de status no canto inferior direito do balão: relógio (0–3s) → ticks cinzas (3–13s) → tick azul (≥13s). Mensagens já no banco ao carregar a página mostram tick azul fixo, sem animação.
- **C.** Quando o ciclo do lead atinge 16s (3s após o tick virar azul), aparece um indicador "digitando…" em dois lugares: subtitle do header da loja (`online` → `digitando…`) e um balão fantasma com 3 pontinhos animados no fim da lista (lado do atendente). A mensagem real da IA (`role === 'assistant'` ou `role === 'operator'`) é segurada localmente até o ciclo atingir 16s, então é liberada e o "digitando" some.

Tudo é client-side e puramente visual: não há novas colunas no banco, nem mudança no fluxo do n8n.

## Decisões (capturadas no brainstorming)

| Pergunta | Decisão |
|---|---|
| Comportamento do Enter | Enter quebra linha; **só** o botão envia. Sem atalhos (sem Shift+Enter, sem Ctrl+Enter) |
| Onde aparece "digitando" | **Dois lugares ao mesmo tempo**: balão de 3 pontinhos na lista + subtitle do header trocado para "digitando…" |
| IA responde antes dos 16s | **Segura** a mensagem da IA localmente; libera assim que o ciclo atinge 16s |
| IA responde depois dos 16s | "Digitando" fica visível desde os 16s até a mensagem chegar; some quando ela aparece |
| Mensagens antigas (carregadas do DB) | Tick azul fixo, sem animação. Só msgs enviadas na sessão atual animam |
| Rajada de mensagens do lead | Todas as msgs do mesmo ciclo **compartilham o mesmo estado de tick**. Nova msg reseta o `startedAt` do ciclo; só existe 1 "digitando" por vez |
| Envio falha (server action retorna erro) | Msg fica na lista (já fica hoje), mas sai do ciclo: tick volta para `idle` (sem ícone, só hora) |

---

## Constantes de timing

```ts
const TICK_CLOCK_MS = 3_000    // 0–3s    → relógio
const TICK_GRAY_MS  = 13_000   // 3–13s   → tick cinza
const TICK_BLUE_MS  = 16_000   // 13s–16s → tick azul (sem "digitando" ainda)
                               // ≥16s    → tick azul + "digitando" visível
```

Os nomes representam o **limiar superior** de cada faixa, exceto `TICK_BLUE_MS` que também é o limiar de início do "digitando".

---

## Arquivos novos

### `src/app/chat/[slug]/components/cycle.ts` (lógica pura, sem React)

```ts
import type { ChatMessage } from '../ChatClient'

export const TICK_CLOCK_MS = 3_000
export const TICK_GRAY_MS  = 13_000
export const TICK_BLUE_MS  = 16_000

export type TickState = 'idle' | 'clock' | 'gray' | 'blue'

export interface Cycle {
  startedAt: number          // ms epoch
  userMsgIds: string[]       // ordem de inserção; comportamento é o de um Set, mas array serializa melhor
  pendingAI: ChatMessage | null
}

export type CycleAction =
  | { type: 'startOrExtend'; userMsgId: string }
  | { type: 'renameInCycle'; tempId: string; realId: string }
  | { type: 'cancelFor'; userMsgId: string }
  | { type: 'holdOrRelease'; msg: ChatMessage; now: number }
  | { type: 'tickElapsed'; now: number }

export interface CycleResult {
  cycle: Cycle | null
  releaseAI: ChatMessage | null   // se não-null, o ChatClient deve dar dispatch('add', ...)
}

export function cycleReducer(cycle: Cycle | null, action: CycleAction): CycleResult
export function tickStateFor(msgId: string, cycle: Cycle | null, now: number): TickState
export function isTypingActive(cycle: Cycle | null, now: number): boolean
```

**Regras do reducer (uma por ação):**

- `startOrExtend(userMsgId)`:
  - Se `cycle === null` → cria `{ startedAt: now(), userMsgIds: [userMsgId], pendingAI: null }`.
  - Se `cycle !== null` → reseta `startedAt = now()`, faz append do id (sem duplicar). Mantém `pendingAI`.
  - `releaseAI: null` sempre.
- `renameInCycle(tempId, realId)`:
  - Se `cycle === null` ou `tempId` não está no set → no-op.
  - Senão troca `tempId` por `realId` no array.
- `cancelFor(userMsgId)`:
  - Se `cycle === null` → no-op.
  - Remove o id do array. Se ficar vazio → `cycle = null` (`pendingAI` é descartado também — se a IA já tinha respondido o ciclo do envio falho, o ciclo morreu).
- `holdOrRelease(msg, now)`:
  - Se `cycle === null` ou `now - cycle.startedAt >= TICK_BLUE_MS` → `releaseAI: msg`, cycle inalterado.
  - Senão → `pendingAI = msg`, `releaseAI: null`.
  - Se já havia um `pendingAI`, **substitui** (deve ser raro; segunda mensagem da IA chegando antes da primeira ser liberada).
- `tickElapsed(now)`:
  - Se `cycle === null` ou `pendingAI === null` → no-op.
  - Se `now - cycle.startedAt < TICK_BLUE_MS` → no-op.
  - Senão → `releaseAI: pendingAI`, `cycle = null`.

**Função `tickStateFor(msgId, cycle, now)`:**
- `cycle === null` → `'idle'`
- `msgId` não está em `cycle.userMsgIds` → `'idle'`
- `elapsed = now - cycle.startedAt`:
  - `elapsed < TICK_CLOCK_MS` → `'clock'`
  - `elapsed < TICK_GRAY_MS` → `'gray'`
  - senão → `'blue'`

**Função `isTypingActive(cycle, now)`:**
- `cycle !== null && (now - cycle.startedAt) >= TICK_BLUE_MS`

---

## Arquivos alterados

### `src/app/chat/[slug]/ChatClient.tsx`

Mudanças:

1. Importar `cycleReducer`, `Cycle`, `tickStateFor`, `isTypingActive` de `./components/cycle`.
2. Adicionar `useReducer` separado: `const [cycle, dispatchCycleRaw] = useReducer(cycleReducerWrap, null)`. O `cycleReducerWrap` é uma versão local que descarta `releaseAI` (o release acontece via efeito separado, abaixo).
3. Criar wrapper `dispatchCycle(action)` que chama o reducer puro com a action **e** o now atual, captura `releaseAI` se vier, e despacha `{ type: 'add', message: releaseAI }` no reducer principal de mensagens.
4. Estado local `now`, atualizado por `setInterval(() => setNow(Date.now()), 500)` somente quando `cycle !== null`. `useEffect` cria/limpa o intervalo conforme `cycle === null` muda.
5. A cada tick do intervalo, chamar `dispatchCycle({ type: 'tickElapsed', now: Date.now() })`. Se houver `pendingAI` pronta para liberar, o wrapper despacha o `add` automaticamente.
6. No handler do realtime (`postgres_changes`), quando `row.role === 'assistant' || row.role === 'operator'`, **substituir** `dispatch({ type: 'add', ... })` por `dispatchCycle({ type: 'holdOrRelease', msg, now: Date.now() })`. Para `role === 'system'` (e `role === 'user'` vindo do realtime, que é o INSERT da própria msg do lead), continua `dispatch({ type: 'add', ... })` direto.
7. **Sincronização do id temp→real no ciclo.** Há uma race condition: o realtime entrega o INSERT da msg do lead (com id real) tipicamente em 50–200ms, antes do server action retornar (espera n8n, ~5–30s). O reducer principal atual já trata isso fazendo dedup por conteúdo no `case 'add'` (substitui a msg `temp-X` pela real). Mas o ciclo continua indexado por `temp-X` até o `ChatInput` chamar `onCycleRename` (após o server action). Nesse intervalo, `tickStateFor("real-Y")` retorna `'idle'` → bolha pisca de relógio para tick azul fixo e depois volta. Inaceitável.
   
   **Solução**: o `ChatClient` mantém um `pendingTempsRef = useRef<Array<{ tempId, content }>>([])`. O `ChatInput` chama `onCycleStart(tempId, content)` (assinatura ampliada) que faz `pendingTempsRef.current.push({ tempId, content })` **antes** de `dispatchCycle({ type: 'startOrExtend', userMsgId: tempId })`. No handler do realtime, quando `row.role === 'user'`, antes do `dispatch({ type: 'add', ... })`:
   ```ts
   const idx = pendingTempsRef.current.findIndex(p => p.content === row.content)
   if (idx !== -1) {
     const { tempId } = pendingTempsRef.current[idx]
     pendingTempsRef.current.splice(idx, 1)
     dispatchCycle({ type: 'renameInCycle', tempId, realId: row.id })
   }
   ```
   Quando o server action finalmente retorna, `onCycleRename(tempId, realId)` é chamado pelo `ChatInput`. Esse callback faz `pendingTempsRef.current = pendingTempsRef.current.filter(p => p.tempId !== tempId)` (limpa entrada se ainda estiver lá) e `dispatchCycle({ type: 'renameInCycle', ... })`. Como `renameInCycle` é no-op se `tempId` já não está no set, é seguro disparar duas vezes.
   
   O `ChatClient` cria 3 callbacks para o `ChatInput`:
   - `onCycleStart(tempId, content)` — após `onLocalAdd`. Adiciona ao ref e despacha `startOrExtend`.
   - `onCycleRename(tempId, realId)` — junto com `onReplaceTemp(tempId, realId)`. Remove do ref (se estiver lá) e despacha `renameInCycle`.
   - `onCycleCancel(tempId)` — em caso de falha do server action. Remove do ref e despacha `cancelFor`.
8. Passar `cycle`, `now` e `isTyping = isTypingActive(cycle, now)` para `<MessageList>` e `<ChatHeader>`.
9. Passar `onCycleStart`, `onCycleRename` e `onCycleCancel` para `<ChatInput>`.

### `src/app/chat/[slug]/components/ChatInput.tsx`

Mudanças:

1. **Remover** a função `handleKey` e a prop `onKeyDown` do `<textarea>`. Enter agora cai no comportamento default do textarea (quebra de linha).
2. Adicionar props:
   - `onCycleStart(tempId: string, content: string): void`
   - `onCycleRename(tempId: string, realId: string): void`
   - `onCycleCancel(tempId: string): void`
3. Em `handleSend`, logo após `onLocalAdd({...id: tempId...})`, chamar `onCycleStart(tempId, trimmed)`.
4. Quando `result.success === true` e há `result.messageId`, chamar `onReplaceTemp(tempId, result.messageId)` **e** `onCycleRename(tempId, result.messageId)` (ordem indiferente — ambos são puros).
5. Quando `result.success === false`, chamar `onCycleCancel(tempId)` antes de setar o erro.
6. Manter o botão como único trigger de envio.

### `src/app/chat/[slug]/components/ChatHeader.tsx`

Mudanças:

1. Aceitar prop `isTyping: boolean`.
2. Quando `isTyping === true`, substituir o texto `"online"` por `"digitando..."`. Manter mesmo container e classes (sem layout shift).

### `src/app/chat/[slug]/components/MessageList.tsx`

Mudanças:

1. Aceitar props `cycle: Cycle | null`, `now: number`, `isTyping: boolean`.
2. Para cada mensagem, calcular `tickState = tickStateFor(m.id, cycle, now)` e passar como prop para `<MessageBubble>`.
3. Renderizar `<TypingBubble />` (novo componente local, abaixo) entre o último `<MessageBubble>` e o `scrollAnchor` quando `isTyping === true`.
4. **Importante:** garantir que o `useEffect` de scroll do `ChatClient` (que observa `state.messages.length`) também role para baixo quando o `TypingBubble` aparece. Para isso, adicionar `isTyping` como segunda dependência: `useEffect(() => { scrollAnchor.current?.scrollIntoView(...) }, [state.messages.length, isTyping])`.

**Novo componente `<TypingBubble />`** (definido inline em `MessageList.tsx`, sem export):

```tsx
function TypingBubble() {
  return (
    <div className="mb-0.5 flex justify-start">
      <div className="rounded-lg bg-white px-3 py-2 shadow-sm">
        <span className="flex items-center gap-1">
          <span className="typing-dot" />
          <span className="typing-dot" style={{ animationDelay: '0.15s' }} />
          <span className="typing-dot" style={{ animationDelay: '0.3s' }} />
        </span>
      </div>
    </div>
  )
}
```

Estilo `.typing-dot` (adicionar ao `globals.css` ou usar Tailwind keyframes):

```css
.typing-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: #8696a0;
  animation: typing-bounce 1s infinite ease-in-out;
}
@keyframes typing-bounce {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30%           { opacity: 1;   transform: translateY(-3px); }
}
```

### `src/app/chat/[slug]/components/MessageBubble.tsx`

Mudanças:

1. Aceitar prop `tickState: TickState` (default `'idle'`).
2. Renderizar ícone de status apenas quando `message.role === 'user'`. Para `assistant`, `operator` e `system`, ignorar `tickState`.
3. Substituir o bloco atual `<p className="...">{formatTime(...)}</p>` por:

```tsx
<p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-gray-500">
  <span>{formatTime(message.created_at)}</span>
  {isUser && <TickIcon state={tickState} />}
</p>
```

4. Adicionar componente local `<TickIcon state>` (no mesmo arquivo, sem export):
   - `state === 'clock'` → SVG outline de relógio, 12×12px, cor `#8696A0`.
   - `state === 'gray'` → SVG dos dois checks sobrepostos (✓✓), ~14×10px, cor `#8696A0`.
   - `state === 'blue'` → mesmo SVG dos checks, cor `#34B7F1` (azul WhatsApp).
   - `state === 'idle'` → renderiza `state='blue'` (mensagem antiga = lida = azul fixo). **Não** renderiza `null` — a regra da decisão 5 é "tick azul fixo, sem animação".

**SVGs** (12×12 para o relógio, ~14×10 para os checks duplos — desenhados inline, sem dependência externa):

```tsx
function ClockSvg() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.5V8L10.5 9.5" strokeLinecap="round" />
    </svg>
  )
}
function DoubleCheckSvg() {
  return (
    <svg viewBox="0 0 18 12" width="14" height="10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 6.5L4 9.5L10 2" />
      <path d="M7 9.5L9 7" />
      <path d="M9 9.5L17 2" />
    </svg>
  )
}
```

---

## Edge cases (recapitulando)

| Cenário | Comportamento |
|---|---|
| Envio falha | `onCycleCancel(tempId)` → msg sai do `userMsgIds`. Se set fica vazio, ciclo zerado. Tick vai para `idle` → tick azul fixo (regra "msg antiga" se aplica). |
| Aba em background | Browser estrangula `setInterval`. Na volta, `Date.now() - cycle.startedAt` já é grande, próxima invocação renderiza o estado correto. Se `pendingAI` existir, libera no primeiro tick após retorno. |
| Lead envia msg durante "digitando" | `startOrExtend` reseta `startedAt = now()`. Todas as msgs do lead voltam para `'clock'`. `isTyping` cai para `false`. `pendingAI` é preservada (a IA já respondeu, mas o ciclo voltou — ela será liberada após o novo ciclo de 16s). |
| Realtime entrega INSERT da msg do lead antes do server action retornar | Reducer principal já faz dedup (`case 'add'` com troca de temp por real). O `renameInCycle` é despachado quando o `replaceTemp` é executado pelo `ChatInput` (via callback). |
| `role === 'operator'` | Trata como `assistant`: passa por `holdOrRelease`. Seguindo a regra do brainstorming. |
| `role === 'system'` | Não passa por `holdOrRelease`. Sempre `dispatch('add')` direto. |
| Mensagens iniciais (`initialMessages`) | Nunca entram em ciclo. `tickStateFor` retorna `'idle'` → tick azul fixo. |
| SSR/hidratação | `cycle` começa `null`; `now` começa `0` (ou não é lido até cycle existir). Sem mismatch. |

---

## Plano de testes

### `src/app/chat/[slug]/components/cycle.test.ts` (Vitest)

Testes da lógica pura:

```
tickStateFor:
  ✓ cycle null → 'idle'
  ✓ msgId fora do set → 'idle'
  ✓ elapsed=0 → 'clock'
  ✓ elapsed=2999 → 'clock'
  ✓ elapsed=3000 → 'gray'
  ✓ elapsed=12999 → 'gray'
  ✓ elapsed=13000 → 'blue'
  ✓ elapsed=99999 → 'blue'

isTypingActive:
  ✓ cycle null → false
  ✓ elapsed=15999 → false
  ✓ elapsed=16000 → true
  ✓ elapsed=99999 → true

cycleReducer / startOrExtend:
  ✓ em cycle null → cria ciclo com 1 id
  ✓ em cycle existente → reseta startedAt, adiciona id, mantém pendingAI
  ✓ id duplicado → não adiciona de novo

cycleReducer / renameInCycle:
  ✓ cycle null → no-op
  ✓ tempId presente → troca por realId
  ✓ tempId ausente → no-op

cycleReducer / cancelFor:
  ✓ cycle null → no-op
  ✓ id presente, set fica não-vazio → remove só ele
  ✓ id presente, set fica vazio → cycle vira null (descarta pendingAI)

cycleReducer / holdOrRelease:
  ✓ cycle null → releaseAI = msg
  ✓ elapsed<16000 → pendingAI = msg, releaseAI = null
  ✓ elapsed>=16000 → releaseAI = msg, pendingAI inalterado
  ✓ já havia pendingAI e elapsed<16000 → substitui pendingAI

cycleReducer / tickElapsed:
  ✓ cycle null → no-op
  ✓ pendingAI null → no-op
  ✓ pendingAI presente, elapsed<16000 → no-op
  ✓ pendingAI presente, elapsed>=16000 → releaseAI = pendingAI, cycle vira null

rajada:
  ✓ 3 dispatches de startOrExtend com 50ms entre cada → todos 3 ids no set, startedAt = now do último
```

### `src/app/chat/[slug]/components/MessageBubble.test.tsx` (Vitest + Testing Library)

```
✓ role='user' + tickState='idle' → renderiza hora + ícone azul (DoubleCheck)
✓ role='user' + tickState='clock' → renderiza hora + ClockSvg
✓ role='user' + tickState='gray' → renderiza hora + DoubleCheck cinza
✓ role='user' + tickState='blue' → renderiza hora + DoubleCheck azul
✓ role='assistant' → renderiza hora, sem ícone de status
✓ role='system' → renderiza bloco amarelo, sem hora nem ícone
```

### Manual (dev server) — checklist

- [ ] Enter no textarea quebra linha; não envia
- [ ] Botão de avião envia
- [ ] Mandar msg: relógio aparece 3s → cinza ~10s → azul ~3s → "digitando..." (header + balão) aparece em 16s
- [ ] Header alterna `online ↔ digitando...` sem layout shift
- [ ] IA responde em 5s: digitando "pisca" aos 16s, msg da IA aparece junto
- [ ] IA responde em 30s: digitando fica visível de 16s a 30s
- [ ] Rajada (3 msgs em 2s): todas com mesmo estado, só 1 balão "digitando" no fim
- [ ] Recarregar página: msgs antigas com tick azul fixo, sem animação
- [ ] Mandar msg durante "digitando": ciclo reseta, todas voltam para relógio, header volta para "online"
- [ ] Server action falha: msg fica visível com tick azul fixo (idle = azul) e banner de erro aparece

---

## Não-objetivos

- Persistir status de tick no banco (a animação é puramente visual, no cliente).
- Refletir status real de entrega/leitura do n8n ou do operador humano.
- Indicar "digitando" do lead para o operador (a página `/dashboard/chats` não muda neste spec).
- Mostrar avatar em cada balão da IA (já decidido fora deste spec — só o header tem logo).
- Som de notificação ou vibração ao receber msg da IA.
