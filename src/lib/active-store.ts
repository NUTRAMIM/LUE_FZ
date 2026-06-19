import { cache } from 'react'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'
import { isPlatformAdmin } from '@/lib/platform-admin'
import { IMPERSONATE_COOKIE } from '@/lib/impersonation-cookie'

export interface StoreContext {
  storeId: string
  role: 'owner' | 'agent'
  impersonating: boolean
}

// Fonte única do store_id + role do user atual. Cacheado por request.
//
//   - Admin + cookie de impersonação: opera a loja-alvo como owner. Não
//     consulta store_members (a loja vem do cookie). O RLS, via
//     app_impersonated_store(), libera só as linhas dessa loja.
//   - Sem row em store_members: fallback storeId=user.id, role='owner'.
export const getStoreContext = cache(
  async (): Promise<StoreContext | null> => {
    const user = await getAuthedUser()
    if (!user) return null

    const cookieStore = await cookies()
    const impersonated = cookieStore.get(IMPERSONATE_COOKIE)?.value
    if (impersonated && isPlatformAdmin(user)) {
      return { storeId: impersonated, role: 'owner', impersonating: true }
    }

    const supabase = await createClient()
    const { data } = await supabase
      .from('store_members')
      .select('store_id, role')
      .eq('user_id', user.id)
      .maybeSingle()
    return {
      storeId: data?.store_id ?? user.id,
      role: data?.role === 'agent' ? 'agent' : 'owner',
      impersonating: false,
    }
  },
)

// Resolve o store_id do user atual (null se deslogado).
export const getActiveStoreId = cache(async (): Promise<string | null> => {
  const ctx = await getStoreContext()
  return ctx?.storeId ?? null
})
