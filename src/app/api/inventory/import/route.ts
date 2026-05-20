import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthedUser } from '@/lib/auth'
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
// Response shape
// ---------------------------------------------------------------------------

interface ImportResult {
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

const KNOWN_SIZES = ['P', 'M', 'G', 'GG', 'EXG', 'EXTRAG', 'XG', 'PP', 'XP']

function extractVariantOptions(variacoes: FacilZapVariation[]): { cores: string[], tamanhos: string[] } {
  const cores = new Set<string>()
  const tamanhos = new Set<string>()

  for (const v of variacoes) {
    // Normaliza espaços múltiplos
    const parts = v.nome.trim().split(/\s+/)
    const lastPart = parts[parts.length - 1]
    if (KNOWN_SIZES.includes(lastPart)) {
      tamanhos.add(lastPart)
      cores.add(parts.slice(0, -1).join(' '))
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
    image_urls: Array.isArray(p.imagens) ? p.imagens : [],
    ...(() => {
      const opts = p.variacoes?.length
        ? extractVariantOptions(p.variacoes)
        : { cores: [], tamanhos: [] }
      return { cores: opts.cores, tamanhos: opts.tamanhos }
    })(),
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
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Authenticate
  const user = await getAuthedUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  // Parse request body
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

  // Fetch remote FacilZap JSON
  let payload: FacilZapPayload
  try {
    const response = await fetch(url.trim(), {
      headers: { Accept: 'application/json' },
      // Enforce a reasonable timeout via AbortSignal (Node 18+)
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
      return NextResponse.json(
        {
          error: `Failed to fetch URL: HTTP ${response.status} ${response.statusText}`,
        },
        { status: 400 }
      )
    }

    payload = await response.json()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: `Failed to fetch URL: ${message}` },
      { status: 400 }
    )
  }

  // Validate expected structure
  if (!payload || !Array.isArray(payload.produtos)) {
    return NextResponse.json(
      {
        error:
          'Unexpected JSON structure: missing "produtos" array at the root level.',
      },
      { status: 400 }
    )
  }

  // Build source metadata for the response
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

  // Process products individually so a single failure doesn't abort the batch
  for (const rawProduct of payload.produtos) {
    const sku = String(rawProduct?.id ?? '')

    if (!sku) {
      errors.push({ sku: '(unknown)', error: 'Product has no id field; skipped.' })
      continue
    }

    let mapped: ProductInsert
    try {
      mapped = mapProduct(rawProduct, user.id)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push({ sku, error: `Mapping error: ${message}` })
      continue
    }

    // Check whether the row already exists so we can count imported vs updated
    const { data: existing, error: selectError } = await supabase
      .from('products')
      .select('id')
      .eq('user_id', user.id)
      .eq('sku', sku)
      .maybeSingle()

    if (selectError) {
      errors.push({ sku, error: `DB select error: ${selectError.message}` })
      continue
    }

    const isExisting = existing !== null

    // Upsert on conflict with sku
    const { error: upsertError } = await supabase
      .from('products')
      .upsert(mapped as any, { onConflict: 'user_id,sku', ignoreDuplicates: false })

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

  // Extract unique categories from imported products and merge into store_settings
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
      .eq('id', user.id)
      .maybeSingle()

    const merged = new Set<string>(settings?.categories ?? [])
    for (const cat of importedCategories) merged.add(cat)

    if (settings) {
      await supabase
        .from('store_settings')
        .update({ categories: [...merged] })
        .eq('id', user.id)
    }
  }

  const result: ImportResult = {
    imported,
    updated,
    errors,
    total_in_source: payload.produtos.length,
    source,
  }

  return NextResponse.json(result, { status: 200 })
}
