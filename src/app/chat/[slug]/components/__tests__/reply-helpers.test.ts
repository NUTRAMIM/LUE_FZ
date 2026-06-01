import { describe, it, expect } from 'vitest'
import {
  normalizeMessageId,
  segmentIndexFromId,
  replyAuthorForRole,
  replyPreviewText,
  truncate,
  shouldTriggerReply,
  SWIPE_TRIGGER_PX,
} from '../reply-helpers'

describe('normalizeMessageId', () => {
  it('remove o sufixo -seg-N de segmentos da IA', () => {
    expect(normalizeMessageId('abc-123-seg-0')).toBe('abc-123')
    expect(normalizeMessageId('abc-123-seg-12')).toBe('abc-123')
  })
  it('mantém id real intocado', () => {
    expect(normalizeMessageId('abc-123')).toBe('abc-123')
    expect(normalizeMessageId('temp-1700000000000')).toBe('temp-1700000000000')
  })
})

describe('segmentIndexFromId', () => {
  it('extrai o índice do segmento de um id -seg-N', () => {
    expect(segmentIndexFromId('abc-123-seg-0')).toBe(0)
    expect(segmentIndexFromId('abc-123-seg-12')).toBe(12)
  })
  it('retorna undefined para id real sem sufixo', () => {
    expect(segmentIndexFromId('abc-123')).toBeUndefined()
    expect(segmentIndexFromId('temp-1700000000000')).toBeUndefined()
  })
})

describe('replyAuthorForRole', () => {
  it('mapeia user para cliente', () => {
    expect(replyAuthorForRole('user')).toBe('cliente')
  })
  it('mapeia assistant e operator para loja', () => {
    expect(replyAuthorForRole('assistant')).toBe('loja')
    expect(replyAuthorForRole('operator')).toBe('loja')
  })
})

describe('replyPreviewText', () => {
  it('rotula imagem e áudio', () => {
    expect(replyPreviewText({ message_type: 'image', content: '' })).toBe('📷 Imagem')
    expect(replyPreviewText({ message_type: 'audio', content: '' })).toBe('🎤 Áudio')
  })
  it('usa o content em mensagens de texto', () => {
    expect(replyPreviewText({ message_type: 'text', content: 'olá' })).toBe('olá')
  })
})

describe('truncate', () => {
  it('mantém texto curto', () => {
    expect(truncate('curto', 80)).toBe('curto')
  })
  it('corta com reticências em texto longo', () => {
    const long = 'a'.repeat(100)
    const out = truncate(long, 80)
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBe(81)
  })
})

describe('shouldTriggerReply', () => {
  it('dispara no limiar e acima', () => {
    expect(shouldTriggerReply(SWIPE_TRIGGER_PX)).toBe(true)
    expect(shouldTriggerReply(SWIPE_TRIGGER_PX + 10)).toBe(true)
  })
  it('não dispara abaixo do limiar', () => {
    expect(shouldTriggerReply(SWIPE_TRIGGER_PX - 1)).toBe(false)
    expect(shouldTriggerReply(0)).toBe(false)
  })
})
