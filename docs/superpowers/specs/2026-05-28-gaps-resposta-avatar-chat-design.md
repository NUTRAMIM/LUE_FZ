# Responder Gaps no Painel + Avatar do Chat — Design

**Data:** 2026-05-28
**Status:** Aprovado para implementação
**Escopo:** Duas features independentes na app LUE FZ:
- **A.** Botão "Responder" em cada card de "pergunta sem resposta" no painel; a resposta do lojista vira entrada no FAQ da loja e resolve o gap.
- **B.** O avatar do chat público passa a usar a logo da loja (`logo_url`), com fallback para as iniciais.

Base: a feature de FAQ (`store_settings.faq` + `src/lib/store-settings-sanitize.ts`) já está mergeada na `main`.

## Decisões (capturadas no brainstorming)

| Pergunta | Decisão |
|---|---|
| Quem responde o gap | O **lojista** (dono), no painel administrativo. O lead nunca vê o painel. |
| O que a resposta faz | Cria entrada no FAQ (`store_settings.faq`) com `{pergunta, resposta}` **e** marca o(s) gap(s) daquela pergunta como resolvido(s). |
| Pergunta já existe no FAQ | **Substitui** a resposta existente (match case-insensitive), sem duplicar. |
| FAQ já com 30 itens | **Bloqueia com aviso**; não salva. Limite `MAX_FAQ_ITEMS = 30` mantido. |
| UI do responder | **Expandir inline** no card (textarea + Salvar/Cancelar). Ao salvar, a linha some. |
| Avatar do chat | Logo da loja no `ChatHeader`; fallback nas iniciais. Mensagens não têm avatar — só o header. |

---

## Feature A — Responder pergunta sem resposta

### A.1 Lógica pura (testável) — `src/lib/store-settings-sanitize.ts`

Nova função pura que mescla uma resposta no array de FAQ:

```ts
export interface MergeFaqResult {
  faq: FaqItem[]
  error?: 'faq_full'
}

export function mergeFaqAnswer(
  currentFaq: unknown,
  pergunta: string,
  resposta: string,
): MergeFaqResult
```

Comportamento:
1. `base = sanitizeFaq(currentFaq)` (normaliza o estado atual; tolera `null`/lixo).
2. Limpa entrada nova: `p = pergunta` e `r = resposta` passam pela mesma limpeza de `sanitizeFaq` (HTML removido, trim, cortes em 200/1000). Se `p` ou `r` ficarem vazios → trata como "nada a fazer": retorna `{ faq: base }` (sem erro; o action valida antes de chamar, mas a função é defensiva).
3. Procura índice em `base` onde `pergunta.toLowerCase().trim()` bate. Se achar → **substitui** `resposta` naquele item; retorna `{ faq: base }`.
4. Se não achar e `base.length >= MAX_FAQ_ITEMS` → retorna `{ faq: base, error: 'faq_full' }`.
5. Senão → `{ faq: [...base, { pergunta: p, resposta: r }] }`.

Para reusar a limpeza de texto, exportar o helper interno `cleanText` (hoje privado) **ou** mesclar via um item temporário passado por `sanitizeFaq`. Decisão: exportar `cleanText(input, maxLength)` do módulo (já usado internamente), e usá-lo em `mergeFaqAnswer`.

Testes vitest novos em `src/lib/__tests__/store-settings-sanitize.test.ts`:
- substitui resposta quando pergunta já existe (case-insensitive).
- adiciona quando não existe.
- retorna `error: 'faq_full'` quando já há 30 e a pergunta é nova.
- NÃO retorna erro quando há 30 mas a pergunta já existe (substituição cabe).
- limpa HTML/trim/corte da resposta.

### A.2 Server action — `src/actions/painel.ts`

```ts
export interface AnswerGapResult {
  success: boolean
  resolvedCount?: number
  error?: string
}

export async function answerKnowledgeGap(input: {
  question: string
  answer: string
}): Promise<AnswerGapResult>
```

Fluxo:
1. `getAuthedUser()`; se ausente → `{ success: false, error: 'Não autorizado.' }`.
2. Valida `answer.trim()` não vazio → senão `{ success:false, error:'Informe uma resposta.' }`. `question` idem.
3. Lê FAQ atual: `select('faq').eq('id', user.id).maybeSingle()`.
4. `const merged = mergeFaqAnswer(row?.faq, input.question, input.answer)`.
   - Se `merged.error === 'faq_full'` → `{ success:false, error:'Limite de 30 perguntas no FAQ atingido. Remova alguma no menu Loja antes.' }`.
5. `update store_settings set faq = merged.faq where id = user.id`. Se erro DB → `{ success:false, error:'Erro ao salvar. Tente novamente.' }`.
6. Resolver gaps: `select('id, question').eq('store_id', user.id).is('resolved_at', null)`; filtrar em JS os ids onde `question.toLowerCase().trim() === input.question.toLowerCase().trim()`; se houver ids, `update knowledge_gaps set resolved_at = now() where id in (ids)`.
7. Retorna `{ success: true, resolvedCount: ids.length }`.

Importa de `@/lib/store-settings-sanitize`: apenas `mergeFaqAnswer`. O action decide a mensagem de limite a partir de `merged.error === 'faq_full'` (não precisa da constante). `painel.ts` é `'use server'` — só importa (não reexporta) o helper síncrono, o que é permitido.

### A.3 UI — `src/components/painel/GapsConhecimento.tsx`

Vira interativo (já é `'use client'`). Estado local:

```ts
const [items, setItems] = useState(gaps)
const [pending, setPending] = useState(totalPending)
const [openKey, setOpenKey] = useState<string | null>(null) // qual linha está aberta
const [answer, setAnswer] = useState('')
const [saving, setSaving] = useState(false)
const [rowError, setRowError] = useState<string | null>(null)
```

Cada `<li>`:
- Linha compacta atual (contador `count×`, pergunta truncada, tag) + botão **"Responder"** à direita.
- Clicar "Responder" → `setOpenKey(g.question)`, limpa `answer`/`rowError`. Quando `openKey === g.question`, abaixo da linha aparece:
  - a pergunta completa (sem truncar),
  - `<textarea>` (maxLength `MAX_FAQ_ANSWER_LENGTH`, placeholder "Resposta que o agente deve usar com os clientes…"),
  - botões **Salvar** e **Cancelar**, e mensagem de erro inline (`rowError`) se houver.
- **Salvar:** `saving=true`; chama `answerKnowledgeGap({ question: g.question, answer })`. Em sucesso: remove a linha (`setItems(items.filter(i => i.question !== g.question))`), `setPending(p => Math.max(0, p - (resolvedCount ?? 0)))`, fecha (`openKey=null`). Em erro: `setRowError(result.error)`. `saving=false` ao fim.
- **Cancelar:** `openKey=null`, limpa estado.
- Botão "Responder" desabilitado enquanto `saving`.

O contador "Abrir todos · {pending}" passa a usar o estado `pending`. Estado vazio: quando `items.length === 0`, mostra a mensagem existente "Nenhuma pergunta sem resposta…".

> Nota de fonte de dados: `GapsConhecimento` recebe `gaps`/`totalPending` de um Server Component pai; a remoção é client-side (sem refetch). Em reload, a action já marcou resolvido no banco, então o gap não reaparece.

---

## Feature B — Avatar do chat = logo da loja

### B.1 Dados — `src/actions/chat.ts`

- `resolveStoreBySlug`: trocar `select('id, store_name, chat_slug')` por `select('id, store_name, chat_slug, logo_url')`.
- `ChatBootstrap`: adicionar `storeLogoUrl: string | null`.
- `ensureConversation`: retornar `storeLogoUrl: store.logo_url ?? null`.

`logo_url` é URL pública (bucket `store-logos`), então o chat público (admin client, sem auth do visitante) carrega direto.

### B.2 Threading — `page.tsx` e `ChatClient.tsx`

- `src/app/chat/[slug]/page.tsx`: `<ChatClient ... storeLogoUrl={bootstrap.storeLogoUrl} />`.
- `ChatClient.tsx`: adicionar prop `storeLogoUrl: string | null` à assinatura; repassar `<ChatHeader storeName={storeName} logoUrl={storeLogoUrl} />`.

### B.3 `ChatHeader.tsx`

```tsx
export function ChatHeader({
  storeName,
  logoUrl,
}: {
  storeName: string
  logoUrl?: string | null
}) {
  // initials = ... (igual hoje)
  return (
    <header className="...">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={storeName}
          className="h-10 w-10 rounded-full object-cover bg-white/20"
        />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">
          {initials}
        </div>
      )}
      {/* nome + "online" iguais */}
    </header>
  )
}
```

`logoUrl` vazio (`''`) ou `null` → cai nas iniciais (`logoUrl ?` trata `''` como falsy). Usa `<img>` simples, consistente com o resto do chat.

---

## Casos de erro / borda

| Cenário | Comportamento |
|---|---|
| Responder com textarea vazio | Botão Salvar bloqueado ou action retorna erro "Informe uma resposta." |
| Pergunta já no FAQ | Resposta substituída (sem duplicar) |
| FAQ com 30 itens, pergunta nova | Bloqueia: "Limite de 30 perguntas no FAQ atingido…" |
| Gap com várias linhas (mesma pergunta) | Todas as linhas daquela pergunta viram `resolved_at = now()` |
| Falha de DB no update | Erro inline, linha permanece |
| Loja sem logo (`logo_url` vazio) | Header mostra iniciais |
| `logo_url` quebrado/inacessível | `<img>` falha ao carregar; sem fallback automático (aceitável — caso raro) |

## Fora do escopo

- Injeção do FAQ no prompt do agente n8n (pendente, como combinado).
- Editar/remover gaps já resolvidos; histórico de respostas; "desfazer".
- Avatar nas bolhas de mensagem (não há avatar lá hoje).
- Otimizar logo via `next/image` (mantém `<img>` por consistência).

## Testes

**Automatizados (vitest):** `mergeFaqAnswer` — substitui, adiciona, `faq_full`, substituição cabe mesmo com 30, limpeza de texto.

**Manuais (gate):**
1. Responder um gap → some da lista, contador decrementa; aparece no FAQ do menu Loja (pergunta + resposta).
2. Responder gap cuja pergunta já está no FAQ → resposta substituída, sem duplicar.
3. Com 30 itens no FAQ, responder gap novo → aviso de limite, nada salvo.
4. Recarregar painel → gap respondido não reaparece.
5. Loja com logo → chat mostra a logo no header; loja sem logo → iniciais.

## Arquivos tocados

- `src/lib/store-settings-sanitize.ts` (export `cleanText`, nova `mergeFaqAnswer`)
- `src/lib/__tests__/store-settings-sanitize.test.ts` (testes de `mergeFaqAnswer`)
- `src/actions/painel.ts` (nova `answerKnowledgeGap`)
- `src/components/painel/GapsConhecimento.tsx` (UI interativa)
- `src/actions/chat.ts` (`logo_url` no select + `ChatBootstrap`)
- `src/app/chat/[slug]/page.tsx` (prop `storeLogoUrl`)
- `src/app/chat/[slug]/ChatClient.tsx` (prop + repasse)
- `src/app/chat/[slug]/components/ChatHeader.tsx` (avatar com logo)
