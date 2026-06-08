'use client'

import { useEffect, useRef, useState } from 'react'
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
  pendingId,
  onViewDetails,
  onEdit,
  onAdjustStock,
  onDelete,
}: {
  rows: ProductRowData[]
  pendingId: string | null
  onViewDetails: (productId: string) => void
  onEdit: (productId: string) => void
  onAdjustStock: (productId: string, delta: number) => void
  onDelete: (productId: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [contentWidth, setContentWidth] = useState(0)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => {
      setContentWidth(el.scrollWidth)
      setOverflowing(el.scrollWidth > el.clientWidth + 1)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [rows])

  function syncFromTable() {
    if (barRef.current && scrollRef.current) {
      barRef.current.scrollLeft = scrollRef.current.scrollLeft
    }
  }

  function syncFromBar() {
    if (barRef.current && scrollRef.current) {
      scrollRef.current.scrollLeft = barRef.current.scrollLeft
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        Nenhum produto encontrado com os filtros atuais.
      </div>
    )
  }

  return (
    <>
      <div
        ref={scrollRef}
        onScroll={syncFromTable}
        className="scrollbar-hide overflow-x-auto rounded-2xl border border-slate-200 bg-white"
      >
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <Th>Produto</Th>
              <Th>Categoria</Th>
              <Th>Cores</Th>
              <Th>Tamanhos</Th>
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
                busy={pendingId !== null}
                onViewDetails={() => onViewDetails(r.product.id)}
                onEdit={() => onEdit(r.product.id)}
                onAdjustStock={delta => onAdjustStock(r.product.id, delta)}
                onDelete={() => onDelete(r.product.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {overflowing && (
        <div
          ref={barRef}
          onScroll={syncFromBar}
          className="sticky bottom-0 z-10 overflow-x-auto"
        >
          <div style={{ width: contentWidth, height: 1 }} />
        </div>
      )}
    </>
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
