import { notFound } from 'next/navigation'
import { getAuthedUser } from '@/lib/auth'
import { isPlatformAdmin } from '@/lib/platform-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  resolvePeriodStart,
  aggregateByStore,
  sumUsage,
  USD_BRL,
  type Periodo,
  type UsageRow,
  type StoreCounts,
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
const brl = (usd: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(usd * USD_BRL)
const usdFmt = (usd: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(usd)
const pct = (f: number) => `${Math.round(f * 100)}%`
const dataBr = (d: string) => d.split('-').reverse().join('/')

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
  const [usageRes, storesRes, ativRes] = await Promise.all([
    admin
      .from('ai_usage_daily')
      .select('store_id, day, model, prompt_tokens, completion_tokens, total_tokens, cached_tokens, calls')
      .gte('day', start),
    admin.from('store_settings').select('id, store_name'),
    admin.rpc('painel_atividade_ia', { p_inicio: start }),
  ])

  const rows: UsageRow[] = usageRes.data ?? []
  const names = new Map(
    (storesRes.data ?? []).map((s) => [s.id, s.store_name] as const),
  )
  const counts = new Map<string, StoreCounts>(
    (ativRes.data ?? []).map((a: { store_id: string; ia_mensagens: number; atendimentos: number }) => [
      a.store_id,
      { iaMessages: Number(a.ia_mensagens), attendances: Number(a.atendimentos) },
    ]),
  )
  const porLoja = aggregateByStore(rows, names, counts)
  const totais = sumUsage(porLoja)
  const erro = Boolean(usageRes.error || storesRes.error || ativRes.error)

  // O custo só cobre os dias com registro de uso (logging começou recentemente).
  // Se o uso mais antigo do período for depois do início do período, o custo é
  // parcial — avisamos, porque atendimentos/mensagens vão mais pra trás.
  const usageDays = (usageRes.data ?? []).map((r) => r.day as string)
  const costSince = usageDays.length ? usageDays.reduce((m, d) => (d < m ? d : m)) : null
  const custoParcial = Boolean(costSince && costSince > start)

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 md:py-8">
      <PageHeader
        title="Admin · Plataforma"
        subtitle="Custo e consumo da IA por loja"
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
              label={`Custo · ${LABEL[periodo]}`}
              value={brl(totais.costUsd)}
              hint={usdFmt(totais.costUsd)}
              tone="brand"
              emphasis="value"
              icon={<Icon name="receipt" className="h-4 w-4" />}
            />
            <StatCard
              label="Atendimentos"
              value={fmt(totais.attendances)}
              tone="info"
              icon={<Icon name="msgSq" className="h-4 w-4" />}
            />
            <StatCard
              label="Mensagens IA"
              value={fmt(totais.iaMessages)}
              tone="neutral"
              hint={`${fmt(totais.calls)} chamadas`}
              icon={<Icon name="ai" className="h-4 w-4" />}
            />
            <StatCard
              label="Cacheado"
              value={pct(totais.cachedPct)}
              tone="success"
              hint={`${fmt(totais.total)} tokens`}
              icon={<Icon name="sparkle" className="h-4 w-4" />}
            />
          </div>

          {custoParcial && costSince ? (
            <p className="mt-3 text-xs text-slate-500">
              O custo cobre só os dias com registro de uso (desde {dataBr(costSince)}).
              Atendimentos e mensagens podem incluir conversas anteriores a essa data.
            </p>
          ) : null}

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
                      <th className="px-5 py-3 text-right">Atend.</th>
                      <th className="px-5 py-3 text-right">Msgs IA</th>
                      <th className="px-5 py-3 text-right">Tokens</th>
                      <th className="px-5 py-3 text-right">% cache</th>
                      <th className="px-5 py-3 text-right">Custo (R$)</th>
                      <th className="px-5 py-3 text-right">R$/atend.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {porLoja.map((s) => (
                      <tr key={s.storeId} className="hover:bg-slate-50/60">
                        <td className="px-5 py-3 font-medium text-slate-900">{s.storeName}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-slate-600">{fmt(s.attendances)}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-slate-600">{fmt(s.iaMessages)}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-slate-600">{fmt(s.total)}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-slate-600">{pct(s.cachedPct)}</td>
                        <td className="px-5 py-3 text-right tabular-nums font-semibold text-slate-900">{brl(s.costUsd)}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-slate-600">{brl(s.costPerAttendanceUsd)}</td>
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
