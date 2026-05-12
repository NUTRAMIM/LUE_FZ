# Estoque Redesign — Leva 1 (read-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a tabela básica de `/estoque` pela versão rica do screenshot (KPIs, busca, filtros, chips de variantes, status, drawer "Ver Detalhes") — somente leitura. Mutations (CRUD) ficam para Leva 2.

**Architecture:** Server Component (`page.tsx`) busca `products` + `store_settings` e entrega ao `EstoqueClient` (client). Estado de busca/filtro/drawer/aba fica client-side. Status de estoque calculado em helper puro (`stock-status.ts`) com cobertura unitária. Novo primitive `Drawer` adicionado a `src/components/ui/`. Os 4 botões de ação aparecem mas ficam desabilitados (ativam na Leva 2).

**Tech Stack:** Next.js 16 App Router + React 19, Supabase SSR client, Tailwind 4 + design system violet (`src/components/ui/`), Vitest para helpers.

**Spec:** `docs/superpowers/specs/2026-05-12-estoque-redesign-design.md`

---

## File Structure

**Create:**
- `supabase/migrations/017_products_stock_min.sql`
- `src/lib/stock-status.ts`
- `src/lib/__tests__/stock-status.test.ts`
- `src/components/ui/Drawer.tsx`
- `src/components/estoque/KpiSection.tsx`
- `src/components/estoque/FilterBar.tsx`
- `src/components/estoque/ProductTable.tsx`
- `src/components/estoque/ProductRow.tsx`
- `src/components/estoque/ProductDetailsDrawer.tsx`
- `src/app/estoque/EstoqueClient.tsx`

**Modify:**
- `src/types/database.ts` — adicionar `stock_min` em products e `default_stock_min` em store_settings
- `src/app/estoque/page.tsx` — substituir conteúdo por shell + `EstoqueClient`

**Pré-existente conhecido:** `src/app/api/inventory/import/route.ts:111` tem TS error (`user_id` faltando). NÃO corrigir neste plano. Não bloqueia `next dev` nem este redesign.

---

### Task 0: Setup de branch

**Files:** (nenhum modificado — só git)

- [ ] **Step 1: Verificar working tree atual**

Run: `git status --short`

Se houver mudanças não commitadas que **não pertencem** ao redesign (ex.: `src/app/loja/LojaForm.tsx` com chip input, `src/app/globals.css` do redesign brand), elas devem ser commitadas, stasheadas ou movidas para outra branch primeiro. **Não misturar com este plano.**

- [ ] **Step 2: Criar e mudar para branch dedicada**

Run:
```bash
git checkout -b feat/estoque-redesign-leva-1
```

Expected: `Switched to a new branch 'feat/estoque-redesign-leva-1'`

Se já estiver nessa branch, pular o comando.

---

### Task 1: Migration — `stock_min` e `default_stock_min`

**Files:**
- Create: `supabase/migrations/017_products_stock_min.sql`

- [ ] **Step 1: Criar arquivo de migration**

```sql
-- 017_products_stock_min.sql
-- Adiciona estoque mínimo por produto e default global da loja.
-- stock_min = 0 significa "usar default da loja".

ALTER TABLE products
  ADD COLUMN stock_min int NOT NULL DEFAULT 0;

ALTER TABLE store_settings
  ADD COLUMN default_stock_min int NOT NULL DEFAULT 5;
```

- [ ] **Step 2: Aplicar migration localmente**

Verificar como o time aplica migrations (Supabase CLI, dashboard ou script). O padrão do repo é arquivos SQL numerados em `supabase/migrations/` — assumir que outro processo aplica.

Marcar este passo como concluído após confirmar que o arquivo foi criado com o conteúdo acima.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/017_products_stock_min.sql
git commit -m "feat(db): add stock_min to products and default_stock_min to store_settings"
```

---

### Task 2: Atualizar tipos do banco

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Adicionar campos novos em products e store_settings**

Abrir `src/types/database.ts`. Localizar o bloco `products` e adicionar `stock_min: number` na `Row`, `stock_min?: number` em `Insert` e `Update`. Localizar `store_settings` e adicionar `default_stock_min: number` na `Row`, `default_stock_min?: number` em `Insert` e `Update`.

Use Grep antes pra confirmar onde estão os blocos:
```
Grep "stock_quantity:" src/types/database.ts -n
```

Edição de exemplo (a posição exata depende do arquivo):

```ts
// dentro de products.Row:
          stock_quantity: number
          stock_min: number   // ← novo

// dentro de products.Insert e Update:
          stock_quantity?: number
          stock_min?: number  // ← novo

// dentro de store_settings.Row (após o último campo existente):
          default_stock_min: number   // ← novo

// dentro de store_settings.Insert e Update:
          default_stock_min?: number  // ← novo
```

- [ ] **Step 2: Confirmar que `tsc --noEmit` não regressa erros (apenas o pré-existente conhecido)**

Run: `npx tsc --noEmit 2>&1 | head -50`

Expected: o único erro deve continuar sendo `src/app/api/inventory/import/route.ts(111,3): error TS2741: Property 'user_id' is missing...`. Nenhum erro novo.

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts
git commit -m "feat(types): add stock_min and default_stock_min to database types"
```

---

### Task 3: Helpers de status de estoque (TDD)

**Files:**
- Create: `src/lib/stock-status.ts`
- Test: `src/lib/__tests__/stock-status.test.ts`

- [ ] **Step 1: Escrever testes que falham**

`src/lib/__tests__/stock-status.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getEffectiveStockMin, getStockStatus } from '../stock-status'

describe('getEffectiveStockMin', () => {
  it('returns product stock_min when greater than 0', () => {
    expect(getEffectiveStockMin({ stock_min: 10 }, 5)).toBe(10)
  })

  it('returns default when product stock_min is 0', () => {
    expect(getEffectiveStockMin({ stock_min: 0 }, 5)).toBe(5)
  })

  it('returns default when product stock_min is missing (null)', () => {
    expect(getEffectiveStockMin({ stock_min: null as unknown as number }, 5)).toBe(5)
  })
})

describe('getStockStatus', () => {
  it('returns "sem" when stock quantity is 0', () => {
    expect(getStockStatus(0, 5)).toBe('sem')
  })

  it('returns "baixo" when stock <= effectiveMin and effectiveMin > 0', () => {
    expect(getStockStatus(5, 5)).toBe('baixo')
    expect(getStockStatus(3, 5)).toBe('baixo')
    expect(getStockStatus(1, 5)).toBe('baixo')
  })

  it('returns "ok" when stock > effectiveMin', () => {
    expect(getStockStatus(6, 5)).toBe('ok')
    expect(getStockStatus(100, 5)).toBe('ok')
  })

  it('returns "ok" when effectiveMin is 0 (default disabled) and stock > 0', () => {
    expect(getStockStatus(1, 0)).toBe('ok')
  })
})
```

- [ ] **Step 2: Rodar testes e verificar que falham**

Run: `npx vitest run src/lib/__tests__/stock-status.test.ts`

Expected: erros do tipo "Cannot find module '../stock-status'" ou export não definido.

- [ ] **Step 3: Implementar helpers**

`src/lib/stock-status.ts`:

```ts
export type StockStatus = 'ok' | 'baixo' | 'sem'

export function getEffectiveStockMin(
  product: { stock_min: number | null | undefined },
  defaultMin: number,
): number {
  const min = product.stock_min ?? 0
  return min > 0 ? min : defaultMin
}

export function getStockStatus(stockQty: number, effectiveMin: number): StockStatus {
  if (stockQty === 0) return 'sem'
  if (effectiveMin > 0 && stockQty <= effectiveMin) return 'baixo'
  return 'ok'
}
```

- [ ] **Step 4: Rodar testes e verificar que passam**

Run: `npx vitest run src/lib/__tests__/stock-status.test.ts`

Expected: 7 tests passing (3 em `getEffectiveStockMin`, 4 em `getStockStatus`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/stock-status.ts src/lib/__tests__/stock-status.test.ts
git commit -m "feat(stock): add status calculation helpers with tests"
```

---

### Task 4: Primitive `Drawer`

**Files:**
- Create: `src/components/ui/Drawer.tsx`

- [ ] **Step 1: Implementar componente**

```tsx
'use client'

import { useEffect } from 'react'
import { cn } from '@/lib/utils'

export function Drawer({
  open,
  onClose,
  title,
  children,
  side = 'right',
  widthClass = 'max-w-md sm:max-w-lg',
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  side?: 'right' | 'left'
  widthClass?: string
}) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  return (
    <div
      aria-hidden={!open}
      className={cn(
        'fixed inset-0 z-50 transition-opacity duration-200',
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      <div
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'absolute top-0 h-full w-full bg-white shadow-2xl transition-transform duration-200',
          widthClass,
          side === 'right' ? 'right-0' : 'left-0',
          open
            ? 'translate-x-0'
            : side === 'right'
              ? 'translate-x-full'
              : '-translate-x-full',
        )}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="font-display text-lg font-semibold text-slate-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>
        <div className="h-[calc(100%-65px)] overflow-y-auto px-5 py-4">
          {children}
        </div>
      </aside>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/Drawer.tsx
git commit -m "feat(ui): add Drawer primitive (overlay + side panel)"
```

---

### Task 5: `KpiSection`

**Files:**
- Create: `src/components/estoque/KpiSection.tsx`

- [ ] **Step 1: Implementar componente**

```tsx
import { StatCard } from '@/components/ui/StatCard'

export interface KpiData {
  totalProducts: number
  totalUnits: number
  lowStockCount: number
  outOfStockCount: number
  totalValue: number
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function KpiSection({ data }: { data: KpiData }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      <StatCard
        label="Total de Produtos"
        value={data.totalProducts}
        tone="brand"
        emphasis="value"
      />
      <StatCard
        label="Total em Estoque"
        value={data.totalUnits}
        hint="unidades"
        tone="info"
        emphasis="value"
      />
      <StatCard
        label="Estoque Baixo"
        value={data.lowStockCount}
        hint="produtos"
        tone="warning"
        emphasis="value"
      />
      <StatCard
        label="Sem Estoque"
        value={data.outOfStockCount}
        hint="produtos"
        tone="danger"
        emphasis="value"
      />
      <StatCard
        label="Valor Total"
        value={formatBRL(data.totalValue)}
        hint="em estoque"
        tone="success"
        emphasis="value"
      />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/estoque/KpiSection.tsx
git commit -m "feat(estoque): add KpiSection with 5 stat cards"
```

---

### Task 6: `FilterBar`

**Files:**
- Create: `src/components/estoque/FilterBar.tsx`

- [ ] **Step 1: Implementar componente**

```tsx
'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'

export type StatusFilter = 'todos' | 'baixo' | 'sem'

const filterButtons: { key: StatusFilter; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'baixo', label: 'Estoque Baixo' },
  { key: 'sem', label: 'Sem Estoque' },
]

export function FilterBar({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  onAddProduct,
}: {
  search: string
  onSearchChange: (v: string) => void
  statusFilter: StatusFilter
  onStatusFilterChange: (f: StatusFilter) => void
  onAddProduct: () => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center">
      <div className="relative flex-1">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <Input
          type="search"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Buscar produto por nome ou categoria..."
          className="pl-9"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {filterButtons.map(f => (
          <button
            key={f.key}
            type="button"
            onClick={() => onStatusFilterChange(f.key)}
            className={cn(
              'h-10 rounded-lg px-3 text-sm font-semibold transition-all',
              statusFilter === f.key
                ? 'bg-brand-600 text-white shadow-[0_6px_18px_-6px_rgba(124,58,237,0.55)]'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50',
            )}
          >
            {f.label}
          </button>
        ))}
        <Link
          href="/estoque/import"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Importar JSON
        </Link>
        <Button onClick={onAddProduct} disabled>
          + Adicionar Produto
        </Button>
      </div>
    </div>
  )
}
```

Nota: "Adicionar Produto" fica `disabled` — ativa na Leva 2.

- [ ] **Step 2: Commit**

```bash
git add src/components/estoque/FilterBar.tsx
git commit -m "feat(estoque): add FilterBar with search and status filters"
```

---

### Task 7: `ProductRow` e `ProductTable`

**Files:**
- Create: `src/components/estoque/ProductRow.tsx`
- Create: `src/components/estoque/ProductTable.tsx`

- [ ] **Step 1: Implementar `ProductRow`**

`src/components/estoque/ProductRow.tsx`:

```tsx
'use client'

import { Badge, type BadgeTone } from '@/components/ui/Badge'
import type { Product } from '@/types/product'
import type { StockStatus } from '@/lib/stock-status'

const statusConfig: Record<StockStatus, { label: string; tone: BadgeTone }> = {
  ok: { label: 'OK', tone: 'success' },
  baixo: { label: 'Baixo', tone: 'warning' },
  sem: { label: 'Sem Estoque', tone: 'danger' },
}

function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function ProductRow({
  product,
  effectiveMin,
  status,
  onViewDetails,
}: {
  product: Product
  effectiveMin: number
  status: StockStatus
  onViewDetails: () => void
}) {
  const firstImage = product.image_urls?.[0]
  const totalValue = product.stock_quantity * Number(product.price)
  const cfg = statusConfig[status]

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex items-center gap-3">
          {firstImage ? (
            <img
              src={firstImage}
              alt={product.name}
              className="h-10 w-10 rounded-lg object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-400 text-xs">
              —
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">
              {product.name}
            </div>
            <div className="truncate text-xs text-slate-500 max-w-xs">
              {product.description ?? `SKU: ${product.sku}`}
            </div>
          </div>
        </div>
      </td>

      <td className="px-4 py-3 whitespace-nowrap text-sm text-slate-600">
        {product.category || '—'}
      </td>

      <td className="px-4 py-3 text-sm">
        <div className="flex flex-wrap gap-1 max-w-xs">
          {(product.tamanhos ?? []).map(t => (
            <Badge key={`t-${t}`} tone="neutral">{t}</Badge>
          ))}
          {(product.cores ?? []).map(c => (
            <Badge key={`c-${c}`} tone="neutral">{c}</Badge>
          ))}
          {(!product.tamanhos?.length && !product.cores?.length) && (
            <span className="text-slate-400">—</span>
          )}
        </div>
      </td>

      <td className="px-4 py-3 whitespace-nowrap text-center font-display text-lg font-bold tabular-nums text-slate-900">
        {product.stock_quantity}
      </td>

      <td className="px-4 py-3 whitespace-nowrap text-center text-sm tabular-nums text-slate-500">
        {effectiveMin}
      </td>

      <td className="px-4 py-3 whitespace-nowrap text-center">
        <Badge tone={cfg.tone}>{cfg.label}</Badge>
      </td>

      <td className="px-4 py-3 whitespace-nowrap text-right text-sm tabular-nums text-slate-900">
        {formatBRL(Number(product.price))}
      </td>

      <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-semibold tabular-nums text-success">
        {formatBRL(totalValue)}
      </td>

      <td className="px-4 py-3 whitespace-nowrap">
        <button
          type="button"
          onClick={onViewDetails}
          className="inline-flex items-center gap-1.5 rounded-lg border border-info/20 bg-info-soft px-3 py-1.5 text-xs font-semibold text-info hover:bg-info/10"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          Ver Detalhes
        </button>
      </td>

      <td className="px-4 py-3 whitespace-nowrap">
        <div className="flex items-center gap-1">
          <ActionIconButton title="Aumentar" tone="success" disabled>↑</ActionIconButton>
          <ActionIconButton title="Diminuir" tone="danger" disabled>↓</ActionIconButton>
          <ActionIconButton title="Editar" tone="info" disabled>✎</ActionIconButton>
          <ActionIconButton title="Excluir" tone="danger" disabled>🗑</ActionIconButton>
        </div>
      </td>
    </tr>
  )
}

type ActionTone = 'success' | 'danger' | 'info'

const actionPalette: Record<ActionTone, string> = {
  success: 'border-success/20 text-success bg-success-soft hover:bg-success/10',
  danger: 'border-danger/20 text-danger bg-danger-soft hover:bg-danger/10',
  info: 'border-info/20 text-info bg-info-soft hover:bg-info/10',
}

function ActionIconButton({
  children,
  title,
  tone,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  title: string
  tone: ActionTone
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-lg border text-sm disabled:opacity-40 disabled:cursor-not-allowed ${actionPalette[tone]}`}
    >
      {children}
    </button>
  )
}
```

- [ ] **Step 2: Implementar `ProductTable`**

`src/components/estoque/ProductTable.tsx`:

```tsx
'use client'

import type { Product } from '@/types/product'
import type { StockStatus } from '@/lib/stock-status'
import { ProductRow } from './ProductRow'

export interface ProductRowData {
  product: Product
  effectiveMin: number
  status: StockStatus
}

export function ProductTable({
  rows,
  onViewDetails,
}: {
  rows: ProductRowData[]
  onViewDetails: (productId: string) => void
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        Nenhum produto encontrado com os filtros atuais.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr>
            <Th>Produto</Th>
            <Th>Categoria</Th>
            <Th>Variantes</Th>
            <Th align="center">Estoque</Th>
            <Th align="center">Mín.</Th>
            <Th align="center">Status</Th>
            <Th align="right">Preço</Th>
            <Th align="right">Valor Total</Th>
            <Th>Detalhes</Th>
            <Th>Ações</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {rows.map(r => (
            <ProductRow
              key={r.product.id}
              product={r.product}
              effectiveMin={r.effectiveMin}
              status={r.status}
              onViewDetails={() => onViewDetails(r.product.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode
  align?: 'left' | 'center' | 'right'
}) {
  return (
    <th
      className={`px-4 py-3 text-${align} text-[11px] font-semibold uppercase tracking-[0.10em] text-slate-500`}
    >
      {children}
    </th>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/estoque/ProductRow.tsx src/components/estoque/ProductTable.tsx
git commit -m "feat(estoque): add ProductTable and ProductRow with variants chips and status badge"
```

---

### Task 8: `ProductDetailsDrawer`

**Files:**
- Create: `src/components/estoque/ProductDetailsDrawer.tsx`

- [ ] **Step 1: Implementar componente**

```tsx
'use client'

import { Drawer } from '@/components/ui/Drawer'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import type { Product } from '@/types/product'
import type { StockStatus } from '@/lib/stock-status'

const statusConfig: Record<StockStatus, { label: string; tone: BadgeTone }> = {
  ok: { label: 'OK', tone: 'success' },
  baixo: { label: 'Estoque Baixo', tone: 'warning' },
  sem: { label: 'Sem Estoque', tone: 'danger' },
}

function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function ProductDetailsDrawer({
  product,
  effectiveMin,
  status,
  open,
  onClose,
}: {
  product: Product | null
  effectiveMin: number
  status: StockStatus
  open: boolean
  onClose: () => void
}) {
  if (!product) {
    return <Drawer open={open} onClose={onClose} title="" />
  }

  const cfg = statusConfig[status]
  const images = product.image_urls ?? []
  const comparePrice = product.compare_at_price ? Number(product.compare_at_price) : null
  const price = Number(product.price)

  return (
    <Drawer open={open} onClose={onClose} title={product.name}>
      <div className="space-y-5">
        {images.length > 0 && (
          <div className="space-y-2">
            {images.map((url, i) => (
              <img
                key={i}
                src={url}
                alt={`${product.name} ${i + 1}`}
                className="w-full rounded-xl border border-slate-200 object-cover"
              />
            ))}
          </div>
        )}

        <section className="space-y-2">
          <InfoLine label="SKU" value={product.sku} />
          <InfoLine label="Categoria" value={product.category || '—'} />
          {product.description && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.10em] text-slate-500">
                Descrição
              </p>
              <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">
                {product.description}
              </p>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.10em] text-slate-500">
                Preço
              </p>
              <p className="mt-1 font-display text-2xl font-bold tabular-nums text-slate-900">
                {formatBRL(price)}
              </p>
            </div>
            {comparePrice && comparePrice !== price && (
              <p className="text-sm tabular-nums text-slate-400 line-through">
                {formatBRL(comparePrice)}
              </p>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.10em] text-slate-500">
                Estoque
              </p>
              <p className="mt-1 font-display text-2xl font-bold tabular-nums text-slate-900">
                {product.stock_quantity}
              </p>
              <p className="text-xs text-slate-500">Mínimo: {effectiveMin}</p>
            </div>
            <Badge tone={cfg.tone}>{cfg.label}</Badge>
          </div>
        </section>

        {(product.tamanhos?.length || product.cores?.length) && (
          <section className="space-y-3">
            {product.tamanhos?.length ? (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.10em] text-slate-500 mb-2">
                  Tamanhos
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {product.tamanhos.map(t => (
                    <Badge key={t} tone="neutral">{t}</Badge>
                  ))}
                </div>
              </div>
            ) : null}
            {product.cores?.length ? (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.10em] text-slate-500 mb-2">
                  Cores
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {product.cores.map(c => (
                    <Badge key={c} tone="neutral">{c}</Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        )}
      </div>
    </Drawer>
  )
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/estoque/ProductDetailsDrawer.tsx
git commit -m "feat(estoque): add ProductDetailsDrawer with images, price, stock and variants"
```

---

### Task 9: `EstoqueClient` (orquestra estado)

**Files:**
- Create: `src/app/estoque/EstoqueClient.tsx`

- [ ] **Step 1: Implementar orquestrador**

```tsx
'use client'

import { useMemo, useState } from 'react'
import type { Product } from '@/types/product'
import { getEffectiveStockMin, getStockStatus } from '@/lib/stock-status'
import { KpiSection } from '@/components/estoque/KpiSection'
import { FilterBar, type StatusFilter } from '@/components/estoque/FilterBar'
import { ProductTable, type ProductRowData } from '@/components/estoque/ProductTable'
import { ProductDetailsDrawer } from '@/components/estoque/ProductDetailsDrawer'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'

type View = 'produtos' | 'detalhado'

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function EstoqueClient({
  products,
  defaultStockMin,
}: {
  products: Product[]
  defaultStockMin: number
}) {
  const [view, setView] = useState<View>('produtos')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todos')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Pre-compute derived data for all products (status + effectiveMin)
  const allRows: ProductRowData[] = useMemo(() => {
    return products.map(p => {
      const effectiveMin = getEffectiveStockMin(p, defaultStockMin)
      const status = getStockStatus(p.stock_quantity, effectiveMin)
      return { product: p, effectiveMin, status }
    })
  }, [products, defaultStockMin])

  // KPI numbers come from ALL products (not filtered)
  const kpi = useMemo(() => {
    return {
      totalProducts: products.length,
      totalUnits: allRows.reduce((sum, r) => sum + r.product.stock_quantity, 0),
      lowStockCount: allRows.filter(r => r.status === 'baixo').length,
      outOfStockCount: allRows.filter(r => r.status === 'sem').length,
      totalValue: allRows.reduce(
        (sum, r) => sum + r.product.stock_quantity * Number(r.product.price),
        0,
      ),
    }
  }, [products, allRows])

  // Apply filters
  const filteredRows = useMemo(() => {
    const q = normalize(search.trim())
    return allRows.filter(r => {
      if (statusFilter === 'baixo' && r.status !== 'baixo') return false
      if (statusFilter === 'sem' && r.status !== 'sem') return false
      if (!q) return true
      const haystack = normalize(
        `${r.product.name} ${r.product.category ?? ''} ${r.product.sku}`,
      )
      return haystack.includes(q)
    })
  }, [allRows, search, statusFilter])

  const selectedRow = selectedId
    ? allRows.find(r => r.product.id === selectedId) ?? null
    : null

  return (
    <div className="space-y-6">
      <ViewTabs view={view} onChange={setView} />

      {view === 'produtos' ? (
        <>
          <KpiSection data={kpi} />
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            onAddProduct={() => {
              // ativado na Leva 2
            }}
          />
          <ProductTable rows={filteredRows} onViewDetails={id => setSelectedId(id)} />
        </>
      ) : (
        <EmptyState
          title="Visualização por variante em breve"
          description="Estamos preparando a vista detalhada por variante (cor × tamanho)."
        />
      )}

      <ProductDetailsDrawer
        product={selectedRow?.product ?? null}
        effectiveMin={selectedRow?.effectiveMin ?? 0}
        status={selectedRow?.status ?? 'ok'}
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
      />
    </div>
  )
}

function ViewTabs({
  view,
  onChange,
}: {
  view: View
  onChange: (v: View) => void
}) {
  const tabs: { key: View; label: string; icon: React.ReactNode }[] = [
    {
      key: 'produtos',
      label: 'Produtos',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        </svg>
      ),
    },
    {
      key: 'detalhado',
      label: 'Estoque Detalhado',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </svg>
      ),
    },
  ]
  return (
    <div className="flex gap-2">
      {tabs.map(t => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={cn(
            'inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition-all',
            view === t.key
              ? 'bg-brand-600 text-white shadow-[0_6px_18px_-6px_rgba(124,58,237,0.55)]'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50',
          )}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Confirmar tipos**

Run: `npx tsc --noEmit 2>&1 | head -50`

Expected: apenas o erro pré-existente em `route.ts:111`. Nenhum erro novo.

- [ ] **Step 3: Commit**

```bash
git add src/app/estoque/EstoqueClient.tsx
git commit -m "feat(estoque): add EstoqueClient orchestrator with view tabs and filters"
```

---

### Task 10: Substituir `page.tsx` por shell server

**Files:**
- Modify: `src/app/estoque/page.tsx`

- [ ] **Step 1: Substituir conteúdo completo**

Substituir o arquivo inteiro por:

```tsx
import { createClient } from '@/lib/supabase/server'
import type { Product } from '@/types/product'
import { PageHeader } from '@/components/ui/PageHeader'
import { EstoqueClient } from './EstoqueClient'

export const dynamic = 'force-dynamic'

export default async function EstoquePage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: productsData, error: productsError }, { data: settings }] = await Promise.all([
    supabase.from('products').select('*').order('name', { ascending: true }),
    user
      ? supabase
          .from('store_settings')
          .select('default_stock_min')
          .eq('id', user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const products = (productsData ?? []) as Product[]
  const defaultStockMin = settings?.default_stock_min ?? 5

  return (
    <div className="p-6">
      <PageHeader
        title="Controle de Estoque"
        subtitle="Gerencie o estoque de todos os produtos"
      />

      {productsError && (
        <div className="mb-4 rounded-xl border border-danger/20 bg-danger-soft p-4 text-sm text-danger">
          Erro ao carregar produtos: {productsError.message}
        </div>
      )}

      <EstoqueClient
        products={products}
        defaultStockMin={defaultStockMin}
      />
    </div>
  )
}
```

- [ ] **Step 2: Confirmar tipos**

Run: `npx tsc --noEmit 2>&1 | head -50`

Expected: apenas o erro pré-existente em `route.ts:111`. Nenhum erro novo.

- [ ] **Step 3: Rodar testes (regressão)**

Run: `npm test`

Expected: tests passam (incluindo os novos de `stock-status`).

- [ ] **Step 4: Commit**

```bash
git add src/app/estoque/page.tsx
git commit -m "feat(estoque): rewrite /estoque page as server shell + EstoqueClient"
```

---

### Task 11: Verificação manual

**Files:** (nenhum)

- [ ] **Step 1: Subir dev server**

Run: `npm run dev`

Abrir `http://localhost:3000/estoque` logado como usuário com produtos.

- [ ] **Step 2: Checklist visual**

Confirmar:
- [ ] 5 KPI cards aparecem com valores corretos (somar/contar à mão se necessário)
- [ ] Toggle "Produtos" / "Estoque Detalhado" funciona; aba detalhada mostra "em breve"
- [ ] Busca por nome filtra a tabela (case-insensitive, ignora acentos)
- [ ] Busca por categoria filtra a tabela
- [ ] Filtro "Estoque Baixo" só mostra produtos com status baixo
- [ ] Filtro "Sem Estoque" só mostra produtos com `stock_quantity === 0`
- [ ] Filtro "Todos" remove os filtros
- [ ] Tabela mostra chips de tamanhos e cores na coluna Variantes
- [ ] Coluna MÍN. mostra o `effectiveMin` correto (default da loja quando produto tem `stock_min = 0`)
- [ ] Coluna Status mostra badge OK/Baixo/Sem Estoque com cor certa
- [ ] Valor Total = estoque × preço
- [ ] Botão "Ver Detalhes" abre o drawer com infos completas
- [ ] Drawer fecha com clique no backdrop, no X e tecla Escape
- [ ] Os 4 botões de ação aparecem mas estão desabilitados
- [ ] Botão "Importar JSON" leva para `/estoque/import`
- [ ] Botão "+ Adicionar Produto" aparece desabilitado

- [ ] **Step 3: Confirmar build (sabendo do erro pré-existente)**

Run: `npx tsc --noEmit 2>&1 | grep -v "api/inventory/import" | head -20`

Expected: nenhum erro além do pré-existente.

- [ ] **Step 4: Marcar leva como concluída**

Se tudo OK, criar PR ou seguir pro plano da Leva 2.

---

## Self-review (já feito)

- Spec coverage: ✓ migrations, helpers, KPIs, busca/filtros, tabela com chips, status, drawer, aba detalhada placeholder, ações desabilitadas — todas mapeadas.
- Sem placeholders TBD/TODO.
- Tipos consistentes: `StockStatus`, `KpiData`, `ProductRowData`, `StatusFilter` definidos uma vez e reutilizados.
- Pré-existente `route.ts:111` documentado e não tocado.
