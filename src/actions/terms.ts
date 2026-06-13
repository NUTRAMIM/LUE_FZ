'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'
import { TERMS_VERSION } from '@/lib/terms'

// Grava o aceite da versao atual dos termos para o usuario logado e leva ao
// painel. IP e user agent vem dos headers da request (prova de consentimento).
export async function acceptTerms() {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const h = await headers()
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null
  const userAgent = h.get('user-agent') ?? null

  const supabase = await createClient()
  const { error } = await supabase.from('terms_acceptances').upsert(
    {
      user_id: user.id,
      terms_version: TERMS_VERSION,
      ip,
      user_agent: userAgent,
    },
    { onConflict: 'user_id,terms_version', ignoreDuplicates: true },
  )

  // Aceite e prova de consentimento: nao pode falhar em silencio. Se o upsert
  // falhar, o middleware mandaria o owner de volta pro /termos num loop. Logamos
  // e devolvemos o erro pra tela em vez de fingir que deu certo.
  if (error) {
    console.error('acceptTerms upsert error', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    })
    redirect(`/termos?erro=${encodeURIComponent(error.message)}`)
  }

  redirect('/painel')
}
