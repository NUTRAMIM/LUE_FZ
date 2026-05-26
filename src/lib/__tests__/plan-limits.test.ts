import { describe, it, expect } from 'vitest'
import { maxAgentsForPlan } from '../plan-limits'

describe('maxAgentsForPlan', () => {
  it('returns 3 for essencial', () => {
    expect(maxAgentsForPlan('essencial')).toBe(3)
  })
  it('returns 5 for profissional', () => {
    expect(maxAgentsForPlan('profissional')).toBe(5)
  })
  it('returns 10 for performance', () => {
    expect(maxAgentsForPlan('performance')).toBe(10)
  })
  it('returns 0 for unknown plan ids', () => {
    expect(maxAgentsForPlan('legacy-pro')).toBe(0)
    expect(maxAgentsForPlan(null)).toBe(0)
    expect(maxAgentsForPlan(undefined)).toBe(0)
  })
})
