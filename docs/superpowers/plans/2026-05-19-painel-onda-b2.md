# Painel — Onda B2 (ticker de atividade real + nome do dono) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir os dois últimos elementos mockados do painel — o ticker "Atividade ao vivo" e o nome no cabeçalho do Hero — por dados reais, sem nenhuma migration.

**Architecture:** O ticker vira real consumindo dois streams diretos (`conversations` e `leads` criados na última hora) mesclados numa server action `getActivityFeed`. O nome do dono vem de `store_settings.store_name`, lido no Server Component. Um hook `usePainelActivity` mantém o ticker ao vivo via Realtime, espelhando o `usePainelPulse` existente.

**Tech Stack:** Next.js 16, React 19, Supabase (`@supabase/ssr`), Vitest 4.

**Spec de referência:** `docs/superpowers/specs/2026-05-15-painel-real-data-design.md`.

**Pré-requisito:** Ondas A e B1 estão mergeadas. `src/actions/painel.ts`, `src/lib/realtime-painel.ts`, `src/components/painel/{Hero,formatters,PainelDashboard}.tsx` e `src/app/painel/page.tsx` já existem na forma final dessas ondas.

---

## Contexto de escopo

A Onda B originalmente previa handoff de vendedor, tabela `conversation_events`, presença de vendedores e o stage 5 "Aceito pelo vendedor". Decisões de produto posteriores reduziram a B2:

- **Não há handoff** — o vendedor não assume a conversa; a IA atende ponta a ponta. Sem `acceptConversation`, sem `conversation_events`, sem evento HANDOFF no ticker.
- **Stage 5 do funil** vira "Lead contatado" no futuro, mas isso depende de uma tela de fila de leads que ainda não existe — **fora desta onda**. O funil não é tocado aqui; o stage 5 segue como está.
- **Vendedores com login / presença "X/Y ON"** dependem de um fluxo de convite de equipe inexistente — **fora desta onda**.

Esta B2 entrega só o que tem valor real e zero dependências: o ticker (CHAT + LEAD) e o nome do dono. É o retoque final do painel.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/components/painel/formatters.ts` (modify) | Função `shortRef` (ref curto de um UUID) |
| `src/components/painel/__tests__/formatters.test.ts` (modify) | Testes de `shortRef` |
| `src/actions/painel.ts` (modify) | `getActivityFeed` + tipo `ActivityEvent` |
| `src/lib/realtime-painel.ts` (modify) | Hook `usePainelActivity` |
| `src/components/painel/Hero.tsx` (modify) | Ticker real + saudação com nome do dono |
| `src/components/painel/PainelDashboard.tsx` (rewrite) | Passa `activity` e `ownerName` ao Hero |
| `src/app/painel/page.tsx` (rewrite) | Fetch do activity feed e do `store_name` |

---

## Task 1: Formatter `shortRef`

**Files:**
- Modify: `src/components/painel/formatters.ts`
- Modify (test): `src/components/painel/__tests__/formatters.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Em `src/components/painel/__tests__/formatters.test.ts`:

1. Adicionar `shortRef` à lista de nomes importados de `'../formatters'` (o `import { ... }` no topo do arquivo).
2. Acrescentar este bloco `describe` ao fim do arquivo:

```ts
describe('shortRef', () => {
  it('pega os 4 primeiros caracteres hex de um UUID sem hífens', () => {
    expect(shortRef('4f1ca02e-1234-5678-9abc-def012345678')).toBe('4f1c')
  })

  it('funciona quando os 4 primeiros são zeros', () => {
    expect(shortRef('00001111-2222-3333-4444-555566667777')).toBe('0000')
  })

  it('devolve a string inteira quando ela é menor que 4', () => {
    expect(shortRef('abc')).toBe('abc')
  })

  it('devolve string vazia para entrada vazia', () => {
    expect(shortRef('')).toBe('')
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm run test -- src/components/painel/__tests__/formatters.test.ts`
Expected: FAIL — `shortRef` não existe / não é exportada.

- [ ] **Step 3: Implementar `shortRef`**

Acrescentar ao fim de `src/components/painel/formatters.ts`:

```ts
// Referência curta de um UUID: os 4 primeiros caracteres do id sem hífens.
// Ex.: "4f1ca02e-1234-..." -> "4f1c". Usado nos identificadores do ticker.
export function shortRef(id: string): string {
  return id.replace(/-/g, '').slice(0, 4)
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm run test -- src/components/painel/__tests__/formatters.test.ts`
Expected: PASS — todos os describes verdes, incluindo `shortRef`.

- [ ] **Step 5: Commit**

```bash
git add src/components/painel/formatters.ts src/components/painel/__tests__/formatters.test.ts
git commit -m "feat(painel): add shortRef formatter for activity ticker ids"
```

---

## Task 2: Server action `getActivityFeed`

Mescla dois streams da última hora — sessões de chat iniciadas (`conversations`) e leads capturados (`leads`) — num feed ordenado.

**Files:**
- Modify: `src/actions/painel.ts`

- [ ] **Step 1: Adicionar o import de `shortRef`**

No topo de `src/actions/painel.ts`, a linha de import dos formatters hoje é:

```ts
import { rangeStart } from '@/components/painel/formatters'
```

Passa a ser:

```ts
import { rangeStart, shortRef } from '@/components/painel/formatters'
```

- [ ] **Step 2: Acrescentar o tipo e a função ao fim do arquivo**

Acrescentar ao final de `src/actions/painel.ts`:

```ts
export interface ActivityEvent {
  time: string // ISO timestamp
  identifier: string // "vis_4f1c" | "#2841"
  label: string
  tag: 'CHAT' | 'LEAD'
}

// Ticker "Atividade ao vivo" do Hero: sessões de chat iniciadas e leads
// capturados na última hora, mesclados e ordenados do mais recente ao mais
// antigo. Limitado aos 6 eventos mais recentes.
export async function getActivityFeed(): Promise<ActivityEvent[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const store = user.id
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()

  const [convsRes, leadsRes] = await Promise.all([
    supabase
      .from('conversations')
      .select('id, visitor_id, created_at')
      .eq('store_id', store)
      .gte('created_at', oneHourAgo)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('leads')
      .select('id, created_at')
      .eq('store_id', store)
      .gte('created_at', oneHourAgo)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  if (convsRes.error) {
    console.error('getActivityFeed conversations error', convsRes.error)
  }
  if (leadsRes.error) {
    console.error('getActivityFeed leads error', leadsRes.error)
  }

  const events: ActivityEvent[] = [
    ...(convsRes.data ?? []).map((c) => ({
      time: c.created_at,
      identifier: `vis_${shortRef(c.visitor_id)}`,
      label: 'sessão iniciada',
      tag: 'CHAT' as const,
    })),
    ...(leadsRes.data ?? []).map((l) => ({
      time: l.created_at,
      identifier: `#${shortRef(l.id)}`,
      label: 'lead capturado',
      tag: 'LEAD' as const,
    })),
  ]

  events.sort((a, b) => b.time.localeCompare(a.time))
  return events.slice(0, 6)
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo. Há UM erro pré-existente não relacionado em `src/app/api/inventory/import/route.ts` (falta `user_id` num upsert) — aceitável, ignore só esse.

- [ ] **Step 4: Commit**

```bash
git add src/actions/painel.ts
git commit -m "feat(painel): add getActivityFeed server action"
```

---

## Task 3: Hook `usePainelActivity`

Mantém o ticker ao vivo: a cada evento em `conversations`, refaz `getActivityFeed` com debounce de 2s. Espelha o `usePainelPulse` existente.

**Files:**
- Modify: `src/lib/realtime-painel.ts`

- [ ] **Step 1: Atualizar o import de actions**

Em `src/lib/realtime-painel.ts`, a linha de import de actions hoje é:

```ts
import { getPainelPulse, type PainelPulse } from '@/actions/painel'
```

Passa a ser:

```ts
import {
  getPainelPulse,
  getActivityFeed,
  type PainelPulse,
  type ActivityEvent,
} from '@/actions/painel'
```

- [ ] **Step 2: Acrescentar o hook ao fim do arquivo**

Acrescentar ao final de `src/lib/realtime-painel.ts`:

```ts
// Mantém o ticker de atividade atualizado: a cada evento em `conversations` da
// loja, refaz getActivityFeed com debounce de 2s. `leads` não está na
// publicação realtime, mas a captura de lead seta conversations.lead_id
// (UPDATE), que dispara aqui.
export function usePainelActivity(
  storeId: string,
  initial: ActivityEvent[],
): ActivityEvent[] {
  const [activity, setActivity] = useState(initial)

  useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null

    const refresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        getActivityFeed()
          .then(setActivity)
          .catch((err) =>
            console.error('usePainelActivity refresh failed', err),
          )
      }, 2000)
    }

    const channel = supabase
      .channel(`painel-activity:${storeId}`)
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

  return activity
}
```

`useEffect`, `useState` e `createClient` já estão importados no arquivo (usados por `useVisitorsPresence` e `usePainelPulse`).

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo (apenas o erro pré-existente conhecido em `src/app/api/inventory/import/route.ts`).

- [ ] **Step 4: Commit**

```bash
git add src/lib/realtime-painel.ts
git commit -m "feat(painel): add usePainelActivity live-refresh hook"
```

---

## Task 4: Hero — ticker real e nome do dono

**Files:**
- Modify: `src/components/painel/Hero.tsx`

- [ ] **Step 1: Atualizar os imports**

Em `src/components/painel/Hero.tsx`:

1. A linha de import de tipo hoje é:
```tsx
import type { PainelPulse } from '@/actions/painel'
```
Passa a ser:
```tsx
import type { PainelPulse, ActivityEvent } from '@/actions/painel'
```

2. A linha de import de formatters hoje é:
```tsx
import { captureRatePct, formatPercent1, formatLatency } from './formatters'
```
Passa a ser:
```tsx
import {
  captureRatePct,
  formatPercent1,
  formatLatency,
  formatPainelClock,
} from './formatters'
```

- [ ] **Step 2: Remover a constante `ACTIVITY` mockada**

Apagar este bloco inteiro de `Hero.tsx` (logo após os imports):

```tsx
const ACTIVITY = [
  { t: '09:42', a: 'vis_4f1c', k: 'sessão iniciada', tag: 'CHAT' },
  { t: '09:39', a: '#2841', k: 'lead capturado', tag: 'LEAD' },
  { t: '09:36', a: '#2837', k: 'handoff → Camila R.', tag: 'HANDOFF' },
] as const
```

- [ ] **Step 3: Atualizar a assinatura de props**

A assinatura do componente hoje é:

```tsx
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
```

Passa a ser (adicionar `activity` e `ownerName` às props e ao tipo, e calcular `hello`):

```tsx
export function Hero({
  pulse,
  greeting,
  clock,
  activity,
  ownerName,
}: {
  pulse: PainelPulse
  greeting: string
  clock: string
  activity: ActivityEvent[]
  ownerName: string
}) {
  const captureRate = formatPercent1(
    captureRatePct(pulse.leadsToday, pulse.sessionsToday),
  )
  const hello = ownerName ? `Olá, ${ownerName}.` : 'Olá.'
```

- [ ] **Step 4: Trocar a saudação hardcoded pelo nome do dono**

No JSX, a linha da saudação hoje é o texto fixo:

```tsx
            Bem-vinda, Mariana.
```

(dentro de um `<div className="font-display font-extrabold leading-[1.02] tracking-tight mt-3" ...>`). Trocar o texto fixo pela variável:

```tsx
            {hello}
```

- [ ] **Step 5: Trocar o ticker mockado pelo feed real**

No JSX, o `<ul>` do ticker hoje é:

```tsx
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
```

Substituir por:

```tsx
            <ul className="divide-y divide-white/10">
              {activity.length === 0 && (
                <li className="px-4 py-6 text-center text-[13px] text-brand-200/70">
                  Sem atividade na última hora
                </li>
              )}
              {activity.map((e) => (
                <li
                  key={`${e.tag}-${e.time}-${e.identifier}`}
                  className="px-4 py-3 flex items-center gap-3"
                >
                  <span className="eyebrow text-brand-300 tabular w-10 shrink-0">
                    {formatPainelClock(new Date(e.time))}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] leading-snug truncate">
                      <span className="font-mono font-semibold text-white">
                        {e.identifier}
                      </span>{' '}
                      <span className="text-brand-100/80">{e.label}</span>
                    </div>
                  </div>
                  <span className="eyebrow text-brand-200/70">{e.tag}</span>
                </li>
              ))}
            </ul>
```

- [ ] **Step 6: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: o `getFunnel`/`PainelDashboard` ainda não passam as novas props ao `Hero`, então é ESPERADO um erro novo em `src/components/painel/PainelDashboard.tsx` (o `<Hero>` é renderizado sem `activity`/`ownerName`). Esse erro é resolvido na Task 5. Os únicos erros aceitáveis aqui: (a) o pré-existente em `src/app/api/inventory/import/route.ts`, e (b) o erro esperado em `PainelDashboard.tsx`. Qualquer outro erro é falha real.

- [ ] **Step 7: Commit**

```bash
git add src/components/painel/Hero.tsx
git commit -m "feat(painel): wire Hero ticker to real activity feed and owner name"
```

---

## Task 5: Religar `PainelDashboard` e `page.tsx`

**Files:**
- Modify (rewrite): `src/components/painel/PainelDashboard.tsx`
- Modify (rewrite): `src/app/painel/page.tsx`

- [ ] **Step 1: Reescrever `PainelDashboard.tsx`** — substituir TODO o conteúdo por:

```tsx
'use client'

import { useEffect, useState } from 'react'
import type { PainelPulse, FunnelData, ActivityEvent } from '@/actions/painel'
import { getFunnel } from '@/actions/painel'
import type { FunnelRange } from './formatters'
import { formatPainelClock } from './formatters'
import {
  useVisitorsPresence,
  usePainelPulse,
  usePainelActivity,
} from '@/lib/realtime-painel'
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
  initialActivity,
  ownerName,
  dateLabel,
  greeting,
  initialClock,
}: {
  storeId: string
  initialPulse: PainelPulse
  initialFunnel: FunnelData
  initialActivity: ActivityEvent[]
  ownerName: string
  dateLabel: string
  greeting: string
  initialClock: string
}) {
  const pulse = usePainelPulse(storeId, initialPulse)
  const visitors = useVisitorsPresence(storeId)
  const activity = usePainelActivity(storeId, initialActivity)

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
    getFunnel(r)
      .then(setFunnel)
      .catch((err) => console.error('getFunnel failed', err))
  }

  return (
    <div className="max-w-[1280px] mx-auto px-8 py-7">
      <Topbar dateLabel={dateLabel} />
      <Hero
        pulse={pulse}
        greeting={greeting}
        clock={clock}
        activity={activity}
        ownerName={ownerName}
      />
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

- [ ] **Step 2: Reescrever `src/app/painel/page.tsx`** — substituir TODO o conteúdo por:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPainelPulse, getFunnel, getActivityFeed } from '@/actions/painel'
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

  const [initialPulse, initialFunnel, initialActivity, storeRes] =
    await Promise.all([
      getPainelPulse(),
      getFunnel('month'),
      getActivityFeed(),
      supabase
        .from('store_settings')
        .select('store_name')
        .eq('id', user.id)
        .maybeSingle(),
    ])
  const ownerName = storeRes.data?.store_name ?? ''
  const now = new Date()

  return (
    <PainelDashboard
      storeId={user.id}
      initialPulse={initialPulse}
      initialFunnel={initialFunnel}
      initialActivity={initialActivity}
      ownerName={ownerName}
      dateLabel={formatPainelDate(now)}
      greeting={painelGreeting(now)}
      initialClock={formatPainelClock(now)}
    />
  )
}
```

- [ ] **Step 3: Build completo**

Run: `npm run build`
Expected: compila e faz typecheck. O ÚNICO erro aceitável é o pré-existente em `src/app/api/inventory/import/route.ts` (`user_id` faltando). O erro de `PainelDashboard.tsx` da Task 4 deve estar resolvido agora. Qualquer outro erro é falha real a reportar.

- [ ] **Step 4: Verificação manual no navegador**

Run: `npm run dev`

Logar e abrir `/painel`. Confirmar:
- O cabeçalho do Hero mostra "Olá, {nome da loja}." (ou "Olá." se a loja não tiver `store_name`).
- O ticker "ATIVIDADE AO VIVO" mostra eventos reais da última hora (sessões de chat e leads), ou "Sem atividade na última hora" se não houver nenhum. Não aparece mais nenhum evento HANDOFF nem nomes mockados ("Camila R.").
- Abrir o chat público `/chat/<slug>` em outra aba gera uma nova conversa → em até ~2s um evento `CHAT · sessão iniciada` aparece no topo do ticker do painel.

- [ ] **Step 5: Commit**

```bash
git add src/components/painel/PainelDashboard.tsx src/app/painel/page.tsx
git commit -m "feat(painel): wire activity feed and owner name into dashboard"
```

---

## Fora do escopo (features futuras, não "Onda B")

- **Fila de leads / workflow de vendedor** — tela onde o vendedor vê leads atribuídos e marca "contatado". É o destino do botão "Abrir fila de leads". Feature própria (merece brainstorm + spec): envolve `leads.contacted_at`, atribuição de lead, e o stage 5 do funil ("Lead contatado") passa a ser real só quando ela existir.
- **Convite de equipe / `store_members`** — modelar vendedores como usuários e a presença "vendedores X/Y ON". Depende de um fluxo de convite inexistente.
- **Latência de rede cliente→servidor** na métrica p95.

Itens que seguem intencionalmente estáticos no painel após esta onda: "vendedores 2/4 ON" e a versão/build no rodapé (`LivePulse.tsx`).
