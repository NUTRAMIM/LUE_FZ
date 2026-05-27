import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthedUser } from '@/lib/auth'
import { syncInventoryFromUrl } from '@/lib/inventory/sync'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthedUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  let body: { url?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const { url } = body
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return NextResponse.json(
      { error: 'Missing required field: url (string).' },
      { status: 400 }
    )
  }

  let result
  try {
    result = await syncInventoryFromUrl(user.id, url)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 400 })
  }

  // Persiste URL pra que o cron consiga reusar
  const supabase = createAdminClient()
  await supabase
    .from('store_settings')
    .update({
      inventory_source_url: url.trim(),
      inventory_last_synced_at: new Date().toISOString(),
      inventory_last_error: null,
    })
    .eq('id', user.id)

  return NextResponse.json(result, { status: 200 })
}
