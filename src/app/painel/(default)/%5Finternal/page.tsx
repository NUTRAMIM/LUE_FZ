import { notFound } from 'next/navigation'
import { getAuthedUser } from '@/lib/auth'
import { isPlatformAdmin } from '@/lib/platform-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  resolvePeriodStart,
  aggregateByStore,
  sumUsage,
  type Periodo,
  type UsageRow,
} from '@/lib/admin-usage'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatCard } from '@/components/ui/StatCard'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Icon } from '@/components/painel/Icons'
import { enterStore } from '@/actions/impersonation'
import { setStoreSubscription } from '@/actions/admin-subscription'
import { PeriodSelector } from './PeriodSelector'

export const dynamic = 'force-dynamic'

type SubInfo = { status: string; current_period_end: string | null; provider: string }

// Espelha o gating de billing: ativa = status 'active' e (sem fim de período
// ou fim de período no futuro).
const isSubActive = (sub: SubInfo | undefined): boolean =>
  !!sub &&
  sub.status === 'active' &&
  (!sub.current_period_end || new Date(sub.current_period_end) > new Date())

const PERIODOS: Periodo[] = ['dia', 'semana', 'mes']
const LABEL: Record<Periodo, string> = { dia: 'hoje', semana: 'últimos 7 dias', mes: 'este mês' }

const fmt = (n: number) => new Intl.NumberFormat('pt-BR').format(n)

export default async function AdminInternalPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>
}) {
  // Gate server-side: não-admin recebe 404 (rota se comporta como inexistente).
  const user = await getAuthedUser()
  if (!user || !isPlatformAdmin(user)) notFound()

  const sp = await searchParams
  const periodo: Periodo = PERIODOS.includes(sp.periodo as Periodo)
    ? (sp.periodo as Periodo)
    : 'dia'
  const start = resolvePeriodStart(periodo, new Date())

  // Leitura via service-role (ignora RLS) — só acontece após o gate de admin.
  const admin = createAdminClient()
  const [usageRes, storesRes, subsRes] = await Promise.all([
    admin
      .from('ai_usage_daily')
      .select('store_id, prompt_tokens, completion_tokens, total_tokens, calls')
      .gte('day', start),
    admin.from('store_settings').select('id, store_name'),
    admin
      .from('store_subscriptions')
      .select('store_id, status, current_period_end, provider'),
  ])

  const rows: UsageRow[] = usageRes.data ?? []
  const names = new Map(
    (storesRes.data ?? []).map((s) => [s.id, s.store_name] as const),
  )
  const subs = new Map<string, SubInfo>(
    (subsRes.data ?? []).map((s) => [
      s.store_id,
      {
        status: s.status,
        current_period_end: s.current_period_end,
        provider: s.provider,
      },
    ]),
  )
  const porLoja = aggregateByStore(rows, names)
  const totais = sumUsage(porLoja)
  const erro = Boolean(usageRes.error || storesRes.error)

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 md:py-8">
      <PageHeader
        title="Admin · Plataforma"
        subtitle="Consumo de tokens da IA por loja"
        actions={<PeriodSelector active={periodo} />}
      />

      {erro ? (
        <EmptyState
          icon={<Icon name="alert" className="h-6 w-6" />}
          title="Não foi possível carregar o consumo"
          description="Tente novamente em instantes."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label={`Tokens · ${LABEL[periodo]}`}
              value={fmt(totais.total)}
              tone="brand"
              emphasis="value"
              icon={<Icon name="sparkle" className="h-4 w-4" />}
            />
            <StatCard
              label="Prompt"
              value={fmt(totais.prompt)}
              tone="info"
              hint={`Completion: ${fmt(totais.completion)}`}
              icon={<Icon name="ai" className="h-4 w-4" />}
            />
            <StatCard
              label="Chamadas"
              value={fmt(totais.calls)}
              tone="neutral"
              icon={<Icon name="send" className="h-4 w-4" />}
            />
            <StatCard
              label="Lojas ativas"
              value={fmt(totais.stores)}
              tone="success"
              icon={<Icon name="store" className="h-4 w-4" />}
            />
          </div>

          <Card className="mt-6 overflow-hidden p-0">
            <div className="border-b border-slate-200/80 px-5 py-4">
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Consumo por loja
              </h2>
            </div>
            {porLoja.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  icon={<Icon name="receipt" className="h-6 w-6" />}
                  title="Sem consumo no período"
                  description="Nenhuma loja gerou tokens no intervalo selecionado."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                      <th className="px-5 py-3">Loja</th>
                      <th className="px-5 py-3 text-right">Prompt</th>
                      <th className="px-5 py-3 text-right">Completion</th>
                      <th className="px-5 py-3 text-right">Total</th>
                      <th className="px-5 py-3 text-right">Chamadas</th>
                      <th className="px-5 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {porLoja.map((s) => (
                      <tr key={s.storeId} className="hover:bg-slate-50/60">
                        <td className="px-5 py-3 font-medium text-slate-900">
                          {s.storeName}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums text-slate-600">
                          {fmt(s.prompt)}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums text-slate-600">
                          {fmt(s.completion)}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums font-semibold text-slate-900">
                          {fmt(s.total)}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums text-slate-600">
                          {fmt(s.calls)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <form action={enterStore.bind(null, s.storeId)}>
                            <button
                              type="submit"
                              className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              Entrar
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="mt-6 overflow-hidden p-0">
            <div className="border-b border-slate-200/80 px-5 py-4">
              <h2 className="font-display text-sm font-semibold text-slate-900">Todas as lojas</h2>
            </div>
            <ul className="divide-y divide-slate-100">
              {(storesRes.data ?? []).map((loja) => {
                const sub = subs.get(loja.id)
                const active = isSubActive(sub)
                return (
                  <li key={loja.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium text-slate-900">
                        {loja.store_name}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          active
                            ? 'bg-emerald-50 text-emerald-700'
                            : sub
                              ? 'bg-slate-100 text-slate-600'
                              : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {active ? 'Ativa' : sub ? sub.status : 'Sem assinatura'}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <form action={enterStore.bind(null, loja.id)}>
                        <button
                          type="submit"
                          className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Entrar
                        </button>
                      </form>
                      {active ? (
                        <form action={setStoreSubscription.bind(null, loja.id, 'revoke')}>
                          <button
                            type="submit"
                            className="rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                          >
                            Revogar
                          </button>
                        </form>
                      ) : (
                        <form action={setStoreSubscription.bind(null, loja.id, 'grant')}>
                          <button
                            type="submit"
                            className="rounded-lg border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                          >
                            Liberar
                          </button>
                        </form>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}
