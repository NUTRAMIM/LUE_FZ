import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  COOKIE_NAME,
  COOKIE_OPTIONS,
  buildVisitorCookieValue,
  generateVisitorId,
  parseVisitorCookieValue,
} from '@/lib/visitor-cookie'

// Rotas que exigem usuário logado (qualquer um — sem checagem de billing).
// Inclui /planos pra a gente saber quem é o usuário ao montar checkout.
const AUTH_PROTECTED = [
  '/painel',
  '/estoque',
  '/loja',
  '/conversas',
  '/equipe',
  '/leads',
  '/planos',
] as const

// Rotas que exigem assinatura ativa. Subset de AUTH_PROTECTED. /equipe e
// /leads ficam de fora propositalmente — billing-gating não se aplica a eles
// neste MVP.
const BILLING_GATED = ['/painel', '/estoque', '/loja', '/conversas'] as const

function ensureVisitorCookie(request: NextRequest): NextResponse {
  const raw = request.cookies.get(COOKIE_NAME)?.value
  if (parseVisitorCookieValue(raw)) {
    return NextResponse.next({ request })
  }
  const newId = generateVisitorId()
  const value = buildVisitorCookieValue(newId)
  // Muta o request.cookies pra que o Server Component downstream
  // (ensureConversation) leia o mesmo visitor_id que mandamos pro browser.
  // Sem isso, o Server Component vê request sem cookie e gera um id próprio,
  // divergindo do que o browser recebe — resulta em "trocou de visitante" a
  // cada refresh.
  request.cookies.set(COOKIE_NAME, value)
  const response = NextResponse.next({ request })
  response.cookies.set(COOKIE_NAME, value, COOKIE_OPTIONS)
  return response
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/chat/')) {
    return ensureVisitorCookie(request)
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const needsAuth = AUTH_PROTECTED.some((p) => pathname.startsWith(p))
  const needsBilling = BILLING_GATED.some((p) => pathname.startsWith(p))

  if (!user && needsAuth) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && needsBilling) {
    const { data: sub, error: subError } = await supabase
      .from('store_subscriptions')
      .select('status, current_period_end')
      .eq('store_id', user.id)
      .maybeSingle()
    if (subError) {
      console.error('middleware billing query error', {
        message: subError.message,
        code: subError.code,
        details: subError.details,
        hint: subError.hint,
      })
    }
    const periodOk =
      !sub?.current_period_end || new Date(sub.current_period_end) > new Date()
    const active = sub?.status === 'active' && periodOk
    if (!active) {
      const url = request.nextUrl.clone()
      url.pathname = '/planos'
      return NextResponse.redirect(url)
    }
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/painel'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|widget|api).*)'],
  runtime: 'nodejs',
}
