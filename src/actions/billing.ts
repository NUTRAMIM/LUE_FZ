'use server'

import { getStripe } from '@/lib/stripe'
import { createClient } from '@/lib/supabase/server'
import { getAppUrl } from '@/lib/app-url'
import { resolvePlanCycle, type PlanId, type BillingCycle } from '@/lib/plans'
import { getActiveStoreId } from '@/lib/active-store'

export interface SubscriptionState {
  isActive: boolean
  planId: string | null
  provider: 'stripe' | 'mercadopago' | 'manual' | null
  status: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  billingCycle: 'monthly' | 'quarterly' | null
}

const EMPTY_SUBSCRIPTION: SubscriptionState = {
  isActive: false,
  planId: null,
  provider: null,
  status: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  billingCycle: null,
}

function siteUrl(): string {
  return getAppUrl()
}

// Lida tanto com subs sem expiração (raras) quanto com subs expirados —
// uma row 'active' com current_period_end no passado não vale como ativa.
function isStillActive(status: string | null, currentPeriodEnd: string | null): boolean {
  if (status !== 'active') return false
  if (!currentPeriodEnd) return true
  return new Date(currentPeriodEnd) > new Date()
}

export async function getCurrentSubscription(): Promise<SubscriptionState> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return EMPTY_SUBSCRIPTION

  const storeId = await getActiveStoreId()
  if (!storeId) return EMPTY_SUBSCRIPTION
  const { data, error } = await supabase
    .from('store_subscriptions')
    .select('plan_id, provider, status, current_period_end, cancel_at_period_end, billing_cycle')
    .eq('store_id', storeId)
    .maybeSingle()

  if (error) {
    const keys = Object.keys(error as object)
    const asString = (() => {
      try {
        return JSON.stringify(error, Object.getOwnPropertyNames(error as object))
      } catch {
        return String(error)
      }
    })()
    console.error(
      `getCurrentSubscription error | type=${typeof error} | name=${(error as Error).name ?? 'none'} | message=${(error as Error).message ?? 'none'} | keys=[${keys.join(',')}] | json=${asString}`,
    )
    return EMPTY_SUBSCRIPTION
  }
  if (!data) return EMPTY_SUBSCRIPTION

  return {
    isActive: isStillActive(data.status, data.current_period_end),
    planId: data.plan_id,
    provider: data.provider,
    status: data.status,
    currentPeriodEnd: data.current_period_end,
    cancelAtPeriodEnd: data.cancel_at_period_end,
    billingCycle: data.billing_cycle,
  }
}

export type CheckoutResult = { url: string } | { error: string }

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

  // Loja-alvo: getActiveStoreId considera impersonação de admin e membership,
  // mantendo a ação coerente com o que getCurrentSubscription lê.
  const storeId = await getActiveStoreId()
  if (!storeId) return { error: 'no_store' }

  const resolved = resolvePlanCycle(planId, cycle)
  if (!resolved) return { error: 'unknown_plan' }
  if (!resolved.pricing.stripe_price_id) {
    return { error: 'stripe_price_not_configured' }
  }

  // Reusa o stripe_customer_id já vinculado à loja (evita customers duplicados).
  const { data: existing } = await supabase
    .from('store_subscriptions')
    .select('stripe_customer_id')
    .eq('store_id', storeId)
    .maybeSingle()

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: resolved.pricing.stripe_price_id, quantity: 1 }],
      ...(existing?.stripe_customer_id
        ? { customer: existing.stripe_customer_id }
        : { customer_email: user.email ?? undefined }),
      client_reference_id: storeId,
      success_url: `${siteUrl()}/painel?checkout=success`,
      cancel_url: `${siteUrl()}/planos?checkout=canceled`,
      metadata: { store_id: storeId, plan_id: planId, billing_cycle: cycle },
      subscription_data: {
        metadata: { store_id: storeId, plan_id: planId, billing_cycle: cycle },
      },
    })

    if (!session.url) return { error: 'no_url' }
    return { url: session.url }
  } catch (err) {
    console.error('createCheckoutSession error', err)
    return { error: 'stripe_failed' }
  }
}

export async function cancelSubscription(): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'unauthorized' }

  const storeId = await getActiveStoreId()
  if (!storeId) return { error: 'no_store' }

  const { data: sub } = await supabase
    .from('store_subscriptions')
    .select('provider, stripe_subscription_id')
    .eq('store_id', storeId)
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

export async function changePlan(
  planId: PlanId,
  cycle: BillingCycle = 'monthly',
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'unauthorized' }

  const storeId = await getActiveStoreId()
  if (!storeId) return { error: 'no_store' }

  const resolved = resolvePlanCycle(planId, cycle)
  if (!resolved || !resolved.pricing.stripe_price_id) return { error: 'unknown_plan' }

  const { data: sub } = await supabase
    .from('store_subscriptions')
    .select('provider, stripe_subscription_id')
    .eq('store_id', storeId)
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
      metadata: { store_id: storeId, plan_id: planId, billing_cycle: cycle },
    })
    return { ok: true }
  } catch (err) {
    console.error('changePlan error', err)
    return { error: 'stripe_failed' }
  }
}

export async function createPortalSession(): Promise<CheckoutResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'unauthorized' }

  const storeId = await getActiveStoreId()
  if (!storeId) return { error: 'no_store' }

  const { data: sub } = await supabase
    .from('store_subscriptions')
    .select('stripe_customer_id')
    .eq('store_id', storeId)
    .maybeSingle()

  if (!sub?.stripe_customer_id) return { error: 'no_customer' }

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${siteUrl()}/painel`,
    })
    return { url: session.url }
  } catch (err) {
    console.error('createPortalSession error', err)
    return { error: 'stripe_failed' }
  }
}
