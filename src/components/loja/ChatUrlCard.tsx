import { createClient } from '@/lib/supabase/server'
import { CopyButton } from './CopyButton'

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

  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
  const url = `${base}/chat/${data.chat_slug}`

  return (
    <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900">
        <span aria-hidden>💬</span> URL do seu chat
      </h3>
      <div className="mb-3 flex gap-2">
        <input
          readOnly
          value={url}
          className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-mono"
        />
        <CopyButton value={url} />
      </div>
      <p className="text-xs text-gray-600">
        Compartilhe este link com seus clientes para iniciarem uma conversa
        com o atendimento da sua loja.
      </p>
    </div>
  )
}
