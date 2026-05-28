# FAQ + Desconto de Atacado (loja) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar à página `/loja` dois componentes — FAQ (perguntas e respostas) e desconto de atacado — persistindo em colunas dedicadas de `store_settings`.

**Architecture:** Lógica pura de sanitização/normalização isolada em `src/lib/store-settings-sanitize.ts` (com testes vitest). O server action `saveStoreSettings` consome essa lógica. A UI vive em `src/app/loja/LojaForm.tsx` (client component) e importa constantes/tipos do módulo de sanitização. Sem alterações no workflow n8n nesta entrega.

**Tech Stack:** Next.js 16, React 19, Supabase (Postgres + JSONB), Vitest, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-05-28-loja-faq-desconto-atacado-design.md`

---

## File Structure

- `supabase/migrations/033_store_settings_faq_discount.sql` — **criar**. 4 colunas novas + CHECKs (idempotente).
- `src/lib/store-settings-sanitize.ts` — **criar**. Tipos, constantes e funções puras (`sanitizeFaq`, `sanitizeDiscountType`, `sanitizeDiscountValue`, `normalizeDiscount`).
- `src/lib/__tests__/store-settings-sanitize.test.ts` — **criar**. Testes das funções puras.
- `src/types/database.ts` — **modificar**. Row/Insert/Update de `store_settings`.
- `src/actions/store-settings.ts` — **modificar**. Estende payload, usa o módulo de sanitização, upsert.
- `src/app/loja/LojaForm.tsx` — **modificar**. Nova seção FAQ + bloco de desconto + estado + submit.

---

## Task 1: Migration — colunas faq + desconto

**Files:**
- Create: `supabase/migrations/033_store_settings_faq_discount.sql`

- [ ] **Step 1: Criar a migration**

```sql
-- 033_store_settings_faq_discount.sql
-- FAQ (perguntas e respostas) + desconto de atacado em store_settings.
-- Idempotente: seguro re-rodar após aplicação parcial.

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS faq             JSONB         NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS discount_type   TEXT,
  ADD COLUMN IF NOT EXISTS discount_value  NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS discount_custom TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'discount_type_valid'
      AND conrelid = 'store_settings'::regclass
  ) THEN
    ALTER TABLE store_settings
      ADD CONSTRAINT discount_type_valid
      CHECK (
        discount_type IS NULL OR
        discount_type IN ('percent_piece','percent_order','fixed_piece','custom')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'discount_value_non_negative'
      AND conrelid = 'store_settings'::regclass
  ) THEN
    ALTER TABLE store_settings
      ADD CONSTRAINT discount_value_non_negative
      CHECK (discount_value IS NULL OR discount_value >= 0);
  END IF;
END $$;
```

- [ ] **Step 2: Verificar (inspeção)**

A migration usa `ADD COLUMN IF NOT EXISTS` e guarda os CHECKs em `pg_constraint` (mesmo padrão de `010_store_settings_min_order.sql`). Defaults garantem que rows existentes não quebrem (`faq` default `'[]'`, demais colunas nullable). Aplicar no Supabase faz parte do fluxo de migrations do projeto (não roda neste passo).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/033_store_settings_faq_discount.sql
git commit -m "feat(loja): migration for faq + wholesale discount columns"
```

---

## Task 2: Tipos do banco

**Files:**
- Modify: `src/types/database.ts` (bloco `store_settings`, ~linhas 244-317)

- [ ] **Step 1: Adicionar as 4 colunas no Row**

Em `store_settings.Row`, após a linha `inventory_last_error: string | null`, adicionar:

```ts
          faq: Array<{ pergunta: string; resposta: string }>
          discount_type: 'percent_piece' | 'percent_order' | 'fixed_piece' | 'custom' | null
          discount_value: number | null
          discount_custom: string | null
```

- [ ] **Step 2: Adicionar no Insert (todas opcionais)**

Em `store_settings.Insert`, após `inventory_last_error?: string | null`, adicionar:

```ts
          faq?: Array<{ pergunta: string; resposta: string }>
          discount_type?: 'percent_piece' | 'percent_order' | 'fixed_piece' | 'custom' | null
          discount_value?: number | null
          discount_custom?: string | null
```

- [ ] **Step 3: Adicionar no Update (todas opcionais)**

Em `store_settings.Update`, após `inventory_last_error?: string | null`, adicionar as mesmas 4 linhas do Step 2.

- [ ] **Step 4: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos relacionados a `store_settings`.

- [ ] **Step 5: Commit**

```bash
git add src/types/database.ts
git commit -m "feat(loja): type faq + discount columns on store_settings"
```

---

## Task 3: Módulo de sanitização (TDD)

**Files:**
- Create: `src/lib/store-settings-sanitize.ts`
- Test: `src/lib/__tests__/store-settings-sanitize.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/lib/__tests__/store-settings-sanitize.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  sanitizeFaq,
  sanitizeDiscountType,
  sanitizeDiscountValue,
  normalizeDiscount,
  MAX_FAQ_ITEMS,
  MAX_FAQ_QUESTION_LENGTH,
  MAX_FAQ_ANSWER_LENGTH,
} from '../store-settings-sanitize'

describe('sanitizeFaq', () => {
  it('returns [] for non-array input', () => {
    expect(sanitizeFaq(null)).toEqual([])
    expect(sanitizeFaq('x')).toEqual([])
  })

  it('keeps valid pairs and trims', () => {
    expect(
      sanitizeFaq([{ pergunta: '  Troca? ', resposta: ' Sim ' }]),
    ).toEqual([{ pergunta: 'Troca?', resposta: 'Sim' }])
  })

  it('drops pairs with empty pergunta or resposta', () => {
    expect(
      sanitizeFaq([
        { pergunta: '', resposta: 'a' },
        { pergunta: 'q', resposta: '' },
        { pergunta: 'q', resposta: 'a' },
      ]),
    ).toEqual([{ pergunta: 'q', resposta: 'a' }])
  })

  it('strips HTML tags', () => {
    expect(
      sanitizeFaq([{ pergunta: '<b>oi</b>', resposta: 'a<script>x</script>b' }]),
    ).toEqual([{ pergunta: 'oi', resposta: 'axb' }])
  })

  it('caps question and answer length', () => {
    const long = 'x'.repeat(5000)
    const [item] = sanitizeFaq([{ pergunta: long, resposta: long }])
    expect(item.pergunta).toHaveLength(MAX_FAQ_QUESTION_LENGTH)
    expect(item.resposta).toHaveLength(MAX_FAQ_ANSWER_LENGTH)
  })

  it('caps number of items', () => {
    const many = Array.from({ length: MAX_FAQ_ITEMS + 5 }, () => ({
      pergunta: 'q',
      resposta: 'a',
    }))
    expect(sanitizeFaq(many)).toHaveLength(MAX_FAQ_ITEMS)
  })

  it('ignores non-object entries', () => {
    expect(sanitizeFaq([null, 1, 'x', { pergunta: 'q', resposta: 'a' }])).toEqual([
      { pergunta: 'q', resposta: 'a' },
    ])
  })
})

describe('sanitizeDiscountType', () => {
  it('accepts valid types', () => {
    expect(sanitizeDiscountType('percent_piece')).toBe('percent_piece')
    expect(sanitizeDiscountType('custom')).toBe('custom')
  })
  it('returns null for invalid/unknown', () => {
    expect(sanitizeDiscountType('bogus')).toBeNull()
    expect(sanitizeDiscountType(null)).toBeNull()
    expect(sanitizeDiscountType(5)).toBeNull()
  })
})

describe('sanitizeDiscountValue', () => {
  it('returns null for non-number', () => {
    expect(sanitizeDiscountValue('5')).toBeNull()
    expect(sanitizeDiscountValue(NaN)).toBeNull()
  })
  it('rejects negatives and over-cap', () => {
    expect(sanitizeDiscountValue(-1)).toBeNull()
    expect(sanitizeDiscountValue(1e12)).toBeNull()
  })
  it('rounds to 2 decimals', () => {
    expect(sanitizeDiscountValue(10.999)).toBe(11)
    expect(sanitizeDiscountValue(10.123)).toBe(10.12)
  })
})

describe('normalizeDiscount', () => {
  it('null type clears value and custom', () => {
    expect(normalizeDiscount(null, 50, 'x')).toEqual({
      discount_type: null,
      discount_value: null,
      discount_custom: '',
    })
  })

  it('custom keeps text, clears value', () => {
    expect(normalizeDiscount('custom', 50, '<b>5% acima de 20</b>')).toEqual({
      discount_type: 'custom',
      discount_value: null,
      discount_custom: '5% acima de 20',
    })
  })

  it('numeric type keeps value, clears custom', () => {
    expect(normalizeDiscount('fixed_piece', 5, 'ignored')).toEqual({
      discount_type: 'fixed_piece',
      discount_value: 5,
      discount_custom: '',
    })
  })

  it('clamps percent types to 100', () => {
    expect(normalizeDiscount('percent_order', 150, '')).toEqual({
      discount_type: 'percent_order',
      discount_value: 100,
      discount_custom: '',
    })
  })
})
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run src/lib/__tests__/store-settings-sanitize.test.ts`
Expected: FAIL — "Failed to resolve import '../store-settings-sanitize'".

- [ ] **Step 3: Implementar o módulo**

Criar `src/lib/store-settings-sanitize.ts`:

```ts
export type FaqItem = { pergunta: string; resposta: string }

export type DiscountType =
  | 'percent_piece'
  | 'percent_order'
  | 'fixed_piece'
  | 'custom'

export const MAX_FAQ_ITEMS = 30
export const MAX_FAQ_QUESTION_LENGTH = 200
export const MAX_FAQ_ANSWER_LENGTH = 1000
export const MAX_DISCOUNT_CUSTOM_LENGTH = 280
export const MAX_DISCOUNT_VALUE = 99_999_999.99

const VALID_DISCOUNT_TYPES: DiscountType[] = [
  'percent_piece',
  'percent_order',
  'fixed_piece',
  'custom',
]

function cleanText(input: unknown, maxLength: number): string {
  if (typeof input !== 'string') return ''
  return input.replace(/<[^>]*>/g, '').trim().slice(0, maxLength)
}

export function sanitizeFaq(input: unknown): FaqItem[] {
  if (!Array.isArray(input)) return []
  const out: FaqItem[] = []
  for (const raw of input) {
    if (raw === null || typeof raw !== 'object') continue
    const rec = raw as Record<string, unknown>
    const pergunta = cleanText(rec.pergunta, MAX_FAQ_QUESTION_LENGTH)
    const resposta = cleanText(rec.resposta, MAX_FAQ_ANSWER_LENGTH)
    if (pergunta === '' || resposta === '') continue
    out.push({ pergunta, resposta })
    if (out.length >= MAX_FAQ_ITEMS) break
  }
  return out
}

export function sanitizeDiscountType(input: unknown): DiscountType | null {
  return VALID_DISCOUNT_TYPES.includes(input as DiscountType)
    ? (input as DiscountType)
    : null
}

export function sanitizeDiscountValue(input: unknown): number | null {
  if (typeof input !== 'number' || !Number.isFinite(input)) return null
  if (input < 0 || input > MAX_DISCOUNT_VALUE) return null
  return Math.round(input * 100) / 100
}

export interface NormalizedDiscount {
  discount_type: DiscountType | null
  discount_value: number | null
  discount_custom: string
}

export function normalizeDiscount(
  rawType: unknown,
  rawValue: unknown,
  rawCustom: unknown,
): NormalizedDiscount {
  const type = sanitizeDiscountType(rawType)
  if (type === null) {
    return { discount_type: null, discount_value: null, discount_custom: '' }
  }
  if (type === 'custom') {
    return {
      discount_type: 'custom',
      discount_value: null,
      discount_custom: cleanText(rawCustom, MAX_DISCOUNT_CUSTOM_LENGTH),
    }
  }
  let value = sanitizeDiscountValue(rawValue)
  if (
    (type === 'percent_piece' || type === 'percent_order') &&
    value !== null &&
    value > 100
  ) {
    value = 100
  }
  return { discount_type: type, discount_value: value, discount_custom: '' }
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run src/lib/__tests__/store-settings-sanitize.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/store-settings-sanitize.ts src/lib/__tests__/store-settings-sanitize.test.ts
git commit -m "feat(loja): add faq + discount sanitization helpers with tests"
```

---

## Task 4: Wire no server action

**Files:**
- Modify: `src/actions/store-settings.ts`

- [ ] **Step 1: Importar o módulo**

No topo do arquivo, após os imports existentes (`getAuthedUser`), adicionar:

```ts
import {
  sanitizeFaq,
  normalizeDiscount,
  type FaqItem,
} from '@/lib/store-settings-sanitize'
```

- [ ] **Step 2: Estender o payload de `saveStoreSettings`**

No objeto de parâmetro `data: { ... }`, após `min_order_logic: 'all' | 'any'`, adicionar:

```ts
  faq: FaqItem[]
  discount_type: 'percent_piece' | 'percent_order' | 'fixed_piece' | 'custom' | null
  discount_value: number | null
  discount_custom: string
```

- [ ] **Step 3: Sanitizar antes do upsert**

Depois da linha `const minOrderLogic = sanitizeMinOrderLogic(data.min_order_logic)`, adicionar:

```ts
  const faq = sanitizeFaq(data.faq)
  const discount = normalizeDiscount(
    data.discount_type,
    data.discount_value,
    data.discount_custom,
  )
```

- [ ] **Step 4: Incluir no upsert**

No objeto passado a `.upsert({ ... }, { onConflict: 'id' })`, após `min_order_logic: minOrderLogic,`, adicionar:

```ts
        faq,
        discount_type: discount.discount_type,
        discount_value: discount.discount_value,
        discount_custom: discount.discount_custom,
```

- [ ] **Step 5: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/actions/store-settings.ts
git commit -m "feat(loja): persist faq + discount in saveStoreSettings"
```

---

## Task 5: UI — seção FAQ (Conhecimento)

**Files:**
- Modify: `src/app/loja/LojaForm.tsx`

- [ ] **Step 1: Importar tipos/constantes**

Após `import type { StoreSettings } from '@/types/store-settings'`, adicionar:

```ts
import {
  MAX_FAQ_ITEMS,
  MAX_FAQ_QUESTION_LENGTH,
  MAX_FAQ_ANSWER_LENGTH,
  MAX_DISCOUNT_CUSTOM_LENGTH,
  type FaqItem,
  type DiscountType,
} from '@/lib/store-settings-sanitize'
```

- [ ] **Step 2: Adicionar estado do FAQ**

Junto aos outros `useState` (depois de `minOrderLogic`), adicionar:

```ts
  const [faq, setFaq] = useState<FaqItem[]>(settings?.faq ?? [])
```

- [ ] **Step 3: Renumerar rótulo de Operação**

Na `<SectionHeader>` da seção Operação, trocar:

```tsx
          step="04 · OPERAÇÃO"
```

por:

```tsx
          step="05 · OPERAÇÃO"
```

- [ ] **Step 4: Inserir a seção FAQ**

Imediatamente **antes** de `{/* ── Seção 4 · Operação ───────── */}` (a `<section ... id="sec-operacao">`), inserir:

```tsx
      {/* ── Seção · Conhecimento (FAQ) ───────── */}
      <section className="card p-6" id="sec-conhecimento">
        <SectionHeader
          step="04 · CONHECIMENTO"
          title="Perguntas e respostas"
          description="Cadastre dúvidas frequentes e a resposta que o agente deve usar."
          toneIcon="sparkle"
          tone="brand"
        />

        <div className="space-y-4">
          {faq.length === 0 && (
            <p className="text-[13px] text-ink-400">
              Nenhuma pergunta cadastrada ainda.
            </p>
          )}

          {faq.map((item, idx) => (
            <div
              key={idx}
              className="rounded-xl border border-ink-200 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="eyebrow text-ink-500">PERGUNTA {idx + 1}</span>
                <button
                  type="button"
                  className="text-[12px] font-semibold text-ink-400 hover:text-[#DC2626] transition-colors"
                  onClick={() => setFaq(faq.filter((_, i) => i !== idx))}
                >
                  Remover
                </button>
              </div>

              <div>
                <label className="label" style={{ fontSize: 12 }}>
                  Pergunta
                </label>
                <input
                  className="input"
                  type="text"
                  maxLength={MAX_FAQ_QUESTION_LENGTH}
                  value={item.pergunta}
                  onChange={(e) =>
                    setFaq(
                      faq.map((p, i) =>
                        i === idx ? { ...p, pergunta: e.target.value } : p,
                      ),
                    )
                  }
                  placeholder="Ex: Vocês fazem troca?"
                />
              </div>

              <div>
                <label className="label" style={{ fontSize: 12 }}>
                  Resposta
                </label>
                <textarea
                  className="input"
                  rows={3}
                  maxLength={MAX_FAQ_ANSWER_LENGTH}
                  value={item.resposta}
                  onChange={(e) =>
                    setFaq(
                      faq.map((p, i) =>
                        i === idx ? { ...p, resposta: e.target.value } : p,
                      ),
                    )
                  }
                  placeholder="Ex: Sim, em até 7 dias com a etiqueta."
                />
              </div>
            </div>
          ))}

          {faq.length < MAX_FAQ_ITEMS && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setFaq([...faq, { pergunta: '', resposta: '' }])}
            >
              <Icon name="plus" className="w-4 h-4" />
              Adicionar pergunta
            </button>
          )}
        </div>
      </section>
```

- [ ] **Step 5: Adicionar `faq` ao submit**

No objeto passado a `saveStoreSettings({ ... })` dentro de `handleSubmit`, após `min_order_logic: minOrderLogic,`, adicionar:

```ts
      faq: faq.filter(
        (p) => p.pergunta.trim() !== '' && p.resposta.trim() !== '',
      ),
```

> As linhas de desconto no submit são adicionadas na Task 6.

- [ ] **Step 6: Verificar build/typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add src/app/loja/LojaForm.tsx
git commit -m "feat(loja): add FAQ (perguntas e respostas) section"
```

---

## Task 6: UI — bloco de desconto de atacado

**Files:**
- Modify: `src/app/loja/LojaForm.tsx`

- [ ] **Step 1: Adicionar estado do desconto**

Junto aos outros `useState` (depois de `faq`), adicionar:

```ts
  const [discountType, setDiscountType] = useState<DiscountType | null>(
    settings?.discount_type ?? null,
  )
  const [discountValue, setDiscountValue] = useState<string>(
    settings?.discount_value != null ? String(settings.discount_value) : '',
  )
  const [discountCustom, setDiscountCustom] = useState(
    settings?.discount_custom ?? '',
  )
```

- [ ] **Step 2: Inserir o bloco de desconto dentro do collapsible de pedido mínimo**

Localizar, dentro do collapsible do pedido mínimo, o parágrafo:

```tsx
                  <p className="helper">
                    Pelo menos um dos campos acima é obrigatório quando o
                    pedido mínimo está ativado.
                  </p>
```

Logo **depois** dele (ainda dentro do `<div className="mt-3 ml-4 pl-5 border-l-2 border-brand-100 space-y-4">`), inserir:

```tsx
                  <div className="h-px bg-ink-100" />

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="eyebrow text-ink-500">
                        DESCONTO DE ATACADO (OPCIONAL)
                      </p>
                      {discountType !== null && (
                        <button
                          type="button"
                          className="text-[12px] font-semibold text-ink-400 hover:text-ink-700 transition-colors"
                          onClick={() => setDiscountType(null)}
                        >
                          Sem desconto
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          ['percent_piece', '% por preço da peça'],
                          ['percent_order', '% por preço do pedido'],
                          ['fixed_piece', 'Valor fixo por peça'],
                          ['custom', 'Personalizado'],
                        ] as Array<[DiscountType, string]>
                      ).map(([value, label]) => (
                        <label
                          key={value}
                          className="flex items-center gap-2.5 p-2.5 rounded-lg border border-ink-200 hover:border-brand-200 cursor-pointer text-[12.5px] text-ink-800 font-medium"
                        >
                          <input
                            type="radio"
                            name="discountType"
                            className="radio"
                            checked={discountType === value}
                            onChange={() => setDiscountType(value)}
                          />
                          {label}
                        </label>
                      ))}
                    </div>

                    {(discountType === 'percent_piece' ||
                      discountType === 'percent_order') && (
                      <div
                        className="flex items-center gap-2 mt-3"
                        style={{ maxWidth: 200 }}
                      >
                        <input
                          className="input"
                          type="number"
                          min={0}
                          max={100}
                          step={0.01}
                          value={discountValue}
                          onChange={(e) => setDiscountValue(e.target.value)}
                          placeholder="10"
                        />
                        <span className="text-[13px] text-ink-500 font-medium">
                          %
                        </span>
                      </div>
                    )}

                    {discountType === 'fixed_piece' && (
                      <div
                        className="flex items-center gap-2 mt-3"
                        style={{ maxWidth: 200 }}
                      >
                        <span className="text-[13px] text-ink-500 font-medium">
                          R$
                        </span>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          step={0.01}
                          value={discountValue}
                          onChange={(e) => setDiscountValue(e.target.value)}
                          placeholder="5,00"
                        />
                      </div>
                    )}

                    {discountType === 'custom' && (
                      <input
                        className="input mt-3"
                        type="text"
                        maxLength={MAX_DISCOUNT_CUSTOM_LENGTH}
                        value={discountCustom}
                        onChange={(e) => setDiscountCustom(e.target.value)}
                        placeholder="Ex: 5% acima de 20 peças, 8% acima de 50"
                      />
                    )}
                  </div>
```

- [ ] **Step 3: Adicionar desconto ao submit**

No objeto passado a `saveStoreSettings({ ... })`, após a linha `faq: faq.filter(...)` adicionada na Task 5, adicionar:

```ts
      discount_type: discountType,
      discount_value:
        discountType && discountType !== 'custom' && discountValue.trim() !== ''
          ? parseFloat(discountValue)
          : null,
      discount_custom: discountType === 'custom' ? discountCustom : '',
```

- [ ] **Step 4: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/app/loja/LojaForm.tsx
git commit -m "feat(loja): add wholesale discount block under min order"
```

---

## Task 7: Verificação final (gate)

**Files:** nenhum (só execução/inspeção)

- [ ] **Step 1: Rodar a suíte de testes**

Run: `npm run test`
Expected: PASS (inclui `store-settings-sanitize.test.ts`).

- [ ] **Step 2: Typecheck + lint + build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: sem erros novos.

- [ ] **Step 3: Aplicar a migration no Supabase**

Aplicar `supabase/migrations/033_store_settings_faq_discount.sql` no banco (fluxo de migrations do projeto). Sem isso, o salvamento falha por colunas inexistentes.

- [ ] **Step 4: Teste manual no navegador (`npm run dev` → `/loja`)**

Conferir o gate de testes manuais do spec:

1. Adicionar 2 perguntas, salvar, recarregar → pares restaurados idênticos.
2. Par com pergunta OU resposta vazia + salvar → par não persiste.
3. Adicionar 30 pares → botão "Adicionar pergunta" some.
4. Pedido mínimo ligado → bloco de desconto visível; desligado → some.
5. `% por preço da peça`, valor 15, salvar, recarregar → tipo e valor corretos.
6. `Valor fixo por peça`, R$ 5, salvar → persiste `fixed_piece` + `5.00`.
7. `Personalizado` + texto, salvar → `discount_type='custom'`, `discount_value` nulo.
8. Trocar `custom` → `percent_order` e salvar → `discount_custom` zera no banco.
9. "Sem desconto" → `discount_type` nulo, value/custom limpos.
10. `% por preço do pedido` valor 150, salvar → clamp a 100.

- [ ] **Step 5: Commit final (se houver ajustes)**

```bash
git add -A
git commit -m "test(loja): verify faq + discount flow"
```

---

## Self-Review (preenchido pelo autor do plano)

**Cobertura do spec:**
- Migration 4 colunas → Task 1. ✔
- Tipos → Task 2. ✔
- Sanitização (faq, discount_type/value, normalize, clamp 100, coerência) → Task 3 (+ testes). ✔
- Server action (payload, sanitize, upsert) → Task 4. ✔
- UI FAQ (seção 04, lista de pares, add/remove, limites, estado vazio, filtro no submit) → Task 5. ✔
- UI desconto (dentro do collapsible, radio 4 tipos, inputs condicionais, "Sem desconto", submit) → Task 6. ✔
- Gate de testes manuais → Task 7. ✔
- Fora do escopo (n8n) → não há task, correto. ✔

**Consistência de tipos:** `FaqItem`/`DiscountType` definidos na Task 3 e reusados em 2/4/5/6. `normalizeDiscount` retorna `{discount_type, discount_value, discount_custom}` consumidos igual no upsert (Task 4). Estado `discountType: DiscountType | null` casa com `settings.discount_type` (Task 2).

**Placeholders:** nenhum — todo passo de código tem o código completo.

