import { describe, it, expect } from 'vitest'
import {
  resolvePeriodStart,
  aggregateByStore,
  sumUsage,
  type UsageRow,
} from '../admin-usage'

describe('resolvePeriodStart', () => {
  // 2026-06-11 12:00Z -> em America/Sao_Paulo (UTC-3) ainda é 2026-06-11
  const now = new Date('2026-06-11T12:00:00Z')

  it('dia => a data de hoje (SP)', () => {
    expect(resolvePeriodStart('dia', now)).toBe('2026-06-11')
  })

  it('semana => 6 dias antes de hoje (janela de 7 dias)', () => {
    expect(resolvePeriodStart('semana', now)).toBe('2026-06-05')
  })

  it('mes => primeiro dia do mês corrente', () => {
    expect(resolvePeriodStart('mes', now)).toBe('2026-06-01')
  })
})

describe('aggregateByStore', () => {
  const rows: UsageRow[] = [
    { store_id: 'a', prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, calls: 1 },
    { store_id: 'a', prompt_tokens: 20, completion_tokens: 6, total_tokens: 26, calls: 2 },
    { store_id: 'b', prompt_tokens: 5, completion_tokens: 1, total_tokens: 6, calls: 1 },
  ]
  const names = new Map([['a', 'Loja A'], ['b', 'Loja B']])

  it('soma por loja e ordena por total desc', () => {
    const out = aggregateByStore(rows, names)
    expect(out).toEqual([
      { storeId: 'a', storeName: 'Loja A', prompt: 30, completion: 10, total: 40, calls: 3 },
      { storeId: 'b', storeName: 'Loja B', prompt: 5, completion: 1, total: 6, calls: 1 },
    ])
  })

  it('usa "—" quando o nome da loja é desconhecido', () => {
    const out = aggregateByStore(rows, new Map())
    expect(out[0].storeName).toBe('—')
  })
})

describe('sumUsage', () => {
  it('soma os totais de todas as lojas', () => {
    const out = sumUsage([
      { storeId: 'a', storeName: 'A', prompt: 30, completion: 10, total: 40, calls: 3 },
      { storeId: 'b', storeName: 'B', prompt: 5, completion: 1, total: 6, calls: 1 },
    ])
    expect(out).toEqual({ prompt: 35, completion: 11, total: 46, calls: 4, stores: 2 })
  })

  it('stores conta só lojas com total > 0', () => {
    const out = sumUsage([
      { storeId: 'a', storeName: 'A', prompt: 0, completion: 0, total: 0, calls: 0 },
      { storeId: 'b', storeName: 'B', prompt: 5, completion: 1, total: 6, calls: 1 },
    ])
    expect(out.stores).toBe(1)
  })
})
