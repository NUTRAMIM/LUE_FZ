'use client'

import { useEffect, useState } from 'react'
import type {
  PainelPulse,
  FunnelData,
  ActivityEvent,
  KnowledgeGap,
  ProductIntent,
} from '@/actions/painel'
import { getFunnel } from '@/actions/painel'
import type { FunnelRange } from './formatters'
import { formatPainelClock } from './formatters'
import {
  useVisitorsPresence,
  usePainelPulse,
  usePainelActivity,
} from '@/lib/realtime-painel'
import { Topbar } from './Topbar'
import { Hero } from './Hero'
import { PulseStripe } from './PulseStripe'
import { FunilCaptura } from './FunilCaptura'
import { GapsConhecimento } from './GapsConhecimento'
import { IntentCatalogo } from './IntentCatalogo'
import { LivePulse } from './LivePulse'

export function PainelDashboard({
  storeId,
  initialPulse,
  initialFunnel,
  initialActivity,
  initialGaps,
  initialGapsTotal,
  initialIntent,
  initialIntentTotalProducts,
  initialIntentWithIssues,
  ownerName,
  dateLabel,
  greeting,
  initialClock,
}: {
  storeId: string
  initialPulse: PainelPulse
  initialFunnel: FunnelData
  initialActivity: ActivityEvent[]
  initialGaps: KnowledgeGap[]
  initialGapsTotal: number
  initialIntent: ProductIntent[]
  initialIntentTotalProducts: number
  initialIntentWithIssues: number
  ownerName: string
  dateLabel: string
  greeting: string
  initialClock: string
}) {
  const pulse = usePainelPulse(storeId, initialPulse)
  const visitors = useVisitorsPresence(storeId)
  const activity = usePainelActivity(storeId, initialActivity)

  const [range, setRange] = useState<FunnelRange>('month')
  const [funnel, setFunnel] = useState(initialFunnel)
  const [clock, setClock] = useState(initialClock)

  useEffect(() => {
    const id = setInterval(() => {
      setClock(formatPainelClock(new Date()))
    }, 60_000)
    return () => clearInterval(id)
  }, [])

  const handleRangeChange = (r: FunnelRange) => {
    setRange(r)
    getFunnel(r)
      .then(setFunnel)
      .catch((err) => console.error('getFunnel failed', err))
  }

  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-6 md:px-8 py-5 md:py-7">
      <Topbar dateLabel={dateLabel} />
      <Hero
        pulse={pulse}
        greeting={greeting}
        clock={clock}
        activity={activity}
        ownerName={ownerName}
      />
      <PulseStripe pulse={pulse} visitors={visitors} />

      <section className="mt-10">
        <FunilCaptura
          funnel={funnel}
          range={range}
          onRangeChange={handleRangeChange}
        />
      </section>

      <section className="mt-6">
        <GapsConhecimento
          gaps={initialGaps}
          totalPending={initialGapsTotal}
        />
      </section>

      <section className="mt-6">
        <IntentCatalogo
          items={initialIntent}
          totalProducts={initialIntentTotalProducts}
          withIssues={initialIntentWithIssues}
        />
      </section>

      <LivePulse pulse={pulse} visitors={visitors} />
    </div>
  )
}
