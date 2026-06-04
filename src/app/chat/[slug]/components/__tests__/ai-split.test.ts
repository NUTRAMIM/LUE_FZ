import { describe, it, expect } from 'vitest'
import {
  splitAIMessage,
  expandInitialMessages,
  delayForSegment,
  PRODUCT_DELAY_MS,
  TEXT_DELAY_MS_PER_CHAR,
} from '../ai-split'

interface Msg {
  id: string
  role: 'user' | 'assistant' | 'operator' | 'system'
  content: string
  message_type: 'text' | 'image' | 'audio'
  media_url: string | null
  created_at: string
}

function msg(over: Partial<Msg> & { id: string; content: string }): Msg {
  return {
    role: 'assistant',
    message_type: 'text',
    media_url: null,
    created_at: '2026-06-04T10:00:00Z',
    ...over,
  }
}

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

describe('expandInitialMessages', () => {
  it('leaves user messages untouched', () => {
    const input = [msg({ id: 'u1', role: 'user', content: 'Oi. Tudo bem?' })]
    expect(expandInitialMessages(input)).toEqual(input)
  })

  it('leaves system messages untouched', () => {
    const input = [msg({ id: 's1', role: 'system', content: 'Aviso. Outro aviso.' })]
    expect(expandInitialMessages(input)).toEqual(input)
  })

  it('leaves non-text assistant messages (image/audio) untouched', () => {
    const input = [
      msg({ id: 'a1', message_type: 'image', content: '', media_url: 'http://x/a.jpg' }),
    ]
    expect(expandInitialMessages(input)).toEqual(input)
  })

  it('keeps a single-segment assistant message as one bubble (same id, trimmed)', () => {
    const out = expandInitialMessages([msg({ id: 'a1', content: '  Oi tudo bem?  ' })])
    expect(out).toEqual([msg({ id: 'a1', content: 'Oi tudo bem?' })])
  })

  it('splits a multi-product assistant message into separate bubbles', () => {
    const content =
      'Olha esses.\n[produto]Camiseta - R$ 50[/produto]\n[produto]Calça - R$ 120[/produto]'
    const out = expandInitialMessages([
      msg({ id: 'a1', content, created_at: '2026-06-04T12:00:00Z' }),
    ])
    expect(out).toEqual([
      msg({ id: 'a1-seg-0', content: 'Olha esses.', created_at: '2026-06-04T12:00:00Z' }),
      msg({ id: 'a1-seg-1', content: 'Camiseta - R$ 50', created_at: '2026-06-04T12:00:00Z' }),
      msg({ id: 'a1-seg-2', content: 'Calça - R$ 120', created_at: '2026-06-04T12:00:00Z' }),
    ])
  })

  it('splits operator messages too', () => {
    const out = expandInitialMessages([
      msg({ id: 'o1', role: 'operator', content: 'Primeiro. Segundo. Terceiro.' }),
    ])
    expect(out).toEqual([
      msg({ id: 'o1-seg-0', role: 'operator', content: 'Primeiro. Segundo.' }),
      msg({ id: 'o1-seg-1', role: 'operator', content: 'Terceiro.' }),
    ])
  })

  it('drops empty-content assistant text messages (matches realtime)', () => {
    expect(expandInitialMessages([msg({ id: 'a1', content: '   ' })])).toEqual([])
  })

  it('preserves order across mixed roles', () => {
    const input = [
      msg({ id: 'u1', role: 'user', content: 'quero ver tops' }),
      msg({ id: 'a1', content: '[produto]Top A[/produto]\n[produto]Top B[/produto]' }),
    ]
    const out = expandInitialMessages(input)
    expect(out.map((m) => m.id)).toEqual(['u1', 'a1-seg-0', 'a1-seg-1'])
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
