# Equipe — Convite de vendedor por link · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o dono de uma loja convide vendedores (não-pagantes) via link copiável; consertar os bugs de billing que hoje bloqueiam o vendedor em `/conversas`.

**Architecture:** Tabela nova `store_invites` com token expirável; helper `getActiveStoreId` centraliza a resolução de loja (corrige billing-gate que hoje usa `user.id` direto); rota pública `/convite/[token]` para o vendedor definir senha e logar; guards de role nas páginas owner-only redirecionam agent pra `/conversas`; limite de vendedores por plano.

**Tech Stack:** Next.js 16 (App Router), Supabase (auth + Postgres + RLS), TypeScript, vitest para unit tests, manual end-to-end no browser.

**Spec:** `docs/superpowers/specs/2026-05-26-equipe-convite-vendedor-design.md`

**Note on testing:** O projeto usa vitest para libs puras (`src/lib/__tests__/`) e verificação manual no browser para tudo que toca DB/UI. Server actions e componentes React não têm test harness setup, então seguimos o padrão: unit-test o que dá pra testar isolado, manual no resto.

---

## Task 1: Migração SQL + types/database.ts

**Files:**
- Create: `supabase/migrations/031_store_invites.sql`
- Modify: `src/types/database.ts:308-335` (adicionar `store_invites` no bloco `Tables:` depois de `store_members`)

- [ ] **Step 1: Criar a migração**

Conteúdo de `supabase/migrations/031_store_invites.sql`:

```sql
-- 031_store_invites.sql
-- Convites pendentes pra um email virar vendedor (agent) de uma loja.
-- O owner gera um token e copia o link; o vendedor abre /convite/{token},
-- define senha e a conta vira agent. Sem dependência de SMTP.

CREATE TABLE store_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES store_settings(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  full_name   TEXT NOT NULL,
  token       TEXT NOT NULL UNIQUE,
  invited_by  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (store_id, email)
);

CREATE INDEX idx_store_invites_token ON store_invites (token);

ALTER TABLE store_invites ENABLE ROW LEVEL SECURITY;

-- Owner enxerga convites da própria loja. INSERT/UPDATE/DELETE via service
-- role nas server actions — sem policy de escrita pra anon/authenticated.
CREATE POLICY "store_invites_select_owner" ON store_invites FOR SELECT
  USING (store_id IN (
    SELECT store_id FROM store_members
    WHERE user_id = auth.uid() AND role = 'owner'
  ));
```

- [ ] **Step 2: Aplicar migração no banco local**

Como o projeto não usa Supabase CLI por aqui, abre o painel do Supabase do projeto (Project → SQL Editor) e roda o conteúdo do arquivo. Confere com:

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'store_invites' ORDER BY ordinal_position;
```

Esperado: 9 colunas (id, store_id, email, full_name, token, invited_by, expires_at, accepted_at, created_at).

- [ ] **Step 3: Atualizar types/database.ts**

Em `src/types/database.ts`, depois do bloco `store_members: { ... }` (linha ~335) e antes de `knowledge_gaps: { ... }`, inserir:

```ts
      store_invites: {
        Row: {
          id: string
          store_id: string
          email: string
          full_name: string
          token: string
          invited_by: string
          expires_at: string
          accepted_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          store_id: string
          email: string
          full_name: string
          token: string
          invited_by: string
          expires_at: string
          accepted_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          store_id?: string
          email?: string
          full_name?: string
          token?: string
          invited_by?: string
          expires_at?: string
          accepted_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/031_store_invites.sql src/types/database.ts
git commit -m "feat(equipe): add store_invites table for vendor invites"
```

---

## Task 2: Helper getActiveStoreId

**Files:**
- Create: `src/lib/active-store.ts`
- Create: `src/lib/__tests__/active-store.test.ts`

- [ ] **Step 1: Escrever o teste primeiro**

Conteúdo de `src/lib/__tests__/active-store.test.ts`:

```ts
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
```

- [ ] **Step 2: Rodar o teste pra confirmar que falha**

Run: `npx vitest run src/lib/__tests__/active-store.test.ts`
Expected: FAIL com "Cannot find module '../active-store'".

- [ ] **Step 3: Implementar o helper**

Conteúdo de `src/lib/active-store.ts`:

```ts
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'

// Resolve o store_id do user atual. Cacheado por request (mesmo padrão do
// getAuthedUser) pra evitar query duplicada quando middleware + page +
// actions chamam no mesmo render.
//
//   - Sem user logado: null
//   - Tem row em store_members: usa o store_id (cobre owner com loja
//     configurada e agent)
//   - Sem row em store_members: fallback user.id (preserva a convenção
//     anterior do projeto onde owner.store_id = owner.user.id antes do
//     seed da membership rodar)
export const getActiveStoreId = cache(async (): Promise<string | null> => {
  const user = await getAuthedUser()
  if (!user) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from('store_members')
    .select('store_id')
    .eq('user_id', user.id)
    .maybeSingle()
  return data?.store_id ?? user.id
})
```

- [ ] **Step 4: Rodar o teste de novo**

Run: `npx vitest run src/lib/__tests__/active-store.test.ts`
Expected: 3 testes PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/active-store.ts src/lib/__tests__/active-store.test.ts
git commit -m "feat(lib): add getActiveStoreId helper for store_id resolution"
```

---

## Task 3: Limites por plano (maxAgents + plan-limits.ts)

**Files:**
- Modify: `src/lib/plans-display.ts` (adicionar `maxAgents` em cada `PlanDisplay`)
- Create: `src/lib/plan-limits.ts`
- Create: `src/lib/__tests__/plan-limits.test.ts`

- [ ] **Step 1: Adicionar maxAgents na interface PlanDisplay**

Em `src/lib/plans-display.ts`, no `interface PlanDisplay` (linhas 6-20), adicionar:

```ts
export interface PlanDisplay {
  id: 'essencial' | 'profissional' | 'performance'
  name: string
  for: string
  msgs: string
  msgsLimit: number
  maxAgents: number   // <-- novo
  priceMonthly: number
  priceAnnual: number
  cpm: string
  intro?: string
  feats: string[]
  cta: string
  featured?: boolean
  badge?: string
}
```

E em cada um dos 3 itens do array `PLANS_DISPLAY`, adicionar `maxAgents`:

- `essencial`: `maxAgents: 3,`
- `profissional`: `maxAgents: 5,`
- `performance`: `maxAgents: 10,`

(Coloca depois de `msgsLimit` em cada bloco — não toca em mais nada do array.)

- [ ] **Step 2: Type-check pra confirmar que não quebrou nenhum consumer**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Escrever o teste do plan-limits**

Conteúdo de `src/lib/__tests__/plan-limits.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { maxAgentsForPlan } from '../plan-limits'

describe('maxAgentsForPlan', () => {
  it('returns 3 for essencial', () => {
    expect(maxAgentsForPlan('essencial')).toBe(3)
  })
  it('returns 5 for profissional', () => {
    expect(maxAgentsForPlan('profissional')).toBe(5)
  })
  it('returns 10 for performance', () => {
    expect(maxAgentsForPlan('performance')).toBe(10)
  })
  it('returns 0 for unknown plan ids', () => {
    expect(maxAgentsForPlan('legacy-pro')).toBe(0)
    expect(maxAgentsForPlan(null)).toBe(0)
    expect(maxAgentsForPlan(undefined)).toBe(0)
  })
})
```

- [ ] **Step 4: Rodar o teste pra confirmar que falha**

Run: `npx vitest run src/lib/__tests__/plan-limits.test.ts`
Expected: FAIL com "Cannot find module '../plan-limits'".

- [ ] **Step 5: Implementar o plan-limits**

Conteúdo de `src/lib/plan-limits.ts`:

```ts
import { createClient } from '@/lib/supabase/server'
import { PLANS_DISPLAY, type PlanDisplay } from '@/lib/plans-display'

// Resolve o maxAgents do plan_id. Plans desconhecidos (legacy 'pro' antigo,
// null, undefined) retornam 0 — sem plano ativo == não pode convidar.
export function maxAgentsForPlan(
  planId: string | null | undefined,
): number {
  const match = PLANS_DISPLAY.find((p: PlanDisplay) => p.id === planId)
  return match?.maxAgents ?? 0
}

// Lê o plano ativo da loja e devolve o maxAgents. Server-only (usa supabase
// server client com RLS). Retorna 0 se não houver subscription ativa.
export async function getMaxAgentsForStore(
  storeId: string,
): Promise<number> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('store_subscriptions')
    .select('plan_id, status, current_period_end')
    .eq('store_id', storeId)
    .maybeSingle()
  if (!data || data.status !== 'active') return 0
  if (
    data.current_period_end &&
    new Date(data.current_period_end) <= new Date()
  ) {
    return 0
  }
  return maxAgentsForPlan(data.plan_id)
}
```

- [ ] **Step 6: Rodar todos os testes**

Run: `npx vitest run src/lib/__tests__/plan-limits.test.ts`
Expected: 4 testes PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/plans-display.ts src/lib/plan-limits.ts src/lib/__tests__/plan-limits.test.ts
git commit -m "feat(plans): add maxAgents per plan + plan-limits helper"
```

---

## Task 4: Conserto do middleware

**Files:**
- Modify: `src/middleware.ts:46-126`

- [ ] **Step 1: Substituir o middleware inteiro**

Reescrever `src/middleware.ts` (mantém os imports e o `ensureVisitorCookie` no topo; só substitui a função `middleware` e o `config`):

```ts
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "fix(middleware): resolve store_id via membership; bypass /convite; role-based post-login redirect"
```

---

## Task 5: Conserto do billing.ts e mercadopago route

**Files:**
- Modify: `src/actions/billing.ts:38-49` (getCurrentSubscription)
- Modify: `src/actions/billing.ts:79` (createCheckoutSession — block agent)
- Modify: `src/app/api/mercadopago/pix/route.ts:13-20` (block agent)

- [ ] **Step 1: Trocar a query do getCurrentSubscription**

Em `src/actions/billing.ts`, importar o novo helper no topo (depois dos outros imports):

```ts
import { getActiveStoreId } from '@/lib/active-store'
```

E em `getCurrentSubscription` (linha ~38), trocar:

```ts
  const { data, error } = await supabase
    .from('store_subscriptions')
    .select('plan_id, provider, status, current_period_end, cancel_at_period_end')
    .eq('store_id', user.id)
    .maybeSingle()
```

Por:

```ts
  const storeId = await getActiveStoreId()
  if (!storeId) return EMPTY_SUBSCRIPTION
  const { data, error } = await supabase
    .from('store_subscriptions')
    .select('plan_id, provider, status, current_period_end, cancel_at_period_end')
    .eq('store_id', storeId)
    .maybeSingle()
```

- [ ] **Step 2: Bloquear agent em createCheckoutSession (Stripe)**

Em `src/actions/billing.ts`, dentro de `createCheckoutSession`, logo após `if (!user) return { error: 'unauthorized' }`, adicionar:

```ts
  // Vendedor (agent) não paga — só o dono assina.
  const { data: membership } = await supabase
    .from('store_members')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (membership?.role === 'agent') {
    return { error: 'agent_cannot_pay' }
  }
```

- [ ] **Step 3: Bloquear agent no Mercado Pago Pix route**

Em `src/app/api/mercadopago/pix/route.ts`, logo após o bloco que valida `user` (linha ~17-20), adicionar:

```ts
  // Vendedor não paga — só o dono.
  const { data: membership } = await supabase
    .from('store_members')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (membership?.role === 'agent') {
    return NextResponse.json({ error: 'agent_cannot_pay' }, { status: 403 })
  }
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/actions/billing.ts src/app/api/mercadopago/pix/route.ts
git commit -m "fix(billing): resolve store_id via membership; block agent from Stripe + MP checkout"
```

---

## Task 6: Guards de role nas páginas owner-only

**Files:**
- Modify: `src/app/estoque/page.tsx:16` (redirect `/leads` → `/conversas`)
- Modify: `src/app/loja/page.tsx:16` (redirect `/leads` → `/conversas`)
- Modify: `src/app/equipe/page.tsx:12` (redirect `/leads` → `/conversas`)
- Modify: `src/app/painel/(default)/page.tsx` (adicionar guard)
- Modify: `src/app/planos/page.tsx` (adicionar guard pra agent)

- [ ] **Step 1: Ajustar redirect nas páginas que já têm guard**

Nas 3 páginas (`estoque/page.tsx`, `loja/page.tsx`, `equipe/page.tsx`), trocar:

```ts
if ((await getStoreRole()) !== 'owner') redirect('/leads')
```

Por:

```ts
if ((await getStoreRole()) !== 'owner') redirect('/conversas')
```

- [ ] **Step 2: Adicionar guard no painel**

Em `src/app/painel/(default)/page.tsx`, adicionar o import no topo:

```ts
import { getStoreRole } from '@/lib/store-role'
```

E adicionar a guarda logo depois do `if (!user) redirect('/login')`:

```ts
if ((await getStoreRole()) === 'agent') redirect('/conversas')
```

- [ ] **Step 3: Adicionar guard no /planos**

Em `src/app/planos/page.tsx`, adicionar o import:

```ts
import { getStoreRole } from '@/lib/store-role'
```

E entre `if (!user) redirect('/login')` e `const subscription = await getCurrentSubscription()`, inserir:

```ts
if ((await getStoreRole()) === 'agent') redirect('/conversas')
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/app/estoque/page.tsx src/app/loja/page.tsx src/app/equipe/page.tsx "src/app/painel/(default)/page.tsx" src/app/planos/page.tsx
git commit -m "feat(routes): agent guards on owner-only pages redirect to /conversas"
```

---

## Task 7: Remover redirect hardcoded do login

**Files:**
- Modify: `src/app/login/page.tsx:49-50`

- [ ] **Step 1: Trocar o redirect**

Em `src/app/login/page.tsx`, localizar o bloco depois do `signInWithPassword` bem-sucedido:

```ts
    router.push('/painel')
    router.refresh()
```

Trocar por:

```ts
    // Middleware decide o destino (agent → /conversas, owner → /painel).
    router.refresh()
    router.push('/')
```

(O `router.push('/')` faz o browser sair de `/login`; o middleware vê que `pathname === '/login'` não bate mais e o resto do fluxo do site assume o controle. O `/` redireciona para o destino padrão de cada role via middleware.)

Espera, isso pode não funcionar — depende de onde `/` resolve. Vamos validar: o melhor é manter o `router.push('/painel')` e deixar o middleware ver `pathname === '/painel'` com user já autenticado. O middleware, com a Task 4 aplicada, vai:
- Owner → passa direto (billing OK ou redirect pra /planos)
- Agent → billing-gate falha (sem sub) → redirect /planos → /planos guard (Task 6) → /conversas

Funciona, mas tem 2 saltos pro agent. Solução mais direta: hit `/login` de novo após refresh, deixar o middleware redirecionar.

Substituir o bloco por:

```ts
    router.refresh()
    // Reentra em /login com sessão ativa — middleware decide o destino
    // (agent → /conversas, owner → /painel) num único redirect.
    router.push('/login')
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/app/login/page.tsx
git commit -m "fix(login): delegate post-login redirect to middleware"
```

---

## Task 8: Server actions de convite

**Files:**
- Modify: `src/actions/equipe.ts` (substitui o arquivo inteiro)

- [ ] **Step 1: Substituir o arquivo inteiro**

Conteúdo completo de `src/actions/equipe.ts`:

```ts
'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthedUser } from '@/lib/auth'
import { getMaxAgentsForStore } from '@/lib/plan-limits'
import { getAppUrl } from '@/lib/app-url'

const INVITE_TTL_DAYS = 7

export interface MemberRow {
  id: string
  userId: string
  fullName: string
  email: string
  role: 'owner' | 'agent'
}

export interface InviteRow {
  id: string
  email: string
  fullName: string
  token: string
  url: string
  expiresAt: string
  createdAt: string
}

export interface EquipeData {
  members: MemberRow[]
  invites: InviteRow[]
  maxAgents: number
  agentCount: number
  pendingCount: number
}

async function ownerStoreId(): Promise<string | null> {
  const supabase = await createClient()
  const user = await getAuthedUser()
  if (!user) return null

  const { data } = await supabase
    .from('store_members')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (data?.role === 'agent') return null
  return user.id
}

function inviteUrl(token: string): string {
  return `${getAppUrl()}/convite/${token}`
}

// Procura um user no auth.users pelo email. O JS SDK não tem filtro por
// email no listUsers, então rodamos a query direta via service role.
async function findUserIdByEmail(email: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .rpc('get_user_id_by_email' as never, { p_email: email } as never)
    .single<{ id: string } | null>()
  if (error || !data) return null
  return data.id ?? null
}

// Fallback se a RPC não existir: lista todos os users com paginação até
// achar (até 1000 users, suficiente pro estágio do projeto). Substitui o
// findUserIdByEmail acima quando a RPC não estiver disponível.
async function findUserIdByEmailFallback(email: string): Promise<string | null> {
  const admin = createAdminClient()
  const lower = email.toLowerCase()
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 100,
    })
    if (error || !data?.users) return null
    const hit = data.users.find((u) => u.email?.toLowerCase() === lower)
    if (hit) return hit.id
    if (data.users.length < 100) return null
  }
  return null
}

async function emailExistsInAuth(email: string): Promise<boolean> {
  // Tenta a RPC primeiro (mais barato); se não existir, faz fallback paginado.
  try {
    const id = await findUserIdByEmail(email)
    if (id) return true
  } catch {
    // RPC não existe — segue pro fallback.
  }
  const fallbackId = await findUserIdByEmailFallback(email)
  return fallbackId !== null
}

export async function listEquipeData(): Promise<EquipeData> {
  const storeId = await ownerStoreId()
  if (!storeId) {
    return {
      members: [],
      invites: [],
      maxAgents: 0,
      agentCount: 0,
      pendingCount: 0,
    }
  }

  const admin = createAdminClient()

  const [membersRes, invitesRes, maxAgents] = await Promise.all([
    admin
      .from('store_members')
      .select('id, user_id, full_name, role')
      .eq('store_id', storeId)
      .order('created_at', { ascending: true }),
    admin
      .from('store_invites')
      .select('id, email, full_name, token, expires_at, created_at')
      .eq('store_id', storeId)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }),
    getMaxAgentsForStore(storeId),
  ])

  const members: MemberRow[] = []
  if (membersRes.data) {
    for (const m of membersRes.data) {
      const { data: u } = await admin.auth.admin.getUserById(m.user_id)
      members.push({
        id: m.id,
        userId: m.user_id,
        fullName: m.full_name,
        email: u.user?.email ?? '',
        role: m.role === 'owner' ? 'owner' : 'agent',
      })
    }
  }

  const invites: InviteRow[] = (invitesRes.data ?? []).map((i) => ({
    id: i.id,
    email: i.email,
    fullName: i.full_name,
    token: i.token,
    url: inviteUrl(i.token),
    expiresAt: i.expires_at,
    createdAt: i.created_at,
  }))

  const agentCount = members.filter((m) => m.role === 'agent').length
  return {
    members,
    invites,
    maxAgents,
    agentCount,
    pendingCount: invites.length,
  }
}

export async function createInvite(input: {
  fullName: string
  email: string
}): Promise<{ ok: boolean; error?: string; url?: string }> {
  const storeId = await ownerStoreId()
  if (!storeId) {
    return { ok: false, error: 'Apenas o dono pode convidar vendedores.' }
  }

  const fullName = input.fullName.trim()
  const email = input.email.trim().toLowerCase()
  if (!fullName) return { ok: false, error: 'Informe o nome do vendedor.' }
  if (!email || !email.includes('@')) {
    return { ok: false, error: 'Informe um email válido.' }
  }

  const maxAgents = await getMaxAgentsForStore(storeId)
  if (maxAgents <= 0) {
    return {
      ok: false,
      error: 'Ative seu plano pra adicionar vendedores.',
    }
  }

  const admin = createAdminClient()

  // Limite: agents atuais + convites pendentes não pode ultrapassar maxAgents.
  const [{ count: agentCount }, { count: pendingCount }] = await Promise.all([
    admin
      .from('store_members')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .eq('role', 'agent'),
    admin
      .from('store_invites')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString()),
  ])
  if ((agentCount ?? 0) + (pendingCount ?? 0) >= maxAgents) {
    return {
      ok: false,
      error: `Limite de ${maxAgents} vendedores atingido nesse plano.`,
    }
  }

  if (await emailExistsInAuth(email)) {
    return { ok: false, error: 'Esse email já tem conta no LUE.' }
  }

  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(
    Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()

  const user = await getAuthedUser()
  if (!user) return { ok: false, error: 'Sessão expirada.' }

  const { error: insertErr } = await admin.from('store_invites').insert({
    store_id: storeId,
    email,
    full_name: fullName,
    token,
    invited_by: user.id,
    expires_at: expiresAt,
  })
  if (insertErr) {
    // Provável violação do UNIQUE (store_id, email) — convite pendente
    // já existe pra esse email.
    if (insertErr.code === '23505') {
      return {
        ok: false,
        error: 'Já existe um convite pendente pra esse email.',
      }
    }
    console.error('createInvite insert error', insertErr)
    return { ok: false, error: 'Não foi possível criar o convite.' }
  }

  revalidatePath('/equipe')
  return { ok: true, url: inviteUrl(token) }
}

export async function revokeInvite(
  inviteId: string,
): Promise<{ ok: boolean; error?: string }> {
  const storeId = await ownerStoreId()
  if (!storeId) {
    return { ok: false, error: 'Apenas o dono pode revogar convites.' }
  }

  const admin = createAdminClient()
  const { data: invite } = await admin
    .from('store_invites')
    .select('store_id')
    .eq('id', inviteId)
    .maybeSingle()
  if (!invite || invite.store_id !== storeId) {
    return { ok: false, error: 'Convite não encontrado.' }
  }

  const { error } = await admin.from('store_invites').delete().eq('id', inviteId)
  if (error) {
    console.error('revokeInvite error', error)
    return { ok: false, error: 'Não foi possível revogar o convite.' }
  }

  revalidatePath('/equipe')
  return { ok: true }
}

export async function acceptInvite(input: {
  token: string
  password: string
}): Promise<{ ok: boolean; error?: string; email?: string }> {
  if (!input.token) return { ok: false, error: 'Token inválido.' }
  if (input.password.length < 6) {
    return { ok: false, error: 'A senha precisa ter ao menos 6 caracteres.' }
  }

  const admin = createAdminClient()
  const { data: invite } = await admin
    .from('store_invites')
    .select('id, store_id, email, full_name, expires_at, accepted_at')
    .eq('token', input.token)
    .maybeSingle()
  if (!invite) {
    return { ok: false, error: 'Convite inválido.' }
  }
  if (invite.accepted_at) {
    return { ok: false, error: 'Esse convite já foi usado.' }
  }
  if (new Date(invite.expires_at) <= new Date()) {
    return { ok: false, error: 'Esse convite expirou.' }
  }

  // Recheck race: alguém pode ter criado conta entre createInvite e agora.
  if (await emailExistsInAuth(invite.email)) {
    return {
      ok: false,
      error: 'Esse email já foi cadastrado. Peça outro link pro dono.',
    }
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: invite.email,
    password: input.password,
    email_confirm: true,
  })
  if (createErr || !created.user) {
    console.error('acceptInvite createUser error', createErr)
    return { ok: false, error: 'Não foi possível criar a conta.' }
  }

  const { error: memberErr } = await admin.from('store_members').insert({
    store_id: invite.store_id,
    user_id: created.user.id,
    role: 'agent',
    full_name: invite.full_name,
  })
  if (memberErr) {
    await admin.auth.admin.deleteUser(created.user.id)
    console.error('acceptInvite member insert error', memberErr)
    return { ok: false, error: 'Não foi possível vincular o vendedor à loja.' }
  }

  await admin
    .from('store_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id)

  revalidatePath('/equipe')
  return { ok: true, email: invite.email }
}

export async function removeVendor(
  memberId: string,
): Promise<{ ok: boolean; error?: string }> {
  const storeId = await ownerStoreId()
  if (!storeId) {
    return { ok: false, error: 'Apenas o dono pode remover vendedores.' }
  }

  const admin = createAdminClient()
  const { data: member } = await admin
    .from('store_members')
    .select('user_id, store_id, role')
    .eq('id', memberId)
    .maybeSingle()
  if (!member || member.store_id !== storeId) {
    return { ok: false, error: 'Vendedor não encontrado.' }
  }
  if (member.role !== 'agent') {
    return { ok: false, error: 'Só é possível remover vendedores.' }
  }

  const { error } = await admin.auth.admin.deleteUser(member.user_id)
  if (error) {
    console.error('removeVendor error', error)
    return { ok: false, error: 'Não foi possível remover o vendedor.' }
  }

  revalidatePath('/equipe')
  return { ok: true }
}

// Backward-compat: a página /equipe ainda importa listStoreMembers. Mantém
// como alias enquanto a UI é refatorada (Task 9 troca por listEquipeData).
export async function listStoreMembers(): Promise<MemberRow[]> {
  return (await listEquipeData()).members
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/actions/equipe.ts
git commit -m "feat(equipe): invite actions (create/list/revoke/accept) replacing createVendor"
```

---

## Task 9: Refatorar EquipeView

**Files:**
- Modify: `src/components/equipe/EquipeView.tsx` (substitui o arquivo inteiro)
- Modify: `src/app/equipe/page.tsx` (troca `listStoreMembers` por `listEquipeData`)

- [ ] **Step 1: Atualizar a página pra usar listEquipeData**

Conteúdo de `src/app/equipe/page.tsx`:

```ts
import { redirect } from 'next/navigation'
import { getAuthedUser } from '@/lib/auth'
import { getStoreRole } from '@/lib/store-role'
import { listEquipeData } from '@/actions/equipe'
import { EquipeView } from '@/components/equipe/EquipeView'

export const dynamic = 'force-dynamic'

export default async function EquipePage() {
  const user = await getAuthedUser()
  if (!user) redirect('/login')
  if ((await getStoreRole()) !== 'owner') redirect('/conversas')

  const data = await listEquipeData()
  return <EquipeView data={data} />
}
```

- [ ] **Step 2: Substituir o EquipeView**

Conteúdo de `src/components/equipe/EquipeView.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  createInvite,
  revokeInvite,
  removeVendor,
  type EquipeData,
} from '@/actions/equipe'
import { Input, Label } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

function expiresInDays(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)))
}

export function EquipeView({ data }: { data: EquipeData }) {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const totalUsed = data.agentCount + data.pendingCount
  const atLimit = data.maxAgents > 0 && totalUsed >= data.maxAgents
  const noPlan = data.maxAgents === 0

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLastInviteUrl(null)
    startTransition(async () => {
      const res = await createInvite({ fullName, email })
      if (!res.ok || !res.url) {
        setError(res.error ?? 'Erro ao criar convite.')
        return
      }
      setFullName('')
      setEmail('')
      setLastInviteUrl(res.url)
      router.refresh()
    })
  }

  function handleRevoke(inviteId: string) {
    setError(null)
    startTransition(async () => {
      const res = await revokeInvite(inviteId)
      if (res.ok) router.refresh()
      else setError(res.error ?? 'Erro ao revogar convite.')
    })
  }

  function handleRemove(memberId: string) {
    setError(null)
    startTransition(async () => {
      const res = await removeVendor(memberId)
      if (res.ok) router.refresh()
      else setError(res.error ?? 'Erro ao remover vendedor.')
    })
  }

  async function handleCopy(url: string, id: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1400)
    } catch {
      // ignore
    }
  }

  return (
    <div className="max-w-[860px] mx-auto px-8 py-7">
      <div className="eyebrow text-ink-500">EQUIPE</div>
      <h1
        className="font-display font-bold text-ink-900 tracking-tight mt-1"
        style={{ fontSize: '26px' }}
      >
        Vendedores
      </h1>

      {/* Card de uso do plano */}
      <div className="card mt-6 p-5 flex items-center gap-3">
        <div className="flex-1">
          {noPlan ? (
            <p className="text-[13.5px] text-ink-700">
              Ative seu plano pra adicionar vendedores.
            </p>
          ) : (
            <p className="text-[13.5px] text-ink-700">
              <span className="font-semibold text-ink-900">
                {totalUsed} de {data.maxAgents}
              </span>{' '}
              vagas usadas
              {data.pendingCount > 0 && (
                <span className="text-ink-500">
                  {' '}
                  ({data.pendingCount} pendente{data.pendingCount > 1 ? 's' : ''})
                </span>
              )}
            </p>
          )}
        </div>
        {atLimit && !noPlan && (
          <span className="eyebrow text-danger-700 bg-danger-50 px-2 py-1 rounded-md">
            LIMITE ATINGIDO
          </span>
        )}
      </div>

      {/* Lista de membros */}
      <div className="card mt-6 divide-y divide-ink-100">
        {data.members.length === 0 && (
          <div className="px-5 py-6 text-[13px] text-ink-500">
            Nenhum membro ainda.
          </div>
        )}
        {data.members.map((m) => (
          <div key={m.id} className="flex items-center gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-ink-900 truncate">
                {m.fullName}
              </div>
              <div className="text-[12.5px] text-ink-500 truncate">
                {m.email}
              </div>
            </div>
            <span className="eyebrow text-ink-400">
              {m.role === 'owner' ? 'DONO' : 'VENDEDOR'}
            </span>
            {m.role === 'agent' && (
              <button
                type="button"
                onClick={() => handleRemove(m.id)}
                disabled={pending}
                className="text-[12.5px] font-semibold text-danger-700 hover:text-danger-800 disabled:opacity-50"
              >
                Remover
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Lista de convites pendentes */}
      {data.invites.length > 0 && (
        <div className="card mt-6 divide-y divide-ink-100">
          <div className="px-5 py-3 eyebrow text-ink-500">
            CONVITES PENDENTES
          </div>
          {data.invites.map((inv) => (
            <div
              key={inv.id}
              className="flex items-center gap-3 px-5 py-3.5"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-ink-900 truncate">
                  {inv.fullName}
                </div>
                <div className="text-[12.5px] text-ink-500 truncate">
                  {inv.email}
                </div>
              </div>
              <span className="eyebrow text-ink-400">
                EXPIRA EM {expiresInDays(inv.expiresAt)}D
              </span>
              <button
                type="button"
                onClick={() => handleCopy(inv.url, inv.id)}
                disabled={pending}
                className="text-[12.5px] font-semibold text-brand-700 hover:text-brand-800 disabled:opacity-50"
              >
                {copiedId === inv.id ? 'Copiado!' : 'Copiar link'}
              </button>
              <button
                type="button"
                onClick={() => handleRevoke(inv.id)}
                disabled={pending}
                className="text-[12.5px] font-semibold text-danger-700 hover:text-danger-800 disabled:opacity-50"
              >
                Revogar
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Form de convite */}
      <form
        onSubmit={handleAdd}
        className={`card mt-6 p-5 space-y-4 ${
          atLimit || noPlan ? 'opacity-60' : ''
        }`}
      >
        <div
          className="font-display font-bold text-ink-900"
          style={{ fontSize: '16px' }}
        >
          Convidar vendedor
        </div>
        <div>
          <Label htmlFor="v-name">Nome</Label>
          <Input
            id="v-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            placeholder="Nome do vendedor"
            disabled={atLimit || noPlan || pending}
          />
        </div>
        <div>
          <Label htmlFor="v-email">Email</Label>
          <Input
            id="v-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="vendedor@email.com"
            disabled={atLimit || noPlan || pending}
          />
        </div>
        {error && (
          <p className="text-[13px] font-medium text-danger-700">{error}</p>
        )}
        {lastInviteUrl && (
          <div className="rounded-lg border border-success-200 bg-success-50 px-3 py-2.5 space-y-2">
            <p className="text-[13px] font-semibold text-success-800">
              Convite criado! Mande esse link pro vendedor:
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={lastInviteUrl}
                readOnly
                className="input flex-1 text-[12px]"
              />
              <button
                type="button"
                onClick={() => handleCopy(lastInviteUrl, 'last')}
                className="text-[12.5px] font-semibold text-brand-700 hover:text-brand-800"
              >
                {copiedId === 'last' ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
            <p className="text-[11.5px] text-success-700/80">
              Link expira em 7 dias.
            </p>
          </div>
        )}
        <Button type="submit" disabled={pending || atLimit || noPlan}>
          {pending ? 'Convidando…' : 'Gerar link de convite'}
        </Button>
      </form>
    </div>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/components/equipe/EquipeView.tsx src/app/equipe/page.tsx
git commit -m "feat(equipe): invite UI with usage card, pending list, copy-link form"
```

---

## Task 10: Rota /convite/[token]

**Files:**
- Create: `src/app/convite/[token]/page.tsx`
- Create: `src/app/convite/[token]/ConviteForm.tsx`

- [ ] **Step 1: Criar a server page**

Conteúdo de `src/app/convite/[token]/page.tsx`:

```tsx
import { createAdminClient } from '@/lib/supabase/admin'
import { ConviteForm } from './ConviteForm'

export const dynamic = 'force-dynamic'

type Status =
  | { kind: 'valid'; storeName: string; email: string; token: string }
  | { kind: 'expired' }
  | { kind: 'used' }
  | { kind: 'invalid' }

async function resolveStatus(token: string): Promise<Status> {
  if (!token) return { kind: 'invalid' }
  const admin = createAdminClient()
  const { data: invite } = await admin
    .from('store_invites')
    .select('email, store_id, expires_at, accepted_at')
    .eq('token', token)
    .maybeSingle()
  if (!invite) return { kind: 'invalid' }
  if (invite.accepted_at) return { kind: 'used' }
  if (new Date(invite.expires_at) <= new Date()) return { kind: 'expired' }

  const { data: store } = await admin
    .from('store_settings')
    .select('store_name')
    .eq('id', invite.store_id)
    .maybeSingle()
  return {
    kind: 'valid',
    storeName: store?.store_name ?? 'a loja',
    email: invite.email,
    token,
  }
}

function MessageCard({
  title,
  body,
}: {
  title: string
  body: string
}) {
  return (
    <div className="bg-brand-mesh relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="relative w-full max-w-md rounded-2xl border border-white bg-white/95 p-8 shadow-[0_30px_80px_-30px_rgba(76,29,149,0.35)]">
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
          {title}
        </h1>
        <p className="mt-2 text-sm text-slate-600">{body}</p>
      </div>
    </div>
  )
}

export default async function ConvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const status = await resolveStatus(token)

  if (status.kind === 'expired') {
    return (
      <MessageCard
        title="Convite expirado"
        body="Esse link de convite passou da validade. Peça outro pro dono da loja."
      />
    )
  }
  if (status.kind === 'used') {
    return (
      <MessageCard
        title="Convite já usado"
        body="Esse link já foi aceito. Se você precisa de acesso, peça outro pro dono da loja."
      />
    )
  }
  if (status.kind === 'invalid') {
    return (
      <MessageCard
        title="Convite inválido"
        body="Esse link não é válido. Confira com o dono da loja."
      />
    )
  }

  return (
    <ConviteForm
      storeName={status.storeName}
      email={status.email}
      token={status.token}
    />
  )
}
```

- [ ] **Step 2: Criar o form client**

Conteúdo de `src/app/convite/[token]/ConviteForm.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { acceptInvite } from '@/actions/equipe'
import { createClient } from '@/lib/supabase/client'
import { Wordmark } from '@/components/ui/Wordmark'
import { Button } from '@/components/ui/Button'
import { Input, Label } from '@/components/ui/Input'

export function ConviteForm({
  storeName,
  email,
  token,
}: {
  storeName: string
  email: string
  token: string
}) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 6) {
      setError('A senha precisa ter ao menos 6 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.')
      return
    }
    setLoading(true)

    const res = await acceptInvite({ token, password })
    if (!res.ok || !res.email) {
      setError(res.error ?? 'Não foi possível aceitar o convite.')
      setLoading(false)
      return
    }

    // Conta criada — loga no browser pra pegar a sessão antes do redirect.
    const supabase = createClient()
    const { error: signErr } = await supabase.auth.signInWithPassword({
      email: res.email,
      password,
    })
    if (signErr) {
      setError(
        'Conta criada, mas falhou ao entrar. Use a tela de login.',
      )
      setLoading(false)
      return
    }

    router.refresh()
    router.push('/conversas')
  }

  return (
    <div className="bg-brand-mesh relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <Wordmark size="lg" />
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
            Convite de vendedor
          </p>
        </div>

        <div className="rounded-2xl border border-white bg-white/95 p-8 shadow-[0_30px_80px_-30px_rgba(76,29,149,0.35)]">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Você foi convidado pra {storeName}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Defina uma senha pra acessar o painel de vendas.
          </p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-5">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} readOnly />
            </div>
            <div>
              <Label htmlFor="password">Nova senha</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder="mínimo 6 caracteres"
              />
            </div>
            <div>
              <Label htmlFor="confirm">Confirmar senha</Label>
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={6}
              />
            </div>

            {error && (
              <div className="bg-danger-soft border-danger/20 rounded-lg border px-3 py-2">
                <p className="text-danger text-sm font-medium">{error}</p>
              </div>
            )}

            <Button type="submit" disabled={loading} size="lg" className="w-full">
              {loading ? 'Entrando…' : 'Aceitar e entrar'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add "src/app/convite/[token]/page.tsx" "src/app/convite/[token]/ConviteForm.tsx"
git commit -m "feat(convite): public /convite/[token] route to accept invite and log in"
```

---

## Task 11: Verificação manual end-to-end

**Files:** nenhum — só execução no browser.

- [ ] **Step 1: Subir o dev server**

Run: `npm run dev`

Em outra aba, garante que `.env.local` tem `NEXT_PUBLIC_APP_URL=http://localhost:3000` (já existe).

- [ ] **Step 2: Owner com sub ativa convida**

1. Logar como owner que tem subscription `active` (se não tiver localmente, ir no SQL editor do Supabase: `INSERT INTO store_subscriptions (store_id, plan_id, provider, status) VALUES ('<owner-user-id>', 'profissional', 'stripe', 'active');` — confirma o id em `select id, email from auth.users where email = '<seu-email>';`)
2. Ir em `/equipe`. Card de uso deve mostrar "1 de 5 vagas usadas" (1 owner conta? Não — agentCount só conta agents). Esperar "0 de 5 vagas usadas".
3. Preencher form "Convidar vendedor" com Nome + Email NOVO (não cadastrado no LUE).
4. Submit → deve aparecer card verde com a URL `http://localhost:3000/convite/<token>` + botão "Copiar".
5. Clicar "Copiar" → vira "Copiado!" por ~1.4s.
6. Recarregar a página: o convite aparece na seção "CONVITES PENDENTES" com "EXPIRA EM 7D" + botões Copiar link / Revogar.

- [ ] **Step 3: Vendedor aceita o convite**

1. Em janela anônima, abrir a URL copiada.
2. Página deve mostrar "Você foi convidado pra <nome da loja>".
3. Definir senha (>= 6 chars) + confirmar.
4. Submit → redirect pra `/conversas`. Vendedor logado.
5. Tentar abrir manualmente `/painel`, `/loja`, `/estoque`, `/equipe`, `/planos` → todos redirecionam pra `/conversas`.
6. Sidebar deve mostrar só os menus permitidos (sem Painel/Loja/Estoque/Equipe/Planos).

- [ ] **Step 4: Owner vê o vendedor**

1. Voltar pra janela do owner. Recarregar `/equipe`.
2. Card de uso: "1 de 5 vagas usadas".
3. Vendedor aparece na lista com badge "VENDEDOR" + botão Remover.
4. Convite some da lista de pendentes (já foi aceito).

- [ ] **Step 5: Bloqueios**

1. Owner tenta convidar o mesmo email que acabou de virar vendedor → erro "Esse email já tem conta no LUE."
2. Convidar até bater o limite do plano (5 no profissional). Botão "Gerar link" desabilita; tentar via DevTools enviar o action mesmo assim → action retorna erro "Limite de 5 vendedores atingido…".
3. Em outra janela anônima, tentar abrir `/convite/<token-falso>` → "Convite inválido".
4. Revogar um convite no painel do owner; abrir o link revogado em anônima → "Convite inválido".

- [ ] **Step 6: Token expirado**

1. SQL Editor: `UPDATE store_invites SET expires_at = now() - interval '1 day' WHERE token = '<token>';`
2. Abrir o link em anônima → "Convite expirado".

- [ ] **Step 7: Remover vendedor**

1. Owner clica "Remover" no card do vendedor → desaparece da lista.
2. Em outra janela (a do vendedor), próxima navegação deve falhar / redirecionar pra `/login` (cookie ainda válido até refresh — aceitável).

- [ ] **Step 8: Type-check + lint final**

Run: `npx tsc --noEmit && npm run lint`
Expected: ambos limpos.

- [ ] **Step 9: Commit qualquer ajuste**

Se nenhum bug → não precisa de commit final. Se algum ajuste pequeno foi necessário (espaçamento, label), commit com:

```bash
git add -p
git commit -m "fix(equipe): manual qa adjustments"
```

---

## PR Checklist

Antes de abrir o PR / mergear pra main:

- [ ] Todos os testes vitest passam (`npm test`)
- [ ] `npx tsc --noEmit` limpo
- [ ] `npm run lint` limpo
- [ ] Migração `031_store_invites.sql` aplicada no banco de **produção** (via SQL Editor do Supabase do projeto)
- [ ] Variáveis no Vercel: nenhuma nova (usa `NEXT_PUBLIC_APP_URL` que já existe via Task de URL anterior, ou cai no `VERCEL_PROJECT_PRODUCTION_URL` automático)
- [ ] Verificação manual completa em produção: owner convida → vendedor aceita → vendedor vê só conversas/leads

---

## Coverage map (spec → tasks)

| Seção da spec | Task |
|---|---|
| Schema (1) | Task 1 |
| Limites por plano (2) | Task 3 |
| getActiveStoreId (3) | Task 2 |
| Fix middleware billing | Task 4 |
| Fix billing.ts | Task 5 |
| Actions de convite (4) | Task 8 |
| Rotas + login (5) | Tasks 4, 7, 10 |
| Page guards (5) | Task 6 |
| UI /equipe (6) | Task 9 |
| Rota /convite (5) | Task 10 |
| Edge cases (7) | Tasks 8, 10 (impl) + Task 11 (qa) |
| Testes manuais (8) | Task 11 |
