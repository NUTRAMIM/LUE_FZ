import { StatCard } from '@/components/ui/StatCard'

export interface KpiData {
  totalProducts: number
  totalUnits: number
  lowStockCount: number
  outOfStockCount: number
  totalValue: number
}

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function KpiSection({ data }: { data: KpiData }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      <StatCard
        label="Total de Produtos"
        value={data.totalProducts}
        tone="brand"
        emphasis="value"
      />
      <StatCard
        label="Total em Estoque"
        value={data.totalUnits}
        hint="unidades"
        tone="info"
        emphasis="value"
      />
      <StatCard
        label="Estoque Baixo"
        value={data.lowStockCount}
        hint="produtos"
        tone="warning"
        emphasis="value"
      />
      <StatCard
        label="Sem Estoque"
        value={data.outOfStockCount}
        hint="produtos"
        tone="danger"
        emphasis="value"
      />
      <StatCard
        label="Valor Total"
        value={formatBRL(data.totalValue)}
        hint="em estoque"
        tone="success"
        emphasis="value"
      />
    </div>
  )
}
