import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncInventoryFromUrl } from '@/lib/inventory/sync'

interface StoreResult {
  store_id: string
  status: 'ok' | 'error'
  imported?: number
  updated?: number
  error?: string
}

// POST /api/inventory/cron-sync
//
// Roda o sync de catálogo pra todas as lojas com inventory_source_url salvo.
// Acionado pelo n8n (Schedule Trigger), autenticado via header
// `Authorization: Bearer ${INVENTORY_CRON_SECRET}`.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const expected = process.env.INVENTORY_CRON_SECRET
  if (!expected) {
    return NextResponse.json(
      { error: 'INVENTORY_CRON_SECRET not configured on server.' },
      { status: 500 },
    )
  }

  const auth = request.headers.get('authorization') ?? ''
  const provided = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  if (provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const supabase = createAdminClient()

  const { data: stores, error: selectError } = await supabase
    .from('store_settings')
    .select('id, inventory_source_url')
    .not('inventory_source_url', 'is', null)

  if (selectError) {
    return NextResponse.json(
      { error: `Failed to list stores: ${selectError.message}` },
      { status: 500 },
    )
  }

  const results: StoreResult[] = []
  let succeeded = 0
  let failed = 0

  for (const store of stores ?? []) {
    const url = store.inventory_source_url
    if (!url) continue

    try {
      const r = await syncInventoryFromUrl(store.id, url)

      await supabase
        .from('store_settings')
        .update({
          inventory_last_synced_at: new Date().toISOString(),
          inventory_last_error: null,
        })
        .eq('id', store.id)

      results.push({
        store_id: store.id,
        status: 'ok',
        imported: r.imported,
        updated: r.updated,
      })
      succeeded++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)

      await supabase
        .from('store_settings')
        .update({ inventory_last_error: message })
        .eq('id', store.id)

      results.push({ store_id: store.id, status: 'error', error: message })
      failed++
    }
  }

  return NextResponse.json(
    {
      total_stores: results.length,
      succeeded,
      failed,
      results,
    },
    { status: 200 },
  )
}
