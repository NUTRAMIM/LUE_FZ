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
