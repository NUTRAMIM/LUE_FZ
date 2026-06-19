# Modo Loja (impersonação de operador) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que um super-admin da plataforma entre numa loja a partir de `/painel/_internal` e a opere como dono real (leitura + escrita), com banner visível e botão Sair.

**Architecture:** RLS permanece ligado (sem service-role no caminho de dados de loja). Um cookie `impersonate_store` (setado só por admin) faz `getStoreContext()` apontar para a loja-alvo e faz `createClient()` injetar o header `x-impersonate-store`. No banco, cada policy de tabela de loja ganha um ramo **aditivo** `OR (linha == loja-alvo)`, honrado só quando `app_impersonated_store()` retorna não-nulo — o que só ocorre para admin com o header presente. O caminho do usuário normal fica idêntico.

**Tech Stack:** Next.js 16 (App Router, server actions, `cookies()` async), Supabase (`@supabase/ssr`, Postgres RLS, service-role), Vitest.

---

## Notas de contexto (ler antes de começar)

- `isPlatformAdmin(user)` — `src/lib/platform-admin.ts`, allowlist por env `PLATFORM_ADMIN_EMAILS`, fail-closed.
- `getStoreContext()`/`getActiveStoreId()` — `src/lib/active-store.ts`. Hoje resolvem a loja pela membership; fallback `storeId = user.id`.
- `createClient()` — `src/lib/supabase/server.ts`, client autenticado (RLS). `createServerClient` aceita `global.headers`.
- `createAdminClient()` — `src/lib/supabase/admin.ts`, service-role (ignora RLS).
- `getAuthedUser()` — `src/lib/auth.ts`, retorna `AuthedUser | null` com `id`/`email`.
- **RLS heterogêneo** (famílias por tabela):
  - membership `store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid())`: `leads`, `conversations`, `messages`, `store_invites`.
  - `auth.uid() = store_id`: `knowledge_gaps`, `product_mentions`, `store_subscriptions`.
  - `auth.uid() = id`: `store_settings`.
  - `auth.uid() = user_id`: `products`.
  - storage `auth.uid()::text = (storage.foldername(name))[1]`: buckets `product-images`, `product-videos`, `store-logos`.
- `equipe.ts` e várias actions resolvem a loja por `user.id` direto — precisam virar impersonation-aware.
- Convenção de teste: Vitest, mocks via `vi.mock`, arquivos em `src/lib/__tests__/` e `src/actions/__tests__/` (criar a pasta se não existir). Rodar com `npx vitest run <path>`.

## File Structure

- **Criar** `supabase/migrations/047_impersonation_rls.sql` — funções `app_is_platform_admin`/`app_impersonated_store`, tabela `platform_admins`, reescrita aditiva das policies.
- **Criar** `supabase/migrations/047_impersonation_rls_verify.sql` — script SQL manual de verificação (não roda em CI).
- **Criar** `src/lib/impersonation-cookie.ts` — constante do nome do cookie (evita ciclo de import entre `server.ts` e `active-store.ts`).
- **Modificar** `src/lib/active-store.ts` — `getStoreContext` impersonation-aware + `StoreContext.impersonating`.
- **Modificar** `src/lib/supabase/server.ts` — injeta header a partir do cookie.
- **Criar** `src/actions/impersonation.ts` — `enterStore`/`exitStore`.
- **Modificar** `src/actions/painel.ts`, `src/actions/store-settings.ts`, `src/actions/leads.ts`, `src/actions/products.ts`, `src/actions/equipe.ts`, `src/app/estoque/page.tsx`, `src/app/loja/page.tsx` — `user.id` (identidade da loja) → `getActiveStoreId()`.
- **Modificar** `src/app/painel/(default)/_internal/page.tsx` — listar todas as lojas + botão Entrar.
- **Criar** `src/components/ui/ImpersonationBanner.tsx` — banner server component.
- **Modificar** os 6 layouts autenticados — montar o banner.
- **Criar** testes em `src/lib/__tests__/` e `src/actions/__tests__/`.

---

## Task 1: Funções e tabela de identidade no banco

**Files:**
- Create: `supabase/migrations/047_impersonation_rls.sql`

> ⚠️ Confirmar a numeração: as migrations **045 e 046** de RLS estão reservadas pela auditoria de segurança (memória `project_security_audit_2026_06`). Se já existirem no banco/branch, usar o próximo número livre real e ajustar o nome do arquivo de verificação também.

- [ ] **Step 1: Escrever o cabeçalho da migration + funções + tabela**

Criar `supabase/migrations/047_impersonation_rls.sql` com:

```sql
-- 047_impersonation_rls.sql
-- "Modo loja": permite que um super-admin opere uma loja-alvo como dono.
-- Mecanismo: header de request `x-impersonate-store` (injetado pelo client só
-- quando há cookie de impersonação), honrado APENAS para platform-admins.
-- As policies ganham um ramo ADITIVO `OR (linha == loja-alvo)` — o caminho do
-- usuário normal não muda (para ele app_impersonated_store() é sempre NULL).

-- Identidade de admin no banco (RLS não lê env). Seed manual via service-role.
CREATE TABLE IF NOT EXISTS platform_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
-- Sem policies: só a service-role acessa.

CREATE OR REPLACE FUNCTION app_is_platform_admin(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = uid);
$$;

-- Loja impersonada: lê o header, valida UUID, e só honra para admin.
-- Retorna NULL em qualquer outro caso (fail-closed).
CREATE OR REPLACE FUNCTION app_impersonated_store()
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  raw TEXT;
  sid UUID;
BEGIN
  raw := current_setting('request.headers', true)::json ->> 'x-impersonate-store';
  IF raw IS NULL OR raw = '' THEN
    RETURN NULL;
  END IF;
  BEGIN
    sid := raw::uuid;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  IF NOT app_is_platform_admin(auth.uid()) THEN
    RETURN NULL;
  END IF;
  RETURN sid;
END;
$$;
```

- [ ] **Step 2: (continua na Task 2 — mesma migration). Commit parcial**

```bash
git add supabase/migrations/047_impersonation_rls.sql
git commit -m "feat(db): funcoes de impersonacao (platform_admins, app_impersonated_store)"
```

---

## Task 2: Reescrita aditiva das policies (mesma migration)

**Files:**
- Modify: `supabase/migrations/047_impersonation_rls.sql` (append)

Para cada policy abaixo: `DROP POLICY` + `CREATE POLICY` repetindo o predicado original e adicionando o ramo `OR ... app_impersonated_store()`. O ramo é inócuo para não-admin (função retorna NULL → `coluna = NULL` → NULL → falso).

- [ ] **Step 1: Família membership (leads, conversations, messages, store_invites)**

Anexar:

```sql
-- leads (eram membership puro — 025)
DROP POLICY IF EXISTS "leads_select_member" ON leads;
CREATE POLICY "leads_select_member" ON leads FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid())
         OR store_id = app_impersonated_store());

DROP POLICY IF EXISTS "leads_update_member" ON leads;
CREATE POLICY "leads_update_member" ON leads FOR UPDATE
  USING (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid())
         OR store_id = app_impersonated_store());

DROP POLICY IF EXISTS "leads_insert_member" ON leads;
CREATE POLICY "leads_insert_member" ON leads FOR INSERT
  WITH CHECK (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid())
              OR store_id = app_impersonated_store());

-- conversations (member; manter conversations_read_anon intacta)
DROP POLICY IF EXISTS "conversations_read_member" ON conversations;
CREATE POLICY "conversations_read_member" ON conversations FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid())
         OR store_id = app_impersonated_store());

DROP POLICY IF EXISTS "conversations_update_member" ON conversations;
CREATE POLICY "conversations_update_member" ON conversations FOR UPDATE
  USING (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid())
         OR store_id = app_impersonated_store());

-- messages (member; manter messages_read_anon intacta; insert do chat é service-role)
DROP POLICY IF EXISTS "messages_read_member" ON messages;
CREATE POLICY "messages_read_member" ON messages FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid())
         OR store_id = app_impersonated_store());

-- store_invites (SELECT owner; escrita é service-role nas actions)
DROP POLICY IF EXISTS "store_invites_select_owner" ON store_invites;
CREATE POLICY "store_invites_select_owner" ON store_invites FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_members
                      WHERE user_id = auth.uid() AND role = 'owner')
         OR store_id = app_impersonated_store());
```

- [ ] **Step 2: Família `auth.uid() = store_id` (knowledge_gaps, product_mentions, store_subscriptions)**

```sql
DROP POLICY IF EXISTS "kgaps_owner_all" ON knowledge_gaps;
CREATE POLICY "kgaps_owner_all" ON knowledge_gaps FOR ALL
  USING (auth.uid() = store_id OR store_id = app_impersonated_store());

DROP POLICY IF EXISTS "pmentions_owner_all" ON product_mentions;
CREATE POLICY "pmentions_owner_all" ON product_mentions FOR ALL
  USING (auth.uid() = store_id OR store_id = app_impersonated_store());

DROP POLICY IF EXISTS "subs_owner_select" ON store_subscriptions;
CREATE POLICY "subs_owner_select" ON store_subscriptions FOR SELECT
  USING (auth.uid() = store_id OR store_id = app_impersonated_store());
```

- [ ] **Step 3: store_settings (`auth.uid() = id`) e products (`auth.uid() = user_id`)**

```sql
DROP POLICY IF EXISTS "store_settings_select" ON store_settings;
CREATE POLICY "store_settings_select" ON store_settings FOR SELECT
  USING (auth.uid() = id OR id = app_impersonated_store());

DROP POLICY IF EXISTS "store_settings_insert" ON store_settings;
CREATE POLICY "store_settings_insert" ON store_settings FOR INSERT
  WITH CHECK (auth.uid() = id OR id = app_impersonated_store());

DROP POLICY IF EXISTS "store_settings_update" ON store_settings;
CREATE POLICY "store_settings_update" ON store_settings FOR UPDATE
  USING (auth.uid() = id OR id = app_impersonated_store());

DROP POLICY IF EXISTS "products_read" ON products;
CREATE POLICY "products_read" ON products FOR SELECT
  USING (auth.uid() = user_id OR user_id = app_impersonated_store());

DROP POLICY IF EXISTS "products_write" ON products;
CREATE POLICY "products_write" ON products FOR ALL
  USING (auth.uid() = user_id OR user_id = app_impersonated_store());
```

- [ ] **Step 4: Storage (product-images, product-videos, store-logos)**

Comparar como texto (`app_impersonated_store()::text`) para evitar cast de path inválido para uuid.

```sql
-- product-images
DROP POLICY IF EXISTS "product_images_insert_own" ON storage.objects;
CREATE POLICY "product_images_insert_own" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'product-images'
    AND (auth.uid()::text = (storage.foldername(name))[1]
         OR (storage.foldername(name))[1] = app_impersonated_store()::text));
DROP POLICY IF EXISTS "product_images_update_own" ON storage.objects;
CREATE POLICY "product_images_update_own" ON storage.objects FOR UPDATE
  USING (bucket_id = 'product-images'
    AND (auth.uid()::text = (storage.foldername(name))[1]
         OR (storage.foldername(name))[1] = app_impersonated_store()::text));
DROP POLICY IF EXISTS "product_images_delete_own" ON storage.objects;
CREATE POLICY "product_images_delete_own" ON storage.objects FOR DELETE
  USING (bucket_id = 'product-images'
    AND (auth.uid()::text = (storage.foldername(name))[1]
         OR (storage.foldername(name))[1] = app_impersonated_store()::text));

-- product-videos
DROP POLICY IF EXISTS "product_videos_insert_own" ON storage.objects;
CREATE POLICY "product_videos_insert_own" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'product-videos'
    AND (auth.uid()::text = (storage.foldername(name))[1]
         OR (storage.foldername(name))[1] = app_impersonated_store()::text));
DROP POLICY IF EXISTS "product_videos_update_own" ON storage.objects;
CREATE POLICY "product_videos_update_own" ON storage.objects FOR UPDATE
  USING (bucket_id = 'product-videos'
    AND (auth.uid()::text = (storage.foldername(name))[1]
         OR (storage.foldername(name))[1] = app_impersonated_store()::text));
DROP POLICY IF EXISTS "product_videos_delete_own" ON storage.objects;
CREATE POLICY "product_videos_delete_own" ON storage.objects FOR DELETE
  USING (bucket_id = 'product-videos'
    AND (auth.uid()::text = (storage.foldername(name))[1]
         OR (storage.foldername(name))[1] = app_impersonated_store()::text));

-- store-logos
DROP POLICY IF EXISTS "store_logos_insert_own" ON storage.objects;
CREATE POLICY "store_logos_insert_own" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'store-logos'
    AND (auth.uid()::text = (storage.foldername(name))[1]
         OR (storage.foldername(name))[1] = app_impersonated_store()::text));
DROP POLICY IF EXISTS "store_logos_update_own" ON storage.objects;
CREATE POLICY "store_logos_update_own" ON storage.objects FOR UPDATE
  USING (bucket_id = 'store-logos'
    AND (auth.uid()::text = (storage.foldername(name))[1]
         OR (storage.foldername(name))[1] = app_impersonated_store()::text));
DROP POLICY IF EXISTS "store_logos_delete_own" ON storage.objects;
CREATE POLICY "store_logos_delete_own" ON storage.objects FOR DELETE
  USING (bucket_id = 'store-logos'
    AND (auth.uid()::text = (storage.foldername(name))[1]
         OR (storage.foldername(name))[1] = app_impersonated_store()::text));
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/047_impersonation_rls.sql
git commit -m "feat(db): policies aditivas de impersonacao por loja"
```

---

## Task 3: Script de verificação SQL (manual)

**Files:**
- Create: `supabase/migrations/047_impersonation_rls_verify.sql`

Como o projeto não tem harness de teste de banco, a verificação do RLS é um script SQL manual rodado contra um Supabase de dev/staging com dados de duas lojas.

- [ ] **Step 1: Escrever o script de verificação**

```sql
-- 047_impersonation_rls_verify.sql  (rodar manualmente em dev/staging)
-- Pré: existe um admin em platform_admins e duas lojas A (sua) e B (outra).
-- Substituir os UUIDs e o JWT/role conforme o ambiente.
--
-- 1) Sem header: app_impersonated_store() deve ser NULL.
SELECT app_impersonated_store();  -- esperado: NULL
--
-- 2) Simular header de admin para a loja B:
SELECT set_config('request.headers',
  json_build_object('x-impersonate-store', '<UUID_LOJA_B>')::text, true);
-- e simular auth.uid() = <UUID_ADMIN> conforme o harness do ambiente.
SELECT app_impersonated_store();  -- esperado: <UUID_LOJA_B> (se o uid for admin)
--
-- 3) Conferência de isolamento (rodando como o admin impersonando B):
--    products/leads/conversations devem retornar SÓ a loja B.
SELECT count(*) FROM products WHERE user_id <> '<UUID_LOJA_B>';   -- esperado: 0
SELECT count(*) FROM leads    WHERE store_id <> '<UUID_LOJA_B>';  -- esperado: 0
--
-- 4) Paridade não-admin: com um uid não-admin e o mesmo header,
--    app_impersonated_store() deve ser NULL e as queries só verem a própria loja.
```

- [ ] **Step 2: Verificação manual (registrar resultado)**

Rodar o script contra dev/staging após aplicar a migration. Confirmar: NULL sem header; loja-alvo com header de admin; isolamento; paridade não-admin. Documentar o resultado no PR.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/047_impersonation_rls_verify.sql
git commit -m "test(db): script manual de verificacao do RLS de impersonacao"
```

---

## Task 4: Constante do cookie

**Files:**
- Create: `src/lib/impersonation-cookie.ts`

- [ ] **Step 1: Criar o módulo (sem deps, evita ciclo)**

```ts
// Nome do cookie de impersonação. Em módulo próprio para que tanto
// `supabase/server.ts` quanto `active-store.ts` o importem sem criar ciclo.
export const IMPERSONATE_COOKIE = 'impersonate_store'
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/impersonation-cookie.ts
git commit -m "feat: constante do cookie de impersonacao"
```

---

## Task 5: `getStoreContext` impersonation-aware

**Files:**
- Modify: `src/lib/active-store.ts`
- Test: `src/lib/__tests__/active-store.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Substituir o conteúdo de `src/lib/__tests__/active-store.test.ts` por (adiciona mock de `next/headers` e de `platform-admin`):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockMaybeSingle = vi.fn()
const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))
const mockGetCookie = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ from: mockFrom })),
}))
vi.mock('@/lib/auth', () => ({ getAuthedUser: vi.fn() }))
vi.mock('@/lib/platform-admin', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: mockGetCookie })),
}))

import { getActiveStoreId, getStoreContext } from '../active-store'
import { getAuthedUser } from '@/lib/auth'
import { isPlatformAdmin } from '@/lib/platform-admin'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetCookie.mockReturnValue(undefined)
  vi.mocked(isPlatformAdmin).mockReturnValue(false)
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

describe('getStoreContext (impersonação)', () => {
  it('admin com cookie -> loja-alvo, role owner, impersonating true', async () => {
    vi.mocked(getAuthedUser).mockResolvedValue({ id: 'admin-uuid', email: 'a@lue.com' } as never)
    vi.mocked(isPlatformAdmin).mockReturnValue(true)
    mockGetCookie.mockReturnValue({ value: 'loja-alvo' })
    const ctx = await getStoreContext()
    expect(ctx).toEqual({ storeId: 'loja-alvo', role: 'owner', impersonating: true })
    expect(mockFrom).not.toHaveBeenCalled() // não consulta membership ao impersonar
  })

  it('não-admin com cookie -> ignora impersonação (fluxo normal)', async () => {
    vi.mocked(getAuthedUser).mockResolvedValue({ id: 'user-uuid' } as never)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    mockGetCookie.mockReturnValue({ value: 'loja-alvo' })
    mockMaybeSingle.mockResolvedValue({ data: { store_id: 'sua-loja', role: 'owner' } })
    const ctx = await getStoreContext()
    expect(ctx).toEqual({ storeId: 'sua-loja', role: 'owner', impersonating: false })
  })

  it('admin sem cookie -> fluxo normal', async () => {
    vi.mocked(getAuthedUser).mockResolvedValue({ id: 'admin-uuid' } as never)
    vi.mocked(isPlatformAdmin).mockReturnValue(true)
    mockGetCookie.mockReturnValue(undefined)
    mockMaybeSingle.mockResolvedValue({ data: null })
    const ctx = await getStoreContext()
    expect(ctx).toEqual({ storeId: 'admin-uuid', role: 'owner', impersonating: false })
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run src/lib/__tests__/active-store.test.ts`
Expected: FAIL (campo `impersonating` ausente; impersonação não implementada).

- [ ] **Step 3: Implementar**

Substituir `src/lib/active-store.ts` por:

```ts
import { cache } from 'react'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'
import { isPlatformAdmin } from '@/lib/platform-admin'
import { IMPERSONATE_COOKIE } from '@/lib/impersonation-cookie'

export interface StoreContext {
  storeId: string
  role: 'owner' | 'agent'
  impersonating: boolean
}

// Fonte única do store_id + role do user atual. Cacheado por request.
//
//   - Admin + cookie de impersonação: opera a loja-alvo como owner. Não
//     consulta store_members (a loja vem do cookie). O RLS, via
//     app_impersonated_store(), libera só as linhas dessa loja.
//   - Sem row em store_members: fallback storeId=user.id, role='owner'.
export const getStoreContext = cache(
  async (): Promise<StoreContext | null> => {
    const user = await getAuthedUser()
    if (!user) return null

    const cookieStore = await cookies()
    const impersonated = cookieStore.get(IMPERSONATE_COOKIE)?.value
    if (impersonated && isPlatformAdmin(user)) {
      return { storeId: impersonated, role: 'owner', impersonating: true }
    }

    const supabase = await createClient()
    const { data } = await supabase
      .from('store_members')
      .select('store_id, role')
      .eq('user_id', user.id)
      .maybeSingle()
    return {
      storeId: data?.store_id ?? user.id,
      role: data?.role === 'agent' ? 'agent' : 'owner',
      impersonating: false,
    }
  },
)

// Resolve o store_id do user atual (null se deslogado).
export const getActiveStoreId = cache(async (): Promise<string | null> => {
  const ctx = await getStoreContext()
  return ctx?.storeId ?? null
})
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx vitest run src/lib/__tests__/active-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/active-store.ts src/lib/__tests__/active-store.test.ts
git commit -m "feat: getStoreContext impersonation-aware (cookie + admin gate)"
```

---

## Task 6: `createClient` injeta o header de impersonação

**Files:**
- Modify: `src/lib/supabase/server.ts`
- Test: `src/lib/__tests__/supabase-server.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/lib/__tests__/supabase-server.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetCookie = vi.fn()
const createServerClient = vi.fn(() => ({ ok: true }))

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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/__tests__/supabase-server.test.ts`
Expected: FAIL (header não injetado).

- [ ] **Step 3: Implementar**

Substituir `src/lib/supabase/server.ts` por:

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database'
import { IMPERSONATE_COOKIE } from '@/lib/impersonation-cookie'

export async function createClient() {
  const cookieStore = await cookies()

  // Impersonação: se o cookie existir, injeta o header que o RLS lê
  // (app_impersonated_store). A segurança é no banco — o header só é
  // honrado para platform-admins; injetar aqui sem checar admin é seguro.
  const impersonate = cookieStore.get(IMPERSONATE_COOKIE)?.value
  const global = impersonate
    ? { headers: { 'x-impersonate-store': impersonate } }
    : undefined

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(global ? { global } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // chamado de Server Component — ok ignorar (middleware refaz a sessão)
          }
        },
      },
    }
  )
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/__tests__/supabase-server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase/server.ts src/lib/__tests__/supabase-server.test.ts
git commit -m "feat: createClient injeta header x-impersonate-store do cookie"
```

---

## Task 7: Server actions `enterStore` / `exitStore`

**Files:**
- Create: `src/actions/impersonation.ts`
- Test: `src/actions/__tests__/impersonation.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/actions/__tests__/impersonation.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSet = vi.fn()
const mockDelete = vi.fn()
const mockMaybeSingle = vi.fn(async () => ({ data: { id: 'loja-alvo' } }))
const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ set: mockSet, delete: mockDelete })),
}))
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => { throw new Error('REDIRECT') }),
}))
vi.mock('@/lib/auth', () => ({ getAuthedUser: vi.fn() }))
vi.mock('@/lib/platform-admin', () => ({ isPlatformAdmin: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({ from: mockFrom })) }))

import { enterStore } from '../impersonation'
import { getAuthedUser } from '@/lib/auth'
import { isPlatformAdmin } from '@/lib/platform-admin'

beforeEach(() => { vi.clearAllMocks() })

describe('enterStore (gate de admin)', () => {
  it('não seta cookie para não-admin', async () => {
    vi.mocked(getAuthedUser).mockResolvedValue({ id: 'u' } as never)
    vi.mocked(isPlatformAdmin).mockReturnValue(false)
    await enterStore('loja-alvo')
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('seta cookie para admin quando a loja existe', async () => {
    vi.mocked(getAuthedUser).mockResolvedValue({ id: 'admin' } as never)
    vi.mocked(isPlatformAdmin).mockReturnValue(true)
    await expect(enterStore('loja-alvo')).rejects.toThrow('REDIRECT')
    expect(mockSet).toHaveBeenCalledWith('impersonate_store', 'loja-alvo', expect.objectContaining({
      httpOnly: true, path: '/',
    }))
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/actions/__tests__/impersonation.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

Criar `src/actions/impersonation.ts`:

```ts
'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getAuthedUser } from '@/lib/auth'
import { isPlatformAdmin } from '@/lib/platform-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { IMPERSONATE_COOKIE } from '@/lib/impersonation-cookie'

// Entra no "modo loja". Gate de admin é a primeira linha (fail-closed:
// não-admin retorna sem efeito). Valida que a loja existe antes de setar.
export async function enterStore(storeId: string) {
  const user = await getAuthedUser()
  if (!user || !isPlatformAdmin(user)) return

  const admin = createAdminClient()
  const { data } = await admin
    .from('store_settings')
    .select('id')
    .eq('id', storeId)
    .maybeSingle()
  if (!data) return

  const cookieStore = await cookies()
  cookieStore.set(IMPERSONATE_COOKIE, storeId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  })
  redirect('/conversas')
}

// Sai do modo loja: limpa o cookie e volta ao painel admin.
export async function exitStore() {
  const cookieStore = await cookies()
  cookieStore.delete(IMPERSONATE_COOKIE)
  redirect('/painel/_internal')
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/actions/__tests__/impersonation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/actions/impersonation.ts src/actions/__tests__/impersonation.test.ts
git commit -m "feat: server actions enterStore/exitStore (gate de admin)"
```

---

## Task 8: Refactor `user.id` → `getActiveStoreId()` (identidade da loja)

**Files:**
- Modify: `src/actions/painel.ts`, `src/actions/store-settings.ts`, `src/actions/leads.ts`, `src/actions/products.ts`, `src/actions/equipe.ts`, `src/app/estoque/page.tsx`, `src/app/loja/page.tsx`

Objetivo: onde `user.id` significa **a loja**, trocar por `getActiveStoreId()` (impersonation-aware). Onde `user.id` significa **o usuário agindo** (ex.: `contacted_by`, `invited_by`), **manter**. O RLS já protege por baixo — isto é correção de UX para a loja certa aparecer.

- [ ] **Step 1: `src/actions/painel.ts`**

Trocar cada `const store = user.id` por `const store = await getActiveStoreId()` e tratar null (early-return como já se faz com `user`). Adicionar o import `import { getActiveStoreId } from '@/lib/active-store'`. Linhas de referência: 34, 131, 240, e os usos `.eq('store_id', user.id)`/`.eq('id', user.id)` (~313, ~370) → usar a variável `store`. Após editar, garantir que toda função que lia `user.id` como loja use `store`.

- [ ] **Step 2: `src/actions/store-settings.ts`**

No upsert (~177) trocar `id: user.id` por `id: storeId`, onde `storeId = await getActiveStoreId()` (resolver no topo da função, após o `getAuthedUser`, com early-return se null). Import de `getActiveStoreId`.

- [ ] **Step 3: `src/actions/leads.ts`**

Trocar `.eq('user_id', user.id)` / usos de `user.id` como loja (~87) por `getActiveStoreId()`. **Manter** `contacted_by: user.id` (~97) — é o usuário agindo. Import de `getActiveStoreId`.

- [ ] **Step 4: `src/actions/products.ts`**

- Resolver `const storeId = await getActiveStoreId()` no topo das funções relevantes (após `getAuthedUser`, early-return se null).
- Paths de storage (~252 e ~313): `const path = \`${storeId}/${crypto.randomUUID()}.${ext}\`` (era `${user.id}`).
- Insert de produto (~407): `user_id: storeId` (era `user_id: user.id`).
- Demais `.eq('user_id', user.id)` (~154, ~195, ~474, ~494, ~523) → `.eq('user_id', storeId)`.

- [ ] **Step 5: `src/actions/equipe.ts`**

Reescrever `ownerStoreId()` (linhas 40-53) para usar o contexto impersonation-aware:

```ts
import { getStoreContext } from '@/lib/active-store'

async function ownerStoreId(): Promise<string | null> {
  const ctx = await getStoreContext()
  if (!ctx || ctx.role === 'agent') return null
  return ctx.storeId
}
```

(Remove a query manual de `store_members`; admin impersonando recebe `role: 'owner'` + a loja-alvo.)

- [ ] **Step 6: `src/app/estoque/page.tsx`**

A query de `products` não tem filtro de loja e depende do RLS — sob impersonação o RLS já escopa para a loja-alvo, então **não precisa** adicionar filtro. Trocar apenas `store_settings.eq('id', user.id)` (~30) por `.eq('id', storeId)`, com `const storeId = await getActiveStoreId()` (após `getAuthedUser`, redirect se null). Import de `getActiveStoreId`.

- [ ] **Step 7: `src/app/loja/page.tsx`**

Trocar os usos de `user.id` como loja (`store_settings.eq('id', user.id)` e o filtro de `products` se houver) por `getActiveStoreId()`. Import de `getActiveStoreId`.

- [ ] **Step 8: Typecheck + lint + suíte completa**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: sem erros de tipo; lint limpo; testes existentes verdes.

- [ ] **Step 9: Commit**

```bash
git add src/actions/painel.ts src/actions/store-settings.ts src/actions/leads.ts src/actions/products.ts src/actions/equipe.ts src/app/estoque/page.tsx src/app/loja/page.tsx
git commit -m "refactor: identidade da loja via getActiveStoreId (impersonation-aware)"
```

---

## Task 9: `/painel/_internal` lista todas as lojas + botão Entrar

**Files:**
- Modify: `src/app/painel/(default)/_internal/page.tsx`

- [ ] **Step 1: Buscar todas as lojas e mesclar com o consumo**

No `page.tsx`, após a leitura de `storesRes` (já busca `store_settings(id, store_name)`), construir a lista de **todas** as lojas (não só as de `porLoja`). Manter a tabela de consumo existente e adicionar uma coluna "Ações" com um form por linha chamando `enterStore`. Adicionar no topo:

```tsx
import { enterStore } from '@/actions/impersonation'
```

E, na linha da tabela de consumo (`porLoja.map`), adicionar a célula de ação:

```tsx
<td className="px-5 py-3 text-right">
  <form action={enterStore.bind(null, s.storeId)}>
    <button
      type="submit"
      className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
    >
      Entrar
    </button>
  </form>
</td>
```

(Adicionar o `<th className="px-5 py-3 text-right">Ações</th>` correspondente no `thead`.)

- [ ] **Step 2: Card "Todas as lojas" (entrar em loja sem consumo)**

Abaixo do card de consumo, adicionar um `Card` listando **todas** as lojas de `storesRes.data` (id + nome) com o mesmo botão Entrar, para permitir entrar em lojas que não geraram tokens no período. Reusar o componente `Card` e a mesma `<form action={enterStore.bind(null, id)}>`.

```tsx
<Card className="mt-6 overflow-hidden p-0">
  <div className="border-b border-slate-200/80 px-5 py-4">
    <h2 className="font-display text-sm font-semibold text-slate-900">Todas as lojas</h2>
  </div>
  <ul className="divide-y divide-slate-100">
    {(storesRes.data ?? []).map((loja) => (
      <li key={loja.id} className="flex items-center justify-between px-5 py-3">
        <span className="text-sm font-medium text-slate-900">{loja.store_name}</span>
        <form action={enterStore.bind(null, loja.id)}>
          <button
            type="submit"
            className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Entrar
          </button>
        </form>
      </li>
    ))}
  </ul>
</Card>
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add "src/app/painel/(default)/_internal/page.tsx"
git commit -m "feat(admin): listar todas as lojas + botao Entrar no painel _internal"
```

---

## Task 10: Banner de modo loja

**Files:**
- Create: `src/components/ui/ImpersonationBanner.tsx`
- Modify: `src/app/conversas/layout.tsx`, `src/app/estoque/layout.tsx`, `src/app/loja/layout.tsx`, `src/app/leads/layout.tsx`, `src/app/equipe/layout.tsx`, `src/app/painel/(default)/layout.tsx`

- [ ] **Step 1: Criar o componente**

Criar `src/components/ui/ImpersonationBanner.tsx`:

```tsx
import { getStoreContext } from '@/lib/active-store'
import { createClient } from '@/lib/supabase/server'
import { exitStore } from '@/actions/impersonation'

// Faixa fixa exibida só quando o admin está impersonando uma loja.
// Server component: retorna null no fluxo normal (zero impacto).
export async function ImpersonationBanner() {
  const ctx = await getStoreContext()
  if (!ctx?.impersonating) return null

  const supabase = await createClient()
  const { data } = await supabase
    .from('store_settings')
    .select('store_name')
    .eq('id', ctx.storeId)
    .maybeSingle()
  const nome = data?.store_name ?? 'loja'

  return (
    <div className="sticky top-0 z-50 flex items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950">
      <span>
        Você está operando como <strong>{nome}</strong> (modo admin)
      </span>
      <form action={exitStore}>
        <button
          type="submit"
          className="rounded-lg bg-amber-950/10 px-3 py-1 text-xs font-semibold text-amber-950 hover:bg-amber-950/20"
        >
          Sair
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Montar o banner nos 6 layouts**

Em cada um dos 6 arquivos de layout, importar e renderizar o banner acima do container flex. Padrão (aplicar idêntico nos seis, ajustando só o nome da função do layout):

```tsx
import { Sidebar } from '@/components/ui/Sidebar'
import { getSidebarData } from '@/lib/sidebar-data'
import { ImpersonationBanner } from '@/components/ui/ImpersonationBanner'

export default async function ConversasLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const data = await getSidebarData()
  return (
    <>
      <ImpersonationBanner />
      <div className="flex flex-col md:flex-row md:min-h-screen">
        <Sidebar {...data} />
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </>
  )
}
```

Arquivos e o `div` original a preservar (o conteúdo do `<div>` muda entre eles — manter o existente, só envolver no fragmento com o banner):
- `src/app/conversas/layout.tsx` (`md:min-h-screen`)
- `src/app/estoque/layout.tsx` (`md:h-screen bg-gray-100`, `<main className="flex-1 md:overflow-auto">`)
- `src/app/loja/layout.tsx` (`md:min-h-screen`)
- `src/app/leads/layout.tsx` (`md:min-h-screen`)
- `src/app/equipe/layout.tsx` (`md:min-h-screen`)
- `src/app/painel/(default)/layout.tsx` (`md:min-h-screen`)

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/ImpersonationBanner.tsx src/app/conversas/layout.tsx src/app/estoque/layout.tsx src/app/loja/layout.tsx src/app/leads/layout.tsx src/app/equipe/layout.tsx "src/app/painel/(default)/layout.tsx"
git commit -m "feat: banner de modo loja nos layouts autenticados"
```

---

## Task 11: Verificação E2E manual + seed do admin

**Files:** nenhum (operacional)

- [ ] **Step 1: Seed do admin no banco**

No Supabase (dev/staging), inserir o(s) id(s) de admin via service-role:

```sql
INSERT INTO platform_admins (user_id)
SELECT id FROM auth.users WHERE email = 'matheusmanhaesmaciel@gmail.com'
ON CONFLICT DO NOTHING;
```

Garantir que `PLATFORM_ADMIN_EMAILS` inclui o mesmo e-mail (gate de aplicação).

- [ ] **Step 2: Aplicar as migrations + rodar o script de verificação (Task 3)**

- [ ] **Step 3: Smoke test manual**

1. Logar como admin → abrir `/painel/_internal` → ver lista de lojas + botões Entrar.
2. Entrar numa loja B → banner aparece com o nome de B.
3. `/conversas`, `/estoque`, `/leads`, `/loja`, `/equipe` mostram **dados de B**.
4. Editar um produto / responder uma conversa / salvar config em B → persiste em B.
5. **Sair** → volta ao `/painel/_internal`; sem banner; sua própria loja de volta.
6. Logar como usuário **não-admin** e setar manualmente o cookie `impersonate_store` (devtools) → confirmar que **nada muda** (vê só a própria loja). RLS fail-closed.

- [ ] **Step 4: Atualizar a memória do projeto**

Registrar em memória que `platform_admins` precisa de seed manual por ambiente (além de `PLATFORM_ADMIN_EMAILS`).

---

## Self-Review (resultado)

- **Cobertura do spec:** funções/identidade (T1), policies aditivas todas as famílias (T2), verificação (T3), cookie (T4), getStoreContext (T5), header no client (T6), enter/exit (T7), refactor user.id→loja incl. storage paths e equipe (T8), UI _internal (T9), banner (T10), E2E+seed (T11). ✔
- **Sem placeholders:** todo passo tem SQL/código/comando concretos. ✔
- **Consistência de tipos:** `IMPERSONATE_COOKIE`, `StoreContext.impersonating`, `app_impersonated_store()`, `enterStore`/`exitStore` usados igual em todas as tasks. ✔
- **Risco residual conhecido:** RLS não tem teste automatizado no harness atual → coberto por script SQL manual (T3) + smoke E2E (T11). Documentado.
