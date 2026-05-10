import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const path = body?.path
  if (typeof path !== 'string' || path.length === 0) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 })
  }
  const admin = createAdminClient()
  const { data, error } = await admin.storage
    .from('chat-media')
    .createSignedUrl(path, 60 * 60 * 24)
  if (error || !data) {
    return NextResponse.json({ error: 'signed url failed' }, { status: 500 })
  }
  return NextResponse.json({ url: data.signedUrl })
}
