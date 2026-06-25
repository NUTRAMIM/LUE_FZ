import { createAdminClient } from '@/lib/supabase/admin'
import { getActiveStoreId } from '@/lib/active-store'

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

// Para ações de dono: resolve a loja da sessão e checa assinatura ativa.
// Retorna o storeId quando ativa; null quando não há loja ou está inativa.
export async function requireActiveStoreSubscription(): Promise<string | null> {
  const storeId = await getActiveStoreId()
  if (!storeId) return null
  const active = await isStoreSubscriptionActive(storeId)
  return active ? storeId : null
}
