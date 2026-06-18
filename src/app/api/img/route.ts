import { NextRequest, NextResponse } from 'next/server'
import { assertPublicUrl } from '@/lib/ssrf'

// assertPublicUrl usa node:dns -> precisa do runtime Node (não edge).
export const runtime = 'nodejs'

// Proxy de imagem: serve a foto do produto pelo NOSSO domínio. Resolve "imagem
// não carrega no mobile" quando o host externo (ex.: facilzap) bloqueia hotlink
// por referer/user-agent, ou quando a URL é http (mixed content). O servidor
// busca a imagem (sem referer/cookies) e devolve como mesma origem.
export async function GET(request: NextRequest): Promise<Response> {
  const u = request.nextUrl.searchParams.get('u')
  if (!u) {
    return NextResponse.json({ error: 'Missing url.' }, { status: 400 })
  }

  try {
    await assertPublicUrl(u)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'URL inválida.'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  let upstream: Response
  try {
    upstream = await fetch(u, {
      headers: { 'User-Agent': 'LUE-FZ-image-proxy' },
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    return NextResponse.json({ error: 'Falha ao buscar a imagem.' }, { status: 502 })
  }

  const contentType = upstream.headers.get('content-type') ?? ''
  // só repassa imagem — evita virar proxy aberto de qualquer conteúdo
  if (!upstream.ok || !upstream.body || !contentType.startsWith('image/')) {
    return NextResponse.json({ error: 'Imagem indisponível.' }, { status: 502 })
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400, s-maxage=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
