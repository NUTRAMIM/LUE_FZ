import { cache } from 'react'
import { createClient } from './supabase/server'

// CRÍTICO: `cache` precisa vir de 'react' (escopo de request, descartado
// entre requests). NUNCA importar de 'next/cache' — esse é cache global
// persistente e causaria vazamento de sessão entre usuários.
//
// Substitui `supabase.auth.getUser()` em server contexts (pages, server
// actions, server-only libs, API routes não-billing). Returns `User | null`;
// nunca throw. Callers tratam null como "não autenticado".
export const getAuthedUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) return null
  return user
})
