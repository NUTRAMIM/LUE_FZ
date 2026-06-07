import { redirect } from 'next/navigation'
import { getAuthedUser } from '@/lib/auth'
import { getConversations, type ConversationRow } from '@/actions/conversas'
import { ConversasView } from '@/components/conversas/ConversasView'

export const dynamic = 'force-dynamic'

export default async function ConversasPage(props: PageProps<'/conversas'>) {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const sp = await props.searchParams
  const target = typeof sp.c === 'string' ? sp.c : null

  const initialActive = await getConversations('active')

  // Deep-link vindo do menu de leads (?c=<conversationId>): se a conversa alvo
  // não estiver entre as ativas, carrega também as encerradas pra conseguir
  // exibi-la já selecionada na chegada.
  let initialClosed: ConversationRow[] = []
  if (target && !initialActive.some((c) => c.id === target)) {
    initialClosed = await getConversations('closed')
  }

  const initialSelectedId = target ?? initialActive[0]?.id ?? null

  return (
    <ConversasView
      storeId={user.id}
      initialActive={initialActive}
      initialClosed={initialClosed}
      initialSelectedId={initialSelectedId}
    />
  )
}
