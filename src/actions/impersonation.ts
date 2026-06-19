'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getAuthedUser } from '@/lib/auth'
import { isPlatformAdmin } from '@/lib/platform-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { IMPERSONATE_COOKIE } from '@/lib/impersonation-cookie'

// Entra no "modo loja". Gate de admin é a primeira linha (fail-closed:
// não-admin retorna sem efeito). Valida que a loja existe antes de setar.
export async function enterStore(storeId: string) {
  const user = await getAuthedUser()
  if (!user || !isPlatformAdmin(user)) return

  const admin = createAdminClient()
  const { data } = await admin
    .from('store_settings')
    .select('id')
    .eq('id', storeId)
    .maybeSingle()
  if (!data) return

  const cookieStore = await cookies()
  cookieStore.set(IMPERSONATE_COOKIE, storeId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  })
  redirect('/conversas')
}

// Sai do modo loja: limpa o cookie e volta ao painel admin.
export async function exitStore() {
  const cookieStore = await cookies()
  cookieStore.delete(IMPERSONATE_COOKIE)
  redirect('/painel/_internal')
}
