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
  onEdit,
}: {
  rows: ProductRowData[]
  onViewDetails: (productId: string) => void
  onEdit: (productId: string) => void
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
              onEdit={() => onEdit(r.product.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

const alignClass = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
} as const

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode
  align?: keyof typeof alignClass
}) {
  return (
    <th
      className={`px-4 py-3 ${alignClass[align]} text-[11px] font-semibold uppercase tracking-[0.10em] text-slate-500`}
    >
      {children}
    </th>
  )
}
