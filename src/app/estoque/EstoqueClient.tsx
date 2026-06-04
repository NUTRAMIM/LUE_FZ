'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Product } from '@/types/product'
import { adjustStock, deleteProduct } from '@/actions/products'
import { getEffectiveStockMin, getStockStatus } from '@/lib/stock-status'
import { KpiSection } from '@/components/estoque/KpiSection'
import { FilterBar, type StatusFilter } from '@/components/estoque/FilterBar'
import { ProductTable, type ProductRowData } from '@/components/estoque/ProductTable'
import { ProductDetailsDrawer } from '@/components/estoque/ProductDetailsDrawer'
import { ProductEditDrawer } from '@/components/estoque/ProductEditDrawer'
import { ProductCreateDrawer } from '@/components/estoque/ProductCreateDrawer'
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
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [view, setView] = useState<View>('produtos')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todos')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  function handleAdjustStock(productId: string, delta: number) {
    if (pendingId) return
    setPendingId(productId)
    startTransition(async () => {
      const res = await adjustStock(productId, delta)
      if (!res.success) {
        window.alert(res.error ?? 'Erro ao ajustar estoque.')
      } else {
        router.refresh()
      }
      setPendingId(null)
    })
  }

  function handleDelete(productId: string) {
    if (pendingId) return
    const ok = window.confirm(
      'Excluir este produto? Esta ação não pode ser desfeita.',
    )
    if (!ok) return
    setPendingId(productId)
    startTransition(async () => {
      const res = await deleteProduct(productId)
      if (!res.success) {
        window.alert(res.error ?? 'Erro ao excluir produto.')
      } else {
        if (selectedId === productId) setSelectedId(null)
        if (editingId === productId) setEditingId(null)
        router.refresh()
      }
      setPendingId(null)
    })
  }

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

  // selectedRow ainda existe pra alimentar effectiveMin/status no Details
  // drawer (esses dois são derivados da listagem; o resto do produto vem
  // via fetch lazy em getProductDetails dentro do drawer).
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
            onAddProduct={() => setCreating(true)}
          />
          <ProductTable
            rows={filteredRows}
            pendingId={pendingId}
            onViewDetails={id => setSelectedId(id)}
            onEdit={id => {
              setSelectedId(null)
              setEditingId(id)
            }}
            onAdjustStock={handleAdjustStock}
            onDelete={handleDelete}
          />
        </>
      ) : (
        <EmptyState
          title="Visualização por variante em breve"
          description="Estamos preparando a vista detalhada por variante (cor × tamanho)."
        />
      )}

      <ProductDetailsDrawer
        productId={selectedId}
        effectiveMin={selectedRow?.effectiveMin ?? 0}
        status={selectedRow?.status ?? 'ok'}
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
      />
      <ProductEditDrawer
        productId={editingId}
        open={editingId !== null}
        onClose={() => setEditingId(null)}
      />
      <ProductCreateDrawer
        open={creating}
        onClose={() => setCreating(false)}
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
