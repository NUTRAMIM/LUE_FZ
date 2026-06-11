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
import { PeriodSelector } from './PeriodSelector'

export const dynamic = 'force-dynamic'

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
  const [usageRes, storesRes] = await Promise.all([
    admin
      .from('ai_usage_daily')
      .select('store_id, prompt_tokens, completion_tokens, total_tokens, calls')
      .gte('day', start),
    admin.from('store_settings').select('id, store_name'),
  ])

  // The typed Supabase client resolves column-subset selects as `never` for
  // some tables in this project (see billing.ts, chat.ts for the same pattern).
  // We cast via `unknown` to the concrete shapes we know the DB returns.
  type UsageSelect = {
    store_id: string
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    calls: number
  }
  type StoreSelect = { id: string; store_name: string }

  const rows: UsageRow[] = ((usageRes.data as unknown as UsageSelect[]) ?? []).map((r) => ({
    store_id: r.store_id,
    prompt_tokens: r.prompt_tokens,
    completion_tokens: r.completion_tokens,
    total_tokens: r.total_tokens,
    calls: r.calls,
  }))
  const names = new Map(
    ((storesRes.data as unknown as StoreSelect[]) ?? []).map(
      (s) => [s.id, s.store_name ?? '—'] as const,
    ),
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
