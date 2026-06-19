import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database'
import { IMPERSONATE_COOKIE } from '@/lib/impersonation-cookie'

export async function createClient() {
  const cookieStore = await cookies()

  // Impersonação: se o cookie existir, injeta o header que o RLS lê
  // (app_impersonated_store). A segurança é no banco — o header só é
  // honrado para platform-admins; injetar aqui sem checar admin é seguro.
  const impersonate = cookieStore.get(IMPERSONATE_COOKIE)?.value
  const global = impersonate
    ? { headers: { 'x-impersonate-store': impersonate } }
    : undefined

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(global ? { global } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // chamado de Server Component — ok ignorar (middleware refaz a sessão)
          }
        },
      },
    }
  )
}
