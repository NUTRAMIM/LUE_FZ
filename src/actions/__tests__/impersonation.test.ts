import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSet = vi.fn()
const mockDelete = vi.fn()
const mockMaybeSingle = vi.fn(
  async (): Promise<{ data: { id: string } | null }> => ({ data: { id: 'loja-alvo' } }),
)
const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ set: mockSet, delete: mockDelete })),
}))
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => { throw new Error('REDIRECT') }),
}))
vi.mock('@/lib/auth', () => ({ getAuthedUser: vi.fn() }))
vi.mock('@/lib/platform-admin', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({ from: mockFrom })) }))

import { enterStore, exitStore } from '../impersonation'
import { getAuthedUser } from '@/lib/auth'
import { isPlatformAdmin } from '@/lib/platform-admin'

beforeEach(() => { vi.clearAllMocks() })

describe('enterStore (gate de admin)', () => {
  it('não seta cookie para não-admin', async () => {
    vi.mocked(getAuthedUser).mockResolvedValue({ id: 'u' } as never)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    await enterStore('loja-alvo')
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('não seta cookie (nem redireciona) quando a loja não existe', async () => {
    vi.mocked(getAuthedUser).mockResolvedValue({ id: 'admin' } as never)
    vi.mocked(isPlatformAdmin).mockReturnValue(true)
    mockMaybeSingle.mockResolvedValueOnce({ data: null })
    await expect(enterStore('loja-fantasma')).resolves.toBeUndefined()
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('seta cookie endurecido para admin quando a loja existe', async () => {
    vi.mocked(getAuthedUser).mockResolvedValue({ id: 'admin' } as never)
    vi.mocked(isPlatformAdmin).mockReturnValue(true)
    await expect(enterStore('loja-alvo')).rejects.toThrow('REDIRECT')
    expect(mockSet).toHaveBeenCalledWith('impersonate_store', 'loja-alvo', expect.objectContaining({
      httpOnly: true, secure: true, sameSite: 'lax', path: '/',
    }))
  })
})

describe('exitStore', () => {
  it('limpa o cookie e redireciona', async () => {
    await expect(exitStore()).rejects.toThrow('REDIRECT')
    expect(mockDelete).toHaveBeenCalledWith('impersonate_store')
  })
})
