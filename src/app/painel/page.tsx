import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPainelPulse, getFunnel, getActivityFeed } from '@/actions/painel'
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

  const [initialPulse, initialFunnel, initialActivity, storeRes] =
    await Promise.all([
      getPainelPulse(),
      getFunnel('month'),
      getActivityFeed(),
      supabase
        .from('store_settings')
        .select('store_name')
        .eq('id', user.id)
        .maybeSingle(),
    ])
  if (storeRes.error) {
    console.error('painel store_settings error', storeRes.error)
  }
  const ownerName = storeRes.data?.store_name ?? ''
  const now = new Date()

  return (
    <PainelDashboard
      storeId={user.id}
      initialPulse={initialPulse}
      initialFunnel={initialFunnel}
      initialActivity={initialActivity}
      ownerName={ownerName}
      dateLabel={formatPainelDate(now)}
      greeting={painelGreeting(now)}
      initialClock={formatPainelClock(now)}
    />
  )
}
