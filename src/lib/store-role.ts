import { createClient } from '@/lib/supabase/server'

export type StoreRole = 'owner' | 'agent'

// Resolve o papel do usuário atual na loja. Um vendedor sempre tem uma linha
// em store_members (role 'agent'); um dono também tem (criada pelo trigger em
// store_settings) — mas um dono que ainda não configurou a loja não tem linha,
// então a ausência é tratada como 'owner'.
export async function getStoreRole(): Promise<StoreRole> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return 'owner'

  const { data } = await supabase
    .from('store_members')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()

  return data?.role === 'agent' ? 'agent' : 'owner'
}
