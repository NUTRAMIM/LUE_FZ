'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

// Observa o Presence channel da loja e devolve quantos visitantes estão
// com o chat público aberto agora. Não se registra no channel — só conta.
export function useVisitorsPresence(storeId: string): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase.channel(`store:${storeId}:visitors`)

    channel
      .on('presence', { event: 'sync' }, () => {
        setCount(Object.keys(channel.presenceState()).length)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [storeId])

  return count
}
