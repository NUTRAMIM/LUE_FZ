export type Periodo = 'dia' | 'semana' | 'mes'

export interface UsageRow {
  store_id: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cached_tokens: number
  calls: number
}

export interface StoreCounts {
  iaMessages: number
  attendances: number
}

export interface StoreUsage {
  storeId: string
  storeName: string
  prompt: number
  completion: number
  total: number
  cached: number
  calls: number
  costUsd: number
  iaMessages: number
  attendances: number
  cachedPct: number
  costPerAttendanceUsd: number
}

export interface UsageTotals {
  prompt: number
  completion: number
  total: number
  cached: number
  calls: number
  costUsd: number
  iaMessages: number
  attendances: number
  cachedPct: number
  stores: number
}

// Preços OpenAI em USD por 1M tokens (jun/2026). Espelha o chat-service Python.
// Editar aqui quando os preços mudarem.
const PRICES: Record<string, { in: number; cached: number; out: number }> = {
  'gpt-5-mini': { in: 0.25, cached: 0.025, out: 2.0 },
  'gpt-5-nano': { in: 0.05, cached: 0.005, out: 0.4 },
  'text-embedding-3-small': { in: 0.02, cached: 0.02, out: 0 },
}
const DEFAULT_PRICE = PRICES['gpt-5-mini'] // modelo legado/desconhecido

// Câmbio fixo USD->BRL (editar quando precisar; sem cotação dinâmica por escolha).
export const USD_BRL = 5.5

export function rowCostUsd(r: UsageRow): number {
  const p = PRICES[r.model] ?? DEFAULT_PRICE
  const uncached = Math.max(r.prompt_tokens - r.cached_tokens, 0)
  return (
    (uncached * p.in + r.cached_tokens * p.cached + r.completion_tokens * p.out) / 1e6
  )
}

const SP_TZ = 'America/Sao_Paulo'

function spToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SP_TZ }).format(now)
}

export function resolvePeriodStart(periodo: Periodo, now: Date): string {
  const today = spToday(now)
  if (periodo === 'mes') return today.slice(0, 8) + '01'
  if (periodo === 'semana') {
    const base = new Date(today + 'T00:00:00Z')
    base.setUTCDate(base.getUTCDate() - 6)
    return base.toISOString().slice(0, 10)
  }
  return today
}

export function aggregateByStore(
  rows: UsageRow[],
  names: Map<string, string>,
  counts?: Map<string, StoreCounts>,
): StoreUsage[] {
  const map = new Map<string, StoreUsage>()
  for (const r of rows) {
    const cur =
      map.get(r.store_id) ??
      {
        storeId: r.store_id,
        storeName: names.get(r.store_id) ?? '—',
        prompt: 0, completion: 0, total: 0, cached: 0, calls: 0,
        costUsd: 0, iaMessages: 0, attendances: 0,
        cachedPct: 0, costPerAttendanceUsd: 0,
      }
    cur.prompt += r.prompt_tokens
    cur.completion += r.completion_tokens
    cur.total += r.total_tokens
    cur.cached += r.cached_tokens
    cur.calls += r.calls
    cur.costUsd += rowCostUsd(r)
    map.set(r.store_id, cur)
  }
  for (const s of map.values()) {
    const c = counts?.get(s.storeId)
    s.iaMessages = c?.iaMessages ?? 0
    s.attendances = c?.attendances ?? 0
    s.cachedPct = s.prompt > 0 ? s.cached / s.prompt : 0
    s.costPerAttendanceUsd = s.attendances > 0 ? s.costUsd / s.attendances : 0
  }
  return [...map.values()].sort((a, b) => b.costUsd - a.costUsd)
}

export function sumUsage(stores: StoreUsage[]): UsageTotals {
  const t = stores.reduce<UsageTotals>(
    (acc, s) => ({
      prompt: acc.prompt + s.prompt,
      completion: acc.completion + s.completion,
      total: acc.total + s.total,
      cached: acc.cached + s.cached,
      calls: acc.calls + s.calls,
      costUsd: acc.costUsd + s.costUsd,
      iaMessages: acc.iaMessages + s.iaMessages,
      attendances: acc.attendances + s.attendances,
      cachedPct: 0,
      stores: acc.stores + (s.total > 0 ? 1 : 0),
    }),
    {
      prompt: 0, completion: 0, total: 0, cached: 0, calls: 0,
      costUsd: 0, iaMessages: 0, attendances: 0, cachedPct: 0, stores: 0,
    },
  )
  t.cachedPct = t.prompt > 0 ? t.cached / t.prompt : 0
  return t
}
