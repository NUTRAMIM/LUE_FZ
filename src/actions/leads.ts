'use server'

import { createClient } from '@/lib/supabase/server'

export interface LeadRow {
  id: string
  name: string
  whatsapp: string
  interestSummary: string
  createdAt: string
  contactedAt: string | null
  contactedByName: string | null
}

// Lista os leads da loja. A RLS de membership (leads_select_member, migration
// 025) já faz o scoping — o cliente autenticado só enxerga os leads da loja
// do chamador, seja ele dono ou vendedor.
export async function getLeads(): Promise<LeadRow[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('leads')
    .select(
      'id, name, whatsapp, interest_summary, created_at, contacted_at, contacted_by_name',
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
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Não autenticado.' }

  const { data: member } = await supabase
    .from('store_members')
    .select('full_name')
    .eq('user_id', user.id)
    .maybeSingle()

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
