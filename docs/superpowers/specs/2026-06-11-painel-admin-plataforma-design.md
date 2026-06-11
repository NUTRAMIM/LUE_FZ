# Painel de Super-Admin da Plataforma — Design

**Data:** 2026-06-11
**Status:** Aprovado para planejamento

## Objetivo

Criar um painel acessível somente a contas de super-admin da plataforma LUE
(operador/sócios), separado das roles por loja (`owner`/`agent`). No momento o
painel exibe apenas **consumo de tokens da IA**, agregado por loja e no total,
com recortes de Dia / Semana / Mês. O acesso é protegido server-side e a rota
não é exposta para não-admins.

## Contexto atual

- Roles são **por loja**: `owner` / `agent` (`store_members`, ver
  `src/lib/store-role.ts`). Não existe conceito de admin global.
- Consumo de tokens **não é persistido**: o `chat-service` (Python) calcula
  `prompt/completion/total/calls` por conversa via `UsageAccumulator`
  (`chat-service/app/usage.py`) e apenas loga em `pipeline.py:77`. Não há
  tabela nem coluna de tokens.
- Sidebar (`src/components/ui/Sidebar.tsx`) já filtra itens por role e usa a
  identidade visual do produto (`nav-link`, `eyebrow`, `text-ink-*`,
  `brand-*`). Layout autenticado em `src/app/painel/(default)/layout.tsx`
  monta o sidebar a partir de `getSidebarData()` (`src/lib/sidebar-data.ts`).
- Já existe `createAdminClient()` (service-role) em
  `src/lib/supabase/admin.ts` e `getAuthedUser()` em `src/lib/auth.ts`.

## Decisões de design

| Tema | Decisão |
|------|---------|
| Tipo de admin | Super-admin **da plataforma** (vê todas as lojas) |
| Como marcar admin | **Allowlist via env** `PLATFORM_ADMIN_EMAILS` |
| Dados de tokens | **Agregado diário por loja**; painel soma por loja, total geral, e recorta Dia/Semana/Mês |
| Proteção da rota | **404 para não-admin** + caminho discreto (`/painel/_internal`) |

## Componentes

### 1. Identidade do admin — `src/lib/platform-admin.ts`

- Nova env `PLATFORM_ADMIN_EMAILS`: lista de e-mails separados por vírgula.
- `isPlatformAdmin(user: { email?: string } | null): boolean`:
  - Faz parse da env (split por vírgula, trim, lowercase, descarta vazios).
  - Compara o e-mail do usuário (trim + lowercase) com a lista.
  - **Fail-closed**: se a env estiver ausente/vazia, ninguém é admin.
- Módulo server-only (lê `process.env`, nunca exposto ao client).

### 2. Persistência do consumo de tokens

**Migration `supabase/migrations/037_ai_usage_daily.sql`:**

```sql
create table ai_usage_daily (
  store_id uuid not null references store_settings(id) on delete cascade,
  day date not null,
  prompt_tokens bigint not null default 0,
  completion_tokens bigint not null default 0,
  total_tokens bigint not null default 0,
  calls integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (store_id, day)
);

alter table ai_usage_daily enable row level security;
-- Sem policies: nenhum acesso via cliente anon/authenticated.
-- Apenas a service-role (que ignora RLS) lê/escreve.
```

**`chat-service/app/db.py` — novo método:**

- `record_daily_usage(store_id, prompt, completion, total, calls)`:
  - UPSERT que **incrementa** os contadores para o dia atual no fuso
    `America/Sao_Paulo`:

  ```sql
  INSERT INTO ai_usage_daily (store_id, day, prompt_tokens,
      completion_tokens, total_tokens, calls, updated_at)
  VALUES ($1, (now() at time zone 'America/Sao_Paulo')::date,
      $2, $3, $4, $5, now())
  ON CONFLICT (store_id, day) DO UPDATE SET
      prompt_tokens     = ai_usage_daily.prompt_tokens     + EXCLUDED.prompt_tokens,
      completion_tokens = ai_usage_daily.completion_tokens + EXCLUDED.completion_tokens,
      total_tokens      = ai_usage_daily.total_tokens      + EXCLUDED.total_tokens,
      calls             = ai_usage_daily.calls             + EXCLUDED.calls,
      updated_at        = now();
  ```

**`chat-service/app/pipeline.py`:**

- Após o `log.info("usage da conversa ...")`, chamar
  `db.record_daily_usage(store.id, usage.prompt, usage.completion,
  usage.total, usage.calls)`.
- **Best-effort**: envolto em try/except com log de erro — falha de gravação
  de métrica nunca afeta a resposta ao cliente. Só grava se `usage.calls > 0`.

**`src/types/database.ts`:** adicionar o tipo `ai_usage_daily` (Row/Insert/Update).

### 3. Rota protegida — `src/app/painel/(default)/_internal/page.tsx`

- URL resultante: **`/painel/_internal`** (o grupo `(default)` não entra na URL;
  herda o layout com sidebar → mesma identidade visual do painel).
- Server component. Gate no topo, **antes de qualquer fetch ou render**:

  ```ts
  const user = await getAuthedUser()
  if (!user || !isPlatformAdmin(user)) notFound()
  ```

  `notFound()` retorna **404** — a rota se comporta como inexistente para
  não-admins (não revela existência via 403/redirect).
- Após o gate: lê os dados via `createAdminClient()` (service-role),
  agregando `ai_usage_daily` e juntando o nome das lojas de `store_settings`.

### 4. Botão "Admin" no Sidebar

- `getSidebarData()` (`src/lib/sidebar-data.ts`) passa a calcular e devolver
  `isAdmin: boolean` (via `isPlatformAdmin(user)`). Fail-open existente para
  `owner` é mantido; `isAdmin` é fail-closed (false em erro).
- `SidebarData` ganha `isAdmin`. O layout repassa para `<Sidebar />`.
- `Sidebar.tsx`: renderiza um item "Admin" na seção **CONTA**, apontando para
  `/painel/_internal`, **somente quando `isAdmin === true`**. Para não-admins a
  string da rota nunca é renderizada no HTML.

### 5. UI do painel (mesma identidade visual)

- `PageHeader` título "Admin · Plataforma", subtítulo curto.
- Seletor de período **Dia / Semana / Mês** (client component leve; controla
  um query param `?periodo=dia|semana|mes`, default `dia`).
- Faixa de `StatCard`s:
  - Total de tokens no período
  - Prompt vs Completion (dois cards ou um com hint)
  - Nº de chamadas (`calls`)
  - Lojas ativas no período
- Tabela **por loja**: nome da loja, prompt, completion, total, chamadas —
  ordenada por `total_tokens` desc. `EmptyState` quando não há dados.
- Reusa `PageHeader`, `StatCard`, `Card`, `IconChip`, `EmptyState` e classes
  `ink/brand/slate`. UI construída com a skill `frontend-design`.

## Fluxo de dados (período)

1. Server component recebe `periodo` (default `dia`).
2. Calcula intervalo no fuso America/Sao_Paulo:
   - **Dia** = hoje
   - **Semana** = últimos 7 dias (incl. hoje)
   - **Mês** = primeiro dia do mês atual até hoje
3. Query: `select` em `ai_usage_daily` com `day >= inicio`, join opcional com
   `store_settings(store_name)`.
4. Agrega em memória: soma por loja (linhas da tabela) e total geral (cards).

## Tratamento de erros

- Gate de admin → `notFound()` (404). Env ausente → ninguém passa (fail-closed).
- Erro na leitura service-role → renderiza `EmptyState` com aviso, sem vazar
  detalhes.
- Falha no `record_daily_usage` (chat-service) → log de erro, resposta ao
  cliente segue normal.

## Testes

- `src/lib/__tests__/platform-admin.test.ts`: parsing da env (vírgulas,
  espaços, case-insensitive), env vazia/ausente (fail-closed), match e não-match.
- `chat-service/tests/`: teste do `record_daily_usage` (UPSERT incrementa em
  segunda gravação do mesmo dia).

## Fora de escopo (YAGNI por enquanto)

- Cobrança/billing a partir do consumo.
- Gerenciamento de admins via UI (allowlist é editada no env).
- Outras métricas além de tokens (conversas, leads, etc.).
- Custo em R$/USD por token.
