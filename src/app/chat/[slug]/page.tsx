import { getChatStore } from '@/actions/chat'
import { ChatClient } from './ChatClient'

export const dynamic = 'force-dynamic'

export default async function ChatPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const store = await getChatStore(slug)

  return (
    <ChatClient
      slug={slug}
      storeId={store.storeId}
      storeName={store.storeName}
      storeLogoUrl={store.storeLogoUrl}
    />
  )
}
