import { createAdminClient } from '@/lib/supabase/admin'

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24

export async function signedReadUrl(
  path: string | null,
): Promise<string | null> {
  if (!path) return null
  const admin = createAdminClient()
  const { data, error } = await admin.storage
    .from('chat-media')
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data) {
    console.error('signedReadUrl error', error)
    return null
  }
  return data.signedUrl
}
