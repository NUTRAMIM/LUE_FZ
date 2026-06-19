'use server'

import { revalidatePath } from 'next/cache'
import { getAuthedUser } from '@/lib/auth'
import { isPlatformAdmin } from '@/lib/platform-admin'
import { createAdminClient } from '@/lib/supabase/admin'

// Super-admin libera (acesso comp) ou revoga a assinatura de uma loja.
// Escrita via service-role (mesmo padrão dos webhooks). Gate fail-closed.
export async function setStoreSubscription(storeId: string, action: 'grant' | 'revoke') {
  const user = await getAuthedUser()
  if (!user || !isPlatformAdmin(user)) return

  const admin = createAdminClient()
  const now = new Date().toISOString()

  if (action === 'grant') {
    // Acesso comp perpétuo (current_period_end null => sempre ativo no gating).
    await admin.from('store_subscriptions').upsert(
      {
        store_id: storeId,
        plan_id: 'pro',
        provider: 'manual',
        status: 'active',
        current_period_end: null,
        cancel_at_period_end: false,
        updated_at: now,
      },
      { onConflict: 'store_id' },
    )
  } else {
    await admin
      .from('store_subscriptions')
      .update({ status: 'canceled', updated_at: now })
      .eq('store_id', storeId)
  }

  revalidatePath('/painel/_internal')
}
