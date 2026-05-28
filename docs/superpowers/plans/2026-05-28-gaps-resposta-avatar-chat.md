# Responder Gaps no Painel + Avatar do Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o lojista responda perguntas sem resposta no painel (vira FAQ + resolve o gap) e fazer o avatar do chat público usar a logo da loja.

**Architecture:** Lógica de mescla do FAQ isolada e testada em `src/lib/store-settings-sanitize.ts` (`mergeFaqAnswer`). Server action `answerKnowledgeGap` em `painel.ts` orquestra FAQ + resolução de gaps. `GapsConhecimento.tsx` vira interativo com estado local. Para o avatar, o `logo_url` é threadado de `chat.ts` até `ChatHeader`.

**Tech Stack:** Next.js 16, React 19, Supabase, Vitest, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-05-28-gaps-resposta-avatar-chat-design.md`

---

## File Structure

- `src/lib/store-settings-sanitize.ts` — **modificar**: exportar `cleanText`, adicionar `mergeFaqAnswer`.
- `src/lib/__tests__/store-settings-sanitize.test.ts` — **modificar**: testes de `mergeFaqAnswer`.
- `src/actions/painel.ts` — **modificar**: nova `answerKnowledgeGap`.
- `src/components/painel/GapsConhecimento.tsx` — **modificar**: UI interativa.
- `src/actions/chat.ts` — **modificar**: `logo_url` no select + `ChatBootstrap` + retorno.
- `src/app/chat/[slug]/page.tsx` — **modificar**: passar `storeLogoUrl`.
- `src/app/chat/[slug]/ChatClient.tsx` — **modificar**: prop + repasse.
- `src/app/chat/[slug]/components/ChatHeader.tsx` — **modificar**: avatar com logo.

---

## Task 1: mergeFaqAnswer (lógica pura, TDD)

**Files:**
- Modify: `src/lib/store-settings-sanitize.ts`
- Test: `src/lib/__tests__/store-settings-sanitize.test.ts`

- [ ] **Step 1: Adicionar os testes que falham**

No topo de `src/lib/__tests__/store-settings-sanitize.test.ts`, adicionar `mergeFaqAnswer` ao import existente de `../store-settings-sanitize` (incluir junto dos nomes já importados):

```ts
  mergeFaqAnswer,
```

Ao final do arquivo, adicionar:

```ts
describe('mergeFaqAnswer', () => {
  it('adiciona nova pergunta quando não existe', () => {
    const r = mergeFaqAnswer([], 'Fazem troca?', 'Sim, em 7 dias')
    expect(r.error).toBeUndefined()
    expect(r.faq).toEqual([{ pergunta: 'Fazem troca?', resposta: 'Sim, em 7 dias' }])
  })

  it('substitui a resposta quando a pergunta já existe (case-insensitive)', () => {
    const current = [{ pergunta: 'Fazem troca?', resposta: 'resposta antiga' }]
    const r = mergeFaqAnswer(current, 'fazem TROCA?', 'resposta nova')
    expect(r.error).toBeUndefined()
    expect(r.faq).toEqual([{ pergunta: 'Fazem troca?', resposta: 'resposta nova' }])
  })

  it('retorna error faq_full quando há 30 itens e a pergunta é nova', () => {
    const current = Array.from({ length: 30 }, (_, i) => ({
      pergunta: `q${i}`,
      resposta: 'a',
    }))
    const r = mergeFaqAnswer(current, 'pergunta nova', 'resposta')
    expect(r.error).toBe('faq_full')
    expect(r.faq).toHaveLength(30)
  })

  it('substitui mesmo com 30 itens quando a pergunta já existe', () => {
    const current = Array.from({ length: 30 }, (_, i) => ({
      pergunta: `q${i}`,
      resposta: 'a',
    }))
    const r = mergeFaqAnswer(current, 'q5', 'resposta nova')
    expect(r.error).toBeUndefined()
    expect(r.faq).toHaveLength(30)
    expect(r.faq[5]).toEqual({ pergunta: 'q5', resposta: 'resposta nova' })
  })

  it('limpa HTML e corta tamanho da resposta', () => {
    const r = mergeFaqAnswer([], 'Pergunta?', '<b>oi</b>')
    expect(r.faq[0].resposta).toBe('oi')
  })

  it('tolera faq atual inválido (null) e nada faz se resposta vazia', () => {
    expect(mergeFaqAnswer(null, 'q', '   ').faq).toEqual([])
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `npx vitest run src/lib/__tests__/store-settings-sanitize.test.ts`
Expected: FAIL — `mergeFaqAnswer is not a function` / import não resolve.

- [ ] **Step 3: Implementar**

Em `src/lib/store-settings-sanitize.ts`:

1. Exportar o helper `cleanText` (trocar a declaração existente):

```ts
export function cleanText(input: unknown, maxLength: number): string {
  if (typeof input !== 'string') return ''
  return input.replace(/<[^>]*>/g, '').trim().slice(0, maxLength)
}
```

2. Ao final do arquivo, adicionar:

```ts
export interface MergeFaqResult {
  faq: FaqItem[]
  error?: 'faq_full'
}

export function mergeFaqAnswer(
  currentFaq: unknown,
  pergunta: string,
  resposta: string,
): MergeFaqResult {
  const base = sanitizeFaq(currentFaq)
  const p = cleanText(pergunta, MAX_FAQ_QUESTION_LENGTH)
  const r = cleanText(resposta, MAX_FAQ_ANSWER_LENGTH)
  if (p === '' || r === '') return { faq: base }

  const key = p.toLowerCase()
  const idx = base.findIndex((item) => item.pergunta.toLowerCase() === key)
  if (idx >= 0) {
    const next = base.map((item, i) =>
      i === idx ? { pergunta: item.pergunta, resposta: r } : item,
    )
    return { faq: next }
  }

  if (base.length >= MAX_FAQ_ITEMS) {
    return { faq: base, error: 'faq_full' }
  }

  return { faq: [...base, { pergunta: p, resposta: r }] }
}
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `npx vitest run src/lib/__tests__/store-settings-sanitize.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/store-settings-sanitize.ts src/lib/__tests__/store-settings-sanitize.test.ts
git commit -m "feat(gaps): add mergeFaqAnswer helper with tests"
```

---

## Task 2: Server action answerKnowledgeGap

**Files:**
- Modify: `src/actions/painel.ts`

`painel.ts` já é `'use server'` e importa `createClient` (de `@/lib/supabase/server`) e `getAuthedUser` (de `@/lib/auth`).

- [ ] **Step 1: Importar mergeFaqAnswer**

Após os imports existentes no topo de `src/actions/painel.ts`, adicionar:

```ts
import { mergeFaqAnswer } from '@/lib/store-settings-sanitize'
```

- [ ] **Step 2: Adicionar a action**

Imediatamente após a função `getKnowledgeGaps` (após a linha `}` que a fecha), adicionar:

```ts
export interface AnswerGapResult {
  success: boolean
  resolvedCount?: number
  error?: string
}

export async function answerKnowledgeGap(input: {
  question: string
  answer: string
}): Promise<AnswerGapResult> {
  const supabase = await createClient()
  const user = await getAuthedUser()
  if (!user) return { success: false, error: 'Não autorizado.' }

  const question = (input.question ?? '').trim()
  const answer = (input.answer ?? '').trim()
  if (!question) return { success: false, error: 'Pergunta inválida.' }
  if (!answer) return { success: false, error: 'Informe uma resposta.' }

  const { data: row, error: readErr } = await supabase
    .from('store_settings')
    .select('faq')
    .eq('id', user.id)
    .maybeSingle()
  if (readErr) {
    console.error('answerKnowledgeGap read error', readErr)
    return { success: false, error: 'Erro ao salvar. Tente novamente.' }
  }

  const merged = mergeFaqAnswer(row?.faq, question, answer)
  if (merged.error === 'faq_full') {
    return {
      success: false,
      error:
        'Limite de 30 perguntas no FAQ atingido. Remova alguma no menu Loja antes.',
    }
  }

  const { error: updErr } = await supabase
    .from('store_settings')
    .update({ faq: merged.faq })
    .eq('id', user.id)
  if (updErr) {
    console.error('answerKnowledgeGap update error', updErr)
    return { success: false, error: 'Erro ao salvar. Tente novamente.' }
  }

  const { data: gapRows } = await supabase
    .from('knowledge_gaps')
    .select('id, question')
    .eq('store_id', user.id)
    .is('resolved_at', null)

  const target = question.toLowerCase()
  const ids = (gapRows ?? [])
    .filter((g) => g.question.toLowerCase().trim() === target)
    .map((g) => g.id)

  if (ids.length > 0) {
    const { error: resErr } = await supabase
      .from('knowledge_gaps')
      .update({ resolved_at: new Date().toISOString() })
      .in('id', ids)
    if (resErr) console.error('answerKnowledgeGap resolve error', resErr)
  }

  return { success: true, resolvedCount: ids.length }
}
```

- [ ] **Step 3: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/actions/painel.ts
git commit -m "feat(gaps): add answerKnowledgeGap server action"
```

---

## Task 3: UI interativa em GapsConhecimento

**Files:**
- Modify: `src/components/painel/GapsConhecimento.tsx`

- [ ] **Step 1: Reescrever o componente**

Substituir TODO o conteúdo de `src/components/painel/GapsConhecimento.tsx` por:

```tsx
'use client'

import { useState } from 'react'
import { answerKnowledgeGap, type KnowledgeGap } from '@/actions/painel'
import { MAX_FAQ_ANSWER_LENGTH } from '@/lib/store-settings-sanitize'
import { Icon } from './Icons'

export function GapsConhecimento({
  gaps,
  totalPending,
}: {
  gaps: KnowledgeGap[]
  totalPending: number
}) {
  const [items, setItems] = useState(gaps)
  const [pending, setPending] = useState(totalPending)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [saving, setSaving] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)

  function openRow(question: string) {
    setOpenKey(question)
    setAnswer('')
    setRowError(null)
  }

  function closeRow() {
    setOpenKey(null)
    setAnswer('')
    setRowError(null)
  }

  async function handleSave(question: string) {
    if (!answer.trim()) {
      setRowError('Informe uma resposta.')
      return
    }
    setSaving(true)
    setRowError(null)
    const result = await answerKnowledgeGap({ question, answer })
    setSaving(false)
    if (result.success) {
      setItems((prev) => prev.filter((i) => i.question !== question))
      setPending((p) => Math.max(0, p - (result.resolvedCount ?? 0)))
      closeRow()
    } else {
      setRowError(result.error ?? 'Erro ao salvar.')
    }
  }

  return (
    <div className="card p-0 h-full flex flex-col">
      <div className="flex flex-wrap items-end justify-between gap-3 px-5 sm:px-6 pt-5 sm:pt-6 pb-4 sm:pb-5">
        <div>
          <div className="eyebrow text-ink-500">RAG · GAPS DE CONHECIMENTO</div>
          <h2
            className="font-display font-bold text-ink-900 tracking-tight mt-1"
            style={{ fontSize: '20px' }}
          >
            Perguntas sem resposta
          </h2>
        </div>
        <button className="text-[12.5px] font-semibold text-brand-700 hover:text-brand-800 inline-flex items-center gap-1">
          Abrir todos · {pending}{' '}
          <Icon name="arrow" className="w-3.5 h-3.5" />
        </button>
      </div>

      {items.length === 0 ? (
        <div className="px-6 py-10 text-center text-[13px] text-ink-500 border-t border-ink-100 flex-1">
          Nenhuma pergunta sem resposta na última semana.
        </div>
      ) : (
        <ul className="divide-y divide-ink-100 border-t border-ink-100 flex-1">
          {items.map((g) => (
            <li key={g.question} className="px-5 sm:px-6 py-3">
              <div className="flex items-center gap-3">
                <span className="font-mono tabular text-[12px] font-semibold text-brand-700 bg-brand-50 ring-1 ring-brand-100 px-1.5 py-0.5 rounded-md min-w-[42px] text-center">
                  {g.count}×
                </span>
                <span
                  className={`text-[13.5px] text-ink-800 flex-1 ${
                    openKey === g.question ? '' : 'truncate'
                  }`}
                >
                  &ldquo;{g.question}&rdquo;
                </span>
                <span className="eyebrow text-ink-400 shrink-0">{g.tag}</span>
                {openKey !== g.question && (
                  <button
                    type="button"
                    onClick={() => openRow(g.question)}
                    className="text-[12px] font-semibold text-brand-700 hover:text-brand-800 shrink-0"
                  >
                    Responder
                  </button>
                )}
              </div>

              {openKey === g.question && (
                <div className="mt-3 space-y-2">
                  <textarea
                    className="input"
                    rows={3}
                    maxLength={MAX_FAQ_ANSWER_LENGTH}
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="Resposta que o agente deve usar com os clientes…"
                    autoFocus
                  />
                  {rowError && (
                    <p className="text-[12px] text-[#DC2626]">{rowError}</p>
                  )}
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={closeRow}
                      disabled={saving}
                      className="text-[12.5px] font-semibold text-ink-500 hover:text-ink-800 px-3 py-1.5"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSave(g.question)}
                      disabled={saving}
                      className="btn btn-primary"
                    >
                      {saving ? 'Salvando…' : 'Salvar resposta'}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="px-5 sm:px-6 py-4 border-t border-ink-100 bg-ink-50/40">
        <button className="w-full inline-flex items-center justify-center gap-2 text-[13px] font-semibold text-ink-900 bg-white ring-1 ring-ink-200 hover:ring-brand-300 hover:text-brand-700 px-4 py-2.5 rounded-xl">
          <Icon name="sparkle" className="w-4 h-4" />
          Completar respostas no catálogo
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verificar typecheck + lint**

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npx eslint src/components/painel/GapsConhecimento.tsx`
Expected: limpo.

- [ ] **Step 3: Commit**

```bash
git add src/components/painel/GapsConhecimento.tsx
git commit -m "feat(gaps): inline answer button in knowledge gaps panel"
```

---

## Task 4: Threadear logo_url no bootstrap do chat

**Files:**
- Modify: `src/actions/chat.ts`

- [ ] **Step 1: Adicionar logo_url ao select**

Em `resolveStoreBySlug`, trocar:

```ts
    .select('id, store_name, chat_slug')
```

por:

```ts
    .select('id, store_name, chat_slug, logo_url')
```

- [ ] **Step 2: Adicionar storeLogoUrl à interface ChatBootstrap**

Na interface `ChatBootstrap`, após a linha `storeName: string`, adicionar:

```ts
  storeLogoUrl: string | null
```

- [ ] **Step 3: Retornar storeLogoUrl em ensureConversation**

No `return` final de `ensureConversation`, após `storeName: store.store_name,`, adicionar:

```ts
    storeLogoUrl: store.logo_url ?? null,
```

- [ ] **Step 4: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/actions/chat.ts
git commit -m "feat(chat): include store logo_url in chat bootstrap"
```

---

## Task 5: Repassar storeLogoUrl até o ChatHeader

**Files:**
- Modify: `src/app/chat/[slug]/page.tsx`
- Modify: `src/app/chat/[slug]/ChatClient.tsx`

- [ ] **Step 1: page.tsx passa a prop**

Em `src/app/chat/[slug]/page.tsx`, no JSX do `<ChatClient ... />`, após `storeName={bootstrap.storeName}`, adicionar:

```tsx
      storeLogoUrl={bootstrap.storeLogoUrl}
```

- [ ] **Step 2: ChatClient aceita e repassa a prop**

Em `src/app/chat/[slug]/ChatClient.tsx`:

a) Na desestruturação dos parâmetros (após `storeName,`), adicionar `storeLogoUrl,`:

```tsx
export function ChatClient({
  slug,
  storeId,
  conversationId,
  storeName,
  storeLogoUrl,
  initialMessages,
}: {
```

b) No tipo do parâmetro (após `storeName: string`), adicionar:

```tsx
  storeLogoUrl: string | null
```

c) Na renderização do header, trocar `<ChatHeader storeName={storeName} />` por:

```tsx
      <ChatHeader storeName={storeName} logoUrl={storeLogoUrl} />
```

- [ ] **Step 3: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/app/chat/[slug]/page.tsx src/app/chat/[slug]/ChatClient.tsx
git commit -m "feat(chat): thread store logo to chat header"
```

---

## Task 6: Avatar com logo no ChatHeader

**Files:**
- Modify: `src/app/chat/[slug]/components/ChatHeader.tsx`

- [ ] **Step 1: Reescrever o componente**

Substituir TODO o conteúdo de `src/app/chat/[slug]/components/ChatHeader.tsx` por:

```tsx
export function ChatHeader({
  storeName,
  logoUrl,
}: {
  storeName: string
  logoUrl?: string | null
}) {
  const initials = storeName
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <header className="flex items-center gap-3 bg-[#075E54] px-4 py-3 text-white shadow">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={storeName}
          className="h-10 w-10 rounded-full bg-white/20 object-cover"
        />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">
          {initials}
        </div>
      )}
      <div className="flex flex-col">
        <span className="text-base font-medium leading-tight">{storeName}</span>
        <span className="text-xs leading-tight text-white/80">online</span>
      </div>
    </header>
  )
}
```

- [ ] **Step 2: Verificar typecheck + lint**

Run: `npx tsc --noEmit`
Expected: sem erros.

Run: `npx eslint src/app/chat/[slug]/components/ChatHeader.tsx`
Expected: pode haver warning `@next/next/no-img-element` (consistente com o resto do chat, que usa `<img>`); sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add src/app/chat/[slug]/components/ChatHeader.tsx
git commit -m "feat(chat): use store logo as chat avatar with initials fallback"
```

---

## Task 7: Verificação final (gate)

**Files:** nenhum (execução/inspeção)

- [ ] **Step 1: Suíte de testes**

Run: `npm run test`
Expected: PASS (inclui os testes de `mergeFaqAnswer`).

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit`
Run: `NODE_OPTIONS="--use-system-ca" npm run build`
Expected: ambos sem erros (lint pré-existente em `ProductEditDrawer.tsx`/`ProductRow.tsx` não bloqueia o build).

- [ ] **Step 3: Teste manual no navegador (`npm run dev`)**

1. No painel, num card de "pergunta sem resposta", clicar **Responder** → expande textarea; salvar → linha some e contador decrementa.
2. Abrir o menu **Loja** → a pergunta+resposta aparece no FAQ.
3. Responder um gap cuja pergunta já está no FAQ → resposta substituída, sem duplicar.
4. (Se possível montar 30 itens no FAQ) responder gap novo → aviso de limite, nada salvo.
5. Recarregar o painel → gap respondido não reaparece.
6. Abrir o chat público de uma loja **com logo** → header mostra a logo; loja **sem logo** → iniciais.

> Observação: requer a migration `033` já aplicada no Supabase (a coluna `faq` precisa existir para a action gravar).

---

## Self-Review (autor do plano)

**Cobertura do spec:**
- `mergeFaqAnswer` (substitui/adiciona/faq_full/limpeza) + export `cleanText` → Task 1. ✔
- `answerKnowledgeGap` (FAQ + resolve gaps) → Task 2. ✔
- UI inline no painel (Responder/textarea/remove linha/erro/contador) → Task 3. ✔
- `logo_url` no bootstrap → Task 4. ✔
- threading page/ChatClient → Task 5. ✔
- ChatHeader avatar + fallback → Task 6. ✔
- Gate manual → Task 7. ✔
- Fora do escopo (n8n) → sem task. ✔

**Consistência de tipos:** `mergeFaqAnswer(currentFaq: unknown, pergunta, resposta): MergeFaqResult` definido na Task 1, consumido igual na Task 2 (`merged.error === 'faq_full'`, `merged.faq`). `answerKnowledgeGap({question, answer}): AnswerGapResult` (Task 2) consumido na Task 3 (`result.success`, `result.resolvedCount`, `result.error`). `ChatBootstrap.storeLogoUrl: string | null` (Task 4) → prop `storeLogoUrl` (Task 5) → `logoUrl?: string | null` no ChatHeader (Task 6).

**Placeholders:** nenhum — todo passo de código tem o código completo.
