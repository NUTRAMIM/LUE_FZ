import { createClient } from '@/lib/supabase/server'
import { BrandHero } from '@/components/ui/BrandHero'
import { StatCard } from '@/components/ui/StatCard'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  IconArrowRight,
  IconDollar,
  IconCart,
  IconUsers,
  IconAlert,
  IconClock,
  IconPackage,
  IconMessage,
  IconSparkles,
} from '@/components/icons'

export const dynamic = 'force-dynamic'

const FUNNEL_STAGES = [
  { dot: 'bg-brand-500', label: 'Novo Lead', count: 0 },
  { dot: 'bg-info', label: 'Em Atendimento', count: 0 },
  { dot: 'bg-warning', label: 'Proposta Enviada', count: 0 },
  { dot: 'bg-success', label: 'Negociação', count: 0 },
  { dot: 'bg-fuchsia-500', label: 'Aguardando Pagamento', count: 0 },
]

const FILA = [
  { label: 'Aguardando', value: 0, tone: 'warning' as const },
  { label: 'Atendendo', value: 0, tone: 'info' as const },
  { label: 'Sem Atendente', value: 0, tone: 'success' as const },
  { label: 'Atrasadas (SLA)', value: 0, tone: 'danger' as const },
]

export default async function PainelPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const handle = user?.email?.split('@')[0]?.split('.')[0] ?? 'Operador'
  const greeting = handle.charAt(0).toUpperCase() + handle.slice(1)

  return (
    <div className="space-y-6 p-6 md:p-8">
      <BrandHero
        eyebrow="Dashboard Estratégico"
        title={`Bem-vindo, ${greeting}`}
        subtitle="Acompanhe sua operação em tempo real."
        action={
          <Button
            variant="secondary"
            className="border-white/25 bg-white/10 text-white hover:bg-white/20"
          >
            Abrir CRM
            <IconArrowRight className="h-4 w-4" />
          </Button>
        }
      />

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <IconSparkles className="h-4 w-4" />
            </span>
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Minha Fila Hoje
            </h2>
          </div>
          <a
            href="/painel"
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 transition-colors hover:text-brand-700"
          >
            Abrir Inbox <IconArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {FILA.map((cell) => (
            <FilaCell key={cell.label} {...cell} />
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          label="Receita do Mês"
          value="R$ 0,00"
          hint="0 pedidos no mês"
          tone="success"
          icon={<IconDollar className="h-5 w-5" />}
        />
        <StatCard
          label="Ticket Médio"
          value="R$ 0,00"
          hint="Valor médio por pedido entregue"
          tone="info"
          icon={<IconCart className="h-5 w-5" />}
        />
        <StatCard
          label="Leads Novos"
          value="0"
          hint="Novos leads este mês"
          tone="brand"
          icon={<IconUsers className="h-5 w-5" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          label="Leads Sem Resposta"
          value="0"
          hint="Sem contato há mais de 48h"
          tone="warning"
          emphasis="value"
          icon={<IconAlert className="h-5 w-5" />}
        />
        <StatCard
          label="Tempo Médio de Resposta"
          value="N/A"
          hint="Conversas aguardando"
          tone="info"
          icon={<IconClock className="h-5 w-5" />}
        />
        <StatCard
          label="Estoque Crítico"
          value="0"
          hint="Produtos abaixo do mínimo"
          tone="danger"
          emphasis="value"
          icon={<IconPackage className="h-5 w-5" />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Funil por Estágio
            </h3>
          </div>
          <ul className="space-y-1.5">
            {FUNNEL_STAGES.map((stage) => (
              <li
                key={stage.label}
                className="flex items-center justify-between rounded-lg px-3 py-2 transition-colors hover:bg-slate-50"
              >
                <div className="flex items-center gap-2.5">
                  <span className={`h-2 w-2 rounded-full ${stage.dot}`} />
                  <span className="text-sm text-slate-700">{stage.label}</span>
                </div>
                <span className="font-mono text-sm font-semibold tabular-nums text-slate-900">
                  {stage.count}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-6">
          <h3 className="mb-4 font-display text-sm font-semibold text-slate-900">
            Conversas Recentes
          </h3>
          <EmptyState
            icon={<IconMessage className="h-5 w-5" />}
            title="Nenhuma conversa ainda"
            description="As conversas aparecerão aqui quando visitantes usarem o widget de chat."
          />
        </Card>
      </div>
    </div>
  )
}

function FilaCell({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'success' | 'warning' | 'info' | 'danger'
}) {
  const toneCls = {
    success: 'text-success',
    warning: 'text-warning',
    info: 'text-info',
    danger: 'text-danger',
  }[tone]
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3 text-center">
      <p className={`font-display text-2xl font-bold tabular-nums ${toneCls}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
    </div>
  )
}
