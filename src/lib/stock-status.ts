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
