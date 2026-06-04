'use client'

import { useEffect, useState } from 'react'
import { formatRelativeTime } from './formatters'

// O tempo relativo depende do relógio do cliente; renderizá-lo no SSR diverge
// do client e quebra a hidratação (React #418). Só renderiza após montar.
export function RelativeTime({ iso }: { iso: string | null | undefined }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return <>{mounted ? formatRelativeTime(iso) : ''}</>
}
