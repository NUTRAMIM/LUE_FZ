'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'
import { getStoreRole } from '@/lib/store-role'
import { generateSku } from '@/lib/sku'
import type { Product } from '@/types/product'
import { MAX_PRODUCT_IMAGES } from '@/lib/inventory/constants'

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
  video_url: string
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
  return sanitizeStringList(input, MAX_URL)
    .filter(url => {
      try {
        const parsed = new URL(url)
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      } catch {
        return false
      }
    })
    .slice(0, MAX_PRODUCT_IMAGES)
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
  const videoUrl = sanitizeOptionalUrl(data.video_url)

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
      video_url: videoUrl,
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

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export interface UploadProductImageResult {
  success: boolean
  url?: string
  error?: string
}

export async function uploadProductImage(
  formData: FormData,
): Promise<UploadProductImageResult> {
  const supabase = await createClient()

  const user = await getAuthedUser()
  if (!user) {
    return { success: false, error: 'Nao autorizado. Faca login novamente.' }
  }
  if ((await getStoreRole()) !== 'owner') {
    return { success: false, error: 'Apenas o dono da loja pode subir imagens.' }
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return { success: false, error: 'Arquivo invalido.' }
  }
  if (!ALLOWED_IMAGE_MIMES.has(file.type)) {
    return { success: false, error: 'Formato nao suportado. Use JPG, PNG, WEBP ou GIF.' }
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { success: false, error: 'Imagem maior que 5MB.' }
  }

  const ext = EXT_BY_MIME[file.type]
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('product-images')
    .upload(path, file, { contentType: file.type, upsert: false })

  if (uploadError) {
    console.error('uploadProductImage error:', uploadError)
    return { success: false, error: 'Erro ao subir imagem. Tente novamente.' }
  }

  const { data } = supabase.storage.from('product-images').getPublicUrl(path)
  if (!data?.publicUrl) {
    return { success: false, error: 'Erro ao gerar URL publica.' }
  }
  return { success: true, url: data.publicUrl }
}

const MAX_VIDEO_BYTES = 20 * 1024 * 1024
const ALLOWED_VIDEO_MIMES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
])
const VIDEO_EXT_BY_MIME: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}

export interface UploadProductVideoResult {
  success: boolean
  url?: string
  error?: string
}

export async function uploadProductVideo(
  formData: FormData,
): Promise<UploadProductVideoResult> {
  const supabase = await createClient()

  const user = await getAuthedUser()
  if (!user) {
    return { success: false, error: 'Nao autorizado. Faca login novamente.' }
  }
  if ((await getStoreRole()) !== 'owner') {
    return { success: false, error: 'Apenas o dono da loja pode subir videos.' }
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return { success: false, error: 'Arquivo invalido.' }
  }
  if (!ALLOWED_VIDEO_MIMES.has(file.type)) {
    return { success: false, error: 'Formato nao suportado. Use MP4, WEBM ou MOV.' }
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return { success: false, error: 'Video maior que 20MB.' }
  }

  const ext = VIDEO_EXT_BY_MIME[file.type]
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('product-videos')
    .upload(path, file, { contentType: file.type, upsert: false })

  if (uploadError) {
    console.error('uploadProductVideo error:', uploadError)
    return { success: false, error: 'Erro ao subir video. Tente novamente.' }
  }

  const { data } = supabase.storage.from('product-videos').getPublicUrl(path)
  if (!data?.publicUrl) {
    return { success: false, error: 'Erro ao gerar URL publica.' }
  }
  return { success: true, url: data.publicUrl }
}

function sanitizeOptionalUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim().slice(0, MAX_URL)
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return trimmed
  } catch {
    return null
  }
}

export interface CreateProductInput {
  name: string
  description: string
  price: string
  stock_quantity: string
  tamanhos: string[]
  cores: string[]
  image_urls: string[]
  video_url: string
}

export interface CreateProductResult {
  success: boolean
  error?: string
  productId?: string
}

const MAX_SKU_RETRIES = 3

export async function createProduct(
  data: CreateProductInput,
): Promise<CreateProductResult> {
  const supabase = await createClient()

  const user = await getAuthedUser()
  if (!user) {
    return { success: false, error: 'Nao autorizado. Faca login novamente.' }
  }
  if ((await getStoreRole()) !== 'owner') {
    return { success: false, error: 'Apenas o dono da loja pode criar produtos.' }
  }

  const name = sanitizeText(data.name, MAX_TEXT)
  const description = sanitizeText(data.description, MAX_DESCRIPTION)
  const price = parseNumber(data.price)
  const stockQuantity = parseInteger(data.stock_quantity)

  const tamanhos = sanitizeStringList(
    Array.isArray(data.tamanhos) ? data.tamanhos.join('\n') : '',
    MAX_LIST_ITEM,
  )
  const cores = sanitizeStringList(
    Array.isArray(data.cores) ? data.cores.join('\n') : '',
    MAX_LIST_ITEM,
  )
  const imageUrls = sanitizeUrlList(
    Array.isArray(data.image_urls) ? data.image_urls.join('\n') : '',
  )
  const videoUrl = sanitizeOptionalUrl(data.video_url)

  if (!name) return { success: false, error: 'Nome do produto e obrigatorio.' }
  if (price === null || price < 0 || price > MAX_PRICE) {
    return { success: false, error: 'Preco invalido.' }
  }
  if (stockQuantity === null || stockQuantity < 0 || stockQuantity > MAX_STOCK) {
    return { success: false, error: 'Quantidade em estoque invalida.' }
  }

  for (let attempt = 0; attempt < MAX_SKU_RETRIES; attempt++) {
    const sku = generateSku(name)
    const { data: inserted, error } = await supabase
      .from('products')
      .insert({
        user_id: user.id,
        sku,
        name,
        description: description || null,
        price,
        stock_quantity: stockQuantity,
        stock_min: 0,
        tamanhos,
        cores,
        image_urls: imageUrls.length ? imageUrls : null,
        video_url: videoUrl,
      })
      .select('id')
      .single()

    if (!error && inserted) {
      revalidatePath('/estoque')
      return { success: true, productId: inserted.id }
    }

    // 23505 = unique_violation (Postgres). Tenta de novo com outro SKU.
    if (error?.code === '23505' && attempt < MAX_SKU_RETRIES - 1) {
      continue
    }

    console.error('createProduct error:', {
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
    })
    return { success: false, error: 'Erro ao criar produto. Tente novamente.' }
  }

  return { success: false, error: 'Nao foi possivel gerar SKU unico. Tente novamente.' }
}

export interface AdjustStockResult {
  success: boolean
  error?: string
  stockQuantity?: number
}

export async function adjustStock(
  id: string,
  delta: number,
): Promise<AdjustStockResult> {
  const supabase = await createClient()

  const user = await getAuthedUser()
  if (!user) {
    return { success: false, error: 'Nao autorizado. Faca login novamente.' }
  }
  if ((await getStoreRole()) !== 'owner') {
    return { success: false, error: 'Apenas o dono da loja pode ajustar o estoque.' }
  }

  const productId = sanitizeText(id, 80)
  if (!productId) return { success: false, error: 'Produto invalido.' }
  if (!Number.isInteger(delta) || delta === 0) {
    return { success: false, error: 'Ajuste invalido.' }
  }

  const { data: current, error: readErr } = await supabase
    .from('products')
    .select('stock_quantity')
    .eq('id', productId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (readErr) {
    console.error('adjustStock read error:', readErr.message)
    return { success: false, error: 'Erro ao ajustar estoque. Tente novamente.' }
  }
  if (!current) {
    return { success: false, error: 'Produto nao encontrado para esta loja.' }
  }

  const next = Math.min(MAX_STOCK, Math.max(0, current.stock_quantity + delta))
  if (next === current.stock_quantity) {
    return { success: true, stockQuantity: next }
  }

  const { error: updErr } = await supabase
    .from('products')
    .update({ stock_quantity: next, updated_at: new Date().toISOString() })
    .eq('id', productId)
    .eq('user_id', user.id)

  if (updErr) {
    console.error('adjustStock update error:', updErr.message)
    return { success: false, error: 'Erro ao ajustar estoque. Tente novamente.' }
  }

  revalidatePath('/estoque')
  return { success: true, stockQuantity: next }
}

export async function deleteProduct(id: string): Promise<SaveProductResult> {
  const supabase = await createClient()

  const user = await getAuthedUser()
  if (!user) {
    return { success: false, error: 'Nao autorizado. Faca login novamente.' }
  }
  if ((await getStoreRole()) !== 'owner') {
    return { success: false, error: 'Apenas o dono da loja pode excluir produtos.' }
  }

  const productId = sanitizeText(id, 80)
  if (!productId) return { success: false, error: 'Produto invalido.' }

  const { data: deleted, error } = await supabase
    .from('products')
    .delete()
    .eq('id', productId)
    .eq('user_id', user.id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('deleteProduct error:', error.message)
    return { success: false, error: 'Erro ao excluir produto. Tente novamente.' }
  }
  if (!deleted) {
    return { success: false, error: 'Produto nao encontrado para esta loja.' }
  }

  revalidatePath('/estoque')
  return { success: true }
}
