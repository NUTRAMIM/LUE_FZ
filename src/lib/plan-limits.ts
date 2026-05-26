import { createClient } from '@/lib/supabase/server'
import { PLANS_DISPLAY, type PlanDisplay } from '@/lib/plans-display'

// Resolve o maxAgents do plan_id. Plans desconhecidos (legacy 'pro' antigo,
// null, undefined) retornam 0 — sem plano ativo == não pode convidar.
export function maxAgentsForPlan(
  planId: string | null | undefined,
): number {
  const match = PLANS_DISPLAY.find((p: PlanDisplay) => p.id === planId)
  return match?.maxAgents ?? 0
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
