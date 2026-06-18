import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'
import { getStoreContext } from '@/lib/active-store'
import { getAppUrl } from '@/lib/app-url'
import { isPlatformAdmin } from '@/lib/platform-admin'
import type { StoreRole } from '@/lib/store-role'

export interface SidebarData {
  role: StoreRole
  slug: string | null
  appUrl: string
  isAdmin: boolean
  storeName: string | null
  email: string | null
}

// Dados que a Sidebar precisa pra montar — papel do usuário (filtra itens
// ownerOnly do NAV), slug da loja (URL pública no widget de /loja) e isAdmin
// (mostra o item Admin só para super-admins). Roda server-side em cada layout
// autenticado. Fail-open pra 'owner' em erro; isAdmin é fail-closed (false).
export async function getSidebarData(): Promise<SidebarData> {
  const appUrl = getAppUrl()
  try {
    const user = await getAuthedUser()
    if (!user) return { role: 'owner', slug: null, appUrl, isAdmin: false, storeName: null, email: null }

    const supabase = await createClient()
    const [ctx, settingsRes] = await Promise.all([
      getStoreContext(),
      supabase
        .from('store_settings')
        .select('chat_slug, store_name')
        .eq('id', user.id)
        .maybeSingle(),
    ])

    const role: StoreRole = ctx?.role ?? 'owner'
    const slug = settingsRes.data?.chat_slug ?? null
    const storeName = settingsRes.data?.store_name ?? null

    return { role, slug, appUrl, isAdmin: isPlatformAdmin(user), storeName, email: user.email ?? null }
  } catch (err) {
    console.error('getSidebarData error', err)
    return { role: 'owner', slug: null, appUrl, isAdmin: false, storeName: null, email: null }
  }
}
