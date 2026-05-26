# Equipe — Convite de vendedor por link

**Data:** 2026-05-26
**Status:** Design aprovado, aguardando plano de implementação

## Objetivo

Permitir que o dono de uma loja convide vendedores (usuários não-pagantes) para acessar **apenas** os menus `/conversas` e `/leads`. Hoje a página `/equipe` existe parcialmente: o owner consegue criar uma conta de vendedor com nome+email+senha provisória que ele inventa, mas:

- O vendedor não "aceita" nada — recebe a senha por canal externo.
- Bugs no middleware de billing fazem o vendedor cair sempre na tela de checkout (`/planos`) ao tentar acessar `/conversas`.
- Nada limita quantos vendedores por plano.

## Decisões já tomadas

| Decisão | Valor |
|---|---|
| Fluxo de convite | Link copiável (sem SMTP) |
| Página inicial do vendedor | `/conversas` |
| Limite de vendedores | Por plano: `essencial=3`, `profissional=5`, `performance=10` |
| Email duplicado (já tem conta no LUE) | Bloqueia |
| Validade do link de convite | 7 dias |

## O que já existe (não mexer)

- Tabela `store_members(store_id, user_id, role, full_name)` (`024_store_members.sql`)
- Trigger `seed_store_owner_member` cria row owner ao criar `store_settings`
- RLS membership-based em `leads`, `conversations`, `messages` (`025_membership_rls.sql`)
- Helper `getStoreRole(): 'owner' | 'agent'` em `src/lib/store-role.ts`
- Sidebar filtra menus `ownerOnly`
- `getSidebarData()` devolve role para a Sidebar
- Página `/equipe` com listagem de membros + `removeVendor`
- Action `removeVendor` em `src/actions/equipe.ts`

## O que muda

### 1. Schema

Nova migração `supabase/migrations/031_store_invites.sql`:

```sql
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

CREATE POLICY "store_invites_select_owner" ON store_invites FOR SELECT
  USING (store_id IN (
    SELECT store_id FROM store_members
    WHERE user_id = auth.uid() AND role = 'owner'
  ));
```

Notas:
- `UNIQUE (store_id, email)` impede 2 convites pendentes da mesma loja pro mesmo email.
- INSERT/UPDATE/DELETE acontecem só via service role (admin client) nas server actions — sem policy de escrita.
- Token é 32 bytes random base64url, gerado server-side (`crypto.randomBytes(32).toString('base64url')`).

### 2. Limites por plano

Adicionar campo `maxAgents: number` em cada plano de `src/lib/plans-display.ts`:

| Plano | maxAgents |
|---|---|
| essencial | 3 |
| profissional | 5 |
| performance | 10 |

Sem subscription ativa → tratamento equivalente a `maxAgents = 0` (não pode convidar).

Novo helper `src/lib/plan-limits.ts`:

```ts
export async function getMaxAgentsForStore(storeId: string): Promise<number>
```

Lê `store_subscriptions` da loja e mapeia `plan_id` → `maxAgents`. Sem sub ativa → 0.

### 3. Resolução de `store_id` (root cause dos bugs de billing)

Novo helper `src/lib/active-store.ts`:

```ts
import { cache } from 'react'

// Resolve o store_id do user atual.
//   - Sem user logado: null
//   - Tem row em store_members: usa o store_id de lá (cobre owner com loja
//     configurada + agent)
//   - Sem row em store_members (owner sem loja): fallback user.id (preserva
//     a convenção atual do projeto)
// React `cache()` deduplica por request (mesmo padrão do getAuthedUser).
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

Usado em:

| Local | Mudança |
|---|---|
| `src/middleware.ts` (billing-gate) | Resolve store_id via `store_members` antes da query em `store_subscriptions`. Não usa `cache()` (middleware não tem React context). |
| `src/actions/billing.ts::getCurrentSubscription` | Troca `eq('store_id', user.id)` por `eq('store_id', await getActiveStoreId())` |
| `src/actions/billing.ts::createCheckoutSession` | Bloqueia se o user for agent: `{ error: 'agent_cannot_pay' }` |

### 4. Actions em `src/actions/equipe.ts`

| Função | Visibilidade | Comportamento |
|---|---|---|
| `createInvite({ fullName, email })` | Owner-only | Valida limite por plano. Checa se email já existe via query direta `SELECT id FROM auth.users WHERE email = ? LIMIT 1` usando service role (o JS SDK não expõe filtro por email no `listUsers`). Gera token 32B base64url. Insere row em `store_invites` com `expires_at = now() + 7 days`. Retorna `{ ok: true, token, url }`. |
| `listInvites()` | Owner-only | Lista convites pendentes (`accepted_at IS NULL AND expires_at > now()`). |
| `revokeInvite(inviteId)` | Owner-only | `DELETE FROM store_invites WHERE id = ?` (valida ownership do store_id antes). |
| `acceptInvite({ token, password })` | **Public (anon)** | Valida token. Recheck email não existe (race). Cria user via `admin.createUser({ email, password, email_confirm: true })`. Insere `store_members(role='agent', full_name)`. `UPDATE store_invites SET accepted_at = now()`. Retorna `{ ok: true, email }` pro client logar via `signInWithPassword`. |
| `removeVendor(memberId)` | Owner-only | **Mantém igual** — já funciona. |
| `createVendor(...)` (atual) | — | **Remove**. Substituído pelo fluxo de convite. |

A URL devolvida em `createInvite` é `${getAppUrl()}/convite/{token}` — usa o helper já existente em `src/lib/app-url.ts`.

### 5. Rotas e fluxo de auth

#### `src/middleware.ts`

```ts
// 1. /chat/* → fluxo de visitor cookie (sem alteração)
// 2. /convite/* → next() sem checagem (rota pública)
// 3. Demais AUTH_PROTECTED:
//    - resolve membership: SELECT store_id, role FROM store_members WHERE user_id = auth.uid()
//    - storeId = membership?.store_id ?? user.id
//    - billing check: SELECT ... WHERE store_id = storeId (não user.id)
// 4. Pós-login (/login com user autenticado):
//    - role = membership?.role === 'agent' ? 'agent' : 'owner'
//    - redirect: agent → /conversas, owner → /painel
```

Matcher pode ficar como está (`/((?!_next/static|_next/image|favicon.ico|widget|api).*)`) — `/convite/*` é tratado dentro da função com `next()` early-return.

#### `src/app/login/page.tsx`

Remove o `router.push('/painel')`. Deixa só `router.refresh()` — o middleware decide o destino.

#### `src/app/planos/page.tsx`

Antes de `if (subscription.isActive) redirect('/painel')`, adiciona:

```ts
const role = await getStoreRole()
if (role === 'agent') redirect('/conversas')
```

#### `src/app/painel/(default)/page.tsx`

Adiciona no topo (cinto + suspensório):

```ts
if ((await getStoreRole()) === 'agent') redirect('/conversas')
```

Mesma guarda em `src/app/loja/page.tsx` e `src/app/estoque/page.tsx` (verificar se já existe; se não, adicionar). `/equipe/page.tsx` já tem.

#### `src/app/convite/[token]/page.tsx` (novo)

Server Component. Layout standalone (sem sidebar), parecido com `/login`.

Fluxo:

1. Server fetch via admin client:
   ```sql
   SELECT i.*, s.store_name
   FROM store_invites i
   JOIN store_settings s ON s.id = i.store_id
   WHERE i.token = $1
     AND i.expires_at > now()
     AND i.accepted_at IS NULL
   ```
2. 3 estados de UI:
   - Convite válido → `<ConviteForm>` (client) com nome da loja, email read-only, "Nova senha" + "Confirmar senha".
   - Convite inválido/expirado → tela "Esse convite expirou ou já foi usado".
   - Erro inesperado → tela genérica.
3. No submit do form:
   - `acceptInvite({ token, password })` → cria a conta server-side e marca como aceito.
   - Client recebe `{ ok: true, email }` → chama `supabase.auth.signInWithPassword({ email, password })` no browser → `router.push('/conversas')`.

### 6. UI da `/equipe`

`src/components/equipe/EquipeView.tsx` ganha 3 seções, nesta ordem:

1. **Card de uso do plano** (no topo):
   ```
   2 de 5 vendedores · Plano Profissional
   ```
   Se sem sub: "Ative seu plano pra adicionar vendedores."
   Se no limite: badge "Limite atingido" no card.

2. **Lista de membros** (já existe; mantém com pequenos ajustes visuais).

3. **Lista de convites pendentes** (nova). Para cada convite:
   ```
   [Email]                Pendente · expira em 4d
                          [Copiar link]  [Revogar]
   ```

4. **Form "Convidar vendedor"** — campos `Nome` e `Email` (a senha some, era a parte que o owner inventava). No submit:
   - Se `createInvite` retornar ok → modal/inline card com a URL de convite e botão **Copiar** (feedback "Copiado!").
   - Auxiliar: "Mande esse link pro vendedor. Expira em 7 dias."
   - Botão desabilitado quando `currentAgents + pendingInvites >= maxAgents`.

### 7. Edge cases

| Cenário | Comportamento |
|---|---|
| Owner sem subscription tenta convidar | Bloqueia. Mensagem: "Ative seu plano pra adicionar vendedores." |
| Plano no limite | Botão "Convidar" desabilitado + tooltip; action revalida no server |
| Email já tem conta (na hora do convite) | `createInvite` retorna `{ ok: false, error: 'Esse email já tem conta no LUE.' }` |
| Email criou conta entre `createInvite` e `acceptInvite` (race) | `acceptInvite` falha com erro inline. Convite **não** marcado como aceito. Owner revoga manualmente. |
| Token expirado | `/convite/[token]` mostra tela amigável |
| Token já aceito | Mesma tela "Esse convite já foi usado" |
| Token inexistente | Mesma tela "Convite inválido" |
| Loja deletada | Cascade via FK limpa convites e memberships |
| Owner é deletado | Cascade via FK (`invited_by ON DELETE CASCADE`) |
| Downgrade de plano com excesso de vendedores | Não desativa ninguém. Bloqueia novos convites. Mensagem: "Você tem 5 vendedores no plano essencial (máx 3). Remova 2 ou faça upgrade." |
| Vendedor abre `/painel`, `/loja`, `/estoque`, `/equipe`, `/planos` direto | Guard explícito em cada page redireciona `/conversas` |
| Vendedor tenta `createCheckoutSession` via DevTools | Action retorna `{ error: 'agent_cannot_pay' }` |
| 2 vendedores aceitam o mesmo convite ao mesmo tempo | Unique `(store_id, email)` em `store_members` impede duplicata; segundo recebe erro |

### 8. Testes manuais (vão pro plano)

1. Owner com sub ativa convida → copia link → abre janela anônima → define senha → cai em `/conversas`
2. Vendedor recém-criado tenta `/painel`, `/estoque`, `/loja`, `/equipe`, `/planos` → todos redirecionam pra `/conversas`
3. Vendedor vê só conversas/leads da loja correta
4. Owner sem sub → `/equipe` mostra "Ative seu plano"
5. Owner no limite (3 vendedores no essencial) → botão desabilitado
6. Token expirado (forçar via update direto no DB) → tela de expiração
7. Owner revoga convite → link para de funcionar
8. Owner remove vendedor → próxima request do vendedor o desloga (cookie ainda válido até refresh — aceitável)
9. Email duplicado bloqueado em `createInvite` e em `acceptInvite`
10. Race: criar 2 invites simultâneos pro mesmo email — unique constraint impede

## Arquivos afetados (resumo)

**Novos:**
- `supabase/migrations/031_store_invites.sql`
- `src/lib/active-store.ts`
- `src/lib/plan-limits.ts`
- `src/app/convite/[token]/page.tsx`
- `src/app/convite/[token]/ConviteForm.tsx`

**Modificados:**
- `src/actions/equipe.ts` (adiciona invite actions, remove createVendor)
- `src/actions/billing.ts` (usa getActiveStoreId; bloqueia agent em checkout)
- `src/middleware.ts` (resolve store_id via membership; bypass /convite/*; redirect pós-login por role)
- `src/lib/plans-display.ts` (adiciona maxAgents)
- `src/components/equipe/EquipeView.tsx` (form + lista de pendentes + card de uso)
- `src/app/login/page.tsx` (remove redirect hardcoded pra /painel)
- `src/app/planos/page.tsx` (guard pra agent)
- `src/app/painel/(default)/page.tsx`, `src/app/loja/page.tsx`, `src/app/estoque/page.tsx` (guard pra agent)

## Out of scope (não fazer agora)

- Email de notificação (precisaria SMTP / Resend)
- Permissões granulares dentro de `/conversas` (ex: vendedor ver só conversas atribuídas a ele)
- Múltiplas lojas por usuário (multi-tenant per-user) — adiado
- Reset de senha do vendedor pelo owner
- Histórico de auditoria além de `accepted_at` (quem aceitou quando, IP, etc.)
- Permitir reutilizar token expirado (owner gera novo manualmente revogando + criando)
