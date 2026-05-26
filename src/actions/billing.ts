'use server'

import { getStripe } from '@/lib/stripe'
import { createClient } from '@/lib/supabase/server'
import { getAppUrl } from '@/lib/app-url'
import { PLANS, type PlanId } from '@/lib/plans'
import { getActiveStoreId } from '@/lib/active-store'

export interface SubscriptionState {
  isActive: boolean
  planId: string | null
  provider: 'stripe' | 'mercadopago' | null
  status: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

const EMPTY_SUBSCRIPTION: SubscriptionState = {
  isActive: false,
  planId: null,
  provider: null,
  status: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
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
    .select('plan_id, provider, status, current_period_end, cancel_at_period_end')
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
  }
}

export type CheckoutResult = { url: string } | { error: string }

export async function createCheckoutSession(planId: PlanId): Promise<CheckoutResult> {
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

  const plan = PLANS[planId]
  if (!plan) return { error: 'unknown_plan' }
  if (!plan.stripe_price_id) return { error: 'stripe_price_not_configured' }

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      customer_email: user.email ?? undefined,
      client_reference_id: user.id,
      success_url: `${siteUrl()}/painel?checkout=success`,
      cancel_url: `${siteUrl()}/planos?checkout=canceled`,
      metadata: { store_id: user.id, plan_id: planId },
      subscription_data: {
        metadata: { store_id: user.id, plan_id: planId },
      },
    })

    if (!session.url) return { error: 'no_url' }
    return { url: session.url }
  } catch (err) {
    console.error('createCheckoutSession error', err)
    return { error: 'stripe_failed' }
  }
}

export async function createPortalSession(): Promise<CheckoutResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'unauthorized' }

  const { data: sub } = await supabase
    .from('store_subscriptions')
    .select('stripe_customer_id')
    .eq('store_id', user.id)
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
