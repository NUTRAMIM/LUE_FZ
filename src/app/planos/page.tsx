import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentSubscription } from '@/actions/billing'
import { getStoreRole } from '@/lib/store-role'
import { PLANS } from '@/lib/plans'
import { CheckoutClient } from './CheckoutClient'

export const dynamic = 'force-dynamic'

// Página de planos. Server Component:
//   - Exige login (redirect /login)
//   - Se já tem assinatura ativa, redireciona pra /painel
//   - Caso contrário, renderiza os planos + cliente de checkout
//
// O middleware leva pra cá os usuários logados sem assinatura tentando
// acessar rotas protegidas (gating).

export default async function PlanosPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if ((await getStoreRole()) === 'agent') redirect('/conversas')

  const subscription = await getCurrentSubscription()
  if (subscription.isActive) redirect('/painel')

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-16 text-neutral-100">
      <div className="mx-auto max-w-2xl">
        <header className="mb-12 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">LUE FZ</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
            Ative sua assinatura
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-neutral-400">
            Pra liberar painel, estoque, loja e conversas. Cancele quando quiser.
          </p>
        </header>

        <div className="space-y-6">
          {Object.entries(PLANS).map(([id, plan]) => (
            <article
              key={id}
              className="rounded-2xl border border-neutral-800 bg-neutral-900/40 p-8 shadow-2xl shadow-black/40 backdrop-blur"
            >
              <div className="mb-8 flex items-baseline justify-between gap-6">
                <div>
                  <h2 className="text-2xl font-semibold">{plan.name}</h2>
                  <p className="mt-1 text-sm text-neutral-400">
                    {plan.duration_days} dias de acesso completo
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold tracking-tight">
                    R$ {(plan.price_brl / 100).toFixed(2).replace('.', ',')}
                  </div>
                  <div className="mt-1 text-xs uppercase tracking-wider text-neutral-500">
                    por período
                  </div>
                </div>
              </div>

              <CheckoutClient planId={id as keyof typeof PLANS} />
            </article>
          ))}
        </div>
      </div>
    </main>
  )
}
