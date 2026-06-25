import { createAdminClient } from '@/lib/supabase/admin'
import { PLANS, isPlanId } from '@/lib/plans'

// Cota mensal de CONVERSAS por plano. As primeiras N conversas do mês (por
// ordem de criação) recebem resposta da IA; conversas além disso não — até o
// próximo mês civil ou upgrade. Reset é por mês civil (UTC), inclusive para
// quem paga trimestral (a cota de conversas é mensal).

// Início do mês civil corrente em UTC (ISO).
export function monthStartIso(now: Date = new Date()): string {
  const d = new Date(now)
  d.setUTCDate(1)
  d.setUTCHours(0, 0, 0, 0)
  return d.toISOString()
}

// Pura: dado quantas conversas do mês foram criadas ANTES desta, ela está
// dentro da cota? A (k+1)-ésima conversa cabe se k < limit.
export function isWithinQuota(priorCount: number, limit: number): boolean {
  return priorCount < limit
}

// Limite de conversas/mês do plano ativo da loja (null se não houver plano
// válido — nesse caso o gate de assinatura já barra antes).
export async function storeConversationLimit(
  storeId: string,
): Promise<number | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('store_subscriptions')
    .select('plan_id')
    .eq('store_id', storeId)
    .maybeSingle()
  if (!data || !isPlanId(data.plan_id)) return null
  return PLANS[data.plan_id].convsLimit
}

// Esta conversa específica está dentro da cota mensal? Conta quantas conversas
// do mês foram criadas antes dela e aplica isWithinQuota. Conversas que vieram
// de meses anteriores (createdAt < início do mês) sempre passam — atendimentos
// em andamento continuam.
//
// Tolerância: o filtro usa `created_at` estrito (`.lt`). Conversas com o MESMO
// timestamp (colisão de microssegundos, rara) não se desempatam por id, então
// sob concorrência extrema a cota pode ser excedida em pouquíssimas unidades —
// sempre a favor do cliente, nunca bloqueando antes do limite.
export async function conversationWithinQuota(
  storeId: string,
  conversationCreatedAt: string,
  limit: number,
): Promise<boolean> {
  const admin = createAdminClient()
  const { count } = await admin
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', storeId)
    .gte('created_at', monthStartIso())
    .lt('created_at', conversationCreatedAt)
  return isWithinQuota(count ?? 0, limit)
}
