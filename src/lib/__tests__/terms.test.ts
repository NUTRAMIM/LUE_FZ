import { describe, it, expect } from 'vitest'
import { shouldGateTerms } from '@/lib/terms'

describe('shouldGateTerms', () => {
  it('gateia owner que ainda nao aceitou a versao atual', () => {
    expect(shouldGateTerms({ role: 'owner', hasAcceptedCurrent: false })).toBe(true)
  })

  it('libera owner que ja aceitou', () => {
    expect(shouldGateTerms({ role: 'owner', hasAcceptedCurrent: true })).toBe(false)
  })

  it('nunca gateia agent (vendedor), aceito ou nao', () => {
    expect(shouldGateTerms({ role: 'agent', hasAcceptedCurrent: false })).toBe(false)
    expect(shouldGateTerms({ role: 'agent', hasAcceptedCurrent: true })).toBe(false)
  })
})
