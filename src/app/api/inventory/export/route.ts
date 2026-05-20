import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'
import type { Product } from '@/types/product'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const user = await getAuthedUser()

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('name', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const products = data as Product[]

  const exported = {
    exported_at: new Date().toISOString(),
    total: products.length,
    produtos: products.map((p) => {
      const attrs = p.attributes as Record<string, unknown> | null
      return {
        id: p.sku,
        nome: p.name,
        descricao: p.description,
        categorias: (attrs?.categorias as unknown[]) || [],
        link: (attrs?.link as string) || null,
        preco: Number(p.compare_at_price) || Number(p.price),
        preco_promocional: p.compare_at_price && Number(p.compare_at_price) !== Number(p.price)
          ? Number(p.price)
          : null,
        imagens: p.image_urls || [],
        controlar_estoque: (attrs?.controlar_estoque as boolean) ?? false,
        estoque: p.stock_quantity,
        variacoes: p.variants || null,
      }
    }),
  }

  const today = new Date().toISOString().split('T')[0]

  return new NextResponse(JSON.stringify(exported, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="estoque-${today}.json"`,
    },
  })
}
