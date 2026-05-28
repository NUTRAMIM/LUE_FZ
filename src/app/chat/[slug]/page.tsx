import { ensureConversation } from '@/actions/chat'
import { ChatClient } from './ChatClient'

export const dynamic = 'force-dynamic'

export default async function ChatPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const bootstrap = await ensureConversation(slug)

  return (
    <ChatClient
      slug={slug}
      storeId={bootstrap.storeId}
      conversationId={bootstrap.conversationId}
      storeName={bootstrap.storeName}
      storeLogoUrl={bootstrap.storeLogoUrl}
      initialMessages={bootstrap.messages}
    />
  )
}
