'use server'

import { createClient } from '@/lib/supabase/server'

const MAX_STORE_NAME_LENGTH = 100
const MAX_INSTRUCTIONS_LENGTH = 2000

const VALID_PAYMENT_METHODS = [
  'PIX',
  'Cartão de Crédito',
  'Cartão de Débito',
  'Boleto Bancário',
]

const VALID_SERVICE_STEPS = [
  'Saudação',
  'Identificar necessidade',
  'Apresentar produtos',
  'Capturar contato',
]

const VALID_DELIVERY_METHODS = [
  'Correios',
]

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
}): Promise<SaveStoreSettingsResult> {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { success: false, error: 'Não autorizado. Faça login novamente.' }
  }

  const storeName = sanitizeText(data.store_name, MAX_STORE_NAME_LENGTH)
  const serviceInstructions = sanitizeText(data.service_instructions, MAX_INSTRUCTIONS_LENGTH)
  const serviceSteps = sanitizeArray(data.service_steps, VALID_SERVICE_STEPS)
  const paymentMethods = sanitizeArray(data.payment_methods, VALID_PAYMENT_METHODS)
  const deliveryMethods = sanitizeArray(data.delivery_methods, VALID_DELIVERY_METHODS)
  const categories = sanitizeStringArray(data.categories, 100)

  if (!storeName) {
    return { success: false, error: 'Nome da loja é obrigatório.' }
  }
  if (paymentMethods.length === 0) {
    return { success: false, error: 'Selecione pelo menos uma forma de pagamento.' }
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
      },
      { onConflict: 'id' }
    )

  if (dbError) {
    console.error('store_settings upsert error:', dbError)
    return { success: false, error: 'Erro ao salvar configurações. Tente novamente.' }
  }

  return { success: true }
}
