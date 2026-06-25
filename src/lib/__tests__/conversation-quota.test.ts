import { describe, it, expect } from 'vitest'
import { isWithinQuota, monthStartIso } from '../conversation-quota'

describe('isWithinQuota', () => {
  it('allows when fewer prior conversations than the limit', () => {
    expect(isWithinQuota(0, 1000)).toBe(true)
    expect(isWithinQuota(999, 1000)).toBe(true) // a 1000ª conversa cabe
  })
  it('blocks at and beyond the limit', () => {
    expect(isWithinQuota(1000, 1000)).toBe(false) // a 1001ª não cabe
    expect(isWithinQuota(5000, 1000)).toBe(false)
  })
})

describe('monthStartIso', () => {
  it('returns the first day of the month at 00:00 UTC', () => {
    const iso = monthStartIso(new Date('2026-06-24T15:30:00.000Z'))
    expect(iso).toBe('2026-06-01T00:00:00.000Z')
  })
})
