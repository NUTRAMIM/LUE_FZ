import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  COOKIE_NAME,
  COOKIE_OPTIONS,
  buildVisitorCookieValue,
  generateVisitorId,
  parseVisitorCookieValue,
} from '@/lib/visitor-cookie'

const AUTH_PROTECTED = [
  '/painel',
  '/estoque',
  '/loja',
  '/conversas',
  '/equipe',
  '/leads',
  '/planos',
] as const

const BILLING_GATED = ['/painel', '/estoque', '/loja', '/conversas'] as const

function ensureVisitorCookie(request: NextRequest): NextResponse {
  const raw = request.cookies.get(COOKIE_NAME)?.value
  if (parseVisitorCookieValue(raw)) {
    return NextResponse.next({ request })
  }
  const newId = generateVisitorId()
  const value = buildVisitorCookieValue(newId)
  request.cookies.set(COOKIE_NAME, value)
  const response = NextResponse.next({ request })
  response.cookies.set(COOKIE_NAME, value, COOKIE_OPTIONS)
  return response
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Chat público mantém o cookie de visitante.
  if (pathname.startsWith('/chat/')) {
    return ensureVisitorCookie(request)
  }

  // Página de aceite de convite é pública — vendedor sem conta abre aqui.
  if (pathname.startsWith('/convite/')) {
    return NextResponse.next({ request })
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

  // Resolve membership uma vez — usado pelo billing-gate e pelo redirect
  // pós-login. Owner que não configurou a loja não tem row e cai no
  // fallback (storeId = user.id).
  let membership: { store_id: string; role: 'owner' | 'agent' } | null = null
  if (user) {
    const { data } = await supabase
      .from('store_members')
      .select('store_id, role')
      .eq('user_id', user.id)
      .maybeSingle()
    membership = data ?? null
  }

  if (user && needsBilling) {
    const storeId = membership?.store_id ?? user.id
    const { data: sub, error: subError } = await supabase
      .from('store_subscriptions')
      .select('status, current_period_end')
      .eq('store_id', storeId)
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

  // Pós-login: destino depende do role. Centraliza o redirect aqui em vez
  // de no /login (que hoje força /painel pra todo mundo).
  if (user && pathname === '/login') {
    const role = membership?.role === 'agent' ? 'agent' : 'owner'
    const url = request.nextUrl.clone()
    url.pathname = role === 'agent' ? '/conversas' : '/painel'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|widget|api).*)'],
  runtime: 'nodejs',
}
