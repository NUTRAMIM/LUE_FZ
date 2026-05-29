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

  it('one text segment for content without markers or paragraphs', () => {
    expect(splitAIMessage('oi tudo bem')).toEqual([
      { kind: 'text', content: 'oi tudo bem' },
    ])
  })

  it('splits paragraphs separated by double newlines', () => {
    expect(splitAIMessage('Oi!\n\nTudo bem?\n\nAté logo')).toEqual([
      { kind: 'text', content: 'Oi!' },
      { kind: 'text', content: 'Tudo bem?' },
      { kind: 'text', content: 'Até logo' },
    ])
  })

  it('extracts [produto]...[/produto] as product segments', () => {
    expect(
      splitAIMessage('[produto]Camiseta Azul - R$ 50[/produto]'),
    ).toEqual([{ kind: 'product', content: 'Camiseta Azul - R$ 50' }])
  })

  it('mixes text and product segments preserving order', () => {
    const input =
      'Encontrei estes produtos:\n\n[produto]Camiseta - R$ 50[/produto]\n\n[produto]Calça - R$ 120[/produto]\n\nGostou?'
    expect(splitAIMessage(input)).toEqual([
      { kind: 'text', content: 'Encontrei estes produtos:' },
      { kind: 'product', content: 'Camiseta - R$ 50' },
      { kind: 'product', content: 'Calça - R$ 120' },
      { kind: 'text', content: 'Gostou?' },
    ])
  })

  it('handles empty product block by skipping it', () => {
    expect(splitAIMessage('Oi\n\n[produto][/produto]\n\nTchau')).toEqual([
      { kind: 'text', content: 'Oi' },
      { kind: 'text', content: 'Tchau' },
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
