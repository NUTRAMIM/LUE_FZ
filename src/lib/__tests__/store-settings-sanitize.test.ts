import { describe, it, expect } from 'vitest'
import {
  sanitizeFaq,
  sanitizeDiscountType,
  sanitizeDiscountValue,
  normalizeDiscount,
  MAX_FAQ_ITEMS,
  MAX_FAQ_QUESTION_LENGTH,
  MAX_FAQ_ANSWER_LENGTH,
} from '../store-settings-sanitize'

describe('sanitizeFaq', () => {
  it('returns [] for non-array input', () => {
    expect(sanitizeFaq(null)).toEqual([])
    expect(sanitizeFaq('x')).toEqual([])
  })

  it('keeps valid pairs and trims', () => {
    expect(
      sanitizeFaq([{ pergunta: '  Troca? ', resposta: ' Sim ' }]),
    ).toEqual([{ pergunta: 'Troca?', resposta: 'Sim' }])
  })

  it('drops pairs with empty pergunta or resposta', () => {
    expect(
      sanitizeFaq([
        { pergunta: '', resposta: 'a' },
        { pergunta: 'q', resposta: '' },
        { pergunta: 'q', resposta: 'a' },
      ]),
    ).toEqual([{ pergunta: 'q', resposta: 'a' }])
  })

  it('strips HTML tags', () => {
    expect(
      sanitizeFaq([{ pergunta: '<b>oi</b>', resposta: 'a<script>x</script>b' }]),
    ).toEqual([{ pergunta: 'oi', resposta: 'axb' }])
  })

  it('caps question and answer length', () => {
    const long = 'x'.repeat(5000)
    const [item] = sanitizeFaq([{ pergunta: long, resposta: long }])
    expect(item.pergunta).toHaveLength(MAX_FAQ_QUESTION_LENGTH)
    expect(item.resposta).toHaveLength(MAX_FAQ_ANSWER_LENGTH)
  })

  it('caps number of items', () => {
    const many = Array.from({ length: MAX_FAQ_ITEMS + 5 }, () => ({
      pergunta: 'q',
      resposta: 'a',
    }))
    expect(sanitizeFaq(many)).toHaveLength(MAX_FAQ_ITEMS)
  })

  it('ignores non-object entries', () => {
    expect(sanitizeFaq([null, 1, 'x', { pergunta: 'q', resposta: 'a' }])).toEqual([
      { pergunta: 'q', resposta: 'a' },
    ])
  })
})

describe('sanitizeDiscountType', () => {
  it('accepts valid types', () => {
    expect(sanitizeDiscountType('percent_piece')).toBe('percent_piece')
    expect(sanitizeDiscountType('custom')).toBe('custom')
  })
  it('returns null for invalid/unknown', () => {
    expect(sanitizeDiscountType('bogus')).toBeNull()
    expect(sanitizeDiscountType(null)).toBeNull()
    expect(sanitizeDiscountType(5)).toBeNull()
  })
})

describe('sanitizeDiscountValue', () => {
  it('returns null for non-number', () => {
    expect(sanitizeDiscountValue('5')).toBeNull()
    expect(sanitizeDiscountValue(NaN)).toBeNull()
  })
  it('rejects negatives and over-cap', () => {
    expect(sanitizeDiscountValue(-1)).toBeNull()
    expect(sanitizeDiscountValue(1e12)).toBeNull()
  })
  it('rounds to 2 decimals', () => {
    expect(sanitizeDiscountValue(10.999)).toBe(11)
    expect(sanitizeDiscountValue(10.123)).toBe(10.12)
  })
})

describe('normalizeDiscount', () => {
  it('null type clears value and custom', () => {
    expect(normalizeDiscount(null, 50, 'x')).toEqual({
      discount_type: null,
      discount_value: null,
      discount_custom: '',
    })
  })

  it('custom keeps text, clears value', () => {
    expect(normalizeDiscount('custom', 50, '<b>5% acima de 20</b>')).toEqual({
      discount_type: 'custom',
      discount_value: null,
      discount_custom: '5% acima de 20',
    })
  })

  it('numeric type keeps value, clears custom', () => {
    expect(normalizeDiscount('fixed_piece', 5, 'ignored')).toEqual({
      discount_type: 'fixed_piece',
      discount_value: 5,
      discount_custom: '',
    })
  })

  it('clamps percent types to 100', () => {
    expect(normalizeDiscount('percent_order', 150, '')).toEqual({
      discount_type: 'percent_order',
      discount_value: 100,
      discount_custom: '',
    })
  })
})
