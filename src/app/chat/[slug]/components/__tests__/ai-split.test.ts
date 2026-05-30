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

  it('one text segment for content without terminators', () => {
    expect(splitAIMessage('oi tudo bem')).toEqual([
      { kind: 'text', content: 'oi tudo bem' },
    ])
  })

  it('one segment when total sentences = 2 (grouped together)', () => {
    expect(splitAIMessage('Oi tudo bem. Posso ajudar?')).toEqual([
      { kind: 'text', content: 'Oi tudo bem. Posso ajudar?' },
    ])
  })

  it('two segments when total sentences = 3 (group 2 + group 1)', () => {
    expect(
      splitAIMessage('Primeiro. Segundo. Terceiro.'),
    ).toEqual([
      { kind: 'text', content: 'Primeiro. Segundo.' },
      { kind: 'text', content: 'Terceiro.' },
    ])
  })

  it('two segments when total sentences = 4 (group 2 + group 2)', () => {
    expect(
      splitAIMessage('Um. Dois? Três. Quatro?'),
    ).toEqual([
      { kind: 'text', content: 'Um. Dois?' },
      { kind: 'text', content: 'Três. Quatro?' },
    ])
  })

  it('treats ? as a sentence terminator', () => {
    expect(splitAIMessage('Oi? Tudo bem?')).toEqual([
      { kind: 'text', content: 'Oi? Tudo bem?' },
    ])
  })

  it('does NOT split on ellipsis (...)', () => {
    expect(splitAIMessage('Espera... agora vai. Pronto.')).toEqual([
      { kind: 'text', content: 'Espera... agora vai. Pronto.' },
    ])
  })

  it('does NOT split on triple question marks (???)', () => {
    expect(splitAIMessage('Quê??? Sério. Falou.')).toEqual([
      { kind: 'text', content: 'Quê??? Sério. Falou.' },
    ])
  })

  it('does NOT split inside URLs containing periods', () => {
    expect(
      splitAIMessage('Veja em https://exemplo.com/foto.jpg agora. Próximo.'),
    ).toEqual([
      {
        kind: 'text',
        content: 'Veja em https://exemplo.com/foto.jpg agora. Próximo.',
      },
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

  it('mixes grouped sentences and product segments preserving order', () => {
    const input =
      'Encontrei estes produtos. Olha só.\n[produto]Camiseta - R$ 50[/produto]\n[produto]Calça - R$ 120[/produto]\nGostou? Quer ver mais?'
    expect(splitAIMessage(input)).toEqual([
      { kind: 'text', content: 'Encontrei estes produtos. Olha só.' },
      { kind: 'product', content: 'Camiseta - R$ 50' },
      { kind: 'product', content: 'Calça - R$ 120' },
      { kind: 'text', content: 'Gostou? Quer ver mais?' },
    ])
  })

  it('handles empty product block by skipping it', () => {
    expect(splitAIMessage('Oi. Tchau. [produto][/produto] Pronto.')).toEqual([
      { kind: 'text', content: 'Oi. Tchau.' },
      { kind: 'text', content: 'Pronto.' },
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
    const text = 'abcde'
    expect(delayForSegment({ kind: 'text', content: text })).toBe(
      5 * TEXT_DELAY_MS_PER_CHAR,
    )
  })

  it('empty text → 0ms', () => {
    expect(delayForSegment({ kind: 'text', content: '' })).toBe(0)
  })
})
