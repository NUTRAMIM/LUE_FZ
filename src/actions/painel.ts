'use server'

import { createClient } from '@/lib/supabase/server'
import { rangeStart, shortRef } from '@/components/painel/formatters'
import type { FunnelRange } from '@/components/painel/formatters'

export interface PainelPulse {
  leadsWeek: number
  leadsToday: number
  awaitingContact: number
  stale1h: number
  activeAiSessions: number
  sessionsToday: number
  aiLatencyP95Ms: number
}

const EMPTY_PULSE: PainelPulse = {
  leadsWeek: 0,
  leadsToday: 0,
  awaitingContact: 0,
  stale1h: 0,
  activeAiSessions: 0,
  sessionsToday: 0,
  aiLatencyP95Ms: 0,
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
  // "sessão IA ativa" = conversa com atividade da IA nos últimos 5 minutos
  const fiveMinAgo = new Date(now.getTime() - 300_000).toISOString()

  const results = await Promise.all([
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc('get_ai_latency_p95', { p_store_id: store }),
  ])
  results.forEach((r, i) => {
    if (r.error) console.error(`getPainelPulse query[${i}] error`, r.error)
  })
  const [
    leadsWeek,
    leadsToday,
    awaiting,
    stale,
    activeAi,
    sessionsToday,
    latency,
  ] = results

  return {
    leadsWeek: leadsWeek.count ?? 0,
    leadsToday: leadsToday.count ?? 0,
    awaitingContact: awaiting.count ?? 0,
    stale1h: stale.count ?? 0,
    activeAiSessions: activeAi.count ?? 0,
    sessionsToday: sessionsToday.count ?? 0,
    aiLatencyP95Ms: Number(latency.data ?? 0),
  }
}

export interface FunnelData {
  uniqueVisits: number
  chatSessions: number
  qualified: number
  leadCaptured: number
  vendorAccepted: number
  closed: number
  cycleDays: number
}

const EMPTY_FUNNEL: FunnelData = {
  uniqueVisits: 0,
  chatSessions: 0,
  qualified: 0,
  leadCaptured: 0,
  vendorAccepted: 0,
  closed: 0,
  cycleDays: 0,
}

export async function getFunnel(range: FunnelRange): Promise<FunnelData> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return EMPTY_FUNNEL

  const store = user.id
  const start = rangeStart(new Date(), range).toISOString()

  // Stages 1 e 2 — conversas criadas no período.
  const convsRes = await supabase
    .from('conversations')
    .select('id, visitor_id')
    .eq('store_id', store)
    .gte('created_at', start)
  if (convsRes.error) {
    console.error('getFunnel conversations error', convsRes.error)
  }

  const convRows = convsRes.data ?? []
  const chatSessions = convRows.length
  const uniqueVisits = new Set(convRows.map((c) => c.visitor_id)).size

  // Stages 3–6 são independentes entre si — rodam em paralelo.
  const [qualified, leadRes, vendorRes, closedRes] = await Promise.all([
    // Stage 3 — conversas com 3 ou mais mensagens.
    (async (): Promise<number> => {
      if (convRows.length === 0) return 0
      // MVP: busca as mensagens e agrega em memória. Onda B troca por RPC.
      const { data: msgs, error } = await supabase
        .from('messages')
        .select('conversation_id')
        .eq('store_id', store)
        .in(
          'conversation_id',
          convRows.map((c) => c.id),
        )
      if (error) console.error('getFunnel messages error', error)
      const perConv = new Map<string, number>()
      for (const m of msgs ?? []) {
        perConv.set(
          m.conversation_id,
          (perConv.get(m.conversation_id) ?? 0) + 1,
        )
      }
      return [...perConv.values()].filter((n) => n >= 3).length
    })(),
    // Stage 4 — leads com WhatsApp confirmado.
    supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', store)
      .not('whatsapp', 'is', null)
      .gte('created_at', start),
    // Stage 5 — proxy: conversas em atendimento humano (Onda B usa
    // conversation_events para histórico preciso).
    supabase
      .from('conversations')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', store)
      .eq('status', 'human_active')
      .gte('updated_at', start),
    // Stage 6 + ciclo — conversas fechadas no período (closed_at, migration 022).
    supabase
      .from('conversations')
      .select('created_at, closed_at')
      .eq('store_id', store)
      .not('closed_at', 'is', null)
      .gte('closed_at', start),
  ])

  if (leadRes.error) console.error('getFunnel leads error', leadRes.error)
  if (vendorRes.error) console.error('getFunnel vendor error', vendorRes.error)
  if (closedRes.error) console.error('getFunnel closed error', closedRes.error)

  const closedRows = closedRes.data ?? []
  const cycleDays =
    closedRows.length === 0
      ? 0
      : closedRows.reduce(
          (sum, c) =>
            sum +
            (new Date(c.closed_at!).getTime() -
              new Date(c.created_at).getTime()),
          0,
        ) /
        closedRows.length /
        86_400_000

  return {
    uniqueVisits,
    chatSessions,
    qualified,
    leadCaptured: leadRes.count ?? 0,
    vendorAccepted: vendorRes.count ?? 0,
    closed: closedRows.length,
    cycleDays: Math.round(cycleDays * 10) / 10,
  }
}

export interface ActivityEvent {
  time: string // ISO timestamp
  identifier: string // "vis_4f1c" | "#2841"
  label: string
  tag: 'CHAT' | 'LEAD'
}

// Ticker "Atividade ao vivo" do Hero: sessões de chat iniciadas e leads
// capturados na última hora, mesclados e ordenados do mais recente ao mais
// antigo. Limitado aos 6 eventos mais recentes.
export async function getActivityFeed(): Promise<ActivityEvent[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const store = user.id
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()

  const [convsRes, leadsRes] = await Promise.all([
    supabase
      .from('conversations')
      .select('id, visitor_id, created_at')
      .eq('store_id', store)
      .gte('created_at', oneHourAgo)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('leads')
      .select('id, created_at')
      .eq('store_id', store)
      .gte('created_at', oneHourAgo)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  if (convsRes.error) {
    console.error('getActivityFeed conversations error', convsRes.error)
  }
  if (leadsRes.error) {
    console.error('getActivityFeed leads error', leadsRes.error)
  }

  const events: ActivityEvent[] = [
    ...(convsRes.data ?? []).map((c) => ({
      time: c.created_at,
      identifier: `vis_${shortRef(c.visitor_id)}`,
      label: 'sessão iniciada',
      tag: 'CHAT' as const,
    })),
    ...(leadsRes.data ?? []).map((l) => ({
      time: l.created_at,
      identifier: `#${shortRef(l.id)}`,
      label: 'lead capturado',
      tag: 'LEAD' as const,
    })),
  ]

  events.sort((a, b) => b.time.localeCompare(a.time))
  return events.slice(0, 6)
}
