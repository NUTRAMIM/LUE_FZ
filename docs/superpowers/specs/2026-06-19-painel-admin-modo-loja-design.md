# Modo Loja — Impersonação de operador pelo super-admin — Design

**Data:** 2026-06-19
**Status:** Aprovado para planejamento

## Objetivo

Permitir que um super-admin da plataforma LUE (allowlist `PLATFORM_ADMIN_EMAILS`)
**entre numa loja específica e a opere como se fosse o dono** — acesso total de
leitura **e escrita** a conversas, estoque, leads, configurações da loja, equipe
e planos. A entrada é feita a partir do painel admin existente
(`/painel/_internal`), com um banner sempre visível indicando o modo e um botão
para sair.

## Decisões (já validadas com o usuário)

| Tema | Decisão |
|------|---------|
| Nível de acesso | **Operador real** — leitura + escrita, age como `owner` da loja |
| Entrada/saída | Lista de lojas no `/painel/_internal` + botão **Entrar**; banner com **Sair** |
| Arquitetura | **RLS ligado** (sem service-role nos dados de loja); header `x-impersonate-store` honrado **só para admin** no banco |
| Auditoria | **Sem auditoria** por enquanto — só o banner visual |
| Role no modo loja | Impersona como **`owner`** (libera páginas owner-only) |

## Princípio de segurança

O risco que esta solução **evita** é o vazamento entre lojas. Por isso **não há
service-role** no caminho de dados da loja: o RLS continua sendo o muro. Toda a
lógica de impersonação é **aditiva** — cada policy ganha um ramo extra
`OR (impersonando E linha pertence à loja-alvo)`, gateado por `is_platform_admin`
**no banco**. Consequências:

- O caminho do **usuário normal não muda** (o predicado original é preservado
  intacto). Risco de regressão para não-admins ≈ zero.
- Um header forjado por um não-admin é **ignorado** (a função no banco checa
  `is_platform_admin(auth.uid())`). Fail-closed.
- Se algum `.eq('store_id', ...)` for esquecido na aplicação, **não vaza**: o RLS
  já restringe as linhas à loja-alvo (e só a ela), tanto na leitura quanto na
  escrita.

## Contexto atual (o que já existe)

- `isPlatformAdmin(user)` — allowlist por env, server-only
  (`src/lib/platform-admin.ts`). **Fail-closed**.
- `getStoreContext()` / `getActiveStoreId()` / `getStoreRole()` resolvem a loja
  ativa lendo a membership do usuário em `store_members`
  (`src/lib/active-store.ts`). Fallback `storeId = user.id`.
- `/painel/_internal` — painel admin existente que lista consumo de tokens por
  loja (`src/app/painel/(default)/_internal/page.tsx`). Já busca
  `store_settings(id, store_name)` via service-role.
- `createClient()` — client server-side autenticado (RLS ligado)
  (`src/lib/supabase/server.ts`). `createServerClient` aceita `global.headers`.
- **RLS é heterogêneo** (ponto crítico). Famílias de policy nas tabelas de loja:
  - **Membership** (`store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid())`):
    `leads` (025), `conversations` (025, member), `messages` (025, member),
    `store_invites` (031). Revisar também `knowledge_gaps` (027),
    `product_mentions` (028), `store_subscriptions` (029).
  - **`auth.uid() = id`**: `store_settings` (005).
  - **`auth.uid() = user_id`**: `products` (006/007). `products.user_id` == id da
    loja (== id do dono).
  - **Storage** (`auth.uid()::text = (storage.foldername(name))[1]`): buckets
    `product-images` (030), `product-videos` (040), `store-logos` (018).
- **Uso de `user.id` como identidade da loja** (porque historicamente
  `store_id == user.id` do dono): `painel.ts` (`const store = user.id`),
  `store-settings.ts` (`id: user.id`), `leads.ts`, `products.ts`
  (`.eq('user_id', user.id)`, `user_id: user.id`, paths `${user.id}/...`),
  `estoque/page.tsx`, `loja/page.tsx`. `conversas.ts` já usa `getActiveStoreId()`.

## Componentes

### 1. Sinal de impersonação (cookie + header)

- **Cookie** `impersonate_store` (httpOnly, `secure`, `sameSite=lax`, `path=/`),
  valor = UUID da loja-alvo. Fonte única do estado de impersonação.
- Setado **somente** pela server action `enterStore` (gateada por
  `isPlatformAdmin`); limpo por `exitStore`.
- `createClient()` passa a **ler o cookie** e, se presente, injetar o header
  `x-impersonate-store: <uuid>` via `global.headers`. Não precisa verificar admin
  aqui — a checagem é no banco (fail-closed lá). Header não é setado quando o
  cookie está ausente.

### 2. Funções e policies no banco — migration `045_impersonation_rls.sql`

> ⚠️ Conferir a numeração antes de criar: as migrations **045 e 046** de RLS já
> estão pendentes da auditoria de segurança (ver memória
> `project_security_audit_2026_06`). Usar o próximo número livre real.

**Identidade de admin no banco** (RLS não lê env):

```sql
create table if not exists platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table platform_admins enable row level security;
-- Sem policies: só a service-role lê/escreve. Seed manual com o(s) id(s) do(s) admin(s).

create or replace function app_is_platform_admin(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = uid);
$$;
```

**Loja impersonada (lê o header, gateia por admin):**

```sql
create or replace function app_impersonated_store()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  raw text;
  sid uuid;
begin
  raw := current_setting('request.headers', true)::json ->> 'x-impersonate-store';
  if raw is null or raw = '' then return null; end if;
  begin sid := raw::uuid; exception when others then return null; end;
  if not app_is_platform_admin(auth.uid()) then return null; end if;  -- fail-closed
  return sid;
end;
$$;
```

`app_impersonated_store()` retorna `NULL` exceto quando: header presente **e**
`auth.uid()` é platform-admin. "Está impersonando" ≡ retorno `IS NOT NULL`.

**Reescrita aditiva das policies.** Para cada policy de tabela de loja, preserva
o predicado original e adiciona o ramo de impersonação. Regra por família:

- Membership → `... OR (l.store_id = app_impersonated_store())`
  (onde `l.store_id` é a coluna de loja: `store_id`).
- `store_settings` → `auth.uid() = id OR id = app_impersonated_store()`.
- `products` → `auth.uid() = user_id OR user_id = app_impersonated_store()`.
- Storage → `... OR (storage.foldername(name))[1]::uuid = app_impersonated_store()`.

Aplicar em **todas** as operações relevantes (SELECT/INSERT/UPDATE/DELETE conforme
a policy existente) para garantir escrita além de leitura. A migration faz
`DROP POLICY`/`CREATE POLICY` de cada uma. Tabelas/policies a cobrir:

- `leads` (select/insert/update — 025)
- `conversations` (read_member/update_member — 025; manter as policies anon do chat intactas)
- `messages` (read_member — 025; manter anon; insert do chat continua via service-role)
- `store_settings` (select/insert/update — 005)
- `products` (read/write — 007)
- `store_invites` (select_owner — 031), `knowledge_gaps` (027),
  `product_mentions` (028), `store_subscriptions` (029) — revisar predicado e
  aplicar a mesma regra aditiva
- Storage: `product-images` (030), `product-videos` (040), `store-logos` (018)
  — ramo aditivo em insert/update/delete `*_own`

> **Validação obrigatória:** o ramo aditivo nunca pode alterar o resultado para
> um usuário não-admin (para quem `app_impersonated_store()` é sempre `NULL`,
> tornando o ramo `OR (... = NULL)` → `NULL`/falso). Testes confirmam paridade.

### 3. Resolução da loja ativa — impersonation-aware

`src/lib/active-store.ts`:

- `getStoreContext()` passa a, **antes** da query de membership, checar o cookie
  `impersonate_store`. Se presente **e** `isPlatformAdmin(user)` → retorna
  `{ storeId: <cookie>, role: 'owner', impersonating: true }`. Senão, fluxo atual.
- `StoreContext` ganha `impersonating: boolean` (default `false`).
- Não-admin com cookie setado → ignorado (gate por `isPlatformAdmin`).

### 4. Refactor `user.id` → `getActiveStoreId()` (correção de UX)

Com o RLS já protegendo por baixo, este refactor deixa de ser crítico de
segurança e passa a ser **correção de UX** (mostrar a loja certa). Trocar
"identidade da loja = `user.id`" por `getActiveStoreId()` em:

- `src/actions/painel.ts` (`const store = user.id` → loja ativa, múltiplos pontos)
- `src/actions/store-settings.ts` (`id: user.id` no upsert)
- `src/actions/leads.ts`
- `src/actions/products.ts` (`.eq('user_id', ...)`, `user_id:` no insert, e
  **paths de storage** `${user.id}/...` → `${activeStoreId}/...` para a mídia
  cair na pasta da loja certa)
- `src/app/estoque/page.tsx` (query `products` sem filtro: o RLS já escopa;
  ajustar o `store_settings.eq('id', user.id)` → loja ativa)
- `src/app/loja/page.tsx`

**Manter `user.id`** onde representa o **usuário agindo**, não a loja
(ex.: `contacted_by: user.id`). Sem auditoria, agir como o admin nesses campos é
aceitável; documentar os pontos.

### 5. Entrar / Sair — server actions

Novo `src/actions/impersonation.ts`:

- `enterStore(storeId: string)`: gate `isPlatformAdmin`; valida que a loja existe
  (via service-role, `store_settings`); seta o cookie `impersonate_store`;
  `redirect('/conversas')` (ou `/painel`).
- `exitStore()`: limpa o cookie; `redirect('/painel/_internal')`.
- Ambas são server actions; o gate de admin é a primeira linha (fail-closed).

### 6. UI

- **`/painel/_internal`**: a tabela passa a listar **todas** as lojas
  (`store_settings`), não só as com consumo, com uma coluna/botão **Entrar**
  (form server-action chamando `enterStore`). Mantém a seção de consumo de tokens.
- **Banner de modo loja** (`src/components/...`): renderizado no layout do painel
  (`src/app/painel/(default)/layout.tsx` e/ou nos layouts autenticados) quando
  `getStoreContext().impersonating === true`. Texto: "Você está operando como
  **\<nome da loja\>** (modo admin)" + botão **Sair** (server action `exitStore`).
  Usa a identidade visual existente (faixa fixa, `brand-*`/`ink-*`).
- `getSidebarData()` já devolve `storeName`; reaproveitar para o banner ou buscar
  o nome da loja-alvo.

## Fluxo (entrar → operar → sair)

1. Admin abre `/painel/_internal`, clica **Entrar** na loja X → `enterStore(X)`
   seta o cookie e redireciona.
2. Em cada request, `createClient()` lê o cookie e injeta
   `x-impersonate-store: X`. `getStoreContext()` retorna `{ storeId: X,
   role: 'owner', impersonating: true }`.
3. Páginas/queries operam sobre a loja X. O RLS — via `app_impersonated_store()`
   — libera **apenas** as linhas da loja X para o admin (leitura e escrita).
4. Banner visível em todas as páginas. **Sair** → `exitStore()` limpa o cookie;
   tudo volta ao normal (admin volta à própria identidade/loja).

## Tratamento de erros

- Cookie aponta para loja inexistente → `getStoreContext` pode devolver o id mesmo
  assim, mas o RLS não retornará linhas e a UI mostra vazio; `enterStore` valida
  a existência na entrada para evitar o caso.
- Header forjado por não-admin → `app_impersonated_store()` retorna `NULL` → sem
  efeito.
- Falha ao ler o header (`current_setting` ausente em algum contexto) →
  `current_setting('request.headers', true)` retorna `NULL` → sem impersonação.

## Testes

- **`platform-admin` / `active-store`** (Vitest): `getStoreContext` com cookie —
  admin → loja-alvo+`impersonating:true`; não-admin → ignora; sem cookie → fluxo
  normal. Mock de cookies/`isPlatformAdmin`.
- **`enterStore`/`exitStore`**: gate de admin (não-admin não seta cookie);
  validação de loja inexistente.
- **`createClient`**: injeta header quando o cookie está presente; não injeta
  quando ausente.
- **RLS (integração / SQL)**: provar paridade para não-admin (ramo aditivo não
  muda resultado) e isolamento para admin (impersonando loja X só vê/escreve X,
  nunca Y). Cobrir as quatro famílias (membership, store_settings, products,
  storage).

## Fora de escopo (YAGNI)

- Auditoria / log de sessões e de ações de escrita.
- Seletor flutuante de loja / busca por nome.
- Billing a partir do consumo.
- Gestão de `platform_admins` via UI (seed manual no banco; env continua para o
  gate de aplicação).
