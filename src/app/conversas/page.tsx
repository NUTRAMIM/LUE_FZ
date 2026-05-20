import { redirect } from 'next/navigation'
import { getAuthedUser } from '@/lib/auth'
import { getConversations } from '@/actions/conversas'
import { ConversasView } from '@/components/conversas/ConversasView'

export const dynamic = 'force-dynamic'

export default async function ConversasPage() {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const initialActive = await getConversations('active')

  return <ConversasView storeId={user.id} initialActive={initialActive} />
}
