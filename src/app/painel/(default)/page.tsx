import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'
import {
  getPainelPulse,
  getFunnel,
  getActivityFeed,
  getKnowledgeGaps,
  getProductIntent,
} from '@/actions/painel'
import {
  formatPainelDate,
  formatPainelClock,
  painelGreeting,
} from '@/components/painel/formatters'
import { PainelDashboard } from '@/components/painel/PainelDashboard'

export const dynamic = 'force-dynamic'

export default async function PainelPage() {
  const supabase = await createClient()
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const [
    initialPulse,
    initialFunnel,
    initialActivity,
    gapsRes,
    intentRes,
    storeRes,
  ] = await Promise.all([
    getPainelPulse(),
    getFunnel('month'),
    getActivityFeed(),
    getKnowledgeGaps(),
    getProductIntent('month'),
    supabase
      .from('store_settings')
      .select('store_name')
      .eq('id', user.id)
      .maybeSingle(),
  ])
  const ownerName = storeRes.data?.store_name ?? ''
  const now = new Date()

  return (
    <PainelDashboard
      storeId={user.id}
      initialPulse={initialPulse}
      initialFunnel={initialFunnel}
      initialActivity={initialActivity}
      initialGaps={gapsRes.items}
      initialGapsTotal={gapsRes.totalPending}
      initialIntent={intentRes.items}
      initialIntentTotalProducts={intentRes.totalProducts}
      initialIntentWithIssues={intentRes.withIssues}
      ownerName={ownerName}
      dateLabel={formatPainelDate(now)}
      greeting={painelGreeting(now)}
      initialClock={formatPainelClock(now)}
    />
  )
}
