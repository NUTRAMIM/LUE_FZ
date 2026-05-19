import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreRole } from '@/lib/store-role'
import { listStoreMembers } from '@/actions/equipe'
import { EquipeView } from '@/components/equipe/EquipeView'

export const dynamic = 'force-dynamic'

export default async function EquipePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if ((await getStoreRole()) !== 'owner') redirect('/conversas')

  const members = await listStoreMembers()
  return <EquipeView members={members} />
}
