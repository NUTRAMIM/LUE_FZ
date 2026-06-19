import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'
import { getActiveStoreId } from '@/lib/active-store'
import { getStoreRole } from '@/lib/store-role'
import type { Product } from '@/types/product'
import { PageHeader } from '@/components/ui/PageHeader'
import { EstoqueClient } from './EstoqueClient'

export const dynamic = 'force-dynamic'

export default async function EstoquePage() {
  const supabase = await createClient()

  const user = await getAuthedUser()
  if (!user) redirect('/login')
  if ((await getStoreRole()) !== 'owner') redirect('/conversas')

  const storeId = await getActiveStoreId()
  if (!storeId) redirect('/login')

  // F1.1: projeção explícita; colunas pesadas (description, variants,
  // attributes) ficam pro fetch lazy via getProductDetails quando um drawer
  // abre.
  const [{ data: productsData, error: productsError }, { data: settings }] = await Promise.all([
    supabase
      .from('products')
      .select(
        'id, sku, name, category, brand, price, compare_at_price, stock_quantity, stock_min, image_urls, tamanhos, cores',
      )
      .order('name', { ascending: true }),
    supabase
      .from('store_settings')
      .select('default_stock_min')
      .eq('id', storeId)
      .maybeSingle(),
  ])

  const products = (productsData ?? []) as Product[]
  const defaultStockMin = settings?.default_stock_min ?? 5

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Controle de Estoque"
        subtitle="Gerencie o estoque de todos os produtos"
      />

      {productsError && (
        <div className="mb-4 rounded-xl border border-danger/20 bg-danger-soft p-4 text-sm text-danger">
          Erro ao carregar produtos: {productsError.message}
        </div>
      )}

      <EstoqueClient
        products={products}
        defaultStockMin={defaultStockMin}
      />
    </div>
  )
}
