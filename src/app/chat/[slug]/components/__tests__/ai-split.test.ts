import { describe, it, expect } from 'vitest'
import {
  splitAIMessage,
  delayForSegment,
  PRODUCT_DELAY_MS,
  TEXT_DELAY_MS_PER_CHAR,
} from '../ai-split'

describe('splitAIMessage', () => {
  it('returns [] for empty string', () => {
    expect(splitAIMessage('')).toEqual([])
  })

  it('returns [] for whitespace-only string', () => {
    expect(splitAIMessage('   \n\n  ')).toEqual([])
  })

  it('one text segment for content without periods', () => {
    expect(splitAIMessage('oi tudo bem')).toEqual([
      { kind: 'text', content: 'oi tudo bem' },
    ])
  })

  it('splits two sentences at the period boundary', () => {
    expect(splitAIMessage('Oi tudo bem. Posso ajudar?')).toEqual([
      { kind: 'text', content: 'Oi tudo bem.' },
      { kind: 'text', content: 'Posso ajudar?' },
    ])
  })

  it('splits three sentences preserving each period', () => {
    expect(
      splitAIMessage('Primeiro. Segundo. Terceiro.'),
    ).toEqual([
      { kind: 'text', content: 'Primeiro.' },
      { kind: 'text', content: 'Segundo.' },
      { kind: 'text', content: 'Terceiro.' },
    ])
  })

  it('does NOT split on ellipsis (...)', () => {
    expect(splitAIMessage('Espera... agora vai. Pronto.')).toEqual([
      { kind: 'text', content: 'Espera... agora vai.' },
      { kind: 'text', content: 'Pronto.' },
    ])
  })

  it('does NOT split inside URLs containing periods', () => {
    expect(
      splitAIMessage('Veja em https://exemplo.com/foto.jpg agora. Próximo.'),
    ).toEqual([
      {
        kind: 'text',
        content: 'Veja em https://exemplo.com/foto.jpg agora.',
      },
      { kind: 'text', content: 'Próximo.' },
    ])
  })

  it('keeps single newlines inside a sentence', () => {
    expect(splitAIMessage('Linha um\nLinha dois.')).toEqual([
      { kind: 'text', content: 'Linha um\nLinha dois.' },
    ])
  })

  it('extracts [produto]...[/produto] as product segments', () => {
    expect(
      splitAIMessage('[produto]Camiseta Azul - R$ 50[/produto]'),
    ).toEqual([{ kind: 'product', content: 'Camiseta Azul - R$ 50' }])
  })

  it('mixes sentences and product segments preserving order', () => {
    const input =
      'Encontrei estes produtos. Olha só.\n[produto]Camiseta - R$ 50[/produto]\n[produto]Calça - R$ 120[/produto]\nGostou?'
    expect(splitAIMessage(input)).toEqual([
      { kind: 'text', content: 'Encontrei estes produtos.' },
      { kind: 'text', content: 'Olha só.' },
      { kind: 'product', content: 'Camiseta - R$ 50' },
      { kind: 'product', content: 'Calça - R$ 120' },
      { kind: 'text', content: 'Gostou?' },
    ])
  })

  it('handles empty product block by skipping it', () => {
    expect(splitAIMessage('Oi. [produto][/produto] Tchau.')).toEqual([
      { kind: 'text', content: 'Oi.' },
      { kind: 'text', content: 'Tchau.' },
    ])
  })

  it('treats stray [produto] without close tag as plain text', () => {
    expect(splitAIMessage('Oi [produto] camiseta')).toEqual([
      { kind: 'text', content: 'Oi [produto] camiseta' },
    ])
  })

  it('handles multi-line content inside product block', () => {
    expect(
      splitAIMessage('[produto]Camiseta\nR$ 50\nhttps://x.com/a.jpg[/produto]'),
    ).toEqual([
      {
        kind: 'product',
        content: 'Camiseta\nR$ 50\nhttps://x.com/a.jpg',
      },
    ])
  })
})

describe('delayForSegment', () => {
  it('product → PRODUCT_DELAY_MS', () => {
    expect(delayForSegment({ kind: 'product', content: 'any' })).toBe(
      PRODUCT_DELAY_MS,
    )
  })

  it('text → 30ms × content.length', () => {
    const text = 'abcde' // 5 chars
    expect(delayForSegment({ kind: 'text', content: text })).toBe(
      5 * TEXT_DELAY_MS_PER_CHAR,
    )
  })

  it('empty text → 0ms', () => {
    expect(delayForSegment({ kind: 'text', content: '' })).toBe(0)
  })
})
