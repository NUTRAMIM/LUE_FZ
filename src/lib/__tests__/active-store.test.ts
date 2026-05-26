import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocka as deps do helper. Como o helper só compõe `getAuthedUser` +
// uma query do supabase server client, testamos a lógica de fallback.
const mockMaybeSingle = vi.fn()
const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ from: mockFrom })),
}))

vi.mock('@/lib/auth', () => ({
  getAuthedUser: vi.fn(),
}))

import { getActiveStoreId } from '../active-store'
import { getAuthedUser } from '@/lib/auth'

beforeEach(() => {
  vi.clearAllMocks()
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
