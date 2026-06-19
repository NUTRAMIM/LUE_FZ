import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetCookie = vi.fn()
const createServerClient = vi.fn((..._args: unknown[]) => ({ ok: true }))

vi.mock('@supabase/ssr', () => ({ createServerClient: (...a: unknown[]) => createServerClient(...a) }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: mockGetCookie, getAll: () => [], set: () => {} })),
}))

import { createClient } from '../supabase/server'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
})

describe('createClient header de impersonação', () => {
  it('injeta x-impersonate-store quando o cookie existe', async () => {
    mockGetCookie.mockImplementation((name: string) =>
      name === 'impersonate_store' ? { value: 'loja-alvo' } : undefined)
    await createClient()
    const opts = createServerClient.mock.calls[0][2] as { global?: { headers?: Record<string, string> } }
    expect(opts.global?.headers?.['x-impersonate-store']).toBe('loja-alvo')
  })

  it('não injeta header quando não há cookie', async () => {
    mockGetCookie.mockReturnValue(undefined)
    await createClient()
    const opts = createServerClient.mock.calls[0][2] as { global?: { headers?: Record<string, string> } }
    expect(opts.global?.headers?.['x-impersonate-store']).toBeUndefined()
  })
})
