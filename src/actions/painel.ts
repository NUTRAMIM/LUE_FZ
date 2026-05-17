'use server'

import { createClient } from '@/lib/supabase/server'
import { rangeStart } from '@/components/painel/formatters'

export interface PainelPulse {
  leadsWeek: number
  leadsToday: number
  awaitingContact: number
  stale1h: number
  activeAiSessions: number
  sessionsToday: number
}

const EMPTY_PULSE: PainelPulse = {
  leadsWeek: 0,
  leadsToday: 0,
  awaitingContact: 0,
  stale1h: 0,
  activeAiSessions: 0,
  sessionsToday: 0,
}

export async function getPainelPulse(): Promise<PainelPulse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return EMPTY_PULSE

  const store = user.id
  const now = new Date()
  const dayStart = rangeStart(now, 'day').toISOString()
  const weekStart = rangeStart(now, 'week').toISOString()
  const oneHourAgo = new Date(now.getTime() - 3_600_000).toISOString()
  const fiveMinAgo = new Date(now.getTime() - 300_000).toISOString()

  const [leadsWeek, leadsToday, awaiting, stale, activeAi, sessionsToday] =
    await Promise.all([
      supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', store)
        .gte('created_at', weekStart),
      supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', store)
        .gte('created_at', dayStart),
      supabase
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', store)
        .eq('status', 'ai_active')
        .is('assigned_to', null)
        .not('lead_id', 'is', null),
      supabase
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', store)
        .eq('status', 'ai_active')
        .is('assigned_to', null)
        .not('lead_id', 'is', null)
        .lt('last_message_at', oneHourAgo),
      supabase
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', store)
        .eq('status', 'ai_active')
        .gte('last_message_at', fiveMinAgo),
      supabase
        .from('conversations')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', store)
        .gte('created_at', dayStart),
    ])

  return {
    leadsWeek: leadsWeek.count ?? 0,
    leadsToday: leadsToday.count ?? 0,
    awaitingContact: awaiting.count ?? 0,
    stale1h: stale.count ?? 0,
    activeAiSessions: activeAi.count ?? 0,
    sessionsToday: sessionsToday.count ?? 0,
  }
}
