import { getAuthedUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { hasAcceptedCurrentTerms } from '@/lib/terms'
import { TermsDocument } from '@/content/terms'
import { TermosAceite } from '@/components/termos/TermosAceite'

export const dynamic = 'force-dynamic'

export default async function TermosPage() {
  const user = await getAuthedUser()

  // Owner logado que ainda nao aceitou a versao atual ve o formulario de aceite.
  if (user) {
    const supabase = await createClient()
    const accepted = await hasAcceptedCurrentTerms(supabase, user.id)
    if (!accepted) {
      return (
        <TermosAceite>
          <TermsDocument />
        </TermosAceite>
      )
    }
  }

  // Visitante deslogado ou usuario que ja aceitou: documento em modo leitura.
  return (
    <main className="mx-auto max-w-[760px] px-4 py-8 sm:px-6">
      <h1 className="mb-6 font-display text-[24px] font-bold tracking-tight text-ink-900">
        Termos de Uso e Política de Privacidade
      </h1>
      <div className="rounded-2xl border border-ink-200 bg-white p-5 sm:p-7">
        <TermsDocument />
      </div>
    </main>
  )
}
