import { describe, it, expect } from 'vitest'
import { nextFor, pickTemplate, buildActionUrl } from '../emails/hook'
import {
  confirmSignupTemplate,
  resetPasswordTemplate,
  genericAuthTemplate,
} from '../emails/templates'

describe('nextFor', () => {
  it('recovery → /reset-password', () => {
    expect(nextFor('recovery')).toBe('/reset-password')
  })
  it('signup → /painel', () => {
    expect(nextFor('signup')).toBe('/painel')
  })
  it('tipo desconhecido → /painel', () => {
    expect(nextFor('magiclink')).toBe('/painel')
  })
})

describe('pickTemplate', () => {
  it('signup → confirmSignupTemplate', () => {
    expect(pickTemplate('signup')).toBe(confirmSignupTemplate)
  })
  it('recovery → resetPasswordTemplate', () => {
    expect(pickTemplate('recovery')).toBe(resetPasswordTemplate)
  })
  it('desconhecido → genericAuthTemplate', () => {
    expect(pickTemplate('email_change')).toBe(genericAuthTemplate)
  })
})

describe('buildActionUrl', () => {
  it('monta URL de recovery com token_hash, type e next encodados', () => {
    const url = buildActionUrl(
      { token_hash: 'abc123', email_action_type: 'recovery' },
      'https://ialue.com.br',
    )
    expect(url).toBe(
      'https://ialue.com.br/auth/confirm?token_hash=abc123&type=recovery&next=%2Freset-password',
    )
  })

  it('usa /painel pra signup', () => {
    const url = buildActionUrl(
      { token_hash: 'tok', email_action_type: 'signup' },
      'https://ialue.com.br',
    )
    expect(url).toContain('type=signup')
    expect(url).toContain('next=%2Fpainel')
  })

  it('usa o baseUrl passado, ignorando qualquer site_url do payload', () => {
    const url = buildActionUrl(
      { token_hash: 'tok', email_action_type: 'recovery' },
      'https://ialue.com.br',
    )
    expect(url.startsWith('https://ialue.com.br/auth/confirm')).toBe(true)
  })
})
