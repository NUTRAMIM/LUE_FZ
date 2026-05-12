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
