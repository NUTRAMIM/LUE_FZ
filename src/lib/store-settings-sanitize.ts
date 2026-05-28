export type FaqItem = { pergunta: string; resposta: string }

export type DiscountType =
  | 'percent_piece'
  | 'percent_order'
  | 'fixed_piece'
  | 'custom'

export const MAX_FAQ_ITEMS = 30
export const MAX_FAQ_QUESTION_LENGTH = 200
export const MAX_FAQ_ANSWER_LENGTH = 1000
export const MAX_DISCOUNT_CUSTOM_LENGTH = 280
export const MAX_DISCOUNT_VALUE = 99_999_999.99

const VALID_DISCOUNT_TYPES: DiscountType[] = [
  'percent_piece',
  'percent_order',
  'fixed_piece',
  'custom',
]

export function cleanText(input: unknown, maxLength: number): string {
  if (typeof input !== 'string') return ''
  return input.replace(/<[^>]*>/g, '').trim().slice(0, maxLength)
}

export function sanitizeFaq(input: unknown): FaqItem[] {
  if (!Array.isArray(input)) return []
  const out: FaqItem[] = []
  for (const raw of input) {
    if (raw === null || typeof raw !== 'object') continue
    const rec = raw as Record<string, unknown>
    const pergunta = cleanText(rec.pergunta, MAX_FAQ_QUESTION_LENGTH)
    const resposta = cleanText(rec.resposta, MAX_FAQ_ANSWER_LENGTH)
    if (pergunta === '' || resposta === '') continue
    out.push({ pergunta, resposta })
    if (out.length >= MAX_FAQ_ITEMS) break
  }
  return out
}

export function sanitizeDiscountType(input: unknown): DiscountType | null {
  return VALID_DISCOUNT_TYPES.includes(input as DiscountType)
    ? (input as DiscountType)
    : null
}

export function sanitizeDiscountValue(input: unknown): number | null {
  if (typeof input !== 'number' || !Number.isFinite(input)) return null
  if (input < 0 || input > MAX_DISCOUNT_VALUE) return null
  return Math.round(input * 100) / 100
}

export interface NormalizedDiscount {
  discount_type: DiscountType | null
  discount_value: number | null
  discount_custom: string
}

export function normalizeDiscount(
  rawType: unknown,
  rawValue: unknown,
  rawCustom: unknown,
): NormalizedDiscount {
  const type = sanitizeDiscountType(rawType)
  if (type === null) {
    return { discount_type: null, discount_value: null, discount_custom: '' }
  }
  if (type === 'custom') {
    return {
      discount_type: 'custom',
      discount_value: null,
      discount_custom: cleanText(rawCustom, MAX_DISCOUNT_CUSTOM_LENGTH),
    }
  }
  let value = sanitizeDiscountValue(rawValue)
  if (value === null) {
    return { discount_type: null, discount_value: null, discount_custom: '' }
  }
  if ((type === 'percent_piece' || type === 'percent_order') && value > 100) {
    value = 100
  }
  return { discount_type: type, discount_value: value, discount_custom: '' }
}

export interface MergeFaqResult {
  faq: FaqItem[]
  error?: 'faq_full'
}

export function mergeFaqAnswer(
  currentFaq: unknown,
  pergunta: string,
  resposta: string,
): MergeFaqResult {
  const base = sanitizeFaq(currentFaq)
  const p = cleanText(pergunta, MAX_FAQ_QUESTION_LENGTH)
  const r = cleanText(resposta, MAX_FAQ_ANSWER_LENGTH)
  if (p === '' || r === '') return { faq: base }

  const key = p.toLowerCase()
  const idx = base.findIndex((item) => item.pergunta.toLowerCase() === key)
  if (idx >= 0) {
    const next = base.map((item, i) =>
      i === idx ? { pergunta: item.pergunta, resposta: r } : item,
    )
    return { faq: next }
  }

  if (base.length >= MAX_FAQ_ITEMS) {
    return { faq: base, error: 'faq_full' }
  }

  return { faq: [...base, { pergunta: p, resposta: r }] }
}
