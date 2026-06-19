import { getStoreContext } from '@/lib/active-store'
import { createClient } from '@/lib/supabase/server'
import { exitStore } from '@/actions/impersonation'

// Faixa fixa exibida só quando o admin está impersonando uma loja.
// Server component: retorna null no fluxo normal (zero impacto).
export async function ImpersonationBanner() {
  const ctx = await getStoreContext()
  if (!ctx?.impersonating) return null

  const supabase = await createClient()
  const { data } = await supabase
    .from('store_settings')
    .select('store_name')
    .eq('id', ctx.storeId)
    .maybeSingle()
  const nome = data?.store_name ?? 'loja'

  return (
    <div className="sticky top-0 z-50 flex items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950">
      <span>
        Você está operando como <strong>{nome}</strong> (modo admin)
      </span>
      <form action={exitStore}>
        <button
          type="submit"
          className="rounded-lg bg-amber-950/10 px-3 py-1 text-xs font-semibold text-amber-950 hover:bg-amber-950/20"
        >
          Sair
        </button>
      </form>
    </div>
  )
}
