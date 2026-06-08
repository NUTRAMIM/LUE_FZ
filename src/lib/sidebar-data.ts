import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'
import { getStoreContext } from '@/lib/active-store'
import { getAppUrl } from '@/lib/app-url'
import type { StoreRole } from '@/lib/store-role'

export interface SidebarData {
  role: StoreRole
  slug: string | null
  appUrl: string
}

// Dados que a Sidebar precisa pra montar — papel do usuário (filtra itens
// ownerOnly do NAV) e slug da loja (URL pública no widget de /loja).
// Roda server-side em cada layout autenticado; o getAuthedUser é cacheado
// por request (F2.1), então não duplica chamada a `supabase.auth.getUser`.
// Fail-open pra 'owner' em qualquer erro — preserva semântica antiga da
// Sidebar (que assumia owner quando o fetch client-side falhava).
export async function getSidebarData(): Promise<SidebarData> {
  const appUrl = getAppUrl()
  try {
    const user = await getAuthedUser()
    if (!user) return { role: 'owner', slug: null, appUrl }

    const supabase = await createClient()
    const [ctx, settingsRes] = await Promise.all([
      getStoreContext(),
      supabase
        .from('store_settings')
        .select('chat_slug')
        .eq('id', user.id)
        .maybeSingle(),
    ])

    const role: StoreRole = ctx?.role ?? 'owner'
    const slug = settingsRes.data?.chat_slug ?? null

    return { role, slug, appUrl }
  } catch (err) {
    console.error('getSidebarData error', err)
    return { role: 'owner', slug: null, appUrl }
  }
}
