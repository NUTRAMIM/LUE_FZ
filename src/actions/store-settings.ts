'use server'

import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'
import {
  sanitizeFaq,
  normalizeDiscount,
  type FaqItem,
} from '@/lib/store-settings-sanitize'

const MAX_STORE_NAME_LENGTH = 100
const MAX_INSTRUCTIONS_LENGTH = 2000
const MAX_BIO_LENGTH = 280
const MAX_HANDLE_LENGTH = 30
const MAX_URL_LENGTH = 500

const VALID_SERVICE_STEPS = [
  'Saudação',
  'Identificar necessidade',
  'Apresentar produtos',
  'Capturar contato',
]

const MAX_METHOD_LENGTH = 100

const VALID_MIN_ORDER_LOGIC = ['all', 'any'] as const
type MinOrderLogic = typeof VALID_MIN_ORDER_LOGIC[number]
const MAX_MIN_ORDER_QUANTITY = 1_000_000
const MAX_MIN_ORDER_VALUE = 99_999_999.99

function sanitizeText(input: unknown, maxLength: number): string {
  if (typeof input !== 'string') return ''
  return input
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, maxLength)
}

function sanitizeArray(input: unknown, allowedValues: string[]): string[] {
  if (!Array.isArray(input)) return []
  return input.filter(
    (v): v is string => typeof v === 'string' && allowedValues.includes(v)
  )
}

function sanitizeStringArray(input: unknown, maxLength: number): string[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map(v => v.replace(/<[^>]*>/g, '').trim().slice(0, maxLength))
}

function sanitizePhone(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input.replace(/\D/g, '').slice(0, 11)
}

// Aceita handle (@usuario) ou link colado e devolve a URL canônica do perfil.
function sanitizeInstagramUrl(input: unknown): string {
  if (typeof input !== 'string') return ''
  let v = input.trim()
  if (!v) return ''
  v = v.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
  v = v.replace(/^(?:m\.|mobile\.)?instagram\.com\//i, '')
  v = v.split(/[/?#]/)[0]
  const handle = v
    .replace(/^@+/, '')
    .replace(/[^a-zA-Z0-9._]/g, '')
    .slice(0, MAX_HANDLE_LENGTH)
  return handle ? `https://instagram.com/${handle}` : ''
}

function sanitizeMinOrderQuantity(input: unknown): number | null {
  if (typeof input !== 'number' || !Number.isFinite(input)) return null
  const n = Math.floor(input)
  if (n < 1 || n > MAX_MIN_ORDER_QUANTITY) return null
  return n
}

function sanitizeMinOrderValue(input: unknown): number | null {
  if (typeof input !== 'number' || !Number.isFinite(input)) return null
  if (input < 0 || input > MAX_MIN_ORDER_VALUE) return null
  return Math.round(input * 100) / 100
}

function sanitizeMinOrderLogic(input: unknown): MinOrderLogic {
  return (VALID_MIN_ORDER_LOGIC as readonly string[]).includes(input as string)
    ? (input as MinOrderLogic)
    : 'all'
}

function sanitizeLogoUrl(input: unknown): string {
  if (typeof input !== 'string') return ''
  const url = input.trim().slice(0, MAX_URL_LENGTH)
  if (!url) return ''
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '')
  if (!base) return ''
  const allowedPrefix = `${base}/storage/v1/object/public/store-logos/`
  return url.startsWith(allowedPrefix) ? url : ''
}

export interface SaveStoreSettingsResult {
  success: boolean
  error?: string
}

export async function saveStoreSettings(data: {
  store_name: string
  service_steps: string[]
  service_instructions: string
  payment_methods: string[]
  delivery_methods: string[]
  categories: string[]
  seller_phone: string
  instagram_handle: string
  store_bio: string
  logo_url: string
  min_order_enabled: boolean
  min_order_quantity: number | null
  min_order_value: number | null
  min_order_logic: 'all' | 'any'
  faq: FaqItem[]
  discount_type: 'percent_piece' | 'percent_order' | 'fixed_piece' | 'custom' | null
  discount_value: number | null
  discount_custom: string
}): Promise<SaveStoreSettingsResult> {
  const supabase = await createClient()

  const user = await getAuthedUser()
  if (!user) {
    return { success: false, error: 'Não autorizado. Faça login novamente.' }
  }

  const storeName = sanitizeText(data.store_name, MAX_STORE_NAME_LENGTH)
  const serviceInstructions = sanitizeText(data.service_instructions, MAX_INSTRUCTIONS_LENGTH)
  const serviceSteps = sanitizeArray(data.service_steps, VALID_SERVICE_STEPS)
  const paymentMethods = sanitizeStringArray(data.payment_methods, MAX_METHOD_LENGTH)
  const deliveryMethods = sanitizeStringArray(data.delivery_methods, MAX_METHOD_LENGTH)
  const categories = sanitizeStringArray(data.categories, 100)
  const sellerPhone = sanitizePhone(data.seller_phone)
  const instagramUrl = sanitizeInstagramUrl(data.instagram_handle)
  const storeBio = sanitizeText(data.store_bio, MAX_BIO_LENGTH)
  const logoUrl = sanitizeLogoUrl(data.logo_url)
  const minOrderEnabled = data.min_order_enabled === true
  const minOrderQuantity = sanitizeMinOrderQuantity(data.min_order_quantity)
  const minOrderValue = sanitizeMinOrderValue(data.min_order_value)
  const minOrderLogic = sanitizeMinOrderLogic(data.min_order_logic)
  const faq = sanitizeFaq(data.faq)
  const discount = normalizeDiscount(
    data.discount_type,
    data.discount_value,
    data.discount_custom,
  )

  if (!storeName) {
    return { success: false, error: 'Nome da loja é obrigatório.' }
  }
  if (paymentMethods.length === 0) {
    return { success: false, error: 'Selecione pelo menos uma forma de pagamento.' }
  }
  if (sellerPhone && (sellerPhone.length < 10 || sellerPhone.length > 11)) {
    return { success: false, error: 'Número de WhatsApp deve ter 10 ou 11 dígitos (DDD + número).' }
  }
  const instagramRaw =
    typeof data.instagram_handle === 'string' ? data.instagram_handle.trim() : ''
  if (instagramRaw && !instagramUrl) {
    return { success: false, error: 'Instagram inválido. Cole o link do perfil (instagram.com/seu_usuario).' }
  }
  if (minOrderEnabled && minOrderQuantity === null && minOrderValue === null) {
    return { success: false, error: 'Informe quantidade mínima ou valor mínimo.' }
  }

  const { error: dbError } = await supabase
    .from('store_settings')
    .upsert(
      {
        id: user.id,
        store_name: storeName,
        service_steps: serviceSteps,
        service_instructions: serviceInstructions,
        payment_methods: paymentMethods,
        delivery_methods: deliveryMethods,
        categories,
        seller_phone: sellerPhone,
        instagram_handle: instagramUrl,
        store_bio: storeBio,
        logo_url: logoUrl,
        min_order_enabled: minOrderEnabled,
        min_order_quantity: minOrderQuantity,
        min_order_value: minOrderValue,
        min_order_logic: minOrderLogic,
        faq,
        discount_type: discount.discount_type,
        discount_value: discount.discount_value,
        discount_custom: discount.discount_custom,
      },
      { onConflict: 'id' }
    )

  if (dbError) {
    console.error('store_settings upsert error:', dbError)
    return { success: false, error: 'Erro ao salvar configurações. Tente novamente.' }
  }

  return { success: true }
}
