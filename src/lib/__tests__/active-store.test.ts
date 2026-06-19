import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockMaybeSingle = vi.fn()
const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))
const mockGetCookie = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ from: mockFrom })),
}))
vi.mock('@/lib/auth', () => ({ getAuthedUser: vi.fn() }))
vi.mock('@/lib/platform-admin', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: mockGetCookie })),
}))

import { getActiveStoreId, getStoreContext } from '../active-store'
import { getAuthedUser } from '@/lib/auth'
import { isPlatformAdmin } from '@/lib/platform-admin'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetCookie.mockReturnValue(undefined)
  vi.mocked(isPlatformAdmin).mockReturnValue(false)
})

describe('getActiveStoreId', () => {
  it('returns null when no user is authenticated', async () => {
    vi.mocked(getAuthedUser).mockResolvedValue(null)
    expect(await getActiveStoreId()).toBeNull()
  })

  it('returns store_id from store_members when row exists (agent case)', async () => {
    vi.mocked(getAuthedUser).mockResolvedValue({ id: 'agent-uuid' } as never)
    mockMaybeSingle.mockResolvedValue({ data: { store_id: 'store-uuid' } })
    expect(await getActiveStoreId()).toBe('store-uuid')
  })

  it('falls back to user.id when no store_members row exists (owner sem loja)', async () => {
    vi.mocked(getAuthedUser).mockResolvedValue({ id: 'owner-uuid' } as never)
    mockMaybeSingle.mockResolvedValue({ data: null })
    expect(await getActiveStoreId()).toBe('owner-uuid')
  })
})

describe('getStoreContext (impersonação)', () => {
  it('admin com cookie -> loja-alvo, role owner, impersonating true', async () => {
    vi.mocked(getAuthedUser).mockResolvedValue({ id: 'admin-uuid', email: 'a@lue.com' } as never)
    vi.mocked(isPlatformAdmin).mockReturnValue(true)
    mockGetCookie.mockReturnValue({ value: 'loja-alvo' })
    const ctx = await getStoreContext()
    expect(ctx).toEqual({ storeId: 'loja-alvo', role: 'owner', impersonating: true })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('não-admin com cookie -> ignora impersonação (fluxo normal)', async () => {
    vi.mocked(getAuthedUser).mockResolvedValue({ id: 'user-uuid' } as never)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    mockGetCookie.mockReturnValue({ value: 'loja-alvo' })
    mockMaybeSingle.mockResolvedValue({ data: { store_id: 'sua-loja', role: 'owner' } })
    const ctx = await getStoreContext()
    expect(ctx).toEqual({ storeId: 'sua-loja', role: 'owner', impersonating: false })
  })

  it('admin sem cookie -> fluxo normal', async () => {
    vi.mocked(getAuthedUser).mockResolvedValue({ id: 'admin-uuid' } as never)
    vi.mocked(isPlatformAdmin).mockReturnValue(true)
    mockGetCookie.mockReturnValue(undefined)
    mockMaybeSingle.mockResolvedValue({ data: null })
    const ctx = await getStoreContext()
    expect(ctx).toEqual({ storeId: 'admin-uuid', role: 'owner', impersonating: false })
  })
})
