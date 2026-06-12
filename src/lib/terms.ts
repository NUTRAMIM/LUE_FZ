import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Versao corrente dos termos. Bump desta string re-dispara o gate de aceite
// para todos os owners (eles precisam aceitar a nova versao).
export const TERMS_VERSION = '2026-06-12'

export type StoreRole = 'owner' | 'agent'

// Decisao pura do gate: so o dono (owner) e gateado, e so enquanto nao
// aceitou a versao atual. Agents (vendedores) nunca passam pelo gate — a
// relacao contratual e do dono.
export function shouldGateTerms(params: {
  role: StoreRole
  hasAcceptedCurrent: boolean
}): boolean {
  return params.role !== 'agent' && !params.hasAcceptedCurrent
}

// Consulta se o usuario ja aceitou a versao atual. Usada no middleware e na
// pagina /termos.
export async function hasAcceptedCurrentTerms(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('terms_acceptances')
    .select('id')
    .eq('user_id', userId)
    .eq('terms_version', TERMS_VERSION)
    .maybeSingle()
  return !!data
}
