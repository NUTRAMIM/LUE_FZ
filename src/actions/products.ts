'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'
import { getStoreRole } from '@/lib/store-role'
import type { Product } from '@/types/product'

const MAX_TEXT = 500
const MAX_DESCRIPTION = 2000
const MAX_LIST_ITEM = 80
const MAX_URL = 500
const MAX_STOCK = 1_000_000
const MAX_PRICE = 99_999_999.99

export interface SaveProductResult {
  success: boolean
  error?: string
}

export interface SaveProductInput {
  id: string
  sku: string
  name: string
  description: string
  category: string
  brand: string
  price: string
  compare_at_price: string
  stock_quantity: string
  stock_min: string
  tamanhos: string
  cores: string
  image_urls: string
}

function sanitizeText(input: unknown, maxLength: number): string {
  if (typeof input !== 'string') return ''
  return input.replace(/<[^>]*>/g, '').trim().slice(0, maxLength)
}

function parseNumber(input: string): number | null {
  const trimmed = input.trim()
  const normalized = trimmed.includes(',')
    ? trimmed.replace(/\./g, '').replace(',', '.')
    : trimmed
  if (!normalized) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

function parseInteger(input: string): number | null {
  const value = parseNumber(input)
  if (value === null) return null
  return Math.floor(value)
}

function sanitizeStringList(input: string, maxItemLength: number): string[] {
  const seen = new Set<string>()
  const items = input
    .split(/[\n,;]/)
    .map(item => sanitizeText(item, maxItemLength))
    .filter(Boolean)

  return items.filter(item => {
    const key = item.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function sanitizeUrlList(input: string): string[] {
  return sanitizeStringList(input, MAX_URL).filter(url => {
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      return false
    }
  })
}

export async function saveProduct(data: SaveProductInput): Promise<SaveProductResult> {
  const supabase = await createClient()

  const user = await getAuthedUser()
  if (!user) {
    return { success: false, error: 'Nao autorizado. Faca login novamente.' }
  }

  if ((await getStoreRole()) !== 'owner') {
    return { success: false, error: 'Apenas o dono da loja pode editar produtos.' }
  }

  const id = sanitizeText(data.id, 80)
  const sku = sanitizeText(data.sku, MAX_TEXT)
  const name = sanitizeText(data.name, MAX_TEXT)
  const description = sanitizeText(data.description, MAX_DESCRIPTION)
  const category = sanitizeText(data.category, MAX_TEXT)
  const brand = sanitizeText(data.brand, MAX_TEXT)
  const price = parseNumber(data.price)
  const compareAtPrice = parseNumber(data.compare_at_price)
  const stockQuantity = parseInteger(data.stock_quantity)
  const stockMin = data.stock_min.trim() ? parseInteger(data.stock_min) : 0
  const tamanhos = sanitizeStringList(data.tamanhos, MAX_LIST_ITEM)
  const cores = sanitizeStringList(data.cores, MAX_LIST_ITEM)
  const imageUrls = sanitizeUrlList(data.image_urls)

  if (!id) return { success: false, error: 'Produto invalido.' }
  if (!name) return { success: false, error: 'Nome do produto e obrigatorio.' }
  if (!sku) return { success: false, error: 'SKU e obrigatorio.' }
  if (price === null || price < 0 || price > MAX_PRICE) {
    return { success: false, error: 'Preco invalido.' }
  }
  if (
    compareAtPrice !== null &&
    (compareAtPrice < 0 || compareAtPrice > MAX_PRICE)
  ) {
    return { success: false, error: 'Preco comparativo invalido.' }
  }
  if (stockQuantity === null || stockQuantity < 0 || stockQuantity > MAX_STOCK) {
    return { success: false, error: 'Quantidade em estoque invalida.' }
  }
  if (stockMin === null || stockMin < 0 || stockMin > MAX_STOCK) {
    return { success: false, error: 'Estoque minimo invalido.' }
  }

  const { data: updatedProduct, error } = await supabase
    .from('products')
    .update({
      sku,
      name,
      description: description || null,
      category: category || null,
      brand: brand || null,
      price,
      compare_at_price: compareAtPrice,
      stock_quantity: stockQuantity,
      stock_min: stockMin,
      tamanhos,
      cores,
      image_urls: imageUrls.length ? imageUrls : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('saveProduct error:', {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    })
    return { success: false, error: 'Erro ao salvar produto. Tente novamente.' }
  }

  if (!updatedProduct) {
    return { success: false, error: 'Produto nao encontrado para esta loja.' }
  }

  revalidatePath('/estoque')
  return { success: true }
}

export async function getProductDetails(id: string): Promise<Product | null> {
  const supabase = await createClient()

  const user = await getAuthedUser()
  if (!user) {
    throw new Error('Nao autorizado. Faca login novamente.')
  }

  if ((await getStoreRole()) !== 'owner') {
    throw new Error('Apenas o dono da loja pode visualizar detalhes do produto.')
  }

  const cleanId = id.trim().slice(0, 80)
  if (!cleanId) return null

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', cleanId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    console.error('getProductDetails error:', error)
    throw new Error('Erro ao carregar produto.')
  }

  return data ?? null
}
