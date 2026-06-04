'use client'

import { Badge, type BadgeTone } from '@/components/ui/Badge'
import type { StockStatus } from '@/lib/stock-status'
import type { Product } from '@/types/product'

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
  busy,
  onViewDetails,
  onEdit,
  onAdjustStock,
  onDelete,
}: {
  product: Product
  effectiveMin: number
  status: StockStatus
  busy: boolean
  onViewDetails: () => void
  onEdit: () => void
  onAdjustStock: (delta: number) => void
  onDelete: () => void
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
              -
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
        {product.category || '-'}
      </td>

      <td className="px-4 py-3 text-sm">
        <AttributeBadges values={product.cores} prefix="c" />
      </td>

      <td className="px-4 py-3 text-sm">
        <AttributeBadges values={product.tamanhos} prefix="t" />
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
          <ActionIconButton
            title="Aumentar"
            tone="success"
            disabled={busy}
            onClick={() => onAdjustStock(1)}
          >
            +
          </ActionIconButton>
          <ActionIconButton
            title="Diminuir"
            tone="danger"
            disabled={busy || product.stock_quantity <= 0}
            onClick={() => onAdjustStock(-1)}
          >
            -
          </ActionIconButton>
          <ActionIconButton title="Editar" tone="info" disabled={busy} onClick={onEdit}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </ActionIconButton>
          <ActionIconButton
            title="Excluir"
            tone="danger"
            disabled={busy}
            onClick={onDelete}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M19 6l-1 14H6L5 6" />
            </svg>
          </ActionIconButton>
        </div>
      </td>
    </tr>
  )
}

function AttributeBadges({
  values,
  prefix,
}: {
  values: string[] | null | undefined
  prefix: string
}) {
  const list = values ?? []
  const visible = list.slice(0, 5)
  const hidden = list.length - visible.length

  if (list.length === 0) {
    return <span className="text-slate-400">-</span>
  }

  return (
    <div className="flex flex-wrap gap-1 max-w-xs">
      {visible.map((value, index) => (
        <Badge key={`${prefix}-${index}-${value}`} tone="neutral">
          {value}
        </Badge>
      ))}
      {hidden > 0 && (
        <Badge tone="neutral" title={`${hidden} a mais`}>
          ...
        </Badge>
      )}
    </div>
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
      className={`flex h-8 w-8 items-center justify-center rounded-lg border text-sm disabled:cursor-not-allowed disabled:opacity-40 ${actionPalette[tone]}`}
    >
      {children}
    </button>
  )
}
