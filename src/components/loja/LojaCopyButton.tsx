'use client'

import { useState } from 'react'
import { Icon } from '@/components/painel/Icons'

export function LojaCopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      // ignore
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="btn btn-secondary"
      style={{ padding: '6px 10px', fontSize: 11.5 }}
    >
      <Icon name="copy" className="w-3.5 h-3.5" />
      {copied ? 'Copiado!' : 'Copiar'}
    </button>
  )
}
