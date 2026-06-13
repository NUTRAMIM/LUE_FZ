import { describe, it, expect } from 'vitest'
import {
  confirmSignupTemplate,
  resetPasswordTemplate,
  genericAuthTemplate,
} from '../emails/templates'

const ACTION_URL =
  'https://ialue.com.br/auth/confirm?token_hash=x&type=signup&next=%2Fpainel'

describe.each([
  ['confirmSignup', confirmSignupTemplate],
  ['resetPassword', resetPasswordTemplate],
  ['genericAuth', genericAuthTemplate],
])('%s template', (_name, tpl) => {
  it('tem subject não-vazio', () => {
    expect(tpl.subject.length).toBeGreaterThan(0)
  })

  it('render inclui o actionUrl', () => {
    expect(tpl.render(ACTION_URL)).toContain(ACTION_URL)
  })

  it('render inclui a marca LUE', () => {
    expect(tpl.render(ACTION_URL)).toContain('LUE')
  })
})

describe('confirmSignupTemplate', () => {
  it('subject menciona confirmação/cadastro', () => {
    expect(confirmSignupTemplate.subject.toLowerCase()).toMatch(/confirm|cadastro/)
  })
})

describe('resetPasswordTemplate', () => {
  it('subject menciona senha', () => {
    expect(resetPasswordTemplate.subject.toLowerCase()).toContain('senha')
  })
})
