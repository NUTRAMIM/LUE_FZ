// src/lib/__tests__/subscription.test.ts
import { describe, it, expect } from 'vitest'
import { isActiveFromRow } from '../subscription'

describe('isActiveFromRow', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString()
  const past = new Date(Date.now() - 86_400_000).toISOString()

  it('active + future period = active', () => {
    expect(isActiveFromRow('active', future)).toBe(true)
  })
  it('active + null period = active (Stripe perpétuo/manual)', () => {
    expect(isActiveFromRow('active', null)).toBe(true)
  })
  it('active + past period = inactive (expirado)', () => {
    expect(isActiveFromRow('active', past)).toBe(false)
  })
  it('non-active status = inactive', () => {
    expect(isActiveFromRow('past_due', future)).toBe(false)
    expect(isActiveFromRow('canceled', future)).toBe(false)
    expect(isActiveFromRow(null, future)).toBe(false)
  })
})
