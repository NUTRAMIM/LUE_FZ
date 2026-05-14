import { describe, it, expect } from 'vitest'
import {
  visitorName,
  avatarColor,
  avatarInitials,
  formatRelativeTime,
  previewPrefix,
  truncatePreview,
} from '../formatters'

describe('visitorName', () => {
  it('uses lead_name when present', () => {
    expect(visitorName('any-uuid', 'João Silva')).toBe('João Silva')
  })

  it('falls back to "Visitante #" + first 6 chars when lead_name is null', () => {
    expect(visitorName('abc12345-6789-0000-1111-222222222222', null)).toBe(
      'Visitante #abc123',
    )
  })

  it('falls back when lead_name is empty string', () => {
    expect(visitorName('deadbeef-0000-0000-0000-000000000000', '')).toBe(
      'Visitante #deadbe',
    )
  })

  it('trims whitespace-only lead_name as missing', () => {
    expect(visitorName('feedface-1111-1111-1111-111111111111', '   ')).toBe(
      'Visitante #feedfa',
    )
  })
})

describe('avatarColor', () => {
  it('returns one of the palette colors', () => {
    const palette = [
      '#A78BFA', '#FBBF24', '#34D399', '#60A5FA',
      '#F87171', '#C4B5FD', '#F472B6', '#22D3EE',
    ]
    expect(palette).toContain(avatarColor('any-string'))
  })

  it('is deterministic — same input maps to same color', () => {
    expect(avatarColor('abc')).toBe(avatarColor('abc'))
  })

  it('different inputs can map to different colors', () => {
    const colors = new Set<string>()
    for (let i = 0; i < 20; i++) colors.add(avatarColor(`visitor-${i}`))
    expect(colors.size).toBeGreaterThan(1)
  })
})

describe('avatarInitials', () => {
  it('returns initials of two-word names', () => {
    expect(avatarInitials('João Silva')).toBe('JS')
  })

  it('returns first letter only for single-word names', () => {
    expect(avatarInitials('João')).toBe('J')
  })

  it('handles multiple words by taking first and last initials', () => {
    expect(avatarInitials('Maria da Silva')).toBe('MS')
  })

  it('returns "?" for empty input', () => {
    expect(avatarInitials('')).toBe('?')
  })

  it('uppercases lowercase names', () => {
    expect(avatarInitials('joão silva')).toBe('JS')
  })
})

describe('formatRelativeTime', () => {
  const now = new Date('2026-05-14T12:00:00Z')

  it('returns "agora" for < 60s', () => {
    expect(
      formatRelativeTime('2026-05-14T11:59:30Z', now),
    ).toBe('agora')
  })

  it('returns "Nmin" for < 1h', () => {
    expect(formatRelativeTime('2026-05-14T11:55:00Z', now)).toBe('5min')
  })

  it('returns "Nh" for < 24h', () => {
    expect(formatRelativeTime('2026-05-14T09:00:00Z', now)).toBe('3h')
  })

  it('returns "ontem" for 24-48h ago', () => {
    expect(formatRelativeTime('2026-05-13T12:00:00Z', now)).toBe('ontem')
  })

  it('returns DD/MM for older', () => {
    expect(formatRelativeTime('2026-05-01T12:00:00Z', now)).toBe('01/05')
  })

  it('returns empty string for null/undefined input', () => {
    expect(formatRelativeTime(null, now)).toBe('')
  })
})

describe('previewPrefix', () => {
  it('Visitante: for user role', () => {
    expect(previewPrefix('user')).toBe('Visitante: ')
  })

  it('IA: for assistant role', () => {
    expect(previewPrefix('assistant')).toBe('IA: ')
  })

  it('Você: for operator role', () => {
    expect(previewPrefix('operator')).toBe('Você: ')
  })

  it('empty for system role', () => {
    expect(previewPrefix('system')).toBe('')
  })

  it('empty for null', () => {
    expect(previewPrefix(null)).toBe('')
  })
})

describe('truncatePreview', () => {
  it('returns original string when shorter than max', () => {
    expect(truncatePreview('curto', 120)).toBe('curto')
  })

  it('truncates and appends "…" when longer than max', () => {
    const long = 'a'.repeat(130)
    const out = truncatePreview(long, 120)
    expect(out.length).toBe(121) // 120 + '…'
    expect(out.endsWith('…')).toBe(true)
  })

  it('returns "" for null/undefined', () => {
    expect(truncatePreview(null, 120)).toBe('')
  })
})
