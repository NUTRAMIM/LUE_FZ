import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'
import { getCurrentSubscription } from '@/actions/billing'
import { logout } from '@/actions/auth'
import { Icon, Chip } from '@/components/painel/Icons'
import { PLANS_DISPLAY, type PlanDisplay } from '@/lib/plans-display'
import { PlanosInteractive } from './PlanosClient'

export const dynamic = 'force-dynamic'

// Hoje só existe 'pro' em lib/plans.ts; mapeia pra Essencial até os 3
// planos do display virarem reais no checkout.
function mapPlanIdToDisplay(planId: string | null): PlanDisplay['id'] | null {
  if (!planId) return null
  if (planId === 'essencial' || planId === 'profissional' || planId === 'performance') {
    return planId
  }
  return 'essencial'
}

function formatPtBrDay(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
  })
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const diff = new Date(iso).getTime() - new Date().getTime()
  if (diff <= 0) return 0
  return Math.ceil(diff / 86_400_000)
}

function providerLabel(provider: 'stripe' | 'mercadopago' | 'manual' | null): string {
  if (provider === 'stripe') return 'Stripe'
  if (provider === 'mercadopago') return 'Mercado Pago'
  if (provider === 'manual') return 'Acesso concedido'
  return '—'
}

export default async function PainelPlanosPage() {
  const supabase = await createClient()
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const [subscription, msgCountRes, storeRes] = await Promise.all([
    getCurrentSubscription(),
    supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', user.id)
      .eq('role', 'assistant')
      .gte(
        'created_at',
        (() => {
          const d = new Date()
          d.setUTCDate(1)
          d.setUTCHours(0, 0, 0, 0)
          return d.toISOString()
        })(),
      ),
    supabase
      .from('store_settings')
      .select('store_name')
      .eq('id', user.id)
      .maybeSingle(),
  ])

  const currentPlanId = mapPlanIdToDisplay(subscription.planId)
  const currentPlan = currentPlanId
    ? PLANS_DISPLAY.find((p) => p.id === currentPlanId) ?? null
    : null

  const storeName = storeRes.data?.store_name ?? 'Sua loja'
  const storeInitials = storeName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || 'L'

  const userName =
    (user.user_metadata?.full_name as string | undefined) ||
    (user.user_metadata?.name as string | undefined) ||
    user.email?.split('@')[0] ||
    'Você'
  const userInitials = userName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || 'U'

  const planLabel = currentPlan
    ? `PLANO ${currentPlan.name.toUpperCase()}`
    : 'SEM PLANO'

  const messagesUsed = msgCountRes.count ?? 0
  const limit = currentPlan?.msgsLimit ?? 1000
  const used = Math.min(messagesUsed, limit)
  const usagePct = limit > 0 ? (used / limit) * 100 : 0
  const days = daysUntil(subscription.currentPeriodEnd)

  return (
    <div className="flex min-h-screen">
      {/* ───────── Sidebar ───────── */}
      <aside
        className="w-64 shrink-0 bg-white border-r border-ink-200 flex flex-col"
        style={{ height: '100vh', position: 'sticky', top: 0 }}
      >
        {/* Brand */}
        <div className="px-6 pt-7 pb-6 flex items-center gap-3">
          <div
            className="font-display font-extrabold tracking-tight leading-none"
            style={{ fontSize: 32 }}
          >
            <span className="lue-l">L</span>
            <span className="text-ink-900">UE</span>
          </div>
          <div className="ml-auto eyebrow text-ink-400">FZ</div>
        </div>

        {/* Org switcher */}
        <button className="mx-3 mb-5 p-3 rounded-2xl bg-ink-50 hover:bg-ink-100 transition-colors flex items-center gap-3 text-left">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center font-display font-bold text-white text-[13px]">
            {storeInitials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-ink-900 truncate">
              {storeName}
            </div>
            <div className="eyebrow text-ink-500 mt-0.5">{planLabel}</div>
          </div>
          <Icon name="chev" className="w-4 h-4 text-ink-400" />
        </button>

        {/* Nav */}
        <nav className="px-3 flex-1 overflow-y-auto">
          <div className="eyebrow text-ink-400 px-3 mb-2">PRINCIPAL</div>
          <ul className="space-y-1">
            <li>
              <Link href="/painel" className="nav-link">
                <Icon name="trend" className="w-[18px] h-[18px]" />
                Painel
              </Link>
            </li>
            <li>
              <Link href="/conversas" className="nav-link">
                <Icon name="msgSq" className="w-[18px] h-[18px]" />
                Conversas
                <span className="ml-auto tabular text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-ink-100 text-ink-600">
                  12
                </span>
              </Link>
            </li>
            <li>
              <Link href="/estoque" className="nav-link">
                <Icon name="package" className="w-[18px] h-[18px]" />
                Estoque
              </Link>
            </li>
            <li>
              <Link href="/loja" className="nav-link">
                <Icon name="store" className="w-[18px] h-[18px]" />
                Loja
              </Link>
            </li>
          </ul>

          <div className="eyebrow text-ink-400 px-3 mb-2 mt-6">CONTA</div>
          <ul className="space-y-1">
            <li>
              <Link href="/painel/planos" className="nav-link active">
                <Icon name="sparkle" className="w-[18px] h-[18px]" />
                Planos &amp; assinatura
              </Link>
            </li>
            <li>
              <a className="nav-link" aria-disabled="true">
                <Icon name="receipt" className="w-[18px] h-[18px]" />
                Faturas
              </a>
            </li>
            <li>
              <a className="nav-link" aria-disabled="true">
                <Icon name="creditCard" className="w-[18px] h-[18px]" />
                Forma de pagamento
              </a>
            </li>
          </ul>
        </nav>

        {/* Footer (user) */}
        <div className="p-3 border-t border-ink-200">
          <div className="flex items-center gap-3 px-2 py-1.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-300 to-brand-500 font-display font-bold text-white flex items-center justify-center text-[11px]">
              {userInitials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-ink-900 truncate">
                {userName}
              </div>
              <div className="eyebrow text-ink-500 truncate">OPERADORA</div>
            </div>
            <form action={logout}>
              <button
                type="submit"
                className="w-7 h-7 rounded-lg text-ink-500 hover:text-ink-900 hover:bg-ink-100 flex items-center justify-center"
                title="Sair"
              >
                <Icon name="logout" className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* ───────── Main ───────── */}
      <main className="flex-1 min-w-0">
        <div className="max-w-[1280px] mx-auto px-8 py-7">
          {/* Topbar */}
          <div className="flex items-center justify-between mb-7">
            <div>
              <div className="eyebrow text-ink-500">CONTA · ASSINATURA</div>
              <h1
                className="font-display font-bold text-ink-900 tracking-tight mt-1.5"
                style={{ fontSize: '26px', lineHeight: 1.1 }}
              >
                Planos &amp; assinatura
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Icon
                  name="search"
                  className="w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2"
                />
                <input
                  aria-label="Buscar"
                  placeholder="Buscar…"
                  className="w-[240px] pl-9 pr-12 py-2.5 rounded-xl bg-white border border-ink-200 text-[13px] placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 eyebrow text-ink-400 bg-ink-50 px-1.5 py-0.5 rounded-md">
                  ⌘K
                </span>
              </div>
              <button
                aria-label="Notificações"
                className="relative w-10 h-10 rounded-xl bg-white border border-ink-200 text-ink-600 hover:text-ink-900 hover:bg-ink-50 flex items-center justify-center"
              >
                <Icon name="bell" className="w-4 h-4" />
                <span className="absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full bg-brand-600 ring-2 ring-white" />
              </button>
            </div>
          </div>

          {/* Current plan card */}
          <div className="card p-6">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8 items-start">
              <div>
                <div className="flex items-center gap-2.5 mb-3">
                  <Chip tone="brand" name="sparkle" />
                  <span className="eyebrow text-ink-500">PLANO ATUAL</span>
                  {subscription.isActive ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-success-700 bg-success-50 ring-1 ring-success-100 px-2 py-0.5 rounded-md">
                      <span className="live-dot" /> Ativo
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink-600 bg-ink-100 px-2 py-0.5 rounded-md">
                      Sem assinatura
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-3 flex-wrap">
                  <h2
                    className="font-display font-bold text-ink-900 tracking-tight"
                    style={{ fontSize: '28px', lineHeight: 1.05 }}
                  >
                    {currentPlan?.name ?? 'Nenhum plano ativo'}
                  </h2>
                  {currentPlan && (
                    <>
                      <span className="text-ink-500 text-[14px]">·</span>
                      <span className="text-ink-700 tabular text-[14px] font-semibold">
                        R$ {currentPlan.priceMonthly}
                        <span className="text-ink-500 font-normal">/mês</span>
                      </span>
                    </>
                  )}
                </div>
                <p className="mt-2.5 text-[13.5px] text-ink-500 max-w-[60ch] leading-relaxed">
                  {subscription.isActive && subscription.currentPeriodEnd ? (
                    <>
                      {subscription.cancelAtPeriodEnd ? 'Cancela' : 'Próxima cobrança'} em{' '}
                      <strong className="text-ink-800">
                        {formatPtBrDay(subscription.currentPeriodEnd)}
                      </strong>{' '}
                      — {providerLabel(subscription.provider)}.
                    </>
                  ) : (
                    <>
                      Você ainda não tem uma assinatura ativa. Escolha um plano
                      abaixo pra liberar todas as funcionalidades.
                    </>
                  )}
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="eyebrow text-ink-500">USO DO MÊS</span>
                  <span className="tabular text-[12px] font-semibold text-ink-700">
                    {used.toLocaleString('pt-BR')} / {limit.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="usage-bar">
                  <span style={{ width: `${Math.min(usagePct, 100)}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11.5px] text-ink-500">
                  <span className="font-mono">
                    {usagePct.toFixed(0)}% usado
                  </span>
                  {days !== null && (
                    <span>
                      {days === 0
                        ? 'renova hoje'
                        : days === 1
                        ? 'renova amanhã'
                        : `renova em ${days} dias`}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 pt-5 border-t border-ink-100 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[12.5px] text-ink-500">
                <Icon name="infoCircle" className="w-4 h-4 text-ink-400" />
                Você pode trocar de plano a qualquer momento — o ajuste é
                proporcional aos dias restantes do mês.
              </div>
              <div className="flex items-center gap-2">
                <button className="btn btn-ghost" disabled={!subscription.isActive}>
                  Gerenciar pagamento
                </button>
                <button
                  className="btn btn-secondary"
                  disabled={!subscription.isActive}
                >
                  Cancelar assinatura
                </button>
              </div>
            </div>
          </div>

          {/* Interactive: toggle + 3 cards + compare + FAQ */}
          <PlanosInteractive currentPlanId={currentPlanId} />

          <footer className="mt-10 mb-4 flex items-center justify-end text-[11.5px] text-ink-500 font-mono">
            <div className="eyebrow">LUE FZ · v0.4.0</div>
          </footer>
        </div>
      </main>
    </div>
  )
}
