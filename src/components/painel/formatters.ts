export type FunnelRange = 'day' | 'week' | 'month'

const SP_TZ = 'America/Sao_Paulo'

interface SpParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number // 0 = domingo … 6 = sábado
}

// Decompõe um instante nas partes de calendário vistas em São Paulo.
function spParts(d: Date): SpParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SP_TZ,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    weekday: weekdayMap[get('weekday')] ?? 0,
  }
}

// São Paulo é UTC-3 o ano todo (o Brasil aboliu o horário de verão em 2019),
// então a meia-noite de um dia em SP corresponde a 03:00 UTC.
export function rangeStart(now: Date, range: FunnelRange): Date {
  const p = spParts(now)
  if (range === 'month') {
    return new Date(Date.UTC(p.year, p.month - 1, 1, 3, 0, 0))
  }
  const dayStartMs = Date.UTC(p.year, p.month - 1, p.day, 3, 0, 0)
  if (range === 'week') {
    const daysSinceMonday = (p.weekday + 6) % 7
    return new Date(dayStartMs - daysSinceMonday * 86_400_000)
  }
  return new Date(dayStartMs)
}

const WEEKDAYS_PT = [
  'domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado',
]
const MONTHS_PT = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez',
]

export function formatPainelDate(now: Date): string {
  const p = spParts(now)
  return `${WEEKDAYS_PT[p.weekday]}, ${p.day} ${MONTHS_PT[p.month - 1]}`
}

export function formatPainelClock(now: Date): string {
  const p = spParts(now)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

export function painelGreeting(now: Date): string {
  const { hour } = spParts(now)
  if (hour < 12) return 'BOM DIA'
  if (hour < 18) return 'BOA TARDE'
  return 'BOA NOITE'
}

export function formatPercent1(n: number): string {
  return `${n.toFixed(1).replace('.', ',')}%`
}

export function formatIntBr(n: number): string {
  return n.toLocaleString('pt-BR')
}

export function dropOffPct(prev: number, curr: number): number {
  if (prev <= 0) return 0
  return (1 - curr / prev) * 100
}

export function captureRatePct(leads: number, sessions: number): number {
  if (sessions <= 0) return 0
  return (leads / sessions) * 100
}

// Formata uma latência em ms como rótulo de segundos pt-BR (1830 -> "1,8s").
// Devolve "—" quando não há amostra (0 ou negativo).
export function formatLatency(ms: number): string {
  if (ms <= 0) return '—'
  return `${(ms / 1000).toFixed(1).replace('.', ',')}s`
}
