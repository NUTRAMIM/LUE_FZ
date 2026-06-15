import { describe, it, expect } from 'vitest'
import {
  resolvePeriodStart,
  rowCostUsd,
  aggregateByStore,
  sumUsage,
  USD_BRL,
  type UsageRow,
  type StoreCounts,
} from '../admin-usage'

const row = (over: Partial<UsageRow> = {}): UsageRow => ({
  store_id: 'a', model: 'gpt-5-mini',
  prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cached_tokens: 0,
  calls: 0, ...over,
})

describe('resolvePeriodStart', () => {
  const now = new Date('2026-06-11T12:00:00Z')
  it('dia => hoje (SP)', () => expect(resolvePeriodStart('dia', now)).toBe('2026-06-11'))
  it('semana => 6 dias antes', () => expect(resolvePeriodStart('semana', now)).toBe('2026-06-05'))
  it('mes => 1º do mês', () => expect(resolvePeriodStart('mes', now)).toBe('2026-06-01'))
})

describe('rowCostUsd', () => {
  it('mini: input não-cacheado + cacheado + output', () => {
    const c = rowCostUsd(row({ prompt_tokens: 1_000_000, cached_tokens: 200_000, completion_tokens: 100_000 }))
    expect(c).toBeCloseTo(0.405, 6)
  })
  it('nano é mais barato que mini no mesmo uso', () => {
    const base = { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 }
    expect(rowCostUsd(row({ ...base, model: 'gpt-5-nano' })))
      .toBeLessThan(rowCostUsd(row({ ...base, model: 'gpt-5-mini' })))
  })
  it('modelo desconhecido cai no preço do mini', () => {
    const known = rowCostUsd(row({ model: 'gpt-5-mini', prompt_tokens: 1_000_000 }))
    const unknown = rowCostUsd(row({ model: 'desconhecido', prompt_tokens: 1_000_000 }))
    expect(unknown).toBeCloseTo(known, 9)
  })
})

describe('aggregateByStore', () => {
  const rows: UsageRow[] = [
    row({ store_id: 'a', model: 'gpt-5-mini', prompt_tokens: 1_000_000, cached_tokens: 500_000, completion_tokens: 0, total_tokens: 1_000_000, calls: 2 }),
    row({ store_id: 'a', model: 'gpt-5-nano', prompt_tokens: 1_000_000, completion_tokens: 0, total_tokens: 1_000_000, calls: 1 }),
    row({ store_id: 'b', model: 'gpt-5-mini', prompt_tokens: 0, completion_tokens: 1_000_000, total_tokens: 1_000_000, calls: 1 }),
  ]
  const names = new Map([['a', 'Loja A'], ['b', 'Loja B']])
  const counts = new Map<string, StoreCounts>([
    ['a', { iaMessages: 10, attendances: 4 }],
  ])

  it('soma tokens/custo/cache, anexa contagens e ordena por custo desc', () => {
    const out = aggregateByStore(rows, names, counts)
    const a = out.find((s) => s.storeId === 'a')!
    expect(a.costUsd).toBeCloseTo(0.1875, 6)
    expect(a.cached).toBe(500_000)
    expect(a.prompt).toBe(2_000_000)
    expect(a.cachedPct).toBeCloseTo(0.25, 6)
    expect(a.iaMessages).toBe(10)
    expect(a.attendances).toBe(4)
    expect(a.costPerAttendanceUsd).toBeCloseTo(0.1875 / 4, 6)
    expect(out[0].storeId).toBe('b')
  })

  it('loja sem contagem fica com 0 mensagens/atendimentos e custo/atend 0', () => {
    const out = aggregateByStore(rows, names, counts)
    const b = out.find((s) => s.storeId === 'b')!
    expect(b.iaMessages).toBe(0)
    expect(b.attendances).toBe(0)
    expect(b.costPerAttendanceUsd).toBe(0)
  })

  it('nome desconhecido => "—"', () => {
    expect(aggregateByStore(rows, new Map(), counts)[0].storeName).toBe('—')
  })
})

describe('sumUsage', () => {
  it('soma totais incl. custo, cache e contagens', () => {
    const stores = aggregateByStore(
      [
        row({ store_id: 'a', prompt_tokens: 1_000_000, cached_tokens: 250_000, total_tokens: 1_000_000, calls: 1 }),
        row({ store_id: 'b', prompt_tokens: 1_000_000, total_tokens: 1_000_000, calls: 1 }),
      ],
      new Map([['a', 'A'], ['b', 'B']]),
      new Map([['a', { iaMessages: 3, attendances: 1 }], ['b', { iaMessages: 2, attendances: 1 }]]),
    )
    const t = sumUsage(stores)
    expect(t.cached).toBe(250_000)
    expect(t.iaMessages).toBe(5)
    expect(t.attendances).toBe(2)
    expect(t.stores).toBe(2)
    expect(t.costUsd).toBeGreaterThan(0)
  })
})

it('USD_BRL é uma constante numérica editável', () => {
  expect(typeof USD_BRL).toBe('number')
})
