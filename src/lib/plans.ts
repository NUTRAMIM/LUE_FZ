// Catálogo de planos do LUE FZ — fonte única de verdade (server+client, sem
// segredos). Preço em centavos (R$ 289,00 = 28900). O frontend envia só
// plan_id + cycle; o preço NUNCA vem do cliente — é resolvido aqui.
//
// stripe_price_id por ciclo vem de env (difere entre test/live). PIX usa
// price_brl direto. duration_days: 30 (mensal) / 90 (trimestral).
//
// PENDÊNCIA DO USUÁRIO: valores trimestrais são placeholder = 3× o mensal
// (sem desconto). Trocar pelos valores com desconto antes do go-live.
// Limites: maxAgents = nº de vendedores na equipe; convsLimit = cota mensal
// de conversas que recebem IA (enforçada em sendMessage via conversation-quota).

export type BillingCycle = 'monthly' | 'quarterly'

export interface PlanCycle {
  price_brl: number // centavos
  stripe_price_id: string
  duration_days: number
}

export interface Plan {
  name: string
  maxAgents: number
  // Cota mensal de CONVERSAS (não mensagens) que recebem resposta da IA.
  convsLimit: number
  monthly: PlanCycle
  quarterly: PlanCycle
}

export const PLANS = {
  essencial: {
    name: 'Essencial',
    maxAgents: 1,
    convsLimit: 1000,
    monthly: {
      price_brl: 19700,
      stripe_price_id: process.env.STRIPE_PRICE_ESSENCIAL_MONTHLY ?? '',
      duration_days: 30,
    },
    quarterly: {
      price_brl: 53190, // 3× mensal (591,00) com 10% de desconto
      stripe_price_id: process.env.STRIPE_PRICE_ESSENCIAL_QUARTERLY ?? '',
      duration_days: 90,
    },
  },
  profissional: {
    name: 'Profissional',
    maxAgents: 5,
    convsLimit: 3000,
    monthly: {
      price_brl: 28700,
      stripe_price_id: process.env.STRIPE_PRICE_PROFISSIONAL_MONTHLY ?? '',
      duration_days: 30,
    },
    quarterly: {
      price_brl: 77490, // 3× mensal (861,00) com 10% de desconto
      stripe_price_id: process.env.STRIPE_PRICE_PROFISSIONAL_QUARTERLY ?? '',
      duration_days: 90,
    },
  },
  performance: {
    name: 'Performance',
    maxAgents: 10,
    convsLimit: 5000,
    monthly: {
      price_brl: 54700,
      stripe_price_id: process.env.STRIPE_PRICE_PERFORMANCE_MONTHLY ?? '',
      duration_days: 30,
    },
    quarterly: {
      price_brl: 147690, // 3× mensal (1.641,00) com 10% de desconto
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
