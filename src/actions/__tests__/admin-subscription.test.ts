import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUpsert = vi.fn(async () => ({ error: null }))
const mockUpdateEq = vi.fn(async () => ({ error: null }))
const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }))
const mockFrom = vi.fn(() => ({ upsert: mockUpsert, update: mockUpdate }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getAuthedUser: vi.fn() }))
vi.mock('@/lib/platform-admin', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({ from: mockFrom })) }))

import { setStoreSubscription } from '../admin-subscription'
import { getAuthedUser } from '@/lib/auth'
import { isPlatformAdmin } from '@/lib/platform-admin'

beforeEach(() => { vi.clearAllMocks() })

describe('setStoreSubscription (gate de admin)', () => {
  it('não escreve para não-admin', async () => {
    vi.mocked(getAuthedUser).mockResolvedValue({ id: 'u' } as never)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    await setStoreSubscription('loja', 'grant')
    expect(mockUpsert).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('grant faz upsert active/manual para admin', async () => {
    vi.mocked(getAuthedUser).mockResolvedValue({ id: 'admin' } as never)
    vi.mocked(isPlatformAdmin).mockReturnValue(true)
    await setStoreSubscription('loja', 'grant')
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ store_id: 'loja', status: 'active', provider: 'manual', plan_id: 'essencial' }),
      expect.objectContaining({ onConflict: 'store_id' }),
    )
  })

  it('revoke atualiza status para canceled', async () => {
    vi.mocked(getAuthedUser).mockResolvedValue({ id: 'admin' } as never)
    vi.mocked(isPlatformAdmin).mockReturnValue(true)
    await setStoreSubscription('loja', 'revoke')
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'canceled' }))
    expect(mockUpdateEq).toHaveBeenCalledWith('store_id', 'loja')
  })
})
