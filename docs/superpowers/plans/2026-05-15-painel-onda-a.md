# Painel — Onda A (dados reais no Hero, sem migration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir os mocks do Hero, PulseStripe, Funil e footer do `/painel` por dados reais do Supabase, sem nenhuma migration de banco.

**Architecture:** O `page.tsx` vira Server Component que autentica e faz o fetch inicial via duas server actions (`getPainelPulse`, `getFunnel`) que rodam queries diretas em tabelas existentes. `PainelDashboard` vira Client Component que recebe os dados iniciais, mantém o estado ao vivo via dois hooks de Realtime/Presence e distribui props para componentes de apresentação extraídos. Métricas que dependem de schema novo (latência p95, ticker de handoff, stages 5–6 precisos) ficam como proxy ou hardcoded — a Onda B as substitui.

**Tech Stack:** Next.js 16, React 19, Supabase (`@supabase/ssr`), Vitest 4, Tailwind 4.

**Spec de referência:** `docs/superpowers/specs/2026-05-15-painel-real-data-design.md`

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/components/painel/formatters.ts` (novo) | Funções puras: recortes de tempo SP, formatação pt-BR, math de funil |
| `src/components/painel/__tests__/formatters.test.ts` (novo) | Testes das funções puras |
| `src/actions/painel.ts` (novo) | Server actions `getPainelPulse` e `getFunnel` |
| `src/lib/realtime-painel.ts` (novo) | Hooks `useVisitorsPresence` e `usePainelPulse` |
| `src/components/painel/Topbar.tsx` (novo) | Topbar de apresentação |
| `src/components/painel/Hero.tsx` (novo) | Hero de apresentação |
| `src/components/painel/PulseStripe.tsx` (novo) | PulseStripe de apresentação |
| `src/components/painel/LivePulse.tsx` (novo) | Footer LivePulse de apresentação (sem uptime) |
| `src/components/painel/FunilCaptura.tsx` (rewrite) | Funil consumindo `FunnelData` via props |
| `src/components/painel/IntentCatalogo.tsx` (modify) | Remoção do status `BLACKHOLE` |
| `src/components/painel/PainelDashboard.tsx` (rewrite) | Client Component: estado ao vivo + composição |
| `src/app/painel/page.tsx` (rewrite) | Server Component: auth + fetch inicial |
| `src/app/chat/[slug]/page.tsx` (modify) | Repassa `storeId` ao `ChatClient` |
| `src/app/chat/[slug]/ChatClient.tsx` (modify) | Entra no Presence channel de visitantes |

Componentes não tocados nesta onda: `GapsConhecimento.tsx` (segue mockado), `Icons.tsx`, `layout.tsx`.

---

## Task 1: Funções puras de formatação do painel

**Files:**
- Create: `src/components/painel/formatters.ts`
- Test: `src/components/painel/__tests__/formatters.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/components/painel/__tests__/formatters.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  rangeStart,
  formatPainelDate,
  formatPainelClock,
  painelGreeting,
  formatPercent1,
  formatIntBr,
  dropOffPct,
  captureRatePct,
} from '../formatters'

// 2026-05-15T18:30:00Z = sexta-feira 15:30 em São Paulo (UTC-3).
const FRI = new Date('2026-05-15T18:30:00Z')
// 2026-05-15T02:00:00Z = quinta-feira 23:00 em São Paulo (dia anterior).
const LATE = new Date('2026-05-15T02:00:00Z')

describe('rangeStart', () => {
  it('day: início do dia em SP convertido para UTC (03:00Z)', () => {
    expect(rangeStart(FRI, 'day').toISOString()).toBe('2026-05-15T03:00:00.000Z')
  })

  it('day: respeita o fuso — 02:00Z ainda é o dia anterior em SP', () => {
    expect(rangeStart(LATE, 'day').toISOString()).toBe('2026-05-14T03:00:00.000Z')
  })

  it('week: volta para a segunda-feira da semana', () => {
    expect(rangeStart(FRI, 'week').toISOString()).toBe('2026-05-11T03:00:00.000Z')
  })

  it('month: primeiro dia do mês em SP', () => {
    expect(rangeStart(FRI, 'month').toISOString()).toBe('2026-05-01T03:00:00.000Z')
  })
})

describe('formatPainelDate', () => {
  it('formata como "sexta, 15 mai"', () => {
    expect(formatPainelDate(FRI)).toBe('sexta, 15 mai')
  })
})

describe('formatPainelClock', () => {
  it('formata o horário de SP como HH:MM', () => {
    expect(formatPainelClock(FRI)).toBe('15:30')
  })
})

describe('painelGreeting', () => {
  it('tarde entre 12h e 18h', () => {
    expect(painelGreeting(FRI)).toBe('BOA TARDE')
  })

  it('noite a partir das 18h', () => {
    expect(painelGreeting(new Date('2026-05-15T23:00:00Z'))).toBe('BOA NOITE')
  })

  it('manhã antes do meio-dia', () => {
    expect(painelGreeting(new Date('2026-05-15T13:00:00Z'))).toBe('BOM DIA')
  })
})

describe('formatPercent1', () => {
  it('uma casa decimal com vírgula', () => {
    expect(formatPercent1(15.08)).toBe('15,1%')
  })
})

describe('formatIntBr', () => {
  it('separador de milhar pt-BR', () => {
    expect(formatIntBr(1284)).toBe('1.284')
  })
})

describe('dropOffPct', () => {
  it('queda percentual entre etapas', () => {
    expect(dropOffPct(1284, 312)).toBeCloseTo(75.7, 1)
  })

  it('retorna 0 quando a etapa anterior é 0', () => {
    expect(dropOffPct(0, 0)).toBe(0)
  })
})

describe('captureRatePct', () => {
  it('leads sobre sessões em porcentagem', () => {
    expect(captureRatePct(47, 312)).toBeCloseTo(15.06, 2)
  })

  it('retorna 0 quando não há sessões', () => {
    expect(captureRatePct(5, 0)).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm run test -- src/components/painel/__tests__/formatters.test.ts`
Expected: FAIL — `Failed to resolve import "../formatters"`.

- [ ] **Step 3: Implementar `formatters.ts`**

Criar `src/components/painel/formatters.ts`:

```ts
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
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm run test -- src/components/painel/__tests__/formatters.test.ts`
Expected: PASS — todos os describes verdes.

- [ ] **Step 5: Commit**

```bash
git add src/components/painel/formatters.ts src/components/painel/__tests__/formatters.test.ts
git commit -m "feat(painel): add date/funnel formatters with São Paulo timezone"
```

---

## Task 2: Server action `getPainelPulse`

Conta os números do Hero, PulseStripe e footer com queries diretas (sem RPC).

**Files:**
- Create: `src/actions/painel.ts`

- [ ] **Step 1: Implementar `getPainelPulse`**

Criar `src/actions/painel.ts`:

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { rangeStart } from '@/components/painel/formatters'

export interface PainelPulse {
  leadsWeek: number
  leadsToday: number
  awaitingContact: number
  stale1h: number
  activeAiSessions: number
  sessionsToday: number
}

const EMPTY_PULSE: PainelPulse = {
  leadsWeek: 0,
  leadsToday: 0,
  awaitingContact: 0,
  stale1h: 0,
  activeAiSessions: 0,
  sessionsToday: 0,
}

export async function getPainelPulse(): Promise<PainelPulse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return EMPTY_PULSE

  const store = user.id
  const now = new Date()
  const dayStart = rangeStart(now, 'day').toISOString()
  const weekStart = rangeStart(now, 'week').toISOString()
  const oneHourAgo = new Date(now.getTime() - 3_600_000).toISOString()
  const fiveMinAgo = new Date(now.getTime() - 300_000).toISOString()

  const [leadsWeek, leadsToday, awaiting, stale, activeAi, sessionsToday] =
    await Promise.all([
      supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', store)
        .gte('created_at', weekStart),
      supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', store)
        .gte('created_at', dayStart),
      supabase
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', store)
        .eq('status', 'ai_active')
        .is('assigned_to', null)
        .not('lead_id', 'is', null),
      supabase
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', store)
        .eq('status', 'ai_active')
        .is('assigned_to', null)
        .not('lead_id', 'is', null)
        .lt('last_message_at', oneHourAgo),
      supabase
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', store)
        .eq('status', 'ai_active')
        .gte('last_message_at', fiveMinAgo),
      supabase
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', store)
        .gte('created_at', dayStart),
    ])

  return {
    leadsWeek: leadsWeek.count ?? 0,
    leadsToday: leadsToday.count ?? 0,
    awaitingContact: awaiting.count ?? 0,
    stale1h: stale.count ?? 0,
    activeAiSessions: activeAi.count ?? 0,
    sessionsToday: sessionsToday.count ?? 0,
  }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros. Se `tsc` reclamar de config, use `npm run build` como alternativa.

- [ ] **Step 3: Commit**

```bash
git add src/actions/painel.ts
git commit -m "feat(painel): add getPainelPulse server action"
```

---

## Task 3: Server action `getFunnel`

Conta os 6 stages do funil. Stages 1–4 são exatos; 5–6 e ciclo médio usam um
proxy via `status` + `updated_at` (a Onda B troca por `closed_at` e
`conversation_events`).

**Files:**
- Modify: `src/actions/painel.ts`

- [ ] **Step 1: Adicionar `getFunnel` ao fim de `src/actions/painel.ts`**

Acrescentar o import de tipo e a função (o `'use server'` e o import de
`createClient` já existem do Task 2):

```ts
import type { FunnelRange } from '@/components/painel/formatters'

export interface FunnelData {
  uniqueVisits: number
  chatSessions: number
  qualified: number
  leadCaptured: number
  vendorAccepted: number
  closed: number
  cycleDays: number
}

const EMPTY_FUNNEL: FunnelData = {
  uniqueVisits: 0,
  chatSessions: 0,
  qualified: 0,
  leadCaptured: 0,
  vendorAccepted: 0,
  closed: 0,
  cycleDays: 0,
}

export async function getFunnel(range: FunnelRange): Promise<FunnelData> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return EMPTY_FUNNEL

  const store = user.id
  const start = rangeStart(new Date(), range).toISOString()

  // Stages 1 e 2 — conversas criadas no período.
  const { data: convs } = await supabase
    .from('conversations')
    .select('id, visitor_id')
    .eq('store_id', store)
    .gte('created_at', start)

  const convRows = convs ?? []
  const chatSessions = convRows.length
  const uniqueVisits = new Set(convRows.map((c) => c.visitor_id)).size

  // Stage 3 — conversas com 3 ou mais mensagens.
  let qualified = 0
  if (convRows.length > 0) {
    const { data: msgs } = await supabase
      .from('messages')
      .select('conversation_id')
      .eq('store_id', store)
      .in(
        'conversation_id',
        convRows.map((c) => c.id),
      )
    const perConv = new Map<string, number>()
    for (const m of msgs ?? []) {
      perConv.set(
        m.conversation_id,
        (perConv.get(m.conversation_id) ?? 0) + 1,
      )
    }
    qualified = [...perConv.values()].filter((n) => n >= 3).length
  }

  // Stage 4 — leads com WhatsApp confirmado.
  const { count: leadCaptured } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('store_id', store)
    .not('whatsapp', 'is', null)
    .gte('created_at', start)

  // Stage 5 — proxy: conversas em atendimento humano (Onda B usa
  // conversation_events para histórico preciso).
  const { count: vendorAccepted } = await supabase
    .from('conversations')
    .select('*', { count: 'exact', head: true })
    .eq('store_id', store)
    .eq('status', 'human_active')
    .gte('updated_at', start)

  // Stage 6 + ciclo — proxy: status closed e updated_at (Onda B usa closed_at).
  const { data: closedConvs } = await supabase
    .from('conversations')
    .select('created_at, updated_at')
    .eq('store_id', store)
    .eq('status', 'closed')
    .gte('updated_at', start)

  const closedRows = closedConvs ?? []
  const cycleDays =
    closedRows.length === 0
      ? 0
      : closedRows.reduce(
          (sum, c) =>
            sum +
            (new Date(c.updated_at).getTime() -
              new Date(c.created_at).getTime()),
          0,
        ) /
        closedRows.length /
        86_400_000

  return {
    uniqueVisits,
    chatSessions,
    qualified,
    leadCaptured: leadCaptured ?? 0,
    vendorAccepted: vendorAccepted ?? 0,
    closed: closedRows.length,
    cycleDays: Math.round(cycleDays * 10) / 10,
  }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/actions/painel.ts
git commit -m "feat(painel): add getFunnel server action"
```

---

## Task 4: Presence de visitantes — hook + chat público

O painel observa o channel; a página `/chat/[slug]` se registra nele.

**Files:**
- Create: `src/lib/realtime-painel.ts`
- Modify: `src/app/chat/[slug]/page.tsx`
- Modify: `src/app/chat/[slug]/ChatClient.tsx`

- [ ] **Step 1: Criar o hook `useVisitorsPresence`**

Criar `src/lib/realtime-painel.ts`:

```ts
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// Observa o Presence channel da loja e devolve quantos visitantes estão
// com o chat público aberto agora. Não se registra no channel — só conta.
export function useVisitorsPresence(storeId: string): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel(`store:${storeId}:visitors`)

    channel
      .on('presence', { event: 'sync' }, () => {
        setCount(Object.keys(channel.presenceState()).length)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [storeId])

  return count
}
```

- [ ] **Step 2: Repassar `storeId` no `page.tsx` do chat**

`ensureConversation` já devolve `storeId` (ver `src/actions/chat.ts:116`).
Editar `src/app/chat/[slug]/page.tsx` — adicionar a prop `storeId` ao
`<ChatClient>`:

```tsx
  return (
    <ChatClient
      slug={slug}
      storeId={bootstrap.storeId}
      conversationId={bootstrap.conversationId}
      storeName={bootstrap.storeName}
      initialMessages={bootstrap.messages}
    />
  )
```

- [ ] **Step 3: `ChatClient` aceita `storeId` e entra no Presence channel**

Em `src/app/chat/[slug]/ChatClient.tsx`:

1. Adicionar `storeId: string` à assinatura de props do componente (o objeto
   desestruturado que começa em `ChatClient({ slug, conversationId, ... })`).
2. Adicionar este `useEffect` dentro do componente, junto aos demais:

```tsx
  useEffect(() => {
    const supabase = createBrowserSupabase()
    const channel = supabase.channel(`store:${storeId}:visitors`, {
      config: { presence: { key: crypto.randomUUID() } },
    })
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channel.track({ online_at: new Date().toISOString() })
      }
    })
    return () => {
      supabase.removeChannel(channel)
    }
  }, [storeId])
```

`createBrowserSupabase` e `useEffect` já estão importados no arquivo.

- [ ] **Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/lib/realtime-painel.ts "src/app/chat/[slug]/page.tsx" "src/app/chat/[slug]/ChatClient.tsx"
git commit -m "feat(painel): track store visitors via Supabase Presence"
```

---

## Task 5: Hook `usePainelPulse` (estado ao vivo)

Mantém os números do pulse atualizados: refaz `getPainelPulse` (com debounce de
2s) sempre que houver evento em `conversations`.

**Files:**
- Modify: `src/lib/realtime-painel.ts`

- [ ] **Step 1: Adicionar `usePainelPulse` ao `realtime-painel.ts`**

Acrescentar o import e o hook ao arquivo:

```ts
import { getPainelPulse, type PainelPulse } from '@/actions/painel'
```

```ts
// Mantém o pulse atualizado: a cada evento em `conversations` da loja, refaz
// getPainelPulse com debounce de 2s. `leads` não está na publicação realtime,
// mas a captura de lead seta conversations.lead_id (UPDATE), que dispara aqui.
export function usePainelPulse(
  storeId: string,
  initial: PainelPulse,
): PainelPulse {
  const [pulse, setPulse] = useState(initial)

  useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null

    const refresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        getPainelPulse().then(setPulse)
      }, 2000)
    }

    const channel = supabase
      .channel(`painel-pulse:${storeId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `store_id=eq.${storeId}`,
        },
        refresh,
      )
      .subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [storeId])

  return pulse
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/lib/realtime-painel.ts
git commit -m "feat(painel): add usePainelPulse live-refresh hook"
```

---

## Task 6: Extrair `Topbar` e `LivePulse` (com remoção do uptime)

**Files:**
- Create: `src/components/painel/Topbar.tsx`
- Create: `src/components/painel/LivePulse.tsx`

- [ ] **Step 1: Criar `Topbar.tsx`**

Criar `src/components/painel/Topbar.tsx` com o conteúdo da função `Topbar`
atual de `PainelDashboard.tsx`, com duas mudanças:
- recebe `dateLabel: string` por props;
- a `<h1>` usa `Visão geral · {dateLabel}` no lugar do texto fixo
  `Visão geral · sexta, 12 mai`.

```tsx
'use client'

import { Icon } from './Icons'

export function Topbar({ dateLabel }: { dateLabel: string }) {
  return (
    <div className="flex items-center justify-between mb-7">
      <div>
        <div className="eyebrow text-ink-500">PAINEL · OPERAÇÃO</div>
        <h1
          className="font-display font-bold text-ink-900 tracking-tight mt-1.5"
          style={{ fontSize: '26px', lineHeight: 1.1 }}
        >
          Visão geral · {dateLabel}
        </h1>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative">
          <Icon
            name="search"
            className="w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2"
          />
          <input
            placeholder="Buscar conversas, produtos, pedidos…"
            className="w-[300px] pl-9 pr-12 py-2.5 rounded-xl bg-white border border-ink-200 text-[13px] placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 eyebrow text-ink-400 bg-ink-50 px-1.5 py-0.5 rounded-md">
            ⌘K
          </span>
        </div>
        <button className="relative w-10 h-10 rounded-xl bg-white border border-ink-200 text-ink-600 hover:text-ink-900 hover:bg-ink-50 flex items-center justify-center">
          <Icon name="bell" className="w-4 h-4" />
          <span className="absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full bg-brand-600 ring-2 ring-white" />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Criar `LivePulse.tsx`**

Criar `src/components/painel/LivePulse.tsx`. Recebe `pulse: PainelPulse` e
`visitors: number`. Em relação ao `LivePulse` atual de `PainelDashboard.tsx`:
- `sessões` usa `pulse.activeAiSessions`;
- `visitantes` usa `visitors`;
- `fila` usa `pulse.awaitingContact`;
- **o segmento de `uptime` é removido por completo** (o `<span>` "uptime …" e o
  separador `·` que o precede);
- `p95`, `vendedores`, `últ. evento` e a versão seguem hardcoded nesta onda.

```tsx
'use client'

import type { PainelPulse } from '@/actions/painel'

export function LivePulse({
  pulse,
  visitors,
}: {
  pulse: PainelPulse
  visitors: number
}) {
  return (
    <div className="mt-12 -mx-8 px-8 py-3 border-t border-ink-100 bg-ink-50/60 font-mono text-[12px] text-ink-500 flex items-center gap-2 flex-wrap">
      <span className="live-dot" />
      <span className="font-semibold text-ink-700">LIVE</span>
      <span className="text-ink-300">·</span>
      <span>
        <span className="text-ink-700 font-semibold">
          {pulse.activeAiSessions}
        </span>{' '}
        sessões
      </span>
      <span className="text-ink-300">·</span>
      <span>
        <span className="text-ink-700 font-semibold">{visitors}</span>{' '}
        visitantes
      </span>
      <span className="text-ink-300">·</span>
      <span>
        IA p95 <span className="text-ink-700 font-semibold">1,8s</span>
      </span>
      <span className="text-ink-300">·</span>
      <span>
        fila{' '}
        <span className="text-ink-700 font-semibold">
          {pulse.awaitingContact}
        </span>
      </span>
      <span className="text-ink-300">·</span>
      <span>
        vendedores <span className="text-ink-700 font-semibold">2/4</span> ON
      </span>
      <span className="text-ink-300">·</span>
      <span>
        últ. evento <span className="text-ink-700 font-semibold">00:03s</span>
      </span>
      <span className="text-ink-300 ml-auto">·</span>
      <span className="eyebrow text-ink-400">LUE FZ v0.4.0 · BUILD 1284</span>
    </div>
  )
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/components/painel/Topbar.tsx src/components/painel/LivePulse.tsx
git commit -m "feat(painel): extract Topbar and LivePulse, drop uptime metric"
```

---

## Task 7: Extrair `Hero` consumindo o pulse real

**Files:**
- Create: `src/components/painel/Hero.tsx`

- [ ] **Step 1: Criar `Hero.tsx`**

Criar `src/components/painel/Hero.tsx`. Baseia-se no `Hero` atual de
`PainelDashboard.tsx` e na constante `ACTIVITY`, com as mudanças:
- recebe props `pulse`, `greeting`, `clock`;
- a constante `ACTIVITY` perde a linha `sessão expirou (180s)` (decisão de
  produto: ticker só tem CHAT/LEAD/HANDOFF) — restam 3 itens;
- o parágrafo usa `pulse.leadsWeek`, `pulse.awaitingContact`, `pulse.stale1h`;
- "CAPTURADOS HOJE" mostra só `pulse.leadsToday` — o `<span>/60</span>` sai;
- "TAXA DE CAPTURA" usa `formatPercent1(captureRatePct(pulse.leadsToday,
  pulse.sessionsToday))`;
- "LATÊNCIA IA · p95" segue hardcoded `1,8s` (Onda B liga ao real);
- "BOM DIA · 09:42" usa `{greeting} · {clock}`.

```tsx
'use client'

import { Icon } from './Icons'
import type { PainelPulse } from '@/actions/painel'
import { captureRatePct, formatPercent1 } from './formatters'

const ACTIVITY = [
  { t: '09:42', a: 'vis_4f1c', k: 'sessão iniciada', tag: 'CHAT' },
  { t: '09:39', a: '#2841', k: 'lead capturado', tag: 'LEAD' },
  { t: '09:36', a: '#2837', k: 'handoff → Camila R.', tag: 'HANDOFF' },
] as const

export function Hero({
  pulse,
  greeting,
  clock,
}: {
  pulse: PainelPulse
  greeting: string
  clock: string
}) {
  const captureRate = formatPercent1(
    captureRatePct(pulse.leadsToday, pulse.sessionsToday),
  )
  return (
    <div className="relative overflow-hidden rounded-3xl text-white hero-surface">
      <div className="hero-grain" />
      <div
        className="hero-ring"
        style={{ width: 520, height: 520, right: -180, top: -220 }}
      />
      <div
        className="hero-ring"
        style={{ width: 340, height: 340, right: -80, top: -100 }}
      />

      <div className="relative grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10 p-8 md:p-10">
        <div className="min-w-0">
          <div className="flex items-center gap-2 eyebrow text-brand-200">
            <span
              className="live-dot"
              style={{
                background: '#A78BFA',
                boxShadow: '0 0 0 4px rgba(167,139,250,0.22)',
              }}
            />
            {greeting} · {clock}
          </div>
          <h1
            className="font-display font-extrabold leading-[1.02] tracking-tight mt-3"
            style={{ fontSize: '48px' }}
          >
            Bem-vinda, Mariana.
          </h1>
          <p className="mt-3.5 text-[15px] text-brand-100/90 max-w-[44ch] leading-relaxed">
            Sua IA capturou{' '}
            <span className="font-semibold text-white">
              {pulse.leadsWeek} leads esta semana
            </span>
            .{' '}
            <span className="font-semibold text-white">
              {pulse.awaitingContact} aguardam contato
            </span>{' '}
            do seu time —{' '}
            <span className="font-semibold text-white">
              {pulse.stale1h} parados há &gt; 1h
            </span>
            .
          </p>

          <div className="mt-7 flex items-stretch gap-7">
            <div>
              <div className="eyebrow text-brand-200">CAPTURADOS HOJE</div>
              <div
                className="font-display font-extrabold tabular mt-1.5"
                style={{ fontSize: '30px', lineHeight: 1 }}
              >
                {pulse.leadsToday}
              </div>
            </div>
            <div className="w-px bg-white/15" />
            <div>
              <div className="eyebrow text-brand-200">TAXA DE CAPTURA</div>
              <div
                className="font-display font-extrabold tabular mt-1.5"
                style={{ fontSize: '30px', lineHeight: 1 }}
              >
                {captureRate}
              </div>
            </div>
            <div className="w-px bg-white/15" />
            <div>
              <div className="eyebrow text-brand-200">LATÊNCIA IA · p95</div>
              <div
                className="font-display font-extrabold tabular mt-1.5"
                style={{ fontSize: '30px', lineHeight: 1 }}
              >
                1,8
                <span className="text-brand-300 text-[16px] ml-0.5">s</span>
              </div>
            </div>
          </div>

          <div className="mt-7 flex flex-wrap gap-2.5">
            <button className="inline-flex items-center gap-2 bg-white text-brand-700 hover:bg-brand-50 transition-colors text-[13px] font-semibold px-4 py-2.5 rounded-xl">
              Abrir fila de leads <Icon name="arrow" className="w-4 h-4" />
            </button>
            <button className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/15 transition-colors text-white text-[13px] font-semibold px-4 py-2.5 rounded-xl ring-1 ring-white/15">
              Ver relatório do dia
            </button>
          </div>
        </div>

        <div className="relative">
          <div className="rounded-2xl bg-white/[0.06] ring-1 ring-white/10 backdrop-blur-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-3.5 pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <span className="live-dot" />
                <span className="eyebrow text-brand-100">ATIVIDADE AO VIVO</span>
              </div>
              <span className="eyebrow text-brand-200/80">ÚLT. 1H</span>
            </div>
            <ul className="divide-y divide-white/10">
              {ACTIVITY.map((e, i) => (
                <li key={i} className="px-4 py-3 flex items-center gap-3">
                  <span className="eyebrow text-brand-300 tabular w-10 shrink-0">
                    {e.t}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] leading-snug truncate">
                      <span className="font-mono font-semibold text-white">
                        {e.a}
                      </span>{' '}
                      <span className="text-brand-100/80">{e.k}</span>
                    </div>
                  </div>
                  <span className="eyebrow text-brand-200/70">{e.tag}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
```

> O ticker "ATIVIDADE AO VIVO" segue com dados mockados nesta onda — a Onda B
> liga ao `get_activity_feed_last_hour`.

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/components/painel/Hero.tsx
git commit -m "feat(painel): extract Hero wired to live pulse data"
```

---

## Task 8: Extrair `PulseStripe` consumindo dados reais

**Files:**
- Create: `src/components/painel/PulseStripe.tsx`

- [ ] **Step 1: Criar `PulseStripe.tsx`**

Criar `src/components/painel/PulseStripe.tsx`. Baseia-se no `PulseStripe` atual,
trocando a constante `PULSE` por valores derivados das props `pulse` e
`visitors`. Os valores são exibidos com 2 dígitos via `padStart`.

```tsx
'use client'

import { Icon, Chip, type ChipTone } from './Icons'
import type { PainelPulse } from '@/actions/painel'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function PulseStripe({
  pulse,
  visitors,
}: {
  pulse: PainelPulse
  visitors: number
}) {
  const cards: Array<{
    tone: ChipTone
    icon: string
    label: string
    value: string
    sub: string
  }> = [
    {
      tone: 'brand',
      icon: 'msgSq',
      label: 'Sessões IA ativas',
      value: pad(pulse.activeAiSessions),
      sub: 'IA RESPONDENDO  ·  p95 1,8s',
    },
    {
      tone: 'info',
      icon: 'eye',
      label: 'Visitantes na loja',
      value: pad(visitors),
      sub: 'AO VIVO',
    },
    {
      tone: 'warn',
      icon: 'userX',
      label: 'Leads sem atribuição',
      value: pad(pulse.awaitingContact),
      sub: 'AÇÃO  ATRIBUIR',
    },
  ]

  return (
    <section className="mt-10">
      <div className="flex items-end justify-between mb-4">
        <div>
          <div className="eyebrow text-ink-500">OPERAÇÃO · TEMPO REAL</div>
          <h2
            className="font-display font-bold text-ink-900 tracking-tight mt-1"
            style={{ fontSize: '20px' }}
          >
            Pulso ao vivo
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-success-700 bg-success-50 ring-1 ring-success-100 px-2 py-1 rounded-md">
            <span className="live-dot" /> Atualizando ao vivo
          </span>
          <button className="text-[12.5px] font-semibold text-ink-600 hover:text-ink-900 inline-flex items-center gap-1 px-2 py-1">
            Filtrar <Icon name="chev" className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="card grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-ink-100 overflow-hidden">
        {cards.map((q) => (
          <div key={q.label} className="p-6 relative">
            <div className="flex items-center gap-2.5">
              <Chip tone={q.tone} name={q.icon} />
              <span className="text-[13px] font-semibold text-ink-700">
                {q.label}
              </span>
            </div>
            <div
              className="mt-4 font-display font-extrabold tabular text-ink-900 leading-none"
              style={{ fontSize: '56px' }}
            >
              {q.value}
            </div>
            <div className="eyebrow text-ink-400 mt-3">{q.sub}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/components/painel/PulseStripe.tsx
git commit -m "feat(painel): extract PulseStripe wired to live data"
```

---

## Task 9: Reescrever `FunilCaptura` para consumir `FunnelData`

**Files:**
- Modify (rewrite): `src/components/painel/FunilCaptura.tsx`

- [ ] **Step 1: Substituir o conteúdo de `FunilCaptura.tsx`**

Reescrever `src/components/painel/FunilCaptura.tsx` por completo. O componente
deixa de ter dados internos e passa a receber `funnel`, `range` e
`onRangeChange` por props. As cores dos stages são preservadas. Drop-off e
taxas vêm dos formatters.

```tsx
'use client'

import type { FunnelData } from '@/actions/painel'
import type { FunnelRange } from './formatters'
import { dropOffPct, formatIntBr, formatPercent1 } from './formatters'

const STAGE_META = [
  { stage: 'Visitas únicas', color: '#C4B5FD' },
  { stage: 'Sessões de chat', color: '#A78BFA' },
  { stage: 'Conversa qualificada', hint: '≥ 3 mensagens', color: '#8B5CF6' },
  { stage: 'Lead capturado', hint: 'contato confirmado', color: '#7C3AED' },
  { stage: 'Aceito pelo vendedor', color: '#6D28D9' },
  { stage: 'Fechado (marcado)', color: '#5B21B6' },
] as const

const RANGE_LABELS: Array<{ key: FunnelRange; label: string }> = [
  { key: 'day', label: 'Hoje' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mês' },
]

export function FunilCaptura({
  funnel,
  range,
  onRangeChange,
}: {
  funnel: FunnelData
  range: FunnelRange
  onRangeChange: (r: FunnelRange) => void
}) {
  const counts = [
    funnel.uniqueVisits,
    funnel.chatSessions,
    funnel.qualified,
    funnel.leadCaptured,
    funnel.vendorAccepted,
    funnel.closed,
  ]
  const max = Math.max(...counts, 1)
  const top = counts[0] || 1

  const stages = STAGE_META.map((meta, i) => ({
    ...meta,
    count: counts[i],
    pct: (counts[i] / top) * 100,
    drop: i === 0 ? undefined : dropOffPct(counts[i - 1], counts[i]),
  }))

  const visToLead = formatPercent1(
    funnel.uniqueVisits > 0
      ? (funnel.leadCaptured / funnel.uniqueVisits) * 100
      : 0,
  )
  const leadToClose = formatPercent1(
    funnel.leadCaptured > 0
      ? (funnel.closed / funnel.leadCaptured) * 100
      : 0,
  )

  return (
    <div className="card p-6">
      <div className="flex items-end justify-between mb-5">
        <div>
          <div className="eyebrow text-ink-500">PIPELINE</div>
          <h2
            className="font-display font-bold text-ink-900 tracking-tight mt-1"
            style={{ fontSize: '20px' }}
          >
            Funil de captura
          </h2>
        </div>
        <div className="inline-flex rounded-xl bg-white border border-ink-200 p-0.5 text-[12px] font-semibold">
          {RANGE_LABELS.map((r) => (
            <button
              key={r.key}
              onClick={() => onRangeChange(r.key)}
              className={
                r.key === range
                  ? 'px-2.5 py-1 rounded-lg bg-ink-900 text-white'
                  : 'px-2.5 py-1 rounded-lg text-ink-600'
              }
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <ul className="space-y-4">
        {stages.map((s) => (
          <li
            key={s.stage}
            className="grid grid-cols-[14px_1fr_72px_56px] items-center gap-3"
          >
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: s.color, boxShadow: `0 0 0 3px ${s.color}22` }}
            />
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-ink-800 truncate">
                {s.stage}
                {'hint' in s && s.hint && (
                  <span className="ml-2 eyebrow text-ink-400 font-normal">
                    {s.hint}
                  </span>
                )}
              </div>
              <div className="mt-2 h-[6px] rounded-full bg-ink-100 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(s.count / max) * 100}%`,
                    background: s.color,
                  }}
                />
              </div>
            </div>
            <span className="font-mono tabular text-[12px] text-right text-ink-500">
              {s.pct.toFixed(1)}%
            </span>
            <span
              className="font-display font-bold tabular text-ink-900 text-right"
              style={{ fontSize: '17px' }}
            >
              {formatIntBr(s.count)}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 pt-4 border-t border-ink-100">
        <div className="eyebrow text-ink-400 mb-3">DROP-OFF ENTRE ETAPAS</div>
        <div className="grid grid-cols-5 gap-2">
          {stages.slice(1).map((s, i) => (
            <div
              key={s.stage}
              className="text-center px-2 py-2 rounded-lg bg-ink-50 ring-1 ring-ink-100"
            >
              <div className="eyebrow text-ink-400">ETAPA {i + 2}</div>
              <div className="font-mono tabular text-[13px] font-semibold text-danger-700 mt-1">
                {(s.drop ?? 0).toFixed(1)}%
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 pt-5 border-t border-ink-100 grid grid-cols-3 gap-6">
        <div>
          <div className="eyebrow text-ink-500">TAXA VIS → LEAD</div>
          <div
            className="font-display font-bold tabular text-ink-900 mt-1.5"
            style={{ fontSize: '22px' }}
          >
            {visToLead}
          </div>
        </div>
        <div>
          <div className="eyebrow text-ink-500">TAXA LEAD → FECHADO</div>
          <div
            className="font-display font-bold tabular text-ink-900 mt-1.5"
            style={{ fontSize: '22px' }}
          >
            {leadToClose}
          </div>
        </div>
        <div>
          <div className="eyebrow text-ink-500">CICLO MÉDIO</div>
          <div
            className="font-display font-bold tabular text-ink-900 mt-1.5 flex items-baseline gap-1"
            style={{ fontSize: '22px' }}
          >
            {funnel.cycleDays.toLocaleString('pt-BR')}
            <span className="text-ink-400 text-[15px]">dias</span>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/components/painel/FunilCaptura.tsx
git commit -m "feat(painel): rewire FunilCaptura to real funnel data with range toggle"
```

---

## Task 10: Remover o status `BLACKHOLE` do `IntentCatalogo`

A tabela Intent × Catálogo segue com dados mockados nesta onda; só removemos o
status `BLACKHOLE` (decisão: tabela final lista só produtos que converteram, e
`BLACKHOLE` era justamente o produto sem conversão).

**Files:**
- Modify: `src/components/painel/IntentCatalogo.tsx`

- [ ] **Step 1: Remover `BLACKHOLE` do type e do mapa de classes**

Em `src/components/painel/IntentCatalogo.tsx`:

1. No type `ProductStatus`, remover `'BLACKHOLE'`:

```tsx
type ProductStatus = 'OK' | 'DESC VAZIA' | 'SEM FOTO' | 'STOCK OUT'
```

2. Em `STATUS_CLS`, remover a entrada `'BLACKHOLE'`:

```tsx
const STATUS_CLS: Record<ProductStatus, string> = {
  'OK':         'text-success-700 bg-success-50 ring-success-100',
  'DESC VAZIA': 'text-warn-700 bg-warn-50 ring-warn-100',
  'SEM FOTO':   'text-warn-700 bg-warn-50 ring-warn-100',
  'STOCK OUT':  'text-danger-700 bg-danger-50 ring-danger-100',
}
```

- [ ] **Step 2: Remover a linha mockada `Rosa Equador`**

Era o único produto `BLACKHOLE` (e tinha `leads: 0`). Remover este objeto do
array `PRODUCTS`:

```tsx
  { name: 'Rosa Equador',      views: 189, mentions: 71, leads:  0, hasDesc: false, hasPhoto: false, status: 'BLACKHOLE' },
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros — nenhum produto restante usa `BLACKHOLE`.

- [ ] **Step 4: Commit**

```bash
git add src/components/painel/IntentCatalogo.tsx
git commit -m "feat(painel): drop BLACKHOLE product status from Intent catalog"
```

---

## Task 11: Religar `PainelDashboard` (client) e `page.tsx` (server)

**Files:**
- Modify (rewrite): `src/components/painel/PainelDashboard.tsx`
- Modify (rewrite): `src/app/painel/page.tsx`

- [ ] **Step 1: Reescrever `PainelDashboard.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'
import type { PainelPulse, FunnelData } from '@/actions/painel'
import { getFunnel } from '@/actions/painel'
import type { FunnelRange } from './formatters'
import { formatPainelClock } from './formatters'
import { useVisitorsPresence, usePainelPulse } from '@/lib/realtime-painel'
import { Topbar } from './Topbar'
import { Hero } from './Hero'
import { PulseStripe } from './PulseStripe'
import { FunilCaptura } from './FunilCaptura'
import { GapsConhecimento } from './GapsConhecimento'
import { IntentCatalogo } from './IntentCatalogo'
import { LivePulse } from './LivePulse'

export function PainelDashboard({
  storeId,
  initialPulse,
  initialFunnel,
  dateLabel,
  greeting,
  initialClock,
}: {
  storeId: string
  initialPulse: PainelPulse
  initialFunnel: FunnelData
  dateLabel: string
  greeting: string
  initialClock: string
}) {
  const pulse = usePainelPulse(storeId, initialPulse)
  const visitors = useVisitorsPresence(storeId)

  const [range, setRange] = useState<FunnelRange>('month')
  const [funnel, setFunnel] = useState(initialFunnel)
  const [clock, setClock] = useState(initialClock)

  useEffect(() => {
    const id = setInterval(() => {
      setClock(formatPainelClock(new Date()))
    }, 60_000)
    return () => clearInterval(id)
  }, [])

  const handleRangeChange = (r: FunnelRange) => {
    setRange(r)
    getFunnel(r).then(setFunnel)
  }

  return (
    <div className="max-w-[1280px] mx-auto px-8 py-7">
      <Topbar dateLabel={dateLabel} />
      <Hero pulse={pulse} greeting={greeting} clock={clock} />
      <PulseStripe pulse={pulse} visitors={visitors} />

      <section className="mt-10">
        <FunilCaptura
          funnel={funnel}
          range={range}
          onRangeChange={handleRangeChange}
        />
      </section>

      <section className="mt-6">
        <GapsConhecimento />
      </section>

      <section className="mt-6">
        <IntentCatalogo />
      </section>

      <LivePulse pulse={pulse} visitors={visitors} />
    </div>
  )
}
```

- [ ] **Step 2: Reescrever `src/app/painel/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPainelPulse, getFunnel } from '@/actions/painel'
import {
  formatPainelDate,
  formatPainelClock,
  painelGreeting,
} from '@/components/painel/formatters'
import { PainelDashboard } from '@/components/painel/PainelDashboard'

export const dynamic = 'force-dynamic'

export default async function PainelPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [initialPulse, initialFunnel] = await Promise.all([
    getPainelPulse(),
    getFunnel('month'),
  ])
  const now = new Date()

  return (
    <PainelDashboard
      storeId={user.id}
      initialPulse={initialPulse}
      initialFunnel={initialFunnel}
      dateLabel={formatPainelDate(now)}
      greeting={painelGreeting(now)}
      initialClock={formatPainelClock(now)}
    />
  )
}
```

- [ ] **Step 3: Build completo**

Run: `npm run build`
Expected: build conclui sem erros de tipo nem de lint.

- [ ] **Step 4: Verificação manual no navegador**

Run: `npm run dev`

Logar e abrir `/painel`. Confirmar:
- Topbar mostra a data de hoje (ex.: "Visão geral · sexta, 15 mai").
- Hero: parágrafo, "Capturados hoje" (sem `/60`) e "Taxa de captura" batem com
  os dados da loja; saudação reflete o horário.
- PulseStripe: "Sessões IA ativas" e "Leads sem atribuição" com números reais.
- Funil: alternar Hoje/Semana/Mês recarrega os números; drop-off e taxas
  recalculam.
- Footer: sem o segmento "uptime".
- Em outra aba/navegador, abrir `/chat/<chat_slug>` da loja → "Visitantes na
  loja" e o "visitantes" do footer sobem para 1; fechar a aba → voltam a 0.
- Intent × Catálogo não exibe mais o badge `BLACKHOLE`.

- [ ] **Step 5: Commit**

```bash
git add src/components/painel/PainelDashboard.tsx src/app/painel/page.tsx
git commit -m "feat(painel): wire dashboard to real data with live hooks"
```

---

## Notas de execução

- **`npx tsc --noEmit`**: se acusar erro de configuração do compilador, use
  `npm run build` no lugar — ambos cobrem a checagem de tipos.
- **Fetch do Supabase em dev**: o ambiente já tem `NODE_OPTIONS=--use-system-ca`
  persistido (Norton faz MITM TLS na máquina). Não mexer nisso.
- **Dados ralos**: numa loja sem leads/conversas, todos os números aparecem
  como 0 — isso é correto, não é bug.
- **Fora do escopo desta onda** (vai para B/C): latência p95 real, ticker de
  atividade ao vivo, precisão dos stages 5–6, nome real do dono no Hero,
  versão/build corretos no footer, Gaps e Intent × Catálogo dinâmicos.
