import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStoreContext } from '@/lib/active-store'
import { syncInventoryFromUrl } from '@/lib/inventory/sync'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ctx = await getStoreContext()
  if (!ctx) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }
  // Só o dono importa o catálogo. Antes usava-se user.id como store_id, o que,
  // para um vendedor (agent), gravava produtos numa "loja fantasma" (user.id !=
  // store_id da loja). Agora usa o store_id real e exige o papel de owner.
  if (ctx.role !== 'owner') {
    return NextResponse.json(
      { error: 'Apenas o dono da loja pode importar o catálogo.' },
      { status: 403 },
    )
  }
  const storeId = ctx.storeId

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
    result = await syncInventoryFromUrl(storeId, url)
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
    .eq('id', storeId)

  return NextResponse.json(result, { status: 200 })
}
