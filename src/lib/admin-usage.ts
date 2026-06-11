export type Periodo = 'dia' | 'semana' | 'mes'

export interface UsageRow {
  store_id: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  calls: number
}

export interface StoreUsage {
  storeId: string
  storeName: string
  prompt: number
  completion: number
  total: number
  calls: number
}

export interface UsageTotals {
  prompt: number
  completion: number
  total: number
  calls: number
  stores: number
}

const SP_TZ = 'America/Sao_Paulo'

// Data de hoje no fuso de São Paulo, formato 'YYYY-MM-DD' (en-CA => ISO).
function spToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SP_TZ }).format(now)
}

// Início do período (inclusive) como 'YYYY-MM-DD' no fuso de SP, para comparar
// com a coluna `day` (date) da tabela ai_usage_daily.
export function resolvePeriodStart(periodo: Periodo, now: Date): string {
  const today = spToday(now)
  if (periodo === 'mes') return today.slice(0, 8) + '01'
  if (periodo === 'semana') {
    const base = new Date(today + 'T00:00:00Z')
    base.setUTCDate(base.getUTCDate() - 6)
    return base.toISOString().slice(0, 10)
  }
  return today // dia
}

export function aggregateByStore(
  rows: UsageRow[],
  names: Map<string, string>,
): StoreUsage[] {
  const map = new Map<string, StoreUsage>()
  for (const r of rows) {
    const cur = map.get(r.store_id) ?? {
      storeId: r.store_id,
      storeName: names.get(r.store_id) ?? '—',
      prompt: 0,
      completion: 0,
      total: 0,
      calls: 0,
    }
    cur.prompt += r.prompt_tokens
    cur.completion += r.completion_tokens
    cur.total += r.total_tokens
    cur.calls += r.calls
    map.set(r.store_id, cur)
  }
  return [...map.values()].sort((a, b) => b.total - a.total)
}

export function sumUsage(stores: StoreUsage[]): UsageTotals {
  return stores.reduce<UsageTotals>(
    (acc, s) => ({
      prompt: acc.prompt + s.prompt,
      completion: acc.completion + s.completion,
      total: acc.total + s.total,
      calls: acc.calls + s.calls,
      stores: acc.stores + (s.total > 0 ? 1 : 0),
    }),
    { prompt: 0, completion: 0, total: 0, calls: 0, stores: 0 },
  )
}
