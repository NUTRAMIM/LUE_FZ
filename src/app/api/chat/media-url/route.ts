import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { COOKIE_NAME, parseVisitorCookieValue } from '@/lib/visitor-cookie'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const path = body?.path
  if (typeof path !== 'string' || path.length === 0) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 })
  }

  const cookieStore = await cookies()
  const visitorId = parseVisitorCookieValue(cookieStore.get(COOKIE_NAME)?.value)
  if (!visitorId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Path shape: <store_id>/<conversation_id>/<message_id>.<ext>
  const segments = path.split('/')
  if (segments.length !== 3) {
    return NextResponse.json({ error: 'invalid path shape' }, { status: 400 })
  }
  const [storeId, conversationId] = segments

  const admin = createAdminClient()
  const { data: conv } = await admin
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('store_id', storeId)
    .eq('visitor_id', visitorId)
    .maybeSingle()

  if (!conv) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { data, error } = await admin.storage
    .from('chat-media')
    .createSignedUrl(path, 60 * 60 * 24)
  if (error || !data) {
    return NextResponse.json({ error: 'signed url failed' }, { status: 500 })
  }
  return NextResponse.json({ url: data.signedUrl })
}
