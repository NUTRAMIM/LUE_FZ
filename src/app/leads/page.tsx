import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getLeads } from '@/actions/leads'
import { LeadsView } from '@/components/leads/LeadsView'

export const dynamic = 'force-dynamic'

export default async function LeadsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const leads = await getLeads()
  return <LeadsView leads={leads} />
}
