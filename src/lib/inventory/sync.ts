import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

// ---------------------------------------------------------------------------
// FacilZap shape types
// ---------------------------------------------------------------------------

interface FacilZapCategory {
  id: string
  nome: string
  subcategorias: FacilZapCategory[]
}

interface FacilZapVariation {
  id: string
  nome: string
  preco: number
  preco_promocional: number | null
}

interface FacilZapProduct {
  id: string
  nome: string
  descricao: string | null
  categorias: FacilZapCategory[]
  link: string | null
  preco: number
  preco_promocional: number | null
  imagens: string[]
  controlar_estoque: boolean
  estoque: number | null
  variacoes: FacilZapVariation[] | null
}

interface FacilZapPayload {
  loja?: { nome?: string; url?: string }
  vendedor?: { nome?: string; whatsapp?: string }
  catalogo?: { nome?: string }
  formas_entrega?: unknown[]
  formas_pagamento?: unknown[]
  produtos: FacilZapProduct[]
}

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface ImportResult {
  imported: number
  updated: number
  errors: Array<{ sku: string; error: string }>
  total_in_source: number
  source: {
    loja: { nome: string | null; url: string | null }
    vendedor: { nome: string | null; whatsapp: string | null }
    catalogo: { nome: string | null }
  }
}

// ---------------------------------------------------------------------------
// Variant extraction
// ---------------------------------------------------------------------------

const KNOWN_SIZES = ['PP', 'XP', 'P', 'M', 'G', 'GG', 'GGG', 'XG', 'EXG', 'EXTRAG', 'U', 'UN', 'UNICO', 'ÚNICO']
const KNOWN_SIZES_UP = new Set(KNOWN_SIZES.map(s => s.toUpperCase()))

const COMPOUND_SIZES: Record<string, string> = {
  'EXTRA G': 'EXG',
  'EXTRA GG': 'EXTRAG',
  'EXTRA P': 'EXP',
}

export function extractVariantOptions(
  variacoes: FacilZapVariation[],
): { cores: string[]; tamanhos: string[] } {
  const cores = new Set<string>()
  const tamanhos = new Set<string>()

  for (const v of variacoes) {
    const parts = v.nome.trim().split(/\s+/)
    if (parts.length === 0) continue

    if (parts.length >= 2) {
      const last2 = parts.slice(-2).join(' ').toUpperCase()
      if (last2 in COMPOUND_SIZES) {
        tamanhos.add(COMPOUND_SIZES[last2])
        const cor = parts.slice(0, -2).join(' ')
        if (cor) cores.add(cor)
        continue
      }
    }

    const last = parts[parts.length - 1].toUpperCase()
    if (KNOWN_SIZES_UP.has(last)) {
      tamanhos.add(last)
      const cor = parts.slice(0, -1).join(' ')
      if (cor) cores.add(cor)
    } else {
      cores.add(parts.join(' '))
    }
  }

  return {
    cores: [...cores].sort(),
    tamanhos: [...tamanhos].sort(),
  }
}

// ---------------------------------------------------------------------------
// Mapping helper
// ---------------------------------------------------------------------------

type ProductInsert = Database['public']['Tables']['products']['Insert']

function mapProduct(p: FacilZapProduct, userId: string): ProductInsert {
  const hasPromo =
    p.preco_promocional !== null &&
    p.preco_promocional !== undefined &&
    p.preco_promocional > 0 &&
    p.preco_promocional !== p.preco

  const price = hasPromo ? (p.preco_promocional as number) : p.preco
  const compareAtPrice = hasPromo ? p.preco : null

  const category =
    Array.isArray(p.categorias) && p.categorias.length > 0
      ? p.categorias[0].nome ?? null
      : null

  const opts = p.variacoes?.length
    ? extractVariantOptions(p.variacoes)
    : { cores: [], tamanhos: [] }

  return {
    user_id: userId,
    sku: String(p.id),
    name: p.nome,
    description: p.descricao ?? null,
    price,
    compare_at_price: compareAtPrice,
    currency: 'BRL',
    category,
    brand: null,
    stock_quantity: p.estoque !== null && p.estoque !== undefined ? p.estoque : 0,
    image_urls: Array.isArray(p.imagens) ? p.imagens.slice(0, 3) : [],
    cores: opts.cores,
    tamanhos: opts.tamanhos,
    attributes: JSON.parse(JSON.stringify({
      facilzap_id: p.id,
      link: p.link ?? null,
      controlar_estoque: p.controlar_estoque ?? false,
      categorias: p.categorias ?? [],
    })),
    updated_at: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Main entry: fetch a FacilZap-shaped JSON and upsert products for a store
// ---------------------------------------------------------------------------

export async function syncInventoryFromUrl(
  userId: string,
  url: string,
): Promise<ImportResult> {
  const response = await fetch(url.trim(), {
    headers: {
      Accept: 'application/json',
      // Catálogos FacilZap retornam 500 sem UA de browser
      'User-Agent': 'Mozilla/5.0 (compatible; LueFZ-Inventory-Sync/1.0)',
    },
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    throw new Error(
      `Failed to fetch URL: HTTP ${response.status} ${response.statusText}`,
    )
  }

  const payload = (await response.json()) as FacilZapPayload

  if (!payload || !Array.isArray(payload.produtos)) {
    throw new Error(
      'Unexpected JSON structure: missing "produtos" array at the root level.',
    )
  }

  const source: ImportResult['source'] = {
    loja: {
      nome: payload.loja?.nome ?? null,
      url: payload.loja?.url ?? null,
    },
    vendedor: {
      nome: payload.vendedor?.nome ?? null,
      whatsapp: payload.vendedor?.whatsapp ?? null,
    },
    catalogo: {
      nome: payload.catalogo?.nome ?? null,
    },
  }

  const supabase = createAdminClient()

  let imported = 0
  let updated = 0
  const errors: Array<{ sku: string; error: string }> = []

  for (const rawProduct of payload.produtos) {
    const sku = String(rawProduct?.id ?? '')

    if (!sku) {
      errors.push({ sku: '(unknown)', error: 'Product has no id field; skipped.' })
      continue
    }

    let mapped: ProductInsert
    try {
      mapped = mapProduct(rawProduct, userId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push({ sku, error: `Mapping error: ${message}` })
      continue
    }

    const { data: existing, error: selectError } = await supabase
      .from('products')
      .select('id')
      .eq('user_id', userId)
      .eq('sku', sku)
      .maybeSingle()

    if (selectError) {
      errors.push({ sku, error: `DB select error: ${selectError.message}` })
      continue
    }

    const isExisting = existing !== null

    const { error: upsertError } = await supabase
      .from('products')
      .upsert(mapped as never, { onConflict: 'user_id,sku', ignoreDuplicates: false })

    if (upsertError) {
      errors.push({ sku, error: `DB upsert error: ${upsertError.message}` })
      continue
    }

    if (isExisting) {
      updated++
    } else {
      imported++
    }
  }

  // Mescla categorias do catálogo importado em store_settings.categories
  const importedCategories = new Set<string>()
  for (const p of payload.produtos) {
    if (Array.isArray(p.categorias)) {
      for (const cat of p.categorias) {
        if (cat.nome) importedCategories.add(cat.nome)
      }
    }
  }

  if (importedCategories.size > 0) {
    const { data: settings } = await supabase
      .from('store_settings')
      .select('categories')
      .eq('id', userId)
      .maybeSingle()

    if (settings) {
      const merged = new Set<string>(settings.categories ?? [])
      for (const cat of importedCategories) merged.add(cat)

      await supabase
        .from('store_settings')
        .update({ categories: [...merged] })
        .eq('id', userId)
    }
  }

  return {
    imported,
    updated,
    errors,
    total_in_source: payload.produtos.length,
    source,
  }
}
