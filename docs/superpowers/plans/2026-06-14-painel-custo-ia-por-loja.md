# Custo de IA por loja no painel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar custo em R$/USD, mensagens da IA, atendimentos, custo por atendimento e % cacheado por loja na página de admin `/painel/_internal`.

**Architecture:** Estende a lib TS `src/lib/admin-usage.ts` (preços por modelo + cache → custo, agregação por loja com contagens) e a página server-component existente. As contagens de mensagens/atendimentos vêm de um RPC Postgres (`painel_atividade_ia`) para agregar no banco (a tabela `messages` cresce e o client do Supabase limita 1000 linhas).

**Tech Stack:** Next.js 16.2.4 (server components, app router), Supabase (service-role admin client + RPC), Vitest 4, TypeScript, Tailwind.

---

## File Structure

- **Modify** `src/lib/admin-usage.ts` — tipos `UsageRow`/`StoreUsage`/`UsageTotals` ganham model/cached/custo/contagens; preços; `rowCostUsd`; `aggregateByStore`/`sumUsage` estendidos; `USD_BRL`.
- **Modify** `src/lib/__tests__/admin-usage.test.ts` — atualiza fixtures pro novo shape; adiciona testes de custo, %cache, custo/atendimento.
- **Create** `supabase-migrations/2026-06-14_rpc_painel_atividade_ia.sql` — RPC de contagem por loja/período. (Pasta nova de migrations SQL do app web; se já existir convenção, seguir.)
- **Modify** `src/app/painel/(default)/%5Finternal/page.tsx` — select com model+cached; chamada ao RPC; monta mapa de contagens; novos cards + colunas; formatação de dinheiro.

Observação Next.js: é a versão 16.2.4 (modificada). Todo o trabalho REUSA padrões já presentes na página (server component async, `searchParams` Promise, `force-dynamic`, gate `isPlatformAdmin`, `createAdminClient`). Não introduzir padrão novo de Next.

---

### Task 1: Estender `admin-usage.ts` (custo + contagens)

**Files:**
- Modify: `src/lib/admin-usage.ts`
- Test: `src/lib/__tests__/admin-usage.test.ts`

- [ ] **Step 1: Reescrever o teste para o novo shape (falha esperada)**

Substituir TODO o conteúdo de `src/lib/__tests__/admin-usage.test.ts` por:

```ts
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
    // (1_000_000-200_000)*0.25 + 200_000*0.025 + 100_000*2.0 = 200000c... /1e6
    const c = rowCostUsd(row({ prompt_tokens: 1_000_000, cached_tokens: 200_000, completion_tokens: 100_000 }))
    // 0.8*0.25 + 0.2*0.025 + 0.1*2.0 = 0.2 + 0.005 + 0.2 = 0.405
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
    // custo a: mini (0.5*0.25 + 0.5*0.025) + nano (1*0.05) = 0.1375 + 0.05 = 0.1875
    expect(a.costUsd).toBeCloseTo(0.1875, 6)
    expect(a.cached).toBe(500_000)
    expect(a.prompt).toBe(2_000_000)
    expect(a.cachedPct).toBeCloseTo(0.25, 6)   // 500k cached / 2M prompt
    expect(a.iaMessages).toBe(10)
    expect(a.attendances).toBe(4)
    expect(a.costPerAttendanceUsd).toBeCloseTo(0.1875 / 4, 6)
    // b (só output, custo 2.0) vem antes de a por custo desc
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- src/lib/__tests__/admin-usage.test.ts`
Expected: FAIL (imports `rowCostUsd`, `USD_BRL`, `StoreCounts` inexistentes; shape mudou).

- [ ] **Step 3: Reescrever `src/lib/admin-usage.ts`**

Substituir TODO o conteúdo por:

```ts
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- src/lib/__tests__/admin-usage.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin-usage.ts src/lib/__tests__/admin-usage.test.ts
git commit -m "feat(painel): custo por modelo+cache e contagens em admin-usage"
```

---

### Task 2: RPC de atividade da IA por loja

**Files:**
- Create: `supabase-migrations/2026-06-14_rpc_painel_atividade_ia.sql`

- [ ] **Step 1: Escrever a migration**

Criar `supabase-migrations/2026-06-14_rpc_painel_atividade_ia.sql`:

```sql
-- Contagem de atividade da IA por loja a partir de um início (date, fuso SP).
-- Agrega no banco (a tabela messages cresce; o client Supabase limita 1000 linhas).
CREATE OR REPLACE FUNCTION painel_atividade_ia(p_inicio date)
RETURNS TABLE (store_id uuid, ia_mensagens bigint, atendimentos bigint)
LANGUAGE sql STABLE AS $$
  SELECT m.store_id,
         COUNT(*) FILTER (WHERE m.role = 'assistant') AS ia_mensagens,
         COUNT(DISTINCT m.conversation_id)            AS atendimentos
  FROM messages m
  WHERE m.created_at >= (p_inicio::timestamp AT TIME ZONE 'America/Sao_Paulo')
  GROUP BY m.store_id;
$$;
```

- [ ] **Step 2: Aplicar no Supabase**

Rodar o SQL no banco (SQL editor do Supabase ou via psql/asyncpg com a DATABASE_URL do serviço). Validar:

Run (psql): `SELECT * FROM painel_atividade_ia((now() at time zone 'America/Sao_Paulo')::date);`
Expected: linhas `(store_id, ia_mensagens, atendimentos)` sem erro.

- [ ] **Step 3: Commit**

```bash
git add supabase-migrations/2026-06-14_rpc_painel_atividade_ia.sql
git commit -m "feat(painel): RPC painel_atividade_ia (mensagens/atendimentos por loja)"
```

---

### Task 3: Ligar a página `/painel/_internal`

**Files:**
- Modify: `src/app/painel/(default)/%5Finternal/page.tsx`

- [ ] **Step 1: Trocar imports da lib e o bloco de leitura/age­gação**

No topo, garantir o import de `USD_BRL` e tipos:

```ts
import {
  resolvePeriodStart,
  aggregateByStore,
  sumUsage,
  type Periodo,
  type UsageRow,
  type StoreCounts,
} from '@/lib/admin-usage'
```

Substituir o bloco de leitura (o `Promise.all([... ai_usage_daily ..., ... store_settings ...])` e a montagem de `rows/names/porLoja/totais/erro`) por:

```ts
  const admin = createAdminClient()
  const [usageRes, storesRes, ativRes] = await Promise.all([
    admin
      .from('ai_usage_daily')
      .select('store_id, model, prompt_tokens, completion_tokens, total_tokens, cached_tokens, calls')
      .gte('day', start),
    admin.from('store_settings').select('id, store_name'),
    admin.rpc('painel_atividade_ia', { p_inicio: start }),
  ])

  const rows: UsageRow[] = usageRes.data ?? []
  const names = new Map(
    (storesRes.data ?? []).map((s) => [s.id, s.store_name] as const),
  )
  const counts = new Map<string, StoreCounts>(
    (ativRes.data ?? []).map((a: { store_id: string; ia_mensagens: number; atendimentos: number }) => [
      a.store_id,
      { iaMessages: Number(a.ia_mensagens), attendances: Number(a.atendimentos) },
    ]),
  )
  const porLoja = aggregateByStore(rows, names, counts)
  const totais = sumUsage(porLoja)
  const erro = Boolean(usageRes.error || storesRes.error || ativRes.error)
```

- [ ] **Step 2: Adicionar formatadores de dinheiro e % (perto do `fmt` existente)**

```ts
const fmt = (n: number) => new Intl.NumberFormat('pt-BR').format(n)
const brl = (usd: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(usd * USD_BRL)
const usdFmt = (usd: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(usd)
const pct = (f: number) => `${Math.round(f * 100)}%`
```

- [ ] **Step 3: Trocar os 4 StatCards**

Substituir o bloco `<div className="grid grid-cols-2 ...">...</div>` dos cards por:

```tsx
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label={`Custo · ${LABEL[periodo]}`}
              value={brl(totais.costUsd)}
              hint={usdFmt(totais.costUsd)}
              tone="brand"
              emphasis="value"
              icon={<Icon name="receipt" className="h-4 w-4" />}
            />
            <StatCard
              label="Atendimentos"
              value={fmt(totais.attendances)}
              tone="info"
              icon={<Icon name="chat" className="h-4 w-4" />}
            />
            <StatCard
              label="Mensagens IA"
              value={fmt(totais.iaMessages)}
              tone="neutral"
              hint={`${fmt(totais.calls)} chamadas`}
              icon={<Icon name="ai" className="h-4 w-4" />}
            />
            <StatCard
              label="Cacheado"
              value={pct(totais.cachedPct)}
              tone="success"
              hint={`${fmt(totais.total)} tokens`}
              icon={<Icon name="sparkle" className="h-4 w-4" />}
            />
          </div>
```

Nota: usar nomes de ícone que existam em `@/components/painel/Icons` (a página já usa `alert`, `sparkle`, `ai`, `send`, `store`, `receipt`). Se `chat` não existir, usar `send` ou outro válido (conferir o arquivo de Icons no Step 5).

- [ ] **Step 4: Trocar a tabela por loja**

Substituir o `<table>` (thead+tbody) por:

```tsx
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                      <th className="px-5 py-3">Loja</th>
                      <th className="px-5 py-3 text-right">Atend.</th>
                      <th className="px-5 py-3 text-right">Msgs IA</th>
                      <th className="px-5 py-3 text-right">Tokens</th>
                      <th className="px-5 py-3 text-right">% cache</th>
                      <th className="px-5 py-3 text-right">Custo (R$)</th>
                      <th className="px-5 py-3 text-right">R$/atend.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {porLoja.map((s) => (
                      <tr key={s.storeId} className="hover:bg-slate-50/60">
                        <td className="px-5 py-3 font-medium text-slate-900">{s.storeName}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-slate-600">{fmt(s.attendances)}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-slate-600">{fmt(s.iaMessages)}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-slate-600">{fmt(s.total)}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-slate-600">{pct(s.cachedPct)}</td>
                        <td className="px-5 py-3 text-right tabular-nums font-semibold text-slate-900">{brl(s.costUsd)}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-slate-600">{brl(s.costPerAttendanceUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
```

- [ ] **Step 5: Conferir nomes de ícone e tipos; typecheck/lint**

Run: `grep -oE "name=\"[a-z]+\"" src/app/painel/\(default\)/%5Finternal/page.tsx` e conferir cada um contra `src/components/painel/Icons.tsx` (trocar inválidos por válidos).
Run: `npx tsc --noEmit` (ou o script de typecheck do projeto, ex.: `npm run typecheck` se existir)
Expected: sem erros de tipo na página.

- [ ] **Step 6: Commit**

```bash
git add "src/app/painel/(default)/%5Finternal/page.tsx"
git commit -m "feat(painel): custo R\$/USD, atendimentos, msgs IA e % cache por loja"
```

---

### Task 4: Verificação final

**Files:** nenhum (só execução)

- [ ] **Step 1: Suíte de testes do web**

Run: `npm test`
Expected: PASS (incl. admin-usage).

- [ ] **Step 2: Build/typecheck**

Run: `npm run build` (ou `npx tsc --noEmit` se o build for pesado)
Expected: sem erros.

- [ ] **Step 3: Checagem manual (opcional, recomendada)**

Subir o app (`npm run dev`), logar como platform-admin, abrir `/painel/_internal`, alternar período (dia/semana/mês) e conferir: cards de Custo/Atendimentos/Msgs IA/Cacheado e a tabela por loja com Custo (R$). Conferir que não-admin recebe 404.

- [ ] **Step 4: Commit final se houver ajustes**

```bash
git add -A && git commit -m "chore(painel): ajustes pós-verificação do custo por loja"
```

---

## Notas de execução

- **Isolamento:** já estamos no worktree, branch `feat/painel-custo-ia` a partir de `origin/main`.
- **Deviation da spec (consciente):** a spec sugeriu contar mensagens em TS (distinct); o plano usa um RPC Postgres por causa do limite de 1000 linhas do client Supabase ao crescer a `messages`. Mesma saída (mensagens da IA + atendimentos por loja), mais robusto.
- **Dados legados** (`model='desconhecido'`, `cached=0`) caem no preço mini sem cache → custo é teto até o chat-service novo ser redeployado.
