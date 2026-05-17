'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getPainelPulse, type PainelPulse } from '@/actions/painel'

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

// Mantém o pulse atualizado: a cada evento em `conversations` da loja, refaz
// getPainelPulse com debounce de 2s. `leads` não está na publicação realtime,
// mas a captura de lead seta conversations.lead_id (UPDATE), que dispara aqui.
export function usePainelPulse(
  storeId: string,
  initial: PainelPulse,
): PainelPulse {
  const [pulse, setPulse] = useState(initial)

  useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null

    const refresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        getPainelPulse().then(setPulse)
      }, 2000)
    }

    const channel = supabase
      .channel(`painel-pulse:${storeId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `store_id=eq.${storeId}`,
        },
        refresh,
      )
      .subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [storeId])

  return pulse
}
