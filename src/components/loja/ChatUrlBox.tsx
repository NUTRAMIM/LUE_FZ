'use client'

import { useEffect, useState } from 'react'
import { CopyButton } from './CopyButton'
import { QRCodeDialog } from './QRCodeDialog'

export function ChatUrlBox({
  slug,
  envBase,
}: {
  slug: string
  envBase: string | null
}) {
  const [url, setUrl] = useState(envBase ? `${envBase}/chat/${slug}` : '')

  useEffect(() => {
    if (!envBase && typeof window !== 'undefined') {
      setUrl(`${window.location.origin}/chat/${slug}`)
    }
  }, [slug, envBase])

  return (
    <>
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
      <QRCodeDialog value={url} />
    </>
  )
}
