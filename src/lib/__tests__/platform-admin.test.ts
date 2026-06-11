import { describe, it, expect, afterEach } from 'vitest'
import { isPlatformAdmin } from '../platform-admin'

const ORIGINAL = process.env.PLATFORM_ADMIN_EMAILS

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.PLATFORM_ADMIN_EMAILS
  } else {
    process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL
  }
})

describe('isPlatformAdmin', () => {
  it('retorna false quando a env está ausente (fail-closed)', () => {
    delete process.env.PLATFORM_ADMIN_EMAILS
    expect(isPlatformAdmin({ email: 'dono@lue.com' })).toBe(false)
  })

  it('retorna false quando a env está vazia', () => {
    process.env.PLATFORM_ADMIN_EMAILS = '   '
    expect(isPlatformAdmin({ email: 'dono@lue.com' })).toBe(false)
  })

  it('retorna false para user nulo ou sem email', () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'admin@lue.com'
    expect(isPlatformAdmin(null)).toBe(false)
    expect(isPlatformAdmin({})).toBe(false)
  })

  it('faz match case-insensitive e ignorando espaços', () => {
    process.env.PLATFORM_ADMIN_EMAILS = ' Admin@Lue.com , socio@lue.com '
    expect(isPlatformAdmin({ email: 'admin@lue.com' })).toBe(true)
    expect(isPlatformAdmin({ email: 'SOCIO@LUE.COM' })).toBe(true)
  })

  it('retorna false para email fora da lista', () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'admin@lue.com'
    expect(isPlatformAdmin({ email: 'intruso@lue.com' })).toBe(false)
  })
})
