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
  if (!product) return null

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
