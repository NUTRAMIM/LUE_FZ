import { NextResponse, type NextRequest } from 'next/server'
import type Stripe from 'stripe'
import { getStripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { isBillingCycle } from '@/lib/plans'
import type { Json } from '@/types/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Webhook do Stripe. Recebe eventos POST, valida assinatura via
// `stripe-signature` header + STRIPE_WEBHOOK_SECRET, e atualiza
// `store_subscriptions` via service_role (admin client).
//
// Idempotência: cada `event.id` é inserido em `payment_events` antes de
// processar. Conflito de PK (23505) significa "já processado" → 200 sem
// reprocessar.
//
// Eventos tratados:
//   - checkout.session.completed     → cria a subscription a partir do session
//   - customer.subscription.created  → upsert
//   - customer.subscription.updated  → upsert (status, period_end, cancel flag)
//   - customer.subscription.deleted  → status='canceled'
//   - invoice.payment_failed         → status='past_due'

// O enum de status do Stripe é mais largo do que o CHECK do nosso schema
// (active|past_due|canceled|pending|incomplete). Faz o downcast pro nosso
// vocabulário interno antes de gravar.
type SubStatus = 'active' | 'past_due' | 'canceled' | 'pending' | 'incomplete'

function mapStripeStatus(s: Stripe.Subscription.Status): SubStatus {
  switch (s) {
    case 'active':
    case 'trialing':
      return 'active'
    case 'past_due':
    case 'unpaid':
    case 'paused':
      return 'past_due'
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled'
    case 'incomplete':
      return 'incomplete'
    default:
      return 'incomplete'
  }
}

// A API 2025-08-27.basil moveu `current_period_end` pra dentro dos items.
// Single-plan: items[0] tem o que a gente quer. Fallback pro campo legado
// caso a API rode com versão mais antiga.
function getPeriodEndIso(sub: Stripe.Subscription): string | null {
  const fromItem = sub.items?.data?.[0]?.current_period_end
  if (fromItem) return new Date(fromItem * 1000).toISOString()
  const legacy = (sub as unknown as { current_period_end?: number }).current_period_end
  return legacy ? new Date(legacy * 1000).toISOString() : null
}

function getSubscriptionIdFromInvoice(inv: Stripe.Invoice): string | null {
  // Em versões recentes, `invoice.subscription` saiu do tipo. O ID fica em
  // `parent.subscription_details.subscription` OU em `lines.data[].subscription`.
  const legacy = (inv as unknown as { subscription?: string | Stripe.Subscription | null }).subscription
  if (typeof legacy === 'string') return legacy
  if (legacy && typeof legacy === 'object' && 'id' in legacy) return legacy.id

  const parent = (inv as unknown as {
    parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null
  }).parent
  const fromParent = parent?.subscription_details?.subscription
  if (typeof fromParent === 'string') return fromParent
  if (fromParent && typeof fromParent === 'object' && 'id' in fromParent) return fromParent.id

  return null
}

type AdminClient = ReturnType<typeof createAdminClient>

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
      billing_cycle: isBillingCycle(cycle) ? cycle : null,
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

export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature')
  if (!sig) return new NextResponse('Missing signature', { status: 400 })

  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.error('STRIPE_WEBHOOK_SECRET not configured')
    return new NextResponse('Server misconfigured', { status: 500 })
  }

  const body = await req.text()

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(body, sig, secret)
  } catch (err) {
    console.error('Stripe webhook signature invalid', err)
    return new NextResponse('Invalid signature', { status: 400 })
  }

  const admin = createAdminClient()

  // Idempotência: tenta gravar event.id; se conflito (23505), já processou.
  const { error: insertError } = await admin.from('payment_events').insert({
    id: event.id,
    provider: 'stripe',
    type: event.type,
    payload: event as unknown as Json,
  })
  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json({ received: true, duplicate: true })
    }
    console.error('payment_events insert error', insertError)
    return new NextResponse('Storage error', { status: 500 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const storeId = session.metadata?.store_id ?? session.client_reference_id ?? null
        const subscriptionId =
          typeof session.subscription === 'string' ? session.subscription : null
        const customerId =
          typeof session.customer === 'string' ? session.customer : null
        if (!storeId || !subscriptionId) break

        const sub = await getStripe().subscriptions.retrieve(subscriptionId)
        await upsertStripeSubscription(
          admin,
          storeId,
          customerId,
          sub,
          session.metadata?.plan_id ?? sub.metadata?.plan_id ?? 'unknown',
          session.metadata?.billing_cycle ?? sub.metadata?.billing_cycle ?? null,
        )
        break
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const storeId = sub.metadata?.store_id ?? null
        const customerId =
          typeof sub.customer === 'string' ? sub.customer : sub.customer.id
        if (storeId) {
          await upsertStripeSubscription(
            admin,
            storeId,
            customerId,
            sub,
            sub.metadata?.plan_id ?? 'unknown',
            sub.metadata?.billing_cycle ?? null,
          )
        } else {
          // Fallback quando metadata ausente: localiza pela coluna unique.
          const { error } = await admin
            .from('store_subscriptions')
            .update({
              status: mapStripeStatus(sub.status),
              current_period_end: getPeriodEndIso(sub),
              cancel_at_period_end: sub.cancel_at_period_end ?? false,
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_subscription_id', sub.id)
          if (error) console.error('subscription update fallback error', error)
        }
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const { error } = await admin
          .from('store_subscriptions')
          .update({
            status: 'canceled',
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_subscription_id', sub.id)
        if (error) console.error('subscription delete error', error)
        break
      }

      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice
        const subId = getSubscriptionIdFromInvoice(inv)
        if (subId) {
          const { error } = await admin
            .from('store_subscriptions')
            .update({
              status: 'past_due',
              updated_at: new Date().toISOString(),
            })
            .eq('stripe_subscription_id', subId)
          if (error) console.error('past_due update error', error)
        }
        break
      }

      default:
        // Eventos não tratados são apenas registrados (já gravamos no
        // payment_events acima).
        break
    }
  } catch (err) {
    console.error('Stripe webhook handler error', err)
    return new NextResponse('Handler error', { status: 500 })
  }

  return NextResponse.json({ received: true })
}
