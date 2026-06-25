import { describe, it, expect } from 'vitest'
import { PLANS, resolvePlanCycle, planPriceCents, planDurationDays } from '../plans'

describe('PLANS catalog', () => {
  it('has the three real plans', () => {
    expect(Object.keys(PLANS).sort()).toEqual(
      ['essencial', 'performance', 'profissional'],
    )
  })
  it('monthly prices are 197/287/547 in cents', () => {
    expect(PLANS.essencial.monthly.price_brl).toBe(19700)
    expect(PLANS.profissional.monthly.price_brl).toBe(28700)
    expect(PLANS.performance.monthly.price_brl).toBe(54700)
  })
  it('monthly is 30 days, quarterly is 90 days', () => {
    expect(PLANS.essencial.monthly.duration_days).toBe(30)
    expect(PLANS.essencial.quarterly.duration_days).toBe(90)
  })
})

describe('resolvePlanCycle', () => {
  it('resolves a valid plan + cycle', () => {
    const r = resolvePlanCycle('profissional', 'quarterly')
    expect(r).not.toBeNull()
    expect(r!.planId).toBe('profissional')
    expect(r!.cycle).toBe('quarterly')
    expect(r!.pricing.duration_days).toBe(90)
  })
  it('defaults cycle to monthly when missing', () => {
    const r = resolvePlanCycle('essencial', undefined)
    expect(r!.cycle).toBe('monthly')
  })
  it('rejects unknown plan', () => {
    expect(resolvePlanCycle('pirata', 'monthly')).toBeNull()
  })
  it('rejects unknown cycle', () => {
    expect(resolvePlanCycle('essencial', 'weekly')).toBeNull()
  })
})

describe('helpers', () => {
  it('planPriceCents returns the cycle price', () => {
    expect(planPriceCents('performance', 'monthly')).toBe(54700)
  })
  it('planDurationDays returns the cycle duration', () => {
    expect(planDurationDays('performance', 'quarterly')).toBe(90)
  })
  it('helpers return null for unknown', () => {
    expect(planPriceCents('x', 'monthly')).toBeNull()
    expect(planDurationDays('essencial', 'x')).toBeNull()
  })
})
