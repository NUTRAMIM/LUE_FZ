import { describe, it, expect } from 'vitest'
import { isLivePendingInvite } from '../invite-status'

const NOW = new Date('2026-05-28T12:00:00Z')
const future = '2026-06-04T12:00:00Z'
const past = '2026-05-20T12:00:00Z'

describe('isLivePendingInvite', () => {
  it('returns false for a null invite', () => {
    expect(isLivePendingInvite(null, NOW)).toBe(false)
  })

  it('returns false when the invite was already accepted', () => {
    expect(
      isLivePendingInvite(
        { accepted_at: '2026-05-25T12:00:00Z', expires_at: future },
        NOW,
      ),
    ).toBe(false)
  })

  it('returns false when a not-yet-accepted invite is expired', () => {
    expect(
      isLivePendingInvite({ accepted_at: null, expires_at: past }, NOW),
    ).toBe(false)
  })

  it('returns true when the invite is unaccepted and not expired', () => {
    expect(
      isLivePendingInvite({ accepted_at: null, expires_at: future }, NOW),
    ).toBe(true)
  })
})
