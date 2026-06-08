import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'

export interface StoreContext {
  storeId: string
  role: 'owner' | 'agent'
}

// Fonte única do store_id + role do user atual. Cacheado por request, então
// uma só query em `store_members` serve a página, o layout (sidebar) e as
// actions no mesmo render — antes cada um disparava a sua. `getActiveStoreId`
// e `getStoreRole` delegam aqui.
//
//   - Sem row em store_members: fallback storeId=user.id, role='owner'
//     (preserva a convenção anterior onde owner.store_id = owner.user.id
//     antes do seed da membership rodar)
export const getStoreContext = cache(
  async (): Promise<StoreContext | null> => {
    const user = await getAuthedUser()
    if (!user) return null
    const supabase = await createClient()
    const { data } = await supabase
      .from('store_members')
      .select('store_id, role')
      .eq('user_id', user.id)
      .maybeSingle()
    return {
      storeId: data?.store_id ?? user.id,
      role: data?.role === 'agent' ? 'agent' : 'owner',
    }
  },
)

// Resolve o store_id do user atual (null se deslogado).
export const getActiveStoreId = cache(async (): Promise<string | null> => {
  const ctx = await getStoreContext()
  return ctx?.storeId ?? null
})
