'use server'

import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'

export interface PedidoItem {
  produto: string
  qtd: number
  tamanho?: string | null
  cor?: string | null
  preco?: number | null
}

export interface LeadRow {
  id: string
  name: string
  whatsapp: string
  interestSummary: string
  createdAt: string
  contactedAt: string | null
  contactedByName: string | null
  email: string | null
  cep: string | null
  conversationId: string | null
  pedido: PedidoItem[]
  formaPagamento: string | null
  formaEntrega: string | null
  valorTotal: number | null
  tipoCliente: string
  carroChefe: string | null
}

// Lista os leads da loja. A RLS de membership (leads_select_member, migration
// 025) já faz o scoping — o cliente autenticado só enxerga os leads da loja
// do chamador, seja ele dono ou vendedor.
export async function getLeads(): Promise<LeadRow[]> {
  const supabase = await createClient()
  const user = await getAuthedUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('leads')
    .select(
      'id, name, whatsapp, interest_summary, created_at, contacted_at, contacted_by_name, email, cep, conversation_id, pedido, forma_pagamento, forma_entrega, valor_total, tipo_cliente, carro_chefe',
    )
    .order('created_at', { ascending: false })
    .limit(200)
  if (error || !data) {
    console.error('getLeads error', error)
    return []
  }

  return data.map((l) => ({
    id: l.id,
    name: l.name ?? 'Sem nome',
    whatsapp: l.whatsapp ?? '',
    interestSummary: l.interest_summary ?? '',
    createdAt: l.created_at,
    contactedAt: l.contacted_at,
    contactedByName: l.contacted_by_name,
    email: l.email ?? null,
    cep: l.cep ?? null,
    conversationId: l.conversation_id ?? null,
    pedido: Array.isArray(l.pedido) ? (l.pedido as unknown as PedidoItem[]) : [],
    formaPagamento: l.forma_pagamento ?? null,
    formaEntrega: l.forma_entrega ?? null,
    valorTotal: l.valor_total ?? null,
    tipoCliente: l.tipo_cliente ?? 'varejo',
    carroChefe: l.carro_chefe ?? null,
  }))
}

// Marca um lead como contatado: carimba o horário, o UUID e o nome de quem
// contatou. O nome vem da própria linha de store_members do chamador (a RLS
// store_members_select_self permite ler a própria linha). A RLS
// leads_update_member garante que só dá para marcar leads da própria loja.
export async function markLeadContacted(
  leadId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const user = await getAuthedUser()
  if (!user) return { ok: false, error: 'Não autenticado.' }

  const { data: member, error: memberErr } = await supabase
    .from('store_members')
    .select('full_name')
    .eq('user_id', user.id)
    .maybeSingle()
  if (memberErr) {
    console.error('markLeadContacted member lookup error', memberErr)
  }

  const { error } = await supabase
    .from('leads')
    .update({
      contacted_at: new Date().toISOString(),
      contacted_by: user.id,
      contacted_by_name: member?.full_name ?? null,
    })
    .eq('id', leadId)
  if (error) {
    console.error('markLeadContacted error', error)
    return { ok: false, error: 'Não foi possível marcar o lead.' }
  }
  return { ok: true }
}
