# Pagamentos / Assinatura (Stripe + Mercado Pago) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar a assinatura paga do LUE FZ com 3 planos reais, dois ciclos (mensal/trimestral), cobrança por cartão (Stripe, recorrente) e PIX (Mercado Pago, avulso), com gate de funcionalidades e gestão da assinatura.

**Architecture:** Tudo vive no app Next.js existente (não migra para Python). `src/lib/plans.ts` vira o catálogo server-side, fonte única de verdade de preço/limite — o frontend envia só `plan_id`+`cycle`, nunca valor. Checkout resolve o preço no servidor; webhooks (já validados por assinatura + idempotência) sincronizam `store_subscriptions`. Um helper central deriva "assinatura ativa" do estado real e é aplicado nos pontos de funcionalidade (IA no chat, publicar loja, agentes, estoque).

**Tech Stack:** Next.js 16 (App Router, Server Actions), TypeScript, Supabase (Postgres + RLS), Stripe SDK 22, Mercado Pago SDK 2, Vitest 4.

---

## ⛔ POLÍTICA DE COMMIT (instrução explícita do usuário)

**NÃO COMMITAR durante a execução.** O usuário pediu: nenhum commit até estar 100% funcional e com aprovação dele. Cada task termina em **verificação** (typecheck/test), não em commit. Deixe o trabalho *staged/working tree*. Há uma única task de commit no fim (Fase 6), que só roda após o usuário aprovar. Se um worker subagente "quiser" commitar entre tasks, **não commite** — apenas rode as verificações.

Comandos de verificação usados ao longo do plano:
- Testes de um arquivo: `npm run test -- src/lib/__tests__/<arquivo>.test.ts`
- Typecheck do projeto: `npx tsc --noEmit`
- Build (verificação pesada, opcional por task): `npm run build`

---

## Pendências do usuário (não bloqueiam Fases 0–3; necessárias antes do go-live)

1. **Valores trimestrais** de cada plano (com desconto). Placeholder atual = 3× o mensal (sem desconto).
2. **Limites finais** (mensagens/mês e nº de agentes) por plano. Placeholder = valores atuais da UI (1000/3, 5000/5, 20000/10).
3. **Products/Prices reais no Stripe** (6 Prices) e os 6 env vars `STRIPE_PRICE_*` (Fase 1).
4. **Secrets de produção**: `STRIPE_SECRET_KEY` (live), `STRIPE_WEBHOOK_SECRET` (live), `MERCADOPAGO_ACCESS_TOKEN` (prod), `MERCADOPAGO_WEBHOOK_SECRET` (prod real, não `placeholder`).

---

## File Structure

**Criar:**
- `supabase/migrations/049_store_subscriptions_billing_cycle.sql` — adiciona coluna `billing_cycle`.
- `src/lib/subscription.ts` — helper central de "assinatura ativa" (puro + acesso por storeId via admin client).
- `src/lib/__tests__/plans.test.ts` — testes da resolução de plano/ciclo/preço.
- `src/lib/__tests__/subscription.test.ts` — testes da função pura de atividade.
- `.env.example` — documenta todas as envs (sem segredos).

**Modificar:**
- `src/lib/plans.ts` — catálogo: 3 planos × 2 ciclos, limites, Price IDs por ciclo, helper `resolvePlanCycle`.
- `src/lib/plan-limits.ts` — passa a ler limites de `PLANS` (fonte única) em vez de `PLANS_DISPLAY`.
- `src/actions/billing.ts` — `createCheckoutSession(planId, cycle)`, `cancelSubscription()`; reuso de Customer.
- `src/app/api/mercadopago/pix/route.ts` — aceita `cycle`, resolve preço/duração no servidor.
- `src/app/api/mercadopago/webhook/route.ts` — calcula período pelo ciclo gravado no metadata; remove fallback `'pro'`.
- `src/app/api/stripe/webhook/route.ts` — grava `billing_cycle`; sem fallback `'pro'`.
- `src/app/planos/CheckoutClient.tsx` — passa `cycle`; seletor de ciclo.
- `src/app/planos/page.tsx` — renderiza os 3 planos (não só `pro`).
- `src/app/painel/planos/page.tsx` + `PlanosClient.tsx` — preços reais, toggle mensal/trimestral funcional, botões Portal/Cancelar/Upgrade ligados.
- `src/actions/chat.ts` — `sendMessage` checa assinatura ativa antes de acionar a IA.
- Pontos de funcionalidade gated (publicar loja, convidar/ativar agente, importar estoque) — ações server-side ganham `requireActiveStoreSubscription`.
- `src/middleware.ts` — mantém `BILLING_GATED = []` (gate é por funcionalidade, não por rota). Sem mudança de redirect.

---

## FASE 0 — Catálogo de planos (fonte única de verdade)

### Task 0.1: Migration — coluna `billing_cycle`

**Files:**
- Create: `supabase/migrations/049_store_subscriptions_billing_cycle.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- 049_store_subscriptions_billing_cycle.sql
-- Adiciona o ciclo de cobrança (mensal/trimestral) à assinatura. Necessário
-- para o webhook do MP saber por quantos dias liberar (30 vs 90) e para a UI
-- mostrar/alternar o ciclo. NULL = legado/desconhecido (tratado como mensal).

ALTER TABLE store_subscriptions
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT
  CHECK (billing_cycle IN ('monthly', 'quarterly'));
```

- [ ] **Step 2: Aplicar localmente (se houver Supabase local) ou registrar para aplicar em prod**

Run: `npx supabase db push` (se o projeto usa supabase CLI local). Se o fluxo do projeto aplica migrations manualmente no painel, **registre na pendência de deploy** que a 049 precisa ser aplicada.
Expected: coluna `billing_cycle` existe em `store_subscriptions`.

> Não há commit nesta task (ver política de commit).

---

### Task 0.2: Reescrever o catálogo `plans.ts`

**Files:**
- Modify: `src/lib/plans.ts` (substituição completa)
- Test: `src/lib/__tests__/plans.test.ts`

- [ ] **Step 1: Escrever o teste falhando**

```ts
// src/lib/__tests__/plans.test.ts
import { describe, it, expect } from 'vitest'
import { PLANS, resolvePlanCycle, planPriceCents, planDurationDays } from '../plans'

describe('PLANS catalog', () => {
  it('has the three real plans', () => {
    expect(Object.keys(PLANS).sort()).toEqual(
      ['essencial', 'performance', 'profissional'],
    )
  })
  it('monthly prices are 289/319/419 in cents', () => {
    expect(PLANS.essencial.monthly.price_brl).toBe(28900)
    expect(PLANS.profissional.monthly.price_brl).toBe(31900)
    expect(PLANS.performance.monthly.price_brl).toBe(41900)
  })
  it('monthly is 30 days, quarterly is 90 days', () => {
    expect(PLANS.essencial.monthly.duration_days).toBe(30)
    expect(PLANS.essencial.quarterly.duration_days).toBe(90)
  })
})

describe('resolvePlanCycle', () => {
  it('resolves a valid plan + cycle', () => {
    const r = resolvePlanCycle('profissional', 'quarterly')
    expect(r).not.toBeNull()
    expect(r!.planId).toBe('profissional')
    expect(r!.cycle).toBe('quarterly')
    expect(r!.pricing.duration_days).toBe(90)
  })
  it('defaults cycle to monthly when missing', () => {
    const r = resolvePlanCycle('essencial', undefined)
    expect(r!.cycle).toBe('monthly')
  })
  it('rejects unknown plan', () => {
    expect(resolvePlanCycle('pirata', 'monthly')).toBeNull()
  })
  it('rejects unknown cycle', () => {
    expect(resolvePlanCycle('essencial', 'weekly')).toBeNull()
  })
})

describe('helpers', () => {
  it('planPriceCents returns the cycle price', () => {
    expect(planPriceCents('performance', 'monthly')).toBe(41900)
  })
  it('planDurationDays returns the cycle duration', () => {
    expect(planDurationDays('performance', 'quarterly')).toBe(90)
  })
  it('helpers return null for unknown', () => {
    expect(planPriceCents('x', 'monthly')).toBeNull()
    expect(planDurationDays('essencial', 'x')).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- src/lib/__tests__/plans.test.ts`
Expected: FAIL — `resolvePlanCycle`/`planPriceCents`/`planDurationDays` não existem; PLANS ainda só tem `pro`.

- [ ] **Step 3: Reescrever `src/lib/plans.ts`**

```ts
// Catálogo de planos do LUE FZ — fonte única de verdade (server+client, sem
// segredos). Preço em centavos (R$ 289,00 = 28900). O frontend envia só
// plan_id + cycle; o preço NUNCA vem do cliente — é resolvido aqui.
//
// stripe_price_id por ciclo vem de env (difere entre test/live). PIX usa
// price_brl direto. duration_days: 30 (mensal) / 90 (trimestral).
//
// PENDÊNCIA DO USUÁRIO: valores trimestrais são placeholder = 3× o mensal
// (sem desconto). Trocar pelos valores com desconto antes do go-live.
// PENDÊNCIA: limites (maxAgents/msgsLimit) são os atuais da UI; revisar.

export type BillingCycle = 'monthly' | 'quarterly'

export interface PlanCycle {
  price_brl: number // centavos
  stripe_price_id: string
  duration_days: number
}

export interface Plan {
  name: string
  maxAgents: number
  msgsLimit: number
  monthly: PlanCycle
  quarterly: PlanCycle
}

export const PLANS = {
  essencial: {
    name: 'Essencial',
    maxAgents: 3,
    msgsLimit: 1000,
    monthly: {
      price_brl: 28900,
      stripe_price_id: process.env.STRIPE_PRICE_ESSENCIAL_MONTHLY ?? '',
      duration_days: 30,
    },
    quarterly: {
      price_brl: 86700, // placeholder = 3× mensal; trocar pelo valor c/ desconto
      stripe_price_id: process.env.STRIPE_PRICE_ESSENCIAL_QUARTERLY ?? '',
      duration_days: 90,
    },
  },
  profissional: {
    name: 'Profissional',
    maxAgents: 5,
    msgsLimit: 5000,
    monthly: {
      price_brl: 31900,
      stripe_price_id: process.env.STRIPE_PRICE_PROFISSIONAL_MONTHLY ?? '',
      duration_days: 30,
    },
    quarterly: {
      price_brl: 95700, // placeholder = 3× mensal
      stripe_price_id: process.env.STRIPE_PRICE_PROFISSIONAL_QUARTERLY ?? '',
      duration_days: 90,
    },
  },
  performance: {
    name: 'Performance',
    maxAgents: 10,
    msgsLimit: 20000,
    monthly: {
      price_brl: 41900,
      stripe_price_id: process.env.STRIPE_PRICE_PERFORMANCE_MONTHLY ?? '',
      duration_days: 30,
    },
    quarterly: {
      price_brl: 125700, // placeholder = 3× mensal
      stripe_price_id: process.env.STRIPE_PRICE_PERFORMANCE_QUARTERLY ?? '',
      duration_days: 90,
    },
  },
} as const

export type PlanId = keyof typeof PLANS

export function isPlanId(v: string | null | undefined): v is PlanId {
  return !!v && v in PLANS
}

export function isBillingCycle(v: string | null | undefined): v is BillingCycle {
  return v === 'monthly' || v === 'quarterly'
}

export interface ResolvedPlan {
  planId: PlanId
  cycle: BillingCycle
  plan: Plan
  pricing: PlanCycle
}

// Resolve plan_id + cycle vindos do cliente em dados confiáveis do servidor.
// cycle ausente => 'monthly'. Retorna null se plano ou ciclo forem inválidos.
export function resolvePlanCycle(
  planId: string | null | undefined,
  cycle: string | null | undefined,
): ResolvedPlan | null {
  if (!isPlanId(planId)) return null
  const c: string = cycle ?? 'monthly'
  if (!isBillingCycle(c)) return null
  const plan = PLANS[planId]
  return { planId, cycle: c, plan, pricing: plan[c] }
}

export function planPriceCents(
  planId: string | null | undefined,
  cycle: string | null | undefined,
): number | null {
  return resolvePlanCycle(planId, cycle)?.pricing.price_brl ?? null
}

export function planDurationDays(
  planId: string | null | undefined,
  cycle: string | null | undefined,
): number | null {
  return resolvePlanCycle(planId, cycle)?.pricing.duration_days ?? null
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -- src/lib/__tests__/plans.test.ts`
Expected: PASS (todos os casos).

> Atenção: esta mudança quebra o typecheck em `billing.ts`, `pix/route.ts` e `mercadopago/webhook/route.ts` (usam o shape antigo `plan.stripe_price_id`/`plan.price_brl`/`plan.duration_days`). Isso é esperado — as Tasks 2.x consertam. Rode `npx tsc --noEmit` ao fim da Fase 2, não agora.

---

### Task 0.3: `plan-limits.ts` lê de `PLANS`

**Files:**
- Modify: `src/lib/plan-limits.ts`
- Test: `src/lib/__tests__/plan-limits.test.ts` (já existe; deve continuar passando)

- [ ] **Step 1: Atualizar `maxAgentsForPlan` para usar `PLANS`**

Substituir o corpo do arquivo `src/lib/plan-limits.ts` por:

```ts
import { createClient } from '@/lib/supabase/server'
import { PLANS, isPlanId } from '@/lib/plans'

// Resolve o maxAgents do plan_id. Plans desconhecidos (legacy, null, undefined)
// retornam 0 — sem plano ativo == não pode convidar.
export function maxAgentsForPlan(
  planId: string | null | undefined,
): number {
  if (!isPlanId(planId)) return 0
  return PLANS[planId].maxAgents
}

// Lê o plano ativo da loja e devolve o maxAgents. Server-only (usa supabase
// server client com RLS). Retorna 0 se não houver subscription ativa.
export async function getMaxAgentsForStore(
  storeId: string,
): Promise<number> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('store_subscriptions')
    .select('plan_id, status, current_period_end')
    .eq('store_id', storeId)
    .maybeSingle()
  if (!data || data.status !== 'active') return 0
  if (
    data.current_period_end &&
    new Date(data.current_period_end) <= new Date()
  ) {
    return 0
  }
  return maxAgentsForPlan(data.plan_id)
}
```

- [ ] **Step 2: Rodar o teste existente**

Run: `npm run test -- src/lib/__tests__/plan-limits.test.ts`
Expected: PASS — os IDs `essencial`/`profissional`/`performance` retornam 3/5/10 (agora vindos de `PLANS`); desconhecidos retornam 0.

---

## FASE 1 — Stripe: produtos, preços e env (setup)

### Task 1.1: Criar Products + 6 Prices no Stripe e registrar env vars

**Files:**
- Modify: `.env.local` (adicionar os 6 `STRIPE_PRICE_*` de TEST)

Esta task é de **configuração externa** (não há código a testar). Pode ser feita via Dashboard ou via API com a `STRIPE_SECRET_KEY` de teste.

- [ ] **Step 1: Criar 3 Products e 6 Prices (recorrentes, BRL)**

Via Stripe CLI (modo teste), para cada plano:

```bash
# Essencial
stripe products create --name "LUE Essencial"
# guarde o prod_... e crie os 2 prices:
stripe prices create --product prod_ESSENCIAL --currency brl --unit-amount 28900 \
  --recurring "interval=month"
stripe prices create --product prod_ESSENCIAL --currency brl --unit-amount 86700 \
  --recurring "interval=month,interval_count=3"
```

Repetir para Profissional (31900 / 95700) e Performance (41900 / 125700).
> Trimestral no Stripe = `interval=month, interval_count=3`. Os valores trimestrais são placeholders (3× mensal) até o usuário passar os finais.

- [ ] **Step 2: Gravar os Price IDs no `.env.local`**

```
STRIPE_PRICE_ESSENCIAL_MONTHLY=price_...
STRIPE_PRICE_ESSENCIAL_QUARTERLY=price_...
STRIPE_PRICE_PROFISSIONAL_MONTHLY=price_...
STRIPE_PRICE_PROFISSIONAL_QUARTERLY=price_...
STRIPE_PRICE_PERFORMANCE_MONTHLY=price_...
STRIPE_PRICE_PERFORMANCE_QUARTERLY=price_...
```

- [ ] **Step 3: Verificar que o catálogo enxerga os IDs**

Run: `node -e "require('dotenv').config({path:'.env.local'}); console.log(process.env.STRIPE_PRICE_ESSENCIAL_MONTHLY)"`
Expected: imprime um `price_...` (não vazio). Se vazio, revisar nome da env.

> O env var antigo `STRIPE_PRICE_ID` (do plano `pro`) fica órfão — remover do `.env.local` ao final.

---

## FASE 2 — Checkout com plano + ciclo

### Task 2.1: `createCheckoutSession(planId, cycle)` com reuso de Customer

**Files:**
- Modify: `src/actions/billing.ts`

- [ ] **Step 1: Atualizar a assinatura e o corpo de `createCheckoutSession`**

Trocar o import de `PLANS` e a função `createCheckoutSession` por:

```ts
import { resolvePlanCycle, type PlanId, type BillingCycle } from '@/lib/plans'
```

```ts
export async function createCheckoutSession(
  planId: PlanId,
  cycle: BillingCycle = 'monthly',
): Promise<CheckoutResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'unauthorized' }

  // Vendedor (agent) não paga — só o dono assina.
  const { data: membership } = await supabase
    .from('store_members')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (membership?.role === 'agent') {
    return { error: 'agent_cannot_pay' }
  }

  const resolved = resolvePlanCycle(planId, cycle)
  if (!resolved) return { error: 'unknown_plan' }
  if (!resolved.pricing.stripe_price_id) {
    return { error: 'stripe_price_not_configured' }
  }

  // Reusa o stripe_customer_id já vinculado à loja (evita customers duplicados).
  const { data: existing } = await supabase
    .from('store_subscriptions')
    .select('stripe_customer_id')
    .eq('store_id', user.id)
    .maybeSingle()

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: resolved.pricing.stripe_price_id, quantity: 1 }],
      ...(existing?.stripe_customer_id
        ? { customer: existing.stripe_customer_id }
        : { customer_email: user.email ?? undefined }),
      client_reference_id: user.id,
      success_url: `${siteUrl()}/painel?checkout=success`,
      cancel_url: `${siteUrl()}/planos?checkout=canceled`,
      metadata: { store_id: user.id, plan_id: planId, billing_cycle: cycle },
      subscription_data: {
        metadata: { store_id: user.id, plan_id: planId, billing_cycle: cycle },
      },
    })

    if (!session.url) return { error: 'no_url' }
    return { url: session.url }
  } catch (err) {
    console.error('createCheckoutSession error', err)
    return { error: 'stripe_failed' }
  }
}
```

- [ ] **Step 2: Verificar typecheck do arquivo**

Run: `npx tsc --noEmit`
Expected: sem erros em `billing.ts` (ainda pode haver erros em `pix/route.ts` e `webhook` até as próximas tasks).

---

### Task 2.2: Rota PIX aceita `cycle` e resolve preço/duração no servidor

**Files:**
- Modify: `src/app/api/mercadopago/pix/route.ts`

- [ ] **Step 1: Atualizar parsing e criação do pagamento**

Trocar o import e o trecho de resolução de plano:

```ts
import { resolvePlanCycle } from '@/lib/plans'
```

Substituir o bloco entre o parse do body e o `getMpPayment().create(...)`:

```ts
  let body: { plan_id?: string; cycle?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const resolved = resolvePlanCycle(body.plan_id, body.cycle)
  if (!resolved) {
    return NextResponse.json({ error: 'unknown_plan' }, { status: 400 })
  }
  const { planId, cycle, plan, pricing } = resolved

  const siteUrl = getAppUrl()

  try {
    const payment = await getMpPayment().create({
      body: {
        transaction_amount: pricing.price_brl / 100,
        payment_method_id: 'pix',
        payer: {
          email: user.email ?? `store-${user.id}@lue.fz`,
        },
        description: `${plan.name} - ${pricing.duration_days} dias`,
        external_reference: user.id,
        notification_url: `${siteUrl}/api/mercadopago/webhook`,
        metadata: { store_id: user.id, plan_id: planId, billing_cycle: cycle },
      },
      requestOptions: { idempotencyKey: crypto.randomUUID() },
    })
```

Adicionar no topo do arquivo o import de crypto:

```ts
import crypto from 'node:crypto'
```

- [ ] **Step 2: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros em `pix/route.ts`.

> Nota: `X-Idempotency-Key` agora é enviado (era ausente) — exigência do MP e proteção contra duplicação.

---

### Task 2.3: Webhook MP calcula período pelo ciclo e remove fallback `'pro'`

**Files:**
- Modify: `src/app/api/mercadopago/webhook/route.ts`

- [ ] **Step 1: Atualizar a resolução de plano/ciclo e o cálculo de período**

Trocar o import:

```ts
import { resolvePlanCycle } from '@/lib/plans'
```

Substituir o bloco a partir de `const storeId = payment.external_reference` até o `upsert`:

```ts
    const storeId = payment.external_reference
    if (!storeId) {
      console.error('MP webhook: missing external_reference on payment', payment.id)
      return new NextResponse('Missing store_id', { status: 400 })
    }

    const meta = (payment.metadata ?? {}) as Record<string, unknown>
    // O SDK do MP normaliza `metadata` em snake_case quando lê; aceitamos os dois.
    const planIdRaw = (meta.plan_id ?? meta.planId) as string | undefined
    const cycleRaw = (meta.billing_cycle ?? meta.billingCycle) as string | undefined
    const resolved = resolvePlanCycle(planIdRaw, cycleRaw)
    if (!resolved) {
      console.error('MP webhook: unresolved plan/cycle', { planIdRaw, cycleRaw })
      return new NextResponse('Unknown plan', { status: 400 })
    }

    const periodEnd = new Date(
      Date.now() + resolved.pricing.duration_days * 86_400_000,
    ).toISOString()

    const { error: upsertError } = await admin.from('store_subscriptions').upsert(
      {
        store_id: storeId,
        plan_id: resolved.planId,
        provider: 'mercadopago',
        status: 'active',
        billing_cycle: resolved.cycle,
        mp_payment_id: dataIdStr,
        mp_customer_id: payment.payer?.id ? String(payment.payer.id) : null,
        current_period_end: periodEnd,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'store_id' },
    )
```

Remover o import antigo `import { PLANS, type PlanId } from '@/lib/plans'`.

- [ ] **Step 2: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros em `mercadopago/webhook/route.ts`.

---

### Task 2.4: Webhook Stripe grava `billing_cycle` e sem fallback `'pro'`

**Files:**
- Modify: `src/app/api/stripe/webhook/route.ts`

- [ ] **Step 1: Passar `billing_cycle` ao upsert**

Em `upsertStripeSubscription`, adicionar parâmetro `cycle` e gravá-lo:

```ts
async function upsertStripeSubscription(
  admin: AdminClient,
  storeId: string,
  customerId: string | null,
  sub: Stripe.Subscription,
  planId: string,
  cycle: string | null,
) {
  const priceId = sub.items?.data?.[0]?.price?.id ?? null
  const { error } = await admin.from('store_subscriptions').upsert(
    {
      store_id: storeId,
      plan_id: planId,
      provider: 'stripe',
      status: mapStripeStatus(sub.status),
      billing_cycle: cycle,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      stripe_price_id: priceId,
      current_period_end: getPeriodEndIso(sub),
      cancel_at_period_end: sub.cancel_at_period_end ?? false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'store_id' },
  )
  if (error) console.error('upsertStripeSubscription error', error)
}
```

- [ ] **Step 2: Passar o cycle do metadata nas chamadas**

No case `checkout.session.completed`:

```ts
        await upsertStripeSubscription(
          admin,
          storeId,
          customerId,
          sub,
          session.metadata?.plan_id ?? sub.metadata?.plan_id ?? 'unknown',
          session.metadata?.billing_cycle ?? sub.metadata?.billing_cycle ?? null,
        )
```

No case `customer.subscription.created`/`updated` (ramo com `storeId`):

```ts
          await upsertStripeSubscription(
            admin,
            storeId,
            customerId,
            sub,
            sub.metadata?.plan_id ?? 'unknown',
            sub.metadata?.billing_cycle ?? null,
          )
```

> `plan_id` cai para `'unknown'` apenas defensivamente; com o checkout novo o metadata sempre vem preenchido. `'unknown'` não é um `PlanId` válido — `maxAgentsForPlan` devolve 0, o que é seguro (sem privilégio indevido).

- [ ] **Step 3: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros no projeto inteiro (Fase 0–2 fecham o ciclo de tipos).

---

### Task 2.5: UI de checkout passa `cycle` e oferece seletor

**Files:**
- Modify: `src/app/planos/CheckoutClient.tsx`

- [ ] **Step 1: Adicionar estado de ciclo e enviar nos dois fluxos**

No componente `CheckoutClient`, adicionar prop/estado de ciclo e usá-lo:

```tsx
import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { createCheckoutSession, getCurrentSubscription } from '@/actions/billing'
import type { PlanId, BillingCycle } from '@/lib/plans'
```

Dentro do componente, adicionar:

```tsx
  const [cycle, setCycle] = useState<BillingCycle>('monthly')
```

Seletor (renderizar acima dos botões, no `return` final, antes do botão Cartão):

```tsx
      <div className="flex gap-2 rounded-xl border border-neutral-800 p-1 text-xs">
        <button
          type="button"
          onClick={() => setCycle('monthly')}
          className={`flex-1 rounded-lg py-2 font-medium transition ${
            cycle === 'monthly' ? 'bg-neutral-100 text-neutral-950' : 'text-neutral-400'
          }`}
        >
          Mensal
        </button>
        <button
          type="button"
          onClick={() => setCycle('quarterly')}
          className={`flex-1 rounded-lg py-2 font-medium transition ${
            cycle === 'quarterly' ? 'bg-neutral-100 text-neutral-950' : 'text-neutral-400'
          }`}
        >
          Trimestral
        </button>
      </div>
```

Atualizar `handleStripe`:

```tsx
      const res = await createCheckoutSession(planId, cycle)
```

Atualizar o body do PIX em `handlePix`:

```tsx
        body: JSON.stringify({ plan_id: planId, cycle }),
```

- [ ] **Step 2: Verificar typecheck/build**

Run: `npx tsc --noEmit`
Expected: sem erros.

---

### Task 2.6: Página `/planos` renderiza os 3 planos

**Files:**
- Modify: `src/app/planos/page.tsx`

- [ ] **Step 1: Iterar `PLANS` em vez do único `pro`**

Ler o arquivo atual e ajustar o render para mapear `Object.entries(PLANS)` (ou `PLANS_DISPLAY` para copy + `PlanId` para o checkout), passando `planId` a `CheckoutClient`. Manter o guard de redirect (`isActive` → /painel; agent → /conversas).

Exemplo do núcleo do render (adaptar às classes/layout existentes do arquivo):

```tsx
import { PLANS, type PlanId } from '@/lib/plans'
import { CheckoutClient } from './CheckoutClient'

// ...dentro do componente, após os guards:
const planIds = Object.keys(PLANS) as PlanId[]
// render: para cada planId, um card com PLANS[planId].name + um <CheckoutClient planId={planId} />
```

- [ ] **Step 2: Verificar build da rota**

Run: `npm run build`
Expected: build conclui sem erro em `/planos`. (Verificação visual fica para a Fase 6.)

---

## FASE 3 — Gate de funcionalidades

### Task 3.1: Helper central de assinatura

**Files:**
- Create: `src/lib/subscription.ts`
- Test: `src/lib/__tests__/subscription.test.ts`

- [ ] **Step 1: Escrever o teste da função pura**

```ts
// src/lib/__tests__/subscription.test.ts
import { describe, it, expect } from 'vitest'
import { isActiveFromRow } from '../subscription'

describe('isActiveFromRow', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString()
  const past = new Date(Date.now() - 86_400_000).toISOString()

  it('active + future period = active', () => {
    expect(isActiveFromRow('active', future)).toBe(true)
  })
  it('active + null period = active (Stripe perpétuo/manual)', () => {
    expect(isActiveFromRow('active', null)).toBe(true)
  })
  it('active + past period = inactive (expirado)', () => {
    expect(isActiveFromRow('active', past)).toBe(false)
  })
  it('non-active status = inactive', () => {
    expect(isActiveFromRow('past_due', future)).toBe(false)
    expect(isActiveFromRow('canceled', future)).toBe(false)
    expect(isActiveFromRow(null, future)).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- src/lib/__tests__/subscription.test.ts`
Expected: FAIL — módulo/`isActiveFromRow` não existe.

- [ ] **Step 3: Implementar `src/lib/subscription.ts`**

```ts
import { createAdminClient } from '@/lib/supabase/admin'

// Regra única de "assinatura ativa". Pura — testável sem banco.
// Uma row 'active' com current_period_end no passado NÃO vale como ativa.
export function isActiveFromRow(
  status: string | null,
  currentPeriodEnd: string | null,
): boolean {
  if (status !== 'active') return false
  if (!currentPeriodEnd) return true
  return new Date(currentPeriodEnd) > new Date()
}

// Checa, via service role (sem depender de sessão/RLS), se a loja tem
// assinatura ativa. Usado nos pontos de funcionalidade — inclusive no chat
// público, onde não há usuário autenticado (só o store_id da loja).
export async function isStoreSubscriptionActive(
  storeId: string,
): Promise<boolean> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('store_subscriptions')
    .select('status, current_period_end')
    .eq('store_id', storeId)
    .maybeSingle()
  if (error) {
    console.error('isStoreSubscriptionActive error', error)
    return false
  }
  if (!data) return false
  return isActiveFromRow(data.status, data.current_period_end)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -- src/lib/__tests__/subscription.test.ts`
Expected: PASS.

---

### Task 3.2: Gate da IA no chat (núcleo do produto)

**Files:**
- Modify: `src/actions/chat.ts`

- [ ] **Step 1: Não acionar a IA quando a loja está inativa**

No topo, adicionar import:

```ts
import { isStoreSubscriptionActive } from '@/lib/subscription'
```

Em `sendMessage`, **após** inserir a mensagem do visitante (`inserted`) e **antes** do bloco `try { const res = await dispatchToN8n(...) }`, inserir:

```ts
  // Gate de assinatura: a mensagem do visitante é sempre salva (o dono não
  // perde o lead), mas a IA só responde se a loja tiver assinatura ativa.
  const active = await isStoreSubscriptionActive(store.id)
  if (!active) {
    return { success: true, messageId: inserted.id }
  }
```

- [ ] **Step 2: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

> Verificação funcional (loja inativa não recebe resposta da IA; loja ativa recebe) fica para a Fase 6 com dados reais.

---

### Task 3.3: Gate nas ações de dono (publicar loja, agentes, estoque)

**Files:**
- Modify: ações server-side de cada funcionalidade (identificar no código):
  - Publicar/ativar loja e conectar canais (ex.: `src/actions/loja.ts` ou equivalente em `src/app/loja/`).
  - Convidar/ativar agente (ex.: `src/actions/equipe.ts` / fluxo de `store_invites`).
  - Importar/sincronizar estoque (`src/app/api/inventory/import/route.ts`, `src/app/api/inventory/cron-sync/route.ts`).

- [ ] **Step 1: Adicionar guard reutilizável em `subscription.ts`**

Acrescentar a `src/lib/subscription.ts`:

```ts
import { getActiveStoreId } from '@/lib/active-store'

// Para ações de dono: resolve a loja da sessão e checa assinatura ativa.
// Retorna o storeId quando ativa; null quando não há loja ou está inativa.
export async function requireActiveStoreSubscription(): Promise<string | null> {
  const storeId = await getActiveStoreId()
  if (!storeId) return null
  const active = await isStoreSubscriptionActive(storeId)
  return active ? storeId : null
}
```

- [ ] **Step 2: Aplicar o guard no início de cada ação gated**

Para cada server action/rota das funcionalidades acima, no início (após a checagem de auth existente), inserir:

```ts
  const activeStoreId = await requireActiveStoreSubscription()
  if (!activeStoreId) {
    return { success: false, error: 'subscription_required' }
  }
```

(Para rotas `route.ts` que retornam `NextResponse`, usar:)

```ts
  const activeStoreId = await requireActiveStoreSubscription()
  if (!activeStoreId) {
    return NextResponse.json({ error: 'subscription_required' }, { status: 402 })
  }
```

> **Subtarefa de descoberta:** antes de editar, localizar as ações exatas com:
> `Grep "use server"` em `src/actions/` e revisar `src/app/loja`, `src/app/equipe`, `src/app/api/inventory`. Listar cada ponto e aplicar o guard. Não gatear leitura/visualização — só mutations de funcionalidade.

- [ ] **Step 3: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

---

### Task 3.4: UI — CTA "assine para liberar"

**Files:**
- Modify: componentes que disparam as ações gated (botões de publicar loja, convidar agente, importar estoque) e/ou um banner no painel.

- [ ] **Step 1: Tratar `subscription_required` na UI**

Onde a UI chama uma ação gated, tratar o retorno `error === 'subscription_required'` exibindo CTA para `/planos` (ex.: toast/aviso com link "Assine para liberar"). Seguir o padrão de erro já usado em cada tela.

Exemplo genérico:

```tsx
if (res.error === 'subscription_required') {
  // mostrar CTA: "Assine um plano para liberar esta funcionalidade"
  window.location.href = '/planos'
  return
}
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: sem erros.

---

## FASE 4 — Gestão da assinatura

### Task 4.1: Ligar botão "Gerenciar pagamento" ao Portal Stripe

**Files:**
- Modify: `src/app/painel/planos/page.tsx` (e/ou o client que renderiza o botão)

- [ ] **Step 1: Ligar o botão à action existente `createPortalSession`**

O botão "Gerenciar pagamento" deve, no clique (client component), chamar `createPortalSession()` e redirecionar:

```tsx
const res = await createPortalSession()
if ('url' in res) window.location.href = res.url
else setError(res.error)
```

Habilitar o botão quando `provider === 'stripe'` e houver `stripe_customer_id` (PIX não tem portal).

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: sem erros.

---

### Task 4.2: Cancelar assinatura

**Files:**
- Modify: `src/actions/billing.ts`

- [ ] **Step 1: Implementar `cancelSubscription`**

Adicionar a `billing.ts`:

```ts
export async function cancelSubscription(): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'unauthorized' }

  const { data: sub } = await supabase
    .from('store_subscriptions')
    .select('provider, stripe_subscription_id')
    .eq('store_id', user.id)
    .maybeSingle()
  if (!sub) return { error: 'no_subscription' }

  // PIX (mercadopago) é avulso: não há recorrência a cancelar — apenas não
  // renova. Informa o cliente que o acesso vai até current_period_end.
  if (sub.provider !== 'stripe' || !sub.stripe_subscription_id) {
    return { error: 'not_cancelable' }
  }

  try {
    // cancel_at_period_end: mantém acesso até o fim do período já pago.
    await getStripe().subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: true,
    })
    return { ok: true }
  } catch (err) {
    console.error('cancelSubscription error', err)
    return { error: 'stripe_failed' }
  }
}
```

> O webhook `customer.subscription.updated` já reflete `cancel_at_period_end` no banco — não duplicar a escrita aqui.

- [ ] **Step 2: Ligar o botão "Cancelar assinatura" na UI** (client) a `cancelSubscription()`, com confirmação. Mostrar estado "cancelamento agendado para <data>" quando `cancelAtPeriodEnd`.

- [ ] **Step 3: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

---

### Task 4.3: Upgrade/downgrade + toggle mensal/trimestral reais

**Files:**
- Modify: `src/app/painel/planos/PlanosClient.tsx`, `src/app/painel/planos/page.tsx`

- [ ] **Step 1: Toggle mensal/trimestral controla o ciclo de fato**

Trocar o estado `'monthly' | 'annual'` por `BillingCycle` (`'monthly' | 'quarterly'`), rotular "Trimestral", e usar os preços reais de `PLANS[planId][cycle].price_brl` (formatados em reais) em vez de "Indefinido".

- [ ] **Step 2: CTA de plano dispara checkout/troca**

- Sem assinatura ativa, ou provider PIX: CTA chama `createCheckoutSession(planId, cycle)` (cartão) ou redireciona para `/planos` para PIX.
- Com assinatura Stripe ativa: "Fazer upgrade/downgrade" troca o item da subscription (proration). Implementar action:

```ts
export async function changePlan(
  planId: PlanId,
  cycle: BillingCycle = 'monthly',
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'unauthorized' }

  const resolved = resolvePlanCycle(planId, cycle)
  if (!resolved || !resolved.pricing.stripe_price_id) return { error: 'unknown_plan' }

  const { data: sub } = await supabase
    .from('store_subscriptions')
    .select('provider, stripe_subscription_id')
    .eq('store_id', user.id)
    .maybeSingle()
  if (!sub?.stripe_subscription_id || sub.provider !== 'stripe') {
    return { error: 'not_stripe' }
  }

  try {
    const current = await getStripe().subscriptions.retrieve(sub.stripe_subscription_id)
    const itemId = current.items.data[0]?.id
    if (!itemId) return { error: 'no_item' }
    await getStripe().subscriptions.update(sub.stripe_subscription_id, {
      items: [{ id: itemId, price: resolved.pricing.stripe_price_id }],
      proration_behavior: 'create_prorations',
      metadata: { store_id: user.id, plan_id: planId, billing_cycle: cycle },
    })
    return { ok: true }
  } catch (err) {
    console.error('changePlan error', err)
    return { error: 'stripe_failed' }
  }
}
```

> O webhook `customer.subscription.updated` sincroniza plan_id/price/cycle no banco a partir do metadata atualizado.

- [ ] **Step 3: Verificar typecheck/build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

---

## FASE 5 — Hardening de segurança

### Task 5.1: Remover bypass de validação no webhook MP

**Files:**
- Modify: `src/app/api/mercadopago/webhook/route.ts`

- [ ] **Step 1: Exigir secret válido sempre**

Substituir o bloco que pula a validação quando o secret é `placeholder`:

```ts
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET
  if (!secret || secret === 'placeholder') {
    console.error('MERCADOPAGO_WEBHOOK_SECRET not configured')
    return new NextResponse('Server misconfigured', { status: 500 })
  }
  const sigHeader = req.headers.get('x-signature')
  const requestId = req.headers.get('x-request-id')
  if (!sigHeader || !requestId) {
    return new NextResponse('Missing signature headers', { status: 400 })
  }
  if (!verifySignature(sigHeader, requestId, dataIdStr, secret)) {
    return new NextResponse('Invalid signature', { status: 401 })
  }
```

> Para dev local, configure um secret real do MP via `ngrok` + dashboard. O modo "frouxo" deixa de existir (era risco em produção).

- [ ] **Step 2: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

---

### Task 5.2: Criar `.env.example`

**Files:**
- Create: `.env.example`

- [ ] **Step 1: Documentar todas as envs (sem valores reais)**

```bash
# .env.example — copie para .env.local e preencha. NÃO commite segredos reais.

# App
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Stripe (server-only, exceto a publishable)
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ESSENCIAL_MONTHLY=price_...
STRIPE_PRICE_ESSENCIAL_QUARTERLY=price_...
STRIPE_PRICE_PROFISSIONAL_MONTHLY=price_...
STRIPE_PRICE_PROFISSIONAL_QUARTERLY=price_...
STRIPE_PRICE_PERFORMANCE_MONTHLY=price_...
STRIPE_PRICE_PERFORMANCE_QUARTERLY=price_...

# Mercado Pago (server-only)
MERCADOPAGO_ACCESS_TOKEN=TEST-...
MERCADOPAGO_WEBHOOK_SECRET=   # secret real do dashboard MP — nunca 'placeholder'
```

- [ ] **Step 2: Conferir que `.env.example` não tem segredos reais e que `.env.local` está no `.gitignore`**

Run: `git check-ignore .env.local`
Expected: imprime `.env.local` (está ignorado).

---

## FASE 6 — Testes de integração e verificação ponta a ponta

> Esta fase é manual/observacional (sem unit test novo). Use a skill `verify` se disponível.

### Task 6.1: Suíte unitária verde + typecheck + build

- [ ] **Step 1:** Run: `npm run test`
  Expected: todos os testes passam (inclui `plans`, `subscription`, `plan-limits`).
- [ ] **Step 2:** Run: `npx tsc --noEmit`
  Expected: zero erros.
- [ ] **Step 3:** Run: `npm run build`
  Expected: build conclui.

### Task 6.2: Stripe ponta a ponta (modo teste)

- [ ] **Step 1:** `stripe login` e `stripe listen --forward-to localhost:3000/api/stripe/webhook` — copie o `whsec_...` impresso para `STRIPE_WEBHOOK_SECRET` no `.env.local`.
- [ ] **Step 2:** Subir `npm run dev`, ir a `/planos`, escolher um plano, ciclo, "Pagar com Cartão", pagar com `4242 4242 4242 4242`.
- [ ] **Step 3:** Confirmar no banco que `store_subscriptions` tem `provider='stripe'`, `status='active'`, `plan_id`/`billing_cycle` corretos, `current_period_end` futuro.
- [ ] **Step 4:** Testar Portal ("Gerenciar pagamento") e Cancelar (verificar `cancel_at_period_end=true`). Testar falha: `stripe trigger invoice.payment_failed` → `status='past_due'`, gate bloqueia ações.

### Task 6.3: Mercado Pago ponta a ponta

- [ ] **Step 1:** Configurar `MERCADOPAGO_WEBHOOK_SECRET` real (dashboard MP) e `notification_url` via `ngrok`.
- [ ] **Step 2:** Em `/planos`, "Pagar com Pix" — confirmar QR gerado.
- [ ] **Step 3:** Como sandbox PIX não fecha pagamento real, usar o **Simulador de Webhooks** do painel MP (tópico `payment`, status `approved`) e confirmar upsert `provider='mercadopago'`, `status='active'`, `current_period_end` = +30/+90 dias conforme ciclo.

### Task 6.4: Gate ponta a ponta

- [ ] **Step 1:** Com loja **sem** assinatura: enviar mensagem no `/chat/<slug>` → mensagem do visitante salva, **sem** resposta da IA. Ações de dono (publicar loja, convidar agente, importar estoque) retornam `subscription_required` e a UI mostra CTA.
- [ ] **Step 2:** Após ativar assinatura: IA responde; ações liberadas.

### Task 6.5: ✅ Commit (somente após aprovação do usuário)

- [ ] **Step 1: Avisar o usuário** que está 100% funcional e pedir aprovação para commitar (conforme política no topo).
- [ ] **Step 2: Após o OK**, commitar tudo:

```bash
git add -A
git commit -m "feat(billing): assinatura com PIX (avulso) e cartão (Stripe), 3 planos x 2 ciclos, gate de funcionalidades"
```

> Antes do go-live em produção: aplicar a migration 049, criar os Products/Prices live no Stripe e preencher os secrets/envs de produção (ver "Pendências do usuário").

---

## Self-Review (preenchido na escrita do plano)

- **Cobertura do spec:** PIX avulso (2.2/2.3) ✓; Stripe assinatura (2.1/2.4) ✓; 3 planos × 2 ciclos (0.2) ✓; preços 289/319/419 (0.2) ✓; gate suave por funcionalidade (3.2–3.4) ✓; Portal/Cancelar/Upgrade/toggle (4.1–4.3) ✓; remover bypass MP (5.1) ✓; `.env.example` (5.2) ✓; testes (6.x) ✓; sem trial ✓ (nenhuma lógica de trial); código no Next.js ✓.
- **Limites/valores trimestrais:** placeholders explícitos e documentados como pendência — não são TODOs de engenharia, são inputs de produto do usuário.
- **Consistência de tipos:** `resolvePlanCycle`/`PlanId`/`BillingCycle` usados igualmente em billing.ts, pix, webhooks e UI; `isActiveFromRow`/`isStoreSubscriptionActive`/`requireActiveStoreSubscription` consistentes entre 3.1–3.3.
- **Ponto a confirmar na execução (Task 3.3):** localizar as ações exatas de publicar-loja/agente/estoque (subtarefa de descoberta incluída) — o resto referencia arquivos já verificados neste plano.
