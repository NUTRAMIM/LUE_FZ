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

// Mínimo de caracteres para a fusão fuzzy (typos) atuar — protege cores
// curtas e parecidas mas legítimas (ex.: "Rosa" vs "Rose") de fundirem.
const FUZZY_MIN_LEN = 6

// Normaliza um lado da cor (segmento atômico) para comparação: sem acento,
// minúsculo, espaços colapsados. "FÚCSIA" e "Fucsia" viram a mesma chave.
function normalizeAtom(seg: string): string {
  return seg
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// Entre formas que colidem na mesma chave, prefere a mais legível:
// acentuada (+2) e com minúsculas (+1) em vez de CAIXA ALTA.
function displayScore(cor: string): number {
  const hasDiacritics = /[\u0300-\u036f]/.test(cor.normalize('NFD'))
  const hasLowercase = cor !== cor.toUpperCase()
  return (hasDiacritics ? 2 : 0) + (hasLowercase ? 1 : 0)
}

// Distância de edição exatamente 1 (substituição, inserção ou remoção).
function isOneEditAway(a: string, b: string): boolean {
  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > 1) return false
  if (la === lb) {
    let diff = 0
    for (let i = 0; i < la; i++) if (a[i] !== b[i]) diff++
    return diff === 1
  }
  const short = la < lb ? a : b
  const long = la < lb ? b : a
  let i = 0
  let j = 0
  let skipped = false
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i++
      j++
    } else {
      if (skipped) return false
      skipped = true
      j++
    }
  }
  return true
}

// Segmenta uma cor em lados pela barra: "ABACATE/AREIA" -> ["ABACATE","AREIA"].
function segmentsOf(cor: string): string[] {
  return cor
    .split('/')
    .map(s => s.trim())
    .filter(Boolean)
}

export function extractVariantOptions(
  variacoes: FacilZapVariation[],
): { cores: string[]; tamanhos: string[] } {
  const rawCores: string[] = []
  const tamanhos = new Set<string>()

  for (const v of variacoes) {
    const parts = v.nome.trim().split(/\s+/)
    if (parts.length === 0) continue

    if (parts.length >= 2) {
      const last2 = parts.slice(-2).join(' ').toUpperCase()
      if (last2 in COMPOUND_SIZES) {
        tamanhos.add(COMPOUND_SIZES[last2])
        rawCores.push(parts.slice(0, -2).join(' '))
        continue
      }
    }

    const last = parts[parts.length - 1].toUpperCase()
    if (KNOWN_SIZES_UP.has(last)) {
      tamanhos.add(last)
      rawCores.push(parts.slice(0, -1).join(' '))
    } else {
      rawCores.push(parts.join(' '))
    }
  }

  // Melhor forma de exibição de cada lado atômico, compartilhada entre cores
  // sólidas e pares (ex.: "Fúcsia" sólida embeleza o lado de "FUCSIA/AREIA").
  const atomBest = new Map<string, string>()
  // Chave canônica da cor inteira -> lados atômicos ordenados (par fica junto,
  // mas ordem-independente: "AZUL/ROYAL" == "ROYAL/AZUL").
  const fullKeyToAtoms = new Map<string, string[]>()

  for (const cor of rawCores) {
    const atomKeys: string[] = []
    for (const seg of segmentsOf(cor)) {
      const key = normalizeAtom(seg)
      if (!key) continue
      atomKeys.push(key)
      const current = atomBest.get(key)
      if (current === undefined || displayScore(seg) > displayScore(current)) {
        atomBest.set(key, seg)
      }
    }
    const sortedAtoms = [...new Set(atomKeys)].sort()
    if (sortedAtoms.length === 0) continue
    fullKeyToAtoms.set(sortedAtoms.join('/'), sortedAtoms)
  }

  // Fusão fuzzy de typos: processa as chaves longas primeiro (mais provável
  // de serem a grafia correta) e funde as que estão a 1 edição de distância.
  const orderedKeys = [...fullKeyToAtoms.keys()].sort(
    (a, b) => b.length - a.length || a.localeCompare(b),
  )
  const keptKeys: string[] = []
  for (const key of orderedKeys) {
    const match =
      key.length >= FUZZY_MIN_LEN
        ? keptKeys.find(k => k.length >= FUZZY_MIN_LEN && isOneEditAway(k, key))
        : undefined
    if (!match) keptKeys.push(key)
  }

  const cores = keptKeys.map(key => {
    const atoms = fullKeyToAtoms.get(key)!
    return atoms.map(a => atomBest.get(a)!).join('/')
  })

  return {
    cores: cores.sort((a, b) =>
      a.localeCompare(b, 'pt', { sensitivity: 'base' }),
    ),
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
