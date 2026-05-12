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

type ActionTone = 'success' | 'danger' | 'info'

const actionPalette: Record<ActionTone, string> = {
  success: 'border-success/20 text-success bg-success-soft hover:bg-success/10',
  danger: 'border-danger/20 text-danger bg-danger-soft hover:bg-danger/10',
  info: 'border-info/20 text-info bg-info-soft hover:bg-info/10',
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
