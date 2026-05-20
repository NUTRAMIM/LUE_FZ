// Configuração de planos pagos do LUE FZ. Mantida server+client (sem
// segredos) — o `stripe_price_id` vem de env porque é diferente entre
// test/live. `price_brl` está em centavos (R$ 2,00 = 200) e é usado pelo
// fluxo Pix (Mercado Pago) que precisa do valor explícito; o fluxo Stripe
// usa o `stripe_price_id` direto.

export const PLANS = {
  pro: {
    name: 'LUE Pro',
    price_brl: 200, // R$ 2,00 (centavos) — valor de teste
    stripe_price_id: process.env.STRIPE_PRICE_ID ?? '',
    duration_days: 30,
  },
} as const

export type PlanId = keyof typeof PLANS
export type Plan = (typeof PLANS)[PlanId]
