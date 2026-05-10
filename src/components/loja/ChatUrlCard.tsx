import { createClient } from '@/lib/supabase/server'
import { ChatUrlBox } from './ChatUrlBox'

export async function ChatUrlCard() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('store_settings')
    .select('chat_slug')
    .eq('id', user.id)
    .maybeSingle()

  if (!data?.chat_slug) {
    return (
      <div className="mb-6 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
        <p className="text-sm text-gray-600">
          Salve as configurações da loja para gerar a URL do seu chat.
        </p>
      </div>
    )
  }

  const envBase = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? null

  return (
    <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900">
        <span aria-hidden>💬</span> URL do seu chat
      </h3>
      <ChatUrlBox slug={data.chat_slug} envBase={envBase} />
    </div>
  )
}
