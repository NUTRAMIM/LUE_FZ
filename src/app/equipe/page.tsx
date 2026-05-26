import { redirect } from 'next/navigation'
import { getAuthedUser } from '@/lib/auth'
import { getStoreRole } from '@/lib/store-role'
import { listEquipeData } from '@/actions/equipe'
import { EquipeView } from '@/components/equipe/EquipeView'

export const dynamic = 'force-dynamic'

export default async function EquipePage() {
  const user = await getAuthedUser()
  if (!user) redirect('/login')
  if ((await getStoreRole()) !== 'owner') redirect('/conversas')

  const data = await listEquipeData()
  return <EquipeView data={data} />
}
