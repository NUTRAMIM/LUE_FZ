import { redirect } from 'next/navigation'
import { getAuthedUser } from '@/lib/auth'
import { getLeads } from '@/actions/leads'
import { LeadsView } from '@/components/leads/LeadsView'

export const dynamic = 'force-dynamic'

export default async function LeadsPage() {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const leads = await getLeads()
  return <LeadsView leads={leads} />
}
