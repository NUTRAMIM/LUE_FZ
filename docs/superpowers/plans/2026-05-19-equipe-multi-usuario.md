# Equipe & Multi-usuário (Plano 1 de 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o app multi-usuário — o dono cria contas de vendedor numa tela de Equipe, vendedores logam e veem só o que lhes cabe, e a segurança do banco (RLS) passa de "dono-único" para membership de loja.

**Architecture:** Uma tabela `store_members` (dono + vendedores de cada loja) vira a base de identidade. A RLS de `leads`/`conversations`/`messages` passa de `auth.uid() = store_id` para um predicado de membership. Uma tela `/equipe` (só do dono) cria/remove vendedores via admin client (service role). O menu lateral filtra itens por papel; páginas só-do-dono redirecionam vendedores.

**Tech Stack:** Next.js 16, React 19, Supabase (Postgres + RLS + Auth admin API).

**Spec de referência:** `docs/superpowers/specs/2026-05-19-equipe-fila-leads-design.md` (este é o Plano 1; o Plano 2 — Fila de Leads — vem depois).

**Pré-requisito:** Última migration do projeto é a `023`.

---

## Escopo deste plano

Plano 1 entrega: `store_members`, a reescrita de RLS, a tela `/equipe`, e o menu por papel. **Fica para o Plano 2:** as colunas de workflow em `leads` (`interest_summary`/`contacted_at`/`contacted_by`), a página `/leads`, a mudança no n8n e o botão "Abrir fila de leads" do painel. Como `/leads` ainda não existe, neste plano as páginas só-do-dono redirecionam o vendedor para **`/conversas`** (o Plano 2 troca o destino para `/leads`).

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/024_store_members.sql` (novo) | Tabela `store_members` + RLS + seed + trigger |
| `supabase/migrations/025_membership_rls.sql` (novo) | Reescrita de RLS de `leads`/`conversations`/`messages` |
| `src/types/database.ts` (modify) | Tipo da tabela `store_members` |
| `src/lib/store-role.ts` (novo) | Helper `getStoreRole()` (papel do usuário atual) |
| `src/actions/equipe.ts` (novo) | `listStoreMembers`, `createVendor`, `removeVendor` |
| `src/components/equipe/EquipeView.tsx` (novo) | Tela de Equipe (client) |
| `src/app/equipe/layout.tsx` (novo) | Layout com Sidebar |
| `src/app/equipe/page.tsx` (novo) | Server Component: auth + guarda de dono |
| `src/app/painel/page.tsx` (modify) | Guarda de dono |
| `src/app/estoque/page.tsx` (modify) | Guarda de dono |
| `src/app/loja/page.tsx` (modify) | Guarda de dono |
| `src/components/ui/Sidebar.tsx` (modify) | Menu ciente de papel + item Equipe |

---

## Task 1: Migration 024 — `store_members`

Esta task só **cria o arquivo SQL**. Aplicar ao Supabase é um passo de deploy manual (seção final).

**Files:**
- Create: `supabase/migrations/024_store_members.sql`

- [ ] **Step 1: Criar o arquivo**

Criar `supabase/migrations/024_store_members.sql` com este conteúdo exato:

```sql
-- 024_store_members.sql
-- Membership de loja: o dono e os vendedores de cada loja. Base do app
-- multi-usuário e do novo modelo de RLS.

CREATE TABLE store_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID NOT NULL REFERENCES store_settings(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('owner', 'agent')),
  full_name  TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (store_id, user_id)
);

CREATE INDEX idx_store_members_user ON store_members (user_id);

-- Seed: cada loja existente vira sua própria dona (store_id = user.id em todo
-- o projeto). full_name aproveita o store_name.
INSERT INTO store_members (store_id, user_id, role, full_name)
SELECT id, id, 'owner', store_name FROM store_settings;

ALTER TABLE store_members ENABLE ROW LEVEL SECURITY;

-- Cada usuário enxerga só a própria membership. Self-contido (não referencia
-- store_members de volta), então as subqueries de RLS das outras tabelas não
-- recursam. Escrita acontece só via service role (admin client).
CREATE POLICY "store_members_select_self" ON store_members
  FOR SELECT USING (user_id = auth.uid());

-- Toda store_settings nova ganha automaticamente a membership 'owner' do dono.
CREATE OR REPLACE FUNCTION seed_store_owner_member()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO store_members (store_id, user_id, role, full_name)
  VALUES (NEW.id, NEW.id, 'owner', NEW.store_name)
  ON CONFLICT (store_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_store_settings_owner_member
  AFTER INSERT ON store_settings
  FOR EACH ROW EXECUTE FUNCTION seed_store_owner_member();
```

- [ ] **Step 2: Revisar o SQL**

Confira: `UNIQUE (store_id, user_id)`; RLS habilitada com uma única policy de SELECT (`user_id = auth.uid()`) — sem policy de escrita, porque escrita é só via service role; o trigger é `AFTER INSERT ON store_settings` (a primeira gravação do `/loja` é INSERT — o trigger cria a membership do dono); o seed cobre lojas já existentes.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/024_store_members.sql
git commit -m "feat(db): add store_members table with seed and owner trigger"
```

---

## Task 2: Migration 025 — reescrita de RLS para membership

**Files:**
- Create: `supabase/migrations/025_membership_rls.sql`

- [ ] **Step 1: Criar o arquivo**

Criar `supabase/migrations/025_membership_rls.sql` com este conteúdo exato:

```sql
-- 025_membership_rls.sql
-- Troca a RLS baseada em "auth.uid() = store_id" (dono-único) por membership.
-- A subquery aciona store_members_select_self (user_id = auth.uid()), que é
-- self-contida — sem recursão.

-- leads: a policy antiga (auth.role() = 'authenticated') deixava QUALQUER
-- usuário logado ver todos os leads de todas as lojas. Troca por membership.
DROP POLICY IF EXISTS "leads_all" ON leads;

CREATE POLICY "leads_select_member" ON leads FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid()));

CREATE POLICY "leads_update_member" ON leads FOR UPDATE
  USING (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid()));

CREATE POLICY "leads_insert_member" ON leads FOR INSERT
  WITH CHECK (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid()));

-- conversations: leitura/edição por membership; mantém o acesso anon do chat.
DROP POLICY IF EXISTS "conversations_read_owner" ON conversations;
CREATE POLICY "conversations_read_member" ON conversations FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "conversations_update" ON conversations;
CREATE POLICY "conversations_update_member" ON conversations FOR UPDATE
  USING (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid()));

-- messages: leitura por membership; mantém o acesso anon do chat.
DROP POLICY IF EXISTS "messages_read_owner" ON messages;
CREATE POLICY "messages_read_member" ON messages FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid()));
```

- [ ] **Step 2: Revisar o SQL**

Confira: as policies `conversations_read_anon`, `conversations_insert`, `messages_read_anon` e `messages_insert` **não** são tocadas — o chat público (anon) continua funcionando. n8n grava `leads`/`messages` com o service role, que ignora RLS. As policies removidas (`leads_all`, `conversations_read_owner`, `conversations_update`, `messages_read_owner`) são exatamente as que assumiam dono-único.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/025_membership_rls.sql
git commit -m "feat(db): rewrite leads/conversations/messages RLS to store membership"
```

---

## Task 3: Tipo TS de `store_members`

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Adicionar a tabela ao tipo**

Em `src/types/database.ts`, dentro de `Database['public']['Tables']`, adicionar uma entrada `store_members` ao lado das outras tabelas. Seguir o estilo exato das tabelas vizinhas (`Row` com todos os campos, `Insert`/`Update` com os opcionais marcados com `?`):

```ts
      store_members: {
        Row: {
          id: string
          store_id: string
          user_id: string
          role: string
          full_name: string
          created_at: string
        }
        Insert: {
          id?: string
          store_id: string
          user_id: string
          role?: string
          full_name: string
          created_at?: string
        }
        Update: {
          id?: string
          store_id?: string
          user_id?: string
          role?: string
          full_name?: string
          created_at?: string
        }
      }
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo. Há UM erro pré-existente não relacionado em `src/app/api/inventory/import/route.ts` (falta `user_id` num upsert) — aceitável, ignore só esse.

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts
git commit -m "feat(types): add store_members table type"
```

---

## Task 4: Helper `getStoreRole`

**Files:**
- Create: `src/lib/store-role.ts`

- [ ] **Step 1: Criar o helper**

Criar `src/lib/store-role.ts`:

```ts
import { createClient } from '@/lib/supabase/server'

export type StoreRole = 'owner' | 'agent'

// Resolve o papel do usuário atual na loja. Um vendedor sempre tem uma linha
// em store_members (role 'agent'); um dono também tem (criada pelo trigger em
// store_settings) — mas um dono que ainda não configurou a loja não tem linha,
// então a ausência é tratada como 'owner'.
export async function getStoreRole(): Promise<StoreRole> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return 'owner'

  const { data } = await supabase
    .from('store_members')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()

  return data?.role === 'agent' ? 'agent' : 'owner'
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo (apenas o erro pré-existente conhecido em `src/app/api/inventory/import/route.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/store-role.ts
git commit -m "feat(auth): add getStoreRole helper"
```

---

## Task 5: Guarda de dono nas páginas só-do-dono

**Files:**
- Modify: `src/app/painel/page.tsx`
- Modify: `src/app/estoque/page.tsx`
- Modify: `src/app/loja/page.tsx`

- [ ] **Step 1: `painel/page.tsx`**

Em `src/app/painel/page.tsx`, adicionar o import:

```ts
import { getStoreRole } from '@/lib/store-role'
```

E logo após a checagem `if (!user) redirect('/login')` (que já existe), adicionar:

```ts
  if ((await getStoreRole()) !== 'owner') redirect('/conversas')
```

- [ ] **Step 2: `estoque/page.tsx`**

Em `src/app/estoque/page.tsx`, adicionar o import `import { getStoreRole } from '@/lib/store-role'` e, logo após a checagem de usuário não autenticado já existente (o `redirect('/login')`), adicionar:

```ts
  if ((await getStoreRole()) !== 'owner') redirect('/conversas')
```

Se `estoque/page.tsx` ainda não importar `redirect` de `next/navigation`, adicionar esse import também.

- [ ] **Step 3: `loja/page.tsx`**

Em `src/app/loja/page.tsx`, adicionar o import `import { getStoreRole } from '@/lib/store-role'` e, logo após a checagem de usuário não autenticado já existente, adicionar:

```ts
  if ((await getStoreRole()) !== 'owner') redirect('/conversas')
```

Se `loja/page.tsx` ainda não importar `redirect` de `next/navigation`, adicionar esse import também.

- [ ] **Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo (apenas o erro pré-existente conhecido em `src/app/api/inventory/import/route.ts`).

- [ ] **Step 5: Commit**

```bash
git add src/app/painel/page.tsx src/app/estoque/page.tsx src/app/loja/page.tsx
git commit -m "feat(auth): redirect non-owners away from owner-only pages"
```

---

## Task 6: Server actions de Equipe

**Files:**
- Create: `src/actions/equipe.ts`

- [ ] **Step 1: Criar o arquivo**

Criar `src/actions/equipe.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export interface MemberRow {
  id: string
  userId: string
  fullName: string
  email: string
  role: 'owner' | 'agent'
}

// Devolve o id do dono (= store_id) se o chamador for dono; senão null.
async function ownerStoreId(): Promise<string | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('store_members')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()

  // Vendedor tem role 'agent'. Dono tem 'owner' ou (se não configurou a loja
  // ainda) nenhuma linha — ausência conta como dono.
  if (data?.role === 'agent') return null
  return user.id
}

export async function listStoreMembers(): Promise<MemberRow[]> {
  const storeId = await ownerStoreId()
  if (!storeId) return []

  const admin = createAdminClient()
  const { data: members, error } = await admin
    .from('store_members')
    .select('id, user_id, full_name, role')
    .eq('store_id', storeId)
    .order('created_at', { ascending: true })
  if (error || !members) {
    console.error('listStoreMembers error', error)
    return []
  }

  const rows: MemberRow[] = []
  for (const m of members) {
    const { data: u } = await admin.auth.admin.getUserById(m.user_id)
    rows.push({
      id: m.id,
      userId: m.user_id,
      fullName: m.full_name,
      email: u.user?.email ?? '',
      role: m.role === 'owner' ? 'owner' : 'agent',
    })
  }
  return rows
}

export async function createVendor(input: {
  fullName: string
  email: string
  password: string
}): Promise<{ ok: boolean; error?: string }> {
  const storeId = await ownerStoreId()
  if (!storeId) {
    return { ok: false, error: 'Apenas o dono pode adicionar vendedores.' }
  }

  const fullName = input.fullName.trim()
  const email = input.email.trim().toLowerCase()
  if (!fullName) return { ok: false, error: 'Informe o nome do vendedor.' }
  if (!email) return { ok: false, error: 'Informe o email do vendedor.' }
  if (input.password.length < 6) {
    return { ok: false, error: 'A senha deve ter ao menos 6 caracteres.' }
  }

  const admin = createAdminClient()
  const { data: created, error: createErr } =
    await admin.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
    })
  if (createErr || !created.user) {
    return {
      ok: false,
      error: createErr?.message ?? 'Não foi possível criar a conta.',
    }
  }

  const { error: memberErr } = await admin.from('store_members').insert({
    store_id: storeId,
    user_id: created.user.id,
    role: 'agent',
    full_name: fullName,
  })
  if (memberErr) {
    // Desfaz o usuário órfão do Auth.
    await admin.auth.admin.deleteUser(created.user.id)
    console.error('createVendor member insert error', memberErr)
    return { ok: false, error: 'Não foi possível vincular o vendedor à loja.' }
  }

  revalidatePath('/equipe')
  return { ok: true }
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

  // Apagar o usuário do Auth cascateia o delete da linha store_members.
  const { error } = await admin.auth.admin.deleteUser(member.user_id)
  if (error) {
    console.error('removeVendor error', error)
    return { ok: false, error: 'Não foi possível remover o vendedor.' }
  }

  revalidatePath('/equipe')
  return { ok: true }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo (apenas o erro pré-existente conhecido em `src/app/api/inventory/import/route.ts`). O `store_members` é reconhecido porque a Task 3 adicionou o tipo.

- [ ] **Step 3: Commit**

```bash
git add src/actions/equipe.ts
git commit -m "feat(equipe): add team server actions (list/create/remove vendor)"
```

---

## Task 7: Componente `EquipeView`

**Files:**
- Create: `src/components/equipe/EquipeView.tsx`

- [ ] **Step 1: Criar o componente**

Criar `src/components/equipe/EquipeView.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createVendor, removeVendor, type MemberRow } from '@/actions/equipe'
import { Input, Label } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

export function EquipeView({ members }: { members: MemberRow[] }) {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await createVendor({ fullName, email, password })
      if (!res.ok) {
        setError(res.error ?? 'Erro ao adicionar vendedor.')
        return
      }
      setFullName('')
      setEmail('')
      setPassword('')
      router.refresh()
    })
  }

  function handleRemove(memberId: string) {
    startTransition(async () => {
      const res = await removeVendor(memberId)
      if (res.ok) router.refresh()
      else setError(res.error ?? 'Erro ao remover vendedor.')
    })
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

      <div className="card mt-6 divide-y divide-ink-100">
        {members.map((m) => (
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

      <form onSubmit={handleAdd} className="card mt-6 p-5 space-y-4">
        <div
          className="font-display font-bold text-ink-900"
          style={{ fontSize: '16px' }}
        >
          Adicionar vendedor
        </div>
        <div>
          <Label htmlFor="v-name">Nome</Label>
          <Input
            id="v-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            placeholder="Nome do vendedor"
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
          />
        </div>
        <div>
          <Label htmlFor="v-pass">Senha provisória</Label>
          <Input
            id="v-pass"
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            placeholder="mín. 6 caracteres"
          />
        </div>
        {error && (
          <p className="text-[13px] font-medium text-danger-700">{error}</p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? 'Adicionando…' : 'Adicionar vendedor'}
        </Button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo (apenas o erro pré-existente conhecido em `src/app/api/inventory/import/route.ts`). `Input`, `Label` e `Button` são primitivos de UI existentes em `src/components/ui/` (usados na página de login). Se o `Button` exigir alguma prop obrigatória além de `type`/`disabled`/`children`, ajuste a chamada para satisfazê-la — não invente props novas.

- [ ] **Step 3: Commit**

```bash
git add src/components/equipe/EquipeView.tsx
git commit -m "feat(equipe): add EquipeView component"
```

---

## Task 8: Rota `/equipe` (layout + page)

**Files:**
- Create: `src/app/equipe/layout.tsx`
- Create: `src/app/equipe/page.tsx`

- [ ] **Step 1: Criar `layout.tsx`**

Criar `src/app/equipe/layout.tsx` (idêntico em estrutura ao `src/app/painel/layout.tsx`):

```tsx
import { Sidebar } from '@/components/ui/Sidebar'

export default function EquipeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  )
}
```

- [ ] **Step 2: Criar `page.tsx`**

Criar `src/app/equipe/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getStoreRole } from '@/lib/store-role'
import { listStoreMembers } from '@/actions/equipe'
import { EquipeView } from '@/components/equipe/EquipeView'

export const dynamic = 'force-dynamic'

export default async function EquipePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if ((await getStoreRole()) !== 'owner') redirect('/conversas')

  const members = await listStoreMembers()
  return <EquipeView members={members} />
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo (apenas o erro pré-existente conhecido em `src/app/api/inventory/import/route.ts`).

- [ ] **Step 4: Commit**

```bash
git add "src/app/equipe/layout.tsx" "src/app/equipe/page.tsx"
git commit -m "feat(equipe): add /equipe route (owner-only)"
```

---

## Task 9: Sidebar ciente de papel

O `Sidebar` é Client Component. Hoje a constante `NAV` lista Painel/Conversas/Estoque/Loja. Esta task adiciona o item **Equipe**, marca os itens só-do-dono, e filtra o menu pelo papel do usuário (buscado client-side).

**Files:**
- Modify: `src/components/ui/Sidebar.tsx`

- [ ] **Step 1: Estender o tipo `NavItem` e a constante `NAV`**

Em `src/components/ui/Sidebar.tsx`, o tipo `NavItem` hoje é:

```ts
type NavItem = {
  href: string
  label: string
  iconName: IconName
  badge?: string
}
```

Adicionar o campo `ownerOnly`:

```ts
type NavItem = {
  href: string
  label: string
  iconName: IconName
  badge?: string
  ownerOnly?: boolean
}
```

A constante `NAV` hoje é:

```ts
const NAV: NavItem[] = [
  { href: '/painel', label: 'Painel', iconName: 'trend' },
  { href: '/conversas', label: 'Conversas', iconName: 'msgSq', badge: '12' },
  { href: '/estoque', label: 'Estoque', iconName: 'package' },
  { href: '/loja', label: 'Loja', iconName: 'store' },
]
```

Substituir por (marca os itens só-do-dono e adiciona Equipe):

```ts
const NAV: NavItem[] = [
  { href: '/painel', label: 'Painel', iconName: 'trend', ownerOnly: true },
  { href: '/conversas', label: 'Conversas', iconName: 'msgSq', badge: '12' },
  { href: '/estoque', label: 'Estoque', iconName: 'package', ownerOnly: true },
  { href: '/loja', label: 'Loja', iconName: 'store', ownerOnly: true },
  { href: '/equipe', label: 'Equipe', iconName: 'userX', ownerOnly: true },
]
```

- [ ] **Step 2: Buscar o papel do usuário no componente `Sidebar`**

Dentro da função `Sidebar`, logo após `const pathname = usePathname()`, adicionar o estado e o efeito que resolve o papel (o arquivo já importa `useEffect`, `useState` e `createClient`):

```tsx
  const [isOwner, setIsOwner] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function loadRole() {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('store_members')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle()
      // Vendedor tem role 'agent'; dono tem 'owner' ou nenhuma linha.
      if (!cancelled) setIsOwner(data?.role !== 'agent')
    }
    loadRole()
    return () => {
      cancelled = true
    }
  }, [])
```

- [ ] **Step 3: Filtrar `NAV` pelo papel na renderização**

No JSX, o `<ul>` do menu hoje faz `{NAV.map(({ href, label, iconName, badge }) => {`. Trocar `NAV.map` por uma lista filtrada: substituir `{NAV.map(` por `{NAV.filter((item) => isOwner || !item.ownerOnly).map(`.

O resto do `.map` (a desestruturação e o corpo) fica igual.

> Enquanto o papel carrega, `isOwner` é `false` e o menu mostra só os itens sem `ownerOnly` (Conversas). Para o dono, os demais itens aparecem assim que o papel resolve. É um flash aceitável.

- [ ] **Step 4: Build completo**

Run: `npm run build`
Expected: compila e faz typecheck. O ÚNICO erro aceitável é o pré-existente em `src/app/api/inventory/import/route.ts`. Qualquer outro erro é falha real a reportar.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Sidebar.tsx
git commit -m "feat(equipe): role-aware sidebar nav with Equipe item"
```

---

## Deploy & verificação

As migrations `024` e `025` precisam ser **aplicadas ao Supabase** (`supabase db push` ou SQL Editor, em ordem numérica) para o app funcionar — sem a tabela `store_members` e a nova RLS, `getStoreRole`/`listStoreMembers` e as queries de loja falham em runtime. Este passo é manual — o agente executor NÃO deve tentar aplicá-las.

Após aplicar, verificação manual (`npm run dev`):
- Como dono: o menu mostra Painel/Conversas/Estoque/Loja/Equipe. `/equipe` lista o dono; adicionar um vendedor cria a conta e ela aparece na lista.
- Logar com o vendedor recém-criado (email + senha provisória): o menu mostra só Conversas; abrir `/painel`, `/estoque`, `/loja` ou `/equipe` direto redireciona para `/conversas`; em `/conversas` o vendedor vê as conversas **da loja dele** e de nenhuma outra.
- Remover o vendedor em `/equipe` apaga a conta.

## Riscos / pegadinhas

- **RLS é mudança sensível.** Testar isolamento entre lojas: um vendedor da loja A não pode ver leads/conversas da loja B.
- **`leads.store_id` e `conversations.store_id` são nullable.** Linhas com `store_id` nulo ficam invisíveis para todos sob a nova RLS (a subquery `store_id IN (...)` dá NULL). É o comportamento correto (linha sem loja não pertence a ninguém), mas vale saber ao depurar.
- **Senha provisória** — o dono define e comunica por fora; sem fluxo de reset neste plano.
- **Destino do redirect** — neste plano as páginas só-do-dono mandam o vendedor para `/conversas`. O Plano 2 troca para `/leads` quando essa página existir.
- **Numeração de migrations:** confirmar que `024` é o próximo livre antes de criar.
