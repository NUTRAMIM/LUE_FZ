import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'
import type { StoreRole } from '@/lib/store-role'

export interface SidebarData {
  role: StoreRole
  slug: string | null
}

// Dados que a Sidebar precisa pra montar — papel do usuário (filtra itens
// ownerOnly do NAV) e slug da loja (URL pública no widget de /loja).
// Roda server-side em cada layout autenticado; o getAuthedUser é cacheado
// por request (F2.1), então não duplica chamada a `supabase.auth.getUser`.
// Fail-open pra 'owner' em qualquer erro — preserva semântica antiga da
// Sidebar (que assumia owner quando o fetch client-side falhava).
export async function getSidebarData(): Promise<SidebarData> {
  try {
    const user = await getAuthedUser()
    if (!user) return { role: 'owner', slug: null }

    const supabase = await createClient()
    const [memberRes, settingsRes] = await Promise.all([
      supabase
        .from('store_members')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase
        .from('store_settings')
        .select('chat_slug')
        .eq('id', user.id)
        .maybeSingle(),
    ])

    const role: StoreRole =
      memberRes.data?.role === 'agent' ? 'agent' : 'owner'
    const slug = settingsRes.data?.chat_slug ?? null

    return { role, slug }
  } catch (err) {
    console.error('getSidebarData error', err)
    return { role: 'owner', slug: null }
  }
}
