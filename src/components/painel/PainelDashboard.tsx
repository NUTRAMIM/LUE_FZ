'use client'

import { useEffect, useState } from 'react'
import type { PainelPulse, FunnelData } from '@/actions/painel'
import { getFunnel } from '@/actions/painel'
import type { FunnelRange } from './formatters'
import { formatPainelClock } from './formatters'
import { useVisitorsPresence, usePainelPulse } from '@/lib/realtime-painel'
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
  dateLabel,
  greeting,
  initialClock,
}: {
  storeId: string
  initialPulse: PainelPulse
  initialFunnel: FunnelData
  dateLabel: string
  greeting: string
  initialClock: string
}) {
  const pulse = usePainelPulse(storeId, initialPulse)
  const visitors = useVisitorsPresence(storeId)

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
    getFunnel(r).then(setFunnel)
  }

  return (
    <div className="max-w-[1280px] mx-auto px-8 py-7">
      <Topbar dateLabel={dateLabel} />
      <Hero pulse={pulse} greeting={greeting} clock={clock} />
      <PulseStripe pulse={pulse} visitors={visitors} />

      <section className="mt-10">
        <FunilCaptura
          funnel={funnel}
          range={range}
          onRangeChange={handleRangeChange}
        />
      </section>

      <section className="mt-6">
        <GapsConhecimento />
      </section>

      <section className="mt-6">
        <IntentCatalogo />
      </section>

      <LivePulse pulse={pulse} visitors={visitors} />
    </div>
  )
}
