import { cache } from 'react'
import { createClient } from './supabase/server'

// Subconjunto do `User` do Supabase efetivamente consumido pelos callers
// (id em toda parte; email/user_metadata só em /painel/planos). Vem das
// claims do JWT, não do objeto `User` completo.
export interface AuthedUser {
  id: string
  email?: string
  phone?: string
  user_metadata?: Record<string, unknown>
  app_metadata?: Record<string, unknown>
}

// CRÍTICO: `cache` precisa vir de 'react' (escopo de request, descartado
// entre requests). NUNCA importar de 'next/cache' — esse é cache global
// persistente e causaria vazamento de sessão entre usuários.
//
// Substitui `supabase.auth.getUser()` em server contexts (pages, server
// actions, server-only libs, API routes não-billing). Returns
// `AuthedUser | null`; nunca throw. Callers tratam null como "não autenticado".
//
// Usa `getClaims()` em vez de `getUser()`: quando o projeto usa chaves de
// assinatura assimétricas (RS/ES), a verificação do JWT é LOCAL (zero
// round-trip de rede por request). Em HS256 legado o próprio `getClaims`
// faz fallback pra `getUser()` — então a segurança é idêntica à anterior,
// nunca pior.
export const getAuthedUser = cache(async (): Promise<AuthedUser | null> => {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  if (error || !data?.claims) return null
  const c = data.claims
  return {
    id: c.sub,
    email: c.email,
    phone: c.phone,
    user_metadata: c.user_metadata,
    app_metadata: c.app_metadata,
  }
})
