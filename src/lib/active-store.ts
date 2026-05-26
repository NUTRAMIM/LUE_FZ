import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'

// Resolve o store_id do user atual. Cacheado por request (mesmo padrão do
// getAuthedUser) pra evitar query duplicada quando middleware + page +
// actions chamam no mesmo render.
//
//   - Sem user logado: null
//   - Tem row em store_members: usa o store_id (cobre owner com loja
//     configurada e agent)
//   - Sem row em store_members: fallback user.id (preserva a convenção
//     anterior do projeto onde owner.store_id = owner.user.id antes do
//     seed da membership rodar)
export const getActiveStoreId = cache(async (): Promise<string | null> => {
  const user = await getAuthedUser()
  if (!user) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from('store_members')
    .select('store_id')
    .eq('user_id', user.id)
    .maybeSingle()
  return data?.store_id ?? user.id
})
