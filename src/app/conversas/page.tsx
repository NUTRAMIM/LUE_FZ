import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getConversations } from '@/actions/conversas'
import { ConversasView } from '@/components/conversas/ConversasView'

export const dynamic = 'force-dynamic'

export default async function ConversasPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const initialActive = await getConversations('active')

  return <ConversasView storeId={user.id} initialActive={initialActive} />
}
