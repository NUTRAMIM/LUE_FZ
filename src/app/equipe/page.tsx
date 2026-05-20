import { redirect } from 'next/navigation'
import { getAuthedUser } from '@/lib/auth'
import { getStoreRole } from '@/lib/store-role'
import { listStoreMembers } from '@/actions/equipe'
import { EquipeView } from '@/components/equipe/EquipeView'

export const dynamic = 'force-dynamic'

export default async function EquipePage() {
  const user = await getAuthedUser()
  if (!user) redirect('/login')
  if ((await getStoreRole()) !== 'owner') redirect('/leads')

  const members = await listStoreMembers()
  return <EquipeView members={members} />
}
