# Pedido Mínimo (Atacado) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Pedido Mínimo (Atacado)" configuration block in the `loja` page that persists `min_order_enabled`, `min_order_quantity`, `min_order_value`, and `min_order_logic` to `store_settings`.

**Architecture:** Four new columns in `store_settings` (toggle + qty + value + logic). New `<fieldset>` in `src/app/loja/page.tsx`. `saveStoreSettings` server action extended with sanitization helpers and validation. Storage-only — no agent/widget consumption.

**Tech Stack:** Next.js 16.2.4 (App Router, Turbopack), React 19.2.4, Supabase (`@supabase/ssr` + `@supabase/supabase-js`), Tailwind 4, TypeScript 5.

**Spec:** `docs/superpowers/specs/2026-05-03-pedido-minimo-atacado-design.md`

**Note on testing:** This project has no automated test framework (only `next dev`/`build`/`lint`). Verification is manual: dev server in browser at `http://localhost:3000/loja`, plus `npm run lint` and `npx tsc --noEmit` for static checks. Each task ends with a manual verification step before commit.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `supabase/migrations/010_store_settings_min_order.sql` | Create | DDL for the 4 new columns + CHECK constraints |
| `src/types/database.ts` | Modify | Extend `store_settings` Row/Insert/Update with the 4 new fields |
| `src/actions/store-settings.ts` | Modify | New constants, sanitizers, payload, validation, upsert columns |
| `src/app/loja/page.tsx` | Modify | New `<fieldset>` + state + load + submit conversion |

---

### Task 1: Database migration + generated types

**Files:**
- Create: `supabase/migrations/010_store_settings_min_order.sql`
- Modify: `src/types/database.ts:199-233` (extend `store_settings` Row/Insert/Update)

- [ ] **Step 1: Create migration file**

Create `supabase/migrations/010_store_settings_min_order.sql` with the following content (verbatim):

```sql
ALTER TABLE store_settings
  ADD COLUMN min_order_enabled  BOOLEAN       NOT NULL DEFAULT false,
  ADD COLUMN min_order_quantity INTEGER,
  ADD COLUMN min_order_value    NUMERIC(12,2),
  ADD COLUMN min_order_logic    TEXT          NOT NULL DEFAULT 'all';

ALTER TABLE store_settings
  ADD CONSTRAINT min_order_quantity_positive
    CHECK (min_order_quantity IS NULL OR min_order_quantity >= 1),
  ADD CONSTRAINT min_order_value_non_negative
    CHECK (min_order_value IS NULL OR min_order_value >= 0),
  ADD CONSTRAINT min_order_logic_valid
    CHECK (min_order_logic IN ('all','any'));
```

- [ ] **Step 2: Apply migration to Supabase**

Run the SQL above against the Supabase project (Supabase Studio → SQL Editor → paste and execute, or `supabase db push` if the local CLI is configured).

Expected: `ALTER TABLE` succeeds twice. Verify with this SELECT:

```sql
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'store_settings'
  AND column_name LIKE 'min_order_%'
ORDER BY column_name;
```

Expected rows (4): `min_order_enabled` (boolean, false, NO), `min_order_logic` (text, 'all'::text, NO), `min_order_quantity` (integer, NULL, YES), `min_order_value` (numeric, NULL, YES).

- [ ] **Step 3: Update generated TypeScript types**

In `src/types/database.ts`, replace the `store_settings` block (lines 199-233) with:

```ts
      store_settings: {
        Row: {
          id: string
          store_name: string
          service_steps: string[]
          service_instructions: string
          payment_methods: string[]
          delivery_methods: string[]
          categories: string[]
          min_order_enabled: boolean
          min_order_quantity: number | null
          min_order_value: number | null
          min_order_logic: 'all' | 'any'
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          store_name: string
          service_steps?: string[]
          service_instructions?: string
          payment_methods?: string[]
          delivery_methods?: string[]
          categories?: string[]
          min_order_enabled?: boolean
          min_order_quantity?: number | null
          min_order_value?: number | null
          min_order_logic?: 'all' | 'any'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          store_name?: string
          service_steps?: string[]
          service_instructions?: string
          payment_methods?: string[]
          delivery_methods?: string[]
          categories?: string[]
          min_order_enabled?: boolean
          min_order_quantity?: number | null
          min_order_value?: number | null
          min_order_logic?: 'all' | 'any'
          updated_at?: string
        }
        Relationships: []
      }
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/010_store_settings_min_order.sql src/types/database.ts
git commit -m "feat(db): add minimum order columns to store_settings

Adds min_order_enabled, min_order_quantity, min_order_value,
min_order_logic with CHECK constraints. Updates generated TS types."
```

---

### Task 2: Server action — sanitization, validation, upsert

**Files:**
- Modify: `src/actions/store-settings.ts`

- [ ] **Step 1: Add constants near the top of the file**

Open `src/actions/store-settings.ts`. After the existing `VALID_DELIVERY_METHODS` constant (around line 22-24), add:

```ts
const VALID_MIN_ORDER_LOGIC = ['all', 'any'] as const
type MinOrderLogic = typeof VALID_MIN_ORDER_LOGIC[number]
const MAX_MIN_ORDER_QUANTITY = 1_000_000
const MAX_MIN_ORDER_VALUE = 99_999_999.99
```

- [ ] **Step 2: Add the three sanitizer helpers**

After the existing `sanitizeStringArray` helper (around line 41-46), add:

```ts
function sanitizeMinOrderQuantity(input: unknown): number | null {
  if (typeof input !== 'number' || !Number.isFinite(input)) return null
  const n = Math.floor(input)
  if (n < 1 || n > MAX_MIN_ORDER_QUANTITY) return null
  return n
}

function sanitizeMinOrderValue(input: unknown): number | null {
  if (typeof input !== 'number' || !Number.isFinite(input)) return null
  if (input < 0 || input > MAX_MIN_ORDER_VALUE) return null
  return Math.round(input * 100) / 100
}

function sanitizeMinOrderLogic(input: unknown): MinOrderLogic {
  return input === 'any' ? 'any' : 'all'
}
```

- [ ] **Step 3: Extend the `saveStoreSettings` payload type**

Find the `saveStoreSettings` function signature (around line 53-60). Replace it with:

```ts
export async function saveStoreSettings(data: {
  store_name: string
  service_steps: string[]
  service_instructions: string
  payment_methods: string[]
  delivery_methods: string[]
  categories: string[]
  min_order_enabled: boolean
  min_order_quantity: number | null
  min_order_value: number | null
  min_order_logic: 'all' | 'any'
}): Promise<SaveStoreSettingsResult> {
```

- [ ] **Step 4: Sanitize the new fields inside the action body**

After the existing `const categories = sanitizeStringArray(data.categories, 100)` line (around line 73), add:

```ts
  const minOrderEnabled = data.min_order_enabled === true
  const minOrderQuantity = sanitizeMinOrderQuantity(data.min_order_quantity)
  const minOrderValue = sanitizeMinOrderValue(data.min_order_value)
  const minOrderLogic = sanitizeMinOrderLogic(data.min_order_logic)
```

- [ ] **Step 5: Add the "at least one" validation when enabled**

After the existing `if (paymentMethods.length === 0) { ... }` block (around line 78-80), add:

```ts
  if (minOrderEnabled && minOrderQuantity === null && minOrderValue === null) {
    return { success: false, error: 'Informe quantidade mínima ou valor mínimo.' }
  }
```

- [ ] **Step 6: Include the new fields in the upsert object**

In the `.upsert({ ... }, { onConflict: 'id' })` call (around line 84-94), extend the object literal with the four new keys. The full call should read:

```ts
  const { error: dbError } = await supabase
    .from('store_settings')
    .upsert(
      {
        id: user.id,
        store_name: storeName,
        service_steps: serviceSteps,
        service_instructions: serviceInstructions,
        payment_methods: paymentMethods,
        delivery_methods: deliveryMethods,
        categories,
        min_order_enabled: minOrderEnabled,
        min_order_quantity: minOrderQuantity,
        min_order_value: minOrderValue,
        min_order_logic: minOrderLogic,
      },
      { onConflict: 'id' }
    )
```

- [ ] **Step 7: Verify static checks pass**

Run: `npx tsc --noEmit`
Expected: exit 0, no errors.

Run: `npm run lint`
Expected: exit 0, no errors.

- [ ] **Step 8: Commit**

```bash
git add src/actions/store-settings.ts
git commit -m "feat(actions): persist min order fields in saveStoreSettings

Adds sanitization helpers and validation. When toggle is enabled,
requires at least one of quantity or value. Logic always normalized."
```

---

### Task 3: UI — new fieldset, state, load, submit

**Files:**
- Modify: `src/app/loja/page.tsx`

- [ ] **Step 1: Add the four new state declarations**

In `src/app/loja/page.tsx`, find the existing state block (around line 32-43). After `const [availableCategories, setAvailableCategories] = useState<string[]>([])`, add:

```ts
  const [minOrderEnabled, setMinOrderEnabled] = useState(false)
  const [minOrderQuantity, setMinOrderQuantity] = useState<string>('')
  const [minOrderValue, setMinOrderValue] = useState<string>('')
  const [minOrderLogic, setMinOrderLogic] = useState<'all' | 'any'>('all')
```

- [ ] **Step 2: Populate the new state from loaded settings**

In the `useEffect` `loadSettings` function, find the `if (data) { ... }` block (around line 72-79). Inside that block, after `setCategories(data.categories ?? [])`, add:

```ts
        setMinOrderEnabled(data.min_order_enabled ?? false)
        setMinOrderQuantity(data.min_order_quantity != null ? String(data.min_order_quantity) : '')
        setMinOrderValue(data.min_order_value != null ? String(data.min_order_value) : '')
        setMinOrderLogic(data.min_order_logic === 'any' ? 'any' : 'all')
```

- [ ] **Step 3: Add client-side validation in `handleSubmit`**

In `handleSubmit`, after the existing `if (paymentMethods.length === 0)` block (around line 96-100), add:

```ts
    const parsedQty = minOrderQuantity.trim() === '' ? null : parseInt(minOrderQuantity, 10)
    const parsedValue = minOrderValue.trim() === '' ? null : parseFloat(minOrderValue)
    const cleanQty = Number.isFinite(parsedQty as number) ? parsedQty : null
    const cleanValue = Number.isFinite(parsedValue as number) ? parsedValue : null

    if (minOrderEnabled && cleanQty === null && cleanValue === null) {
      setError('Informe quantidade mínima ou valor mínimo.')
      setLoading(false)
      return
    }
```

- [ ] **Step 4: Pass the new fields to `saveStoreSettings`**

In the same `handleSubmit`, find the `await saveStoreSettings({ ... })` call (around line 102-109). Replace it with:

```ts
    const result = await saveStoreSettings({
      store_name: storeName,
      service_steps: serviceSteps,
      service_instructions: serviceInstructions,
      payment_methods: paymentMethods,
      delivery_methods: deliveryMethods,
      categories,
      min_order_enabled: minOrderEnabled,
      min_order_quantity: cleanQty,
      min_order_value: cleanValue,
      min_order_logic: minOrderLogic,
    })
```

- [ ] **Step 5: Add the new fieldset to the JSX**

In the JSX, find the `{/* Formas de Pagamento */}` comment (around line 226). **Immediately before** that comment, insert the following block:

```tsx
        {/* Pedido Mínimo (Atacado) */}
        <fieldset>
          <legend className="block text-sm font-medium text-gray-700 mb-2">
            Pedido Mínimo (Atacado)
          </legend>
          <p className="text-xs text-gray-500 mb-3">
            Defina um pedido mínimo para vendas no atacado. Pode ser por quantidade de peças, por valor, ou ambos.
          </p>

          <label className="flex items-center gap-2 cursor-pointer mb-3">
            <input
              type="checkbox"
              checked={minOrderEnabled}
              onChange={() => setMinOrderEnabled(v => !v)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">Exigir pedido mínimo</span>
          </label>

          {minOrderEnabled && (
            <div className="space-y-3 pl-6">
              <div>
                <label htmlFor="minOrderQuantity" className="block text-sm font-medium text-gray-700 mb-1">
                  Quantidade mínima de peças
                </label>
                <input
                  id="minOrderQuantity"
                  type="number"
                  min={1}
                  step={1}
                  value={minOrderQuantity}
                  onChange={e => setMinOrderQuantity(e.target.value)}
                  className="w-40 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Ex: 10"
                />
              </div>

              <div>
                <label htmlFor="minOrderValue" className="block text-sm font-medium text-gray-700 mb-1">
                  Valor mínimo do pedido (R$)
                </label>
                <input
                  id="minOrderValue"
                  type="number"
                  min={0}
                  step={0.01}
                  value={minOrderValue}
                  onChange={e => setMinOrderValue(e.target.value)}
                  className="w-40 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Ex: 500.00"
                />
              </div>

              {minOrderQuantity.trim() !== '' && minOrderValue.trim() !== '' && (
                <fieldset>
                  <legend className="block text-sm font-medium text-gray-700 mb-2">
                    Quando ambos os critérios estão definidos:
                  </legend>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="minOrderLogic"
                        value="all"
                        checked={minOrderLogic === 'all'}
                        onChange={() => setMinOrderLogic('all')}
                        className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">Exigir os dois (quantidade E valor)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="minOrderLogic"
                        value="any"
                        checked={minOrderLogic === 'any'}
                        onChange={() => setMinOrderLogic('any')}
                        className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">Exigir qualquer um (quantidade OU valor)</span>
                    </label>
                  </div>
                </fieldset>
              )}
            </div>
          )}
        </fieldset>

```

- [ ] **Step 6: Verify static checks pass**

Run: `npx tsc --noEmit`
Expected: exit 0, no errors.

Run: `npm run lint`
Expected: exit 0, no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/loja/page.tsx
git commit -m "feat(loja): add wholesale minimum order fieldset

New 'Pedido Mínimo (Atacado)' section with toggle, optional
quantity and value inputs, and AND/OR radio when both filled.
Loads existing values; client-side validates 'enabled requires
at least one'."
```

---

### Task 4: End-to-end manual verification

**Files:** none (browser-driven verification at `http://localhost:3000/loja`)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected output includes: `▲ Next.js 16.2.4` and `Ready in <ms>`. Leave running.

- [ ] **Step 2: Verify case 1 — toggle off**

In the browser:
1. Navigate to `http://localhost:3000/loja`. Login if redirected.
2. Leave "Exigir pedido mínimo" **unchecked**.
3. Fill the rest of the form normally and click "Salvar Configurações".
4. Expect green "Configurações salvas com sucesso!".

In Supabase Studio (or psql), run:
```sql
SELECT min_order_enabled, min_order_quantity, min_order_value, min_order_logic
FROM store_settings WHERE id = '<your user id>';
```
Expected: `false, NULL, NULL, 'all'`.

- [ ] **Step 3: Verify case 2 — toggle on, only quantity**

1. Check "Exigir pedido mínimo".
2. Type `10` in "Quantidade mínima de peças". Leave value empty.
3. Confirm the AND/OR radio block does NOT appear.
4. Click "Salvar Configurações". Expect success.
5. Reload page. Expect: toggle on, quantity = `10`, value empty, no radio shown.

DB row should read: `true, 10, NULL, 'all'`.

- [ ] **Step 4: Verify case 3 — toggle on, only value**

1. Clear quantity. Type `500` in "Valor mínimo do pedido (R$)".
2. Confirm AND/OR radio still hidden (only one filled).
3. Save. Reload. Expect: toggle on, quantity empty, value = `500`.

DB row: `true, NULL, 500.00, 'all'`.

- [ ] **Step 5: Verify case 4 — both filled, choose OR**

1. Type `10` in quantity, `500` in value.
2. AND/OR radio block appears.
3. Select "Exigir qualquer um".
4. Save. Reload. Expect: both fields populated, radio "Exigir qualquer um" checked.

DB row: `true, 10, 500.00, 'any'`.

- [ ] **Step 6: Verify case 5 — toggle on, both empty (validation)**

1. Clear both fields, keep toggle on.
2. Click Save. Expect inline red error: **"Informe quantidade mínima ou valor mínimo."**
3. Open browser DevTools → Network. Confirm **no** POST/server-action request was sent for this submit.

- [ ] **Step 7: Verify case 6 — toggle off preserves draft**

1. With toggle on and `10`/`500` filled, uncheck the toggle. The number inputs should disappear from the DOM.
2. Save. DB row should now read `false, 10, 500.00, 'any'` (rascunho preserved).
3. Re-check the toggle. The fields should re-appear with `10` and `500` still in them (state preserved in memory and reloaded from DB).

- [ ] **Step 8: Verify case 7 — sanitizer rejects huge value**

1. Toggle on. Type `999999999.99` in value (one too many 9s — exceeds `NUMERIC(12,2)` cap).
2. Save. Reload. Expect: value is **empty** in the form (sanitizer returned null).

DB row should have `min_order_value = NULL`. (This confirms the safety net; it is acceptable that the UI silently drops the over-cap input — wholesale stores do not need values above R$ 99M.)

- [ ] **Step 9: Final commit (if any verification reveals fixes)**

If steps 1-8 pass cleanly, no extra commit needed.
If any step revealed a bug, fix in the smallest possible diff, re-run that step, then:

```bash
git add <fixed files>
git commit -m "fix(loja): <short description from verification step>"
```

---

## Self-Review Checklist (already run)

- [x] **Spec coverage:** Schema (Task 1) ✓, Server action (Task 2) ✓, UI (Task 3) ✓, Tipos (Task 1) ✓, Casos de erro (Tasks 2 step 5, Task 3 step 3) ✓, Testes manuais (Task 4) ✓.
- [x] **Placeholder scan:** No TBDs/TODOs/"add error handling"/etc. Each step has full code or full command.
- [x] **Type consistency:** `min_order_logic` typed as `'all' | 'any'` everywhere (Database type, action signature, page state, sanitizer return). Field names identical across files.
