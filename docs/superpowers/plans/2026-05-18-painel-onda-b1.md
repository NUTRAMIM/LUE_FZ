# Painel — Onda B1 (latência IA p95 + ciclo do funil) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir os dois últimos números hardcoded do painel — latência IA p95 e ciclo médio do funil — por dados reais, via duas migrations de schema.

**Architecture:** Migration 022 adiciona `conversations.closed_at` (preenchido por trigger ao fechar) para o funil medir o stage "Fechado" e o ciclo médio com precisão. Migration 023 adiciona `messages.latency_ms` (preenchido por trigger a cada resposta da IA) mais uma RPC `get_ai_latency_p95`. As server actions `getPainelPulse`/`getFunnel` passam a ler esses campos; os 3 componentes que mostravam "1,8s" hardcoded passam a exibir o valor real.

**Tech Stack:** Next.js 16, React 19, Supabase (Postgres + RLS), Vitest 4.

**Spec de referência:** `docs/superpowers/specs/2026-05-15-painel-real-data-design.md` (Onda B, parte 1 de 2).

**Pré-requisito:** Onda A está mergeada (`getPainelPulse`, `getFunnel`, `formatters.ts`, e os componentes `Hero`/`PulseStripe`/`LivePulse` já existem). A última migration do projeto é a `021`.

---

## Escopo desta onda

Onda B foi dividida em duas. **Esta é a B1.** Fica de fora (vai para a B2): `store_members`, `conversation_events`, `acceptConversation`, presença de vendedores, ticker de atividade real, stage 5 preciso. O stage 5 ("Aceito pelo vendedor") continua usando o proxy `status='human_active'`+`updated_at` da Onda A nesta B1.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/022_conversations_closed_at.sql` (novo) | Coluna `closed_at` + trigger + índice |
| `supabase/migrations/023_messages_latency.sql` (novo) | Coluna `latency_ms` + trigger + RPC `get_ai_latency_p95` |
| `src/types/database.ts` (modify) | Tipos: `conversations.closed_at`, `messages.latency_ms` |
| `src/components/painel/formatters.ts` (modify) | Função `formatLatency` |
| `src/components/painel/__tests__/formatters.test.ts` (modify) | Testes de `formatLatency` |
| `src/actions/painel.ts` (modify) | `getPainelPulse`: campo `aiLatencyP95Ms`. `getFunnel`: `closed_at` no stage 6 + ciclo |
| `src/components/painel/Hero.tsx` (modify) | Latência p95 vinda do pulse |
| `src/components/painel/PulseStripe.tsx` (modify) | Latência no `sub` do card |
| `src/components/painel/LivePulse.tsx` (modify) | Latência no rodapé |

---

## Task 1: Migration 022 — `conversations.closed_at`

As migrations não são aplicadas automaticamente — esta task só **cria o arquivo SQL**. A aplicação ao Supabase é um passo de deploy, descrito na seção final do plano.

**Files:**
- Create: `supabase/migrations/022_conversations_closed_at.sql`

- [ ] **Step 1: Criar o arquivo de migration**

Criar `supabase/migrations/022_conversations_closed_at.sql`:

```sql
-- 022_conversations_closed_at.sql
-- Adds conversations.closed_at so the funnel can count the "Fechado" stage
-- and compute cycle time precisely, replacing the updated_at proxy from Onda A.

ALTER TABLE conversations
  ADD COLUMN closed_at TIMESTAMPTZ;

-- Backfill existing closed conversations with their last-update time as a
-- best-effort approximation (the precise close time is unknowable in retrospect).
UPDATE conversations SET closed_at = updated_at WHERE status = 'closed';

-- Keep closed_at in sync with status transitions.
CREATE OR REPLACE FUNCTION set_conversation_closed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    NEW.closed_at = now();
  ELSIF NEW.status <> 'closed' THEN
    NEW.closed_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_conversations_closed_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_conversation_closed_at();

-- Index for the store-scoped funnel query (closed_at >= range_start).
CREATE INDEX idx_conversations_store_closed
  ON conversations (store_id, closed_at DESC)
  WHERE closed_at IS NOT NULL;
```

- [ ] **Step 2: Revisar o SQL**

Confira: a coluna é nullable (sem `NOT NULL` — conversas abertas não têm `closed_at`); o trigger é `BEFORE UPDATE` (precisa setar `NEW` antes da escrita); `IS DISTINCT FROM` cobre o caso de `OLD.status` nulo; o índice é parcial (`WHERE closed_at IS NOT NULL`). O projeto já tem um trigger `BEFORE UPDATE` em `conversations` (`trg_conversations_updated`); dois triggers `BEFORE UPDATE` coexistem sem problema (rodam em ordem alfabética de nome, e tocam colunas diferentes).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/022_conversations_closed_at.sql
git commit -m "feat(db): add conversations.closed_at with sync trigger"
```

---

## Task 2: Migration 023 — `messages.latency_ms` + RPC de p95

**Files:**
- Create: `supabase/migrations/023_messages_latency.sql`

- [ ] **Step 1: Criar o arquivo de migration**

Criar `supabase/migrations/023_messages_latency.sql`:

```sql
-- 023_messages_latency.sql
-- Adds messages.latency_ms (AI response time, DB-side) and a per-store p95 RPC
-- for the painel's "Latência IA · p95" metric.

ALTER TABLE messages
  ADD COLUMN latency_ms INT;

-- On each assistant message, record milliseconds since the most recent user
-- message in the same conversation. NULL when there is no preceding user msg.
CREATE OR REPLACE FUNCTION calculate_message_latency()
RETURNS TRIGGER AS $$
DECLARE
  last_user_at TIMESTAMPTZ;
BEGIN
  IF NEW.role = 'assistant' THEN
    SELECT created_at INTO last_user_at
    FROM messages
    WHERE conversation_id = NEW.conversation_id AND role = 'user'
    ORDER BY created_at DESC
    LIMIT 1;
    IF last_user_at IS NOT NULL THEN
      NEW.latency_ms =
        (EXTRACT(EPOCH FROM (NEW.created_at - last_user_at)) * 1000)::INT;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_messages_latency
  BEFORE INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION calculate_message_latency();

-- p95 of AI latency over the last 24h for one store.
-- SECURITY INVOKER => respects the messages_read_owner RLS (auth.uid() = store_id).
CREATE OR REPLACE FUNCTION get_ai_latency_p95(p_store_id UUID)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT COALESCE(
    percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms),
    0
  )::INT
  FROM messages
  WHERE store_id = p_store_id
    AND role = 'assistant'
    AND latency_ms IS NOT NULL
    AND created_at > now() - interval '24 hours';
$$;
```

- [ ] **Step 2: Revisar o SQL**

Confira: o trigger é `BEFORE INSERT` (lê `NEW.created_at`, já preenchido pelo `DEFAULT now()` antes dos triggers `BEFORE`); só age em `role='assistant'`; deixa `latency_ms` NULL se não houver mensagem `user` anterior. O projeto já tem um `BEFORE INSERT` em `messages` (`trg_messages_set_store_id`); coexistem sem problema. A RPC retorna `0` quando não há amostras (o `COALESCE`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/023_messages_latency.sql
git commit -m "feat(db): add messages.latency_ms trigger and p95 RPC"
```

---

## Task 3: Tipos TS — `closed_at` e `latency_ms`

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Adicionar os campos aos tipos**

Em `src/types/database.ts`:

1. No tipo da tabela `conversations`, adicionar o campo `closed_at: string | null` às três formas — `Row`, `Insert`, `Update`. Em `Row` é obrigatório; em `Insert` e `Update` é opcional (`closed_at?: string | null`). Siga o estilo das colunas nullable vizinhas já presentes nesse tipo (por exemplo `last_read_at`, que foi adicionada da mesma forma na migration 020).

2. No tipo da tabela `messages`, adicionar `latency_ms: number | null` às três formas — `Row`, `Insert`, `Update` (obrigatório em `Row`, opcional em `Insert`/`Update`). Siga o estilo das colunas numéricas/nullable vizinhas.

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo. Há UM erro pré-existente não relacionado em `src/app/api/inventory/import/route.ts` (falta `user_id` num upsert) — esse é aceitável e deve ser ignorado.

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts
git commit -m "feat(types): add conversations.closed_at and messages.latency_ms"
```

---

## Task 4: Formatter `formatLatency`

**Files:**
- Modify: `src/components/painel/formatters.ts`
- Modify (test): `src/components/painel/__tests__/formatters.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Em `src/components/painel/__tests__/formatters.test.ts`:

1. Adicionar `formatLatency` à lista de imports no topo do arquivo (o `import { ... } from '../formatters'` existente).
2. Acrescentar este bloco `describe` ao fim do arquivo:

```ts
describe('formatLatency', () => {
  it('formata ms como segundos pt-BR com 1 casa', () => {
    expect(formatLatency(1830)).toBe('1,8s')
  })

  it('arredonda para 1 casa decimal', () => {
    expect(formatLatency(940)).toBe('0,9s')
  })

  it('formata valores acima de 10s', () => {
    expect(formatLatency(12000)).toBe('12,0s')
  })

  it('retorna travessão quando não há dado (zero)', () => {
    expect(formatLatency(0)).toBe('—')
  })

  it('retorna travessão para valores negativos', () => {
    expect(formatLatency(-5)).toBe('—')
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm run test -- src/components/painel/__tests__/formatters.test.ts`
Expected: FAIL — `formatLatency` não existe / não é exportada.

- [ ] **Step 3: Implementar `formatLatency`**

Acrescentar ao fim de `src/components/painel/formatters.ts`:

```ts
// Formata uma latência em ms como rótulo de segundos pt-BR (1830 -> "1,8s").
// Devolve "—" quando não há amostra (0 ou negativo).
export function formatLatency(ms: number): string {
  if (ms <= 0) return '—'
  return `${(ms / 1000).toFixed(1).replace('.', ',')}s`
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm run test -- src/components/painel/__tests__/formatters.test.ts`
Expected: PASS — todos os describes verdes, incluindo `formatLatency`.

- [ ] **Step 5: Commit**

```bash
git add src/components/painel/formatters.ts src/components/painel/__tests__/formatters.test.ts
git commit -m "feat(painel): add formatLatency formatter"
```

---

## Task 5: `getPainelPulse` — campo `aiLatencyP95Ms`

**Files:**
- Modify: `src/actions/painel.ts`

- [ ] **Step 1: Adicionar o campo à interface e ao EMPTY_PULSE**

Em `src/actions/painel.ts`, na interface `PainelPulse`, adicionar o campo `aiLatencyP95Ms` como último campo:

```ts
export interface PainelPulse {
  leadsWeek: number
  leadsToday: number
  awaitingContact: number
  stale1h: number
  activeAiSessions: number
  sessionsToday: number
  aiLatencyP95Ms: number
}
```

E em `EMPTY_PULSE`, adicionar `aiLatencyP95Ms: 0` como último campo:

```ts
const EMPTY_PULSE: PainelPulse = {
  leadsWeek: 0,
  leadsToday: 0,
  awaitingContact: 0,
  stale1h: 0,
  activeAiSessions: 0,
  sessionsToday: 0,
  aiLatencyP95Ms: 0,
}
```

- [ ] **Step 2: Chamar a RPC e devolver o campo**

Ainda em `getPainelPulse`, dentro do `Promise.all`, acrescentar a chamada da RPC `get_ai_latency_p95` como **sétimo (último) elemento** do array, logo após a query `sessionsToday`:

```ts
    supabase
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', store)
      .gte('created_at', dayStart),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc('get_ai_latency_p95', { p_store_id: store }),
  ])
```

Atualizar a desestruturação do array `results` para capturar o sétimo elemento:

```ts
  const [
    leadsWeek,
    leadsToday,
    awaiting,
    stale,
    activeAi,
    sessionsToday,
    latency,
  ] = results
```

E acrescentar o campo ao objeto de retorno como último:

```ts
  return {
    leadsWeek: leadsWeek.count ?? 0,
    leadsToday: leadsToday.count ?? 0,
    awaitingContact: awaiting.count ?? 0,
    stale1h: stale.count ?? 0,
    activeAiSessions: activeAi.count ?? 0,
    sessionsToday: sessionsToday.count ?? 0,
    aiLatencyP95Ms: Number(latency.data ?? 0),
  }
```

O loop `results.forEach((r, i) => { if (r.error) ... })` que já existe continua valendo — ele loga o `.error` da RPC também, sem alteração.

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo (apenas o erro pré-existente conhecido em `src/app/api/inventory/import/route.ts`). O padrão `(supabase as any).rpc(...)` é o mesmo já usado em `src/actions/conversas.ts` para RPCs não tipadas.

- [ ] **Step 4: Commit**

```bash
git add src/actions/painel.ts
git commit -m "feat(painel): expose AI latency p95 in getPainelPulse"
```

---

## Task 6: `getFunnel` — stage 6 e ciclo via `closed_at`

**Files:**
- Modify: `src/actions/painel.ts`

- [ ] **Step 1: Trocar a query do stage 6 para usar `closed_at`**

Em `src/actions/painel.ts`, dentro de `getFunnel`, no array do `Promise.all`, o quarto elemento é a query do stage 6. Hoje ele é:

```ts
    // Stage 6 + ciclo — proxy: status closed e updated_at (Onda B usa closed_at).
    supabase
      .from('conversations')
      .select('created_at, updated_at')
      .eq('store_id', store)
      .eq('status', 'closed')
      .gte('updated_at', start),
```

Substituir por:

```ts
    // Stage 6 + ciclo — conversas fechadas no período (closed_at, migration 022).
    supabase
      .from('conversations')
      .select('created_at, closed_at')
      .eq('store_id', store)
      .not('closed_at', 'is', null)
      .gte('closed_at', start),
```

- [ ] **Step 2: Trocar o cálculo do ciclo médio para usar `closed_at`**

Logo abaixo, o cálculo de `cycleDays` hoje usa `c.updated_at`:

```ts
  const closedRows = closedRes.data ?? []
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
```

Substituir `c.updated_at` por `c.closed_at!` (a query filtra `closed_at IS NOT NULL`, então o valor nunca é nulo nessas linhas — o `!` informa isso ao TypeScript):

```ts
  const closedRows = closedRes.data ?? []
  const cycleDays =
    closedRows.length === 0
      ? 0
      : closedRows.reduce(
          (sum, c) =>
            sum +
            (new Date(c.closed_at!).getTime() -
              new Date(c.created_at).getTime()),
          0,
        ) /
        closedRows.length /
        86_400_000
```

Nada mais muda: `closed: closedRows.length` no objeto de retorno continua correto (agora conta as conversas com `closed_at` no período). O stage 5 (`vendorAccepted`) permanece com o proxy `human_active`+`updated_at` — a precisão dele virá na Onda B2.

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo (apenas o erro pré-existente conhecido em `src/app/api/inventory/import/route.ts`). O campo `closed_at` é reconhecido porque a Task 3 o adicionou ao tipo de `conversations`.

- [ ] **Step 4: Commit**

```bash
git add src/actions/painel.ts
git commit -m "feat(painel): compute funnel close stage and cycle from closed_at"
```

---

## Task 7: Exibir a latência real no Hero, PulseStripe e LivePulse

Os três componentes hoje mostram `1,8s` hardcoded. Passam a usar `formatLatency(pulse.aiLatencyP95Ms)`.

**Files:**
- Modify: `src/components/painel/Hero.tsx`
- Modify: `src/components/painel/PulseStripe.tsx`
- Modify: `src/components/painel/LivePulse.tsx`

- [ ] **Step 1: Hero — latência do pulse**

Em `src/components/painel/Hero.tsx`:

1. No import de formatters, adicionar `formatLatency`. A linha hoje é:
```tsx
import { captureRatePct, formatPercent1 } from './formatters'
```
Passa a ser:
```tsx
import { captureRatePct, formatPercent1, formatLatency } from './formatters'
```

2. O bloco "LATÊNCIA IA · p95" hoje é:
```tsx
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
```
Substituir o conteúdo interno do `<div>` de valor pelo valor real:
```tsx
            <div>
              <div className="eyebrow text-brand-200">LATÊNCIA IA · p95</div>
              <div
                className="font-display font-extrabold tabular mt-1.5"
                style={{ fontSize: '30px', lineHeight: 1 }}
              >
                {formatLatency(pulse.aiLatencyP95Ms)}
              </div>
            </div>
```

- [ ] **Step 2: PulseStripe — latência no `sub` do primeiro card**

Em `src/components/painel/PulseStripe.tsx`:

1. Adicionar o import de `formatLatency`. Hoje o arquivo importa `PainelPulse`:
```tsx
import type { PainelPulse } from '@/actions/painel'
```
Acrescentar logo abaixo:
```tsx
import { formatLatency } from './formatters'
```

2. No array `cards`, o primeiro card ("Sessões IA ativas") tem `sub: 'IA RESPONDENDO  ·  p95 1,8s'`. Trocar por uma template string com a latência real:
```tsx
      sub: `IA RESPONDENDO  ·  p95 ${formatLatency(pulse.aiLatencyP95Ms)}`,
```

- [ ] **Step 3: LivePulse — latência no rodapé**

Em `src/components/painel/LivePulse.tsx`:

1. Adicionar o import de `formatLatency`. Hoje o arquivo importa `PainelPulse`:
```tsx
import type { PainelPulse } from '@/actions/painel'
```
Acrescentar logo abaixo:
```tsx
import { formatLatency } from './formatters'
```

2. O segmento de latência hoje é:
```tsx
      <span>
        IA p95 <span className="text-ink-700 font-semibold">1,8s</span>
      </span>
```
Trocar por:
```tsx
      <span>
        IA p95{' '}
        <span className="text-ink-700 font-semibold">
          {formatLatency(pulse.aiLatencyP95Ms)}
        </span>
      </span>
```

- [ ] **Step 4: Build completo**

Run: `npm run build`
Expected: compila e faz typecheck. O ÚNICO erro aceitável é o pré-existente em `src/app/api/inventory/import/route.ts` (`user_id` faltando) — qualquer outro erro é falha real a reportar.

- [ ] **Step 5: Commit**

```bash
git add src/components/painel/Hero.tsx src/components/painel/PulseStripe.tsx src/components/painel/LivePulse.tsx
git commit -m "feat(painel): show real AI latency p95 in Hero, PulseStripe and footer"
```

---

## Deploy & verificação

O código compila independentemente, mas as duas migrations precisam ser **aplicadas ao Supabase** para o painel mostrar os valores reais — caso contrário a coluna `closed_at`, a coluna `latency_ms` e a RPC `get_ai_latency_p95` não existem e as queries falham em runtime (a action loga o erro e devolve `0` / o funil mostra zero no stage 6).

Aplicar `022_conversations_closed_at.sql` e `023_messages_latency.sql` via `supabase db push` (se o projeto estiver linkado) ou colando o SQL no SQL Editor do dashboard Supabase, na ordem numérica. Este passo é manual — o agente que executa o plano NÃO deve tentar aplicá-las.

Após aplicar, verificação manual no navegador (`npm run dev`, logar, abrir `/painel`):
- "LATÊNCIA IA · p95" no Hero, o `sub` do card "Sessões IA ativas" e o "IA p95" do rodapé mostram o mesmo valor real (ou "—" se a loja ainda não tem mensagens da IA nas últimas 24h).
- No funil, o stage "Fechado (marcado)" e o "CICLO MÉDIO" refletem `closed_at`. Conversas fechadas antes da migration aparecem com `closed_at` aproximado (backfill via `updated_at`); conversas fechadas depois têm o horário exato.

## Fora do escopo (vai para a Onda B2)

`store_members`, `conversation_events`, a action `acceptConversation`, presença de vendedores (`useAgentsPresence`), o ticker de atividade ao vivo real, o stage 5 preciso ("Aceito pelo vendedor" via eventos de handoff) e o nome real do dono no Hero.
