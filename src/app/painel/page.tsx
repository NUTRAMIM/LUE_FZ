import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPainelPulse, getFunnel } from '@/actions/painel'
import {
  formatPainelDate,
  formatPainelClock,
  painelGreeting,
} from '@/components/painel/formatters'
import { PainelDashboard } from '@/components/painel/PainelDashboard'

export const dynamic = 'force-dynamic'

export default async function PainelPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [initialPulse, initialFunnel] = await Promise.all([
    getPainelPulse(),
    getFunnel('month'),
  ])
  const now = new Date()

  return (
    <PainelDashboard
      storeId={user.id}
      initialPulse={initialPulse}
      initialFunnel={initialFunnel}
      dateLabel={formatPainelDate(now)}
      greeting={painelGreeting(now)}
      initialClock={formatPainelClock(now)}
    />
  )
}
