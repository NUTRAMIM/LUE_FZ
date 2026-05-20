import Stripe from 'stripe'

// Cliente Stripe server-only. NUNCA importar isso em código que roda no
// client — `STRIPE_SECRET_KEY` é segredo. Usado por:
//   - src/actions/billing.ts (criar Checkout Session)
//   - src/app/api/stripe/webhook/route.ts (validar webhook + ler subscription)
//
// Lazy: o build do Next coleta page data sem env de runtime. Não jogamos no
// import — só na primeira chamada efetiva.

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (_stripe) return _stripe
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  _stripe = new Stripe(key, { typescript: true })
  return _stripe
}
