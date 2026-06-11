# Painel de Super-Admin da Plataforma — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir um painel restrito a super-admins da plataforma (allowlist por env) que exibe o consumo de tokens da IA por loja e no total, com recortes Dia/Semana/Mês.

**Architecture:** Identidade de admin via allowlist `PLATFORM_ADMIN_EMAILS` (helper server-only fail-closed). O `chat-service` (Python) passa a gravar o uso diário por loja numa tabela `ai_usage_daily` (UPSERT incremental, RLS sem acesso público). A página vive em `/painel/_internal` (caminho discreto, herda o sidebar), com gate server-side que retorna 404 para não-admin e lê os agregados via service-role. O botão "Admin" aparece no sidebar apenas para admins.

**Tech Stack:** Next.js 16 (App Router, Server Components), Supabase (Postgres + service-role), TypeScript, Tailwind 4, Vitest; chat-service em Python (asyncpg) testado com pytest.

---

## File Structure

**Frontend / Next.js:**
- Create: `src/lib/platform-admin.ts` — `isPlatformAdmin()` (allowlist via env).
- Create: `src/lib/admin-usage.ts` — helpers puros de período e agregação.
- Create: `src/app/painel/(default)/_internal/page.tsx` — página gated (server component).
- Create: `src/app/painel/(default)/_internal/PeriodSelector.tsx` — seletor Dia/Semana/Mês (client).
- Create: `src/lib/__tests__/platform-admin.test.ts`
- Create: `src/lib/__tests__/admin-usage.test.ts`
- Modify: `src/lib/sidebar-data.ts` — adiciona `isAdmin` ao retorno.
- Modify: `src/app/painel/(default)/layout.tsx` — repassa `isAdmin` ao `<Sidebar />`.
- Modify: `src/components/ui/Sidebar.tsx` — item "Admin" condicional + ícone.
- Modify: `src/components/painel/Icons.tsx` — novo ícone `shield`.
- Modify: `src/types/database.ts` — tipo `ai_usage_daily`.

**Banco:**
- Create: `supabase/migrations/037_ai_usage_daily.sql`

**chat-service (Python):**
- Modify: `chat-service/app/db.py` — método `record_daily_usage()`.
- Modify: `chat-service/app/pipeline.py` — chama o upsert best-effort.
- Modify: `chat-service/tests/conftest.py` — `FakeDB.record_daily_usage`.
- Create: `chat-service/tests/test_daily_usage.py`

---

## Task 1: Helper `isPlatformAdmin` (allowlist por env)

**Files:**
- Create: `src/lib/platform-admin.ts`
- Test: `src/lib/__tests__/platform-admin.test.ts`

> Env nova (a configurar no deploy, NÃO no código): `PLATFORM_ADMIN_EMAILS` = lista de e-mails separados por vírgula. Sem `NEXT_PUBLIC_` — server-only.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/platform-admin.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { isPlatformAdmin } from '../platform-admin'

const ORIGINAL = process.env.PLATFORM_ADMIN_EMAILS

afterEach(() => {
  process.env.PLATFORM_ADMIN_EMAILS = ORIGINAL
})

describe('isPlatformAdmin', () => {
  it('retorna false quando a env está ausente (fail-closed)', () => {
    delete process.env.PLATFORM_ADMIN_EMAILS
    expect(isPlatformAdmin({ email: 'dono@lue.com' })).toBe(false)
  })

  it('retorna false quando a env está vazia', () => {
    process.env.PLATFORM_ADMIN_EMAILS = '   '
    expect(isPlatformAdmin({ email: 'dono@lue.com' })).toBe(false)
  })

  it('retorna false para user nulo ou sem email', () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'admin@lue.com'
    expect(isPlatformAdmin(null)).toBe(false)
    expect(isPlatformAdmin({})).toBe(false)
  })

  it('faz match case-insensitive e ignorando espaços', () => {
    process.env.PLATFORM_ADMIN_EMAILS = ' Admin@Lue.com , socio@lue.com '
    expect(isPlatformAdmin({ email: 'admin@lue.com' })).toBe(true)
    expect(isPlatformAdmin({ email: 'SOCIO@LUE.COM' })).toBe(true)
  })

  it('retorna false para email fora da lista', () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'admin@lue.com'
    expect(isPlatformAdmin({ email: 'intruso@lue.com' })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- platform-admin`
Expected: FAIL — `Cannot find module '../platform-admin'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/platform-admin.ts
import 'server-only'

// Allowlist de super-admins da plataforma. Lida da env `PLATFORM_ADMIN_EMAILS`
// (e-mails separados por vírgula). Fail-closed: env ausente/vazia => ninguém é
// admin. Server-only — nunca exposto ao client.
export function isPlatformAdmin(user: { email?: string | null } | null): boolean {
  const email = user?.email?.trim().toLowerCase()
  if (!email) return false

  const allow = (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)

  return allow.includes(email)
}
```

> Se o pacote `server-only` não existir no projeto, remova a linha `import 'server-only'` (o módulo já só é importado de server components/libs). Verifique com `npm ls server-only`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- platform-admin`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/platform-admin.ts src/lib/__tests__/platform-admin.test.ts
git commit -m "feat(admin): helper isPlatformAdmin com allowlist por env"
```

---

## Task 2: Migration `ai_usage_daily` + tipo no database.ts

**Files:**
- Create: `supabase/migrations/037_ai_usage_daily.sql`
- Modify: `src/types/database.ts` (dentro de `Database.public.Tables`)

- [ ] **Step 1: Escrever a migration**

```sql
-- supabase/migrations/037_ai_usage_daily.sql
-- Consumo de tokens da IA agregado por loja e por dia (fuso America/Sao_Paulo).
-- Escrito pelo chat-service (service-role) via UPSERT incremental em
-- record_daily_usage. Lido apenas pelo painel de super-admin (service-role).

CREATE TABLE ai_usage_daily (
  store_id          UUID NOT NULL REFERENCES store_settings(id) ON DELETE CASCADE,
  day               DATE NOT NULL,
  prompt_tokens     BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  total_tokens      BIGINT NOT NULL DEFAULT 0,
  calls             INTEGER NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, day)
);

CREATE INDEX idx_ai_usage_daily_day ON ai_usage_daily (day);

ALTER TABLE ai_usage_daily ENABLE ROW LEVEL SECURITY;
-- Sem policies: nenhum acesso via cliente anon/authenticated.
-- Apenas a service-role (que ignora RLS) lê e escreve.
```

- [ ] **Step 2: Adicionar o tipo em `src/types/database.ts`**

Localize o objeto `Tables: {` (linha ~11) e adicione esta entrada logo após a abertura, antes de `products: {`:

```ts
      ai_usage_daily: {
        Row: {
          store_id: string
          day: string
          prompt_tokens: number
          completion_tokens: number
          total_tokens: number
          calls: number
          updated_at: string
        }
        Insert: {
          store_id: string
          day: string
          prompt_tokens?: number
          completion_tokens?: number
          total_tokens?: number
          calls?: number
          updated_at?: string
        }
        Update: {
          store_id?: string
          day?: string
          prompt_tokens?: number
          completion_tokens?: number
          total_tokens?: number
          calls?: number
          updated_at?: string
        }
      }
```

- [ ] **Step 3: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos relacionados a `ai_usage_daily`.

- [ ] **Step 4: Aplicar a migration no Supabase**

> Rodar no ambiente do projeto (psql/Supabase CLI/SQL editor). Confirme que a tabela existe:
Run (SQL): `select count(*) from ai_usage_daily;`
Expected: retorna `0` sem erro.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/037_ai_usage_daily.sql src/types/database.ts
git commit -m "feat(db): tabela ai_usage_daily para consumo de tokens por loja/dia"
```

---

## Task 3: chat-service grava uso diário (UPSERT incremental)

**Files:**
- Modify: `chat-service/app/db.py` (novo método; classe `Database`)
- Modify: `chat-service/app/pipeline.py:77-79` (após o `log.info` de usage)
- Modify: `chat-service/tests/conftest.py` (FakeDB)
- Test: `chat-service/tests/test_daily_usage.py`

- [ ] **Step 1: Write the failing test**

```python
# chat-service/tests/test_daily_usage.py
import pytest
from app.db import Database


class FakePool:
    def __init__(self):
        self.calls = []

    async def execute(self, sql, *args):
        self.calls.append((sql, args))


@pytest.fixture
def fake_db():
    db = Database.__new__(Database)   # sem abrir pool real
    db._pool = FakePool()
    return db


async def test_record_daily_usage_executa_upsert_com_os_5_params(fake_db):
    await fake_db.record_daily_usage("store-1", 100, 40, 140, 3)
    assert len(fake_db._pool.calls) == 1
    sql, args = fake_db._pool.calls[0]
    assert "INSERT INTO ai_usage_daily" in sql
    assert "ON CONFLICT (store_id, day) DO UPDATE" in sql
    assert args == ("store-1", 100, 40, 140, 3)


async def test_record_daily_usage_usa_fuso_sao_paulo_para_o_dia(fake_db):
    await fake_db.record_daily_usage("store-1", 1, 1, 2, 1)
    sql, _ = fake_db._pool.calls[0]
    assert "America/Sao_Paulo" in sql
```

> Os testes do chat-service rodam com pytest-asyncio em modo auto (já configurado — ver `test_usage.py` que usa `async def` sem decorator). Se falhar por "async def not natively supported", confirme `asyncio_mode = auto` no pytest config.

- [ ] **Step 2: Run test to verify it fails**

Run (em `chat-service/`): `pytest tests/test_daily_usage.py -v`
Expected: FAIL — `AttributeError: 'Database' object has no attribute 'record_daily_usage'`.

- [ ] **Step 3: Implementar o método em `db.py`**

Adicione na classe `Database` (junto aos outros `execute`, ex.: após `insert_message`):

```python
    async def record_daily_usage(self, store_id, prompt, completion, total, calls):
        await self._pool.execute(
            """INSERT INTO ai_usage_daily (store_id, day, prompt_tokens,
                   completion_tokens, total_tokens, calls, updated_at)
               VALUES ($1, (now() at time zone 'America/Sao_Paulo')::date,
                   $2, $3, $4, $5, now())
               ON CONFLICT (store_id, day) DO UPDATE SET
                   prompt_tokens     = ai_usage_daily.prompt_tokens     + EXCLUDED.prompt_tokens,
                   completion_tokens = ai_usage_daily.completion_tokens + EXCLUDED.completion_tokens,
                   total_tokens      = ai_usage_daily.total_tokens      + EXCLUDED.total_tokens,
                   calls             = ai_usage_daily.calls             + EXCLUDED.calls,
                   updated_at        = now()""",
            store_id, prompt, completion, total, calls)
```

- [ ] **Step 4: Run test to verify it passes**

Run (em `chat-service/`): `pytest tests/test_daily_usage.py -v`
Expected: PASS (2 testes).

- [ ] **Step 5: Ligar no pipeline (best-effort)**

Em `chat-service/app/pipeline.py`, logo após o bloco `log.info("usage da conversa ...")` (linha ~77-79), adicione:

```python
    if usage.calls > 0:
        try:
            await db.record_daily_usage(
                store.id, usage.prompt, usage.completion,
                usage.total, usage.calls)
        except Exception:
            log.exception("falha ao gravar ai_usage_daily (ignorada)")
```

- [ ] **Step 6: Adicionar `record_daily_usage` ao FakeDB**

Em `chat-service/tests/conftest.py`, dentro de `__init__` do `FakeDB` adicione:

```python
        self.daily_usage = []
```

E adicione o método na classe `FakeDB`:

```python
    async def record_daily_usage(self, store_id, prompt, completion, total, calls):
        self.daily_usage.append(
            {"store_id": store_id, "prompt": prompt, "completion": completion,
             "total": total, "calls": calls})
```

- [ ] **Step 7: Rodar a suíte do chat-service**

Run (em `chat-service/`): `pytest -q`
Expected: PASS — incluindo os testes existentes de pipeline (que agora exercitam o caminho do upsert via FakeDB).

- [ ] **Step 8: Commit**

```bash
git add chat-service/app/db.py chat-service/app/pipeline.py chat-service/tests/conftest.py chat-service/tests/test_daily_usage.py
git commit -m "feat(chat-service): grava consumo diario de tokens por loja"
```

---

## Task 4: `getSidebarData` expõe `isAdmin`

**Files:**
- Modify: `src/lib/sidebar-data.ts`
- Modify: `src/app/painel/(default)/layout.tsx`

- [ ] **Step 1: Atualizar `SidebarData` e o cálculo em `sidebar-data.ts`**

Substitua o conteúdo de `src/lib/sidebar-data.ts` por:

```ts
import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'
import { getStoreContext } from '@/lib/active-store'
import { getAppUrl } from '@/lib/app-url'
import { isPlatformAdmin } from '@/lib/platform-admin'
import type { StoreRole } from '@/lib/store-role'

export interface SidebarData {
  role: StoreRole
  slug: string | null
  appUrl: string
  isAdmin: boolean
}

// Dados que a Sidebar precisa pra montar — papel do usuário (filtra itens
// ownerOnly do NAV), slug da loja (URL pública no widget de /loja) e isAdmin
// (mostra o item Admin só para super-admins). Roda server-side em cada layout
// autenticado. Fail-open pra 'owner' em erro; isAdmin é fail-closed (false).
export async function getSidebarData(): Promise<SidebarData> {
  const appUrl = getAppUrl()
  try {
    const user = await getAuthedUser()
    if (!user) return { role: 'owner', slug: null, appUrl, isAdmin: false }

    const supabase = await createClient()
    const [ctx, settingsRes] = await Promise.all([
      getStoreContext(),
      supabase
        .from('store_settings')
        .select('chat_slug')
        .eq('id', user.id)
        .maybeSingle(),
    ])

    const role: StoreRole = ctx?.role ?? 'owner'
    const slug = settingsRes.data?.chat_slug ?? null

    return { role, slug, appUrl, isAdmin: isPlatformAdmin(user) }
  } catch (err) {
    console.error('getSidebarData error', err)
    return { role: 'owner', slug: null, appUrl, isAdmin: false }
  }
}
```

- [ ] **Step 2: Repassar `isAdmin` no layout**

Em `src/app/painel/(default)/layout.tsx`, atualize a desestruturação e o JSX:

```tsx
import { Sidebar } from '@/components/ui/Sidebar'
import { getSidebarData } from '@/lib/sidebar-data'

export default async function PainelLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { role, slug, appUrl, isAdmin } = await getSidebarData()
  return (
    <div className="flex flex-col md:flex-row md:min-h-screen">
      <Sidebar role={role} slug={slug} appUrl={appUrl} isAdmin={isAdmin} />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  )
}
```

> Nesta etapa o `<Sidebar />` ainda não aceita `isAdmin` — o typecheck vai acusar até a Task 5. Tudo bem; as duas tasks formam a mudança completa. Se preferir build verde a cada passo, faça Task 4 e Task 5 num único commit.

- [ ] **Step 3: Commit**

```bash
git add src/lib/sidebar-data.ts src/app/painel/(default)/layout.tsx
git commit -m "feat(admin): getSidebarData expoe isAdmin"
```

---

## Task 5: Item "Admin" no Sidebar (condicional)

**Files:**
- Modify: `src/components/painel/Icons.tsx` (novo ícone `shield`)
- Modify: `src/components/ui/Sidebar.tsx`

- [ ] **Step 1: Adicionar o ícone `shield`**

Em `src/components/painel/Icons.tsx`, dentro do objeto `I`, adicione uma entrada (ex.: após `sparkle`):

```tsx
  shield: (
    <g>
      <path d="M12 3 5 6v5c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6l-7-3Z" />
    </g>
  ),
```

- [ ] **Step 2: Aceitar e usar `isAdmin` na Sidebar**

Em `src/components/ui/Sidebar.tsx`:

(a) Adicione `isAdmin` às props do componente exportado `Sidebar`:

```tsx
export function Sidebar({
  role,
  slug,
  appUrl,
  isAdmin,
}: {
  role: StoreRole
  slug: string | null
  appUrl: string
  isAdmin: boolean
}) {
```

(b) Repasse `isAdmin` para os dois usos de `<SidebarBody ... />` (desktop e mobile drawer), adicionando a prop `isAdmin={isAdmin}` em cada um.

(c) Atualize a assinatura de `SidebarBody` para receber `isAdmin`:

```tsx
function SidebarBody({
  role,
  slug,
  appUrl,
  isAdmin,
  pathname,
  onNavigate,
}: {
  role: StoreRole
  slug: string | null
  appUrl: string
  isAdmin: boolean
  pathname: string | null
  onNavigate?: () => void
}) {
```

(d) No bloco da seção CONTA (o `{isOwner && ( ... )}` que renderiza `NAV_ACCOUNT`), adicione o item Admin no fim da `<ul>`, condicionado a `isAdmin`. Substitua o `</ul>` de `NAV_ACCOUNT` por:

```tsx
              {isAdmin && (
                <li>
                  <Link
                    href="/painel/_internal"
                    onClick={onNavigate}
                    className={`nav-link ${
                      pathname?.startsWith('/painel/_internal') ? 'active' : ''
                    }`}
                  >
                    <Icon name="shield" className="w-[18px] h-[18px]" />
                    Admin
                  </Link>
                </li>
              )}
            </ul>
```

> O item Admin fica dentro do bloco `isOwner` (seção CONTA). Como super-admins são donos da própria conta, isso é coerente; se um admin tiver role `agent` em alguma loja e mesmo assim precisar do link, mover o `{isAdmin && ...}` para fora do `{isOwner && ...}`. Por ora, manter dentro de CONTA.

- [ ] **Step 3: Verificar typecheck e testes**

Run: `npx tsc --noEmit`
Expected: sem erros.
Run: `npm test`
Expected: PASS (suíte existente + platform-admin).

- [ ] **Step 4: Commit**

```bash
git add src/components/painel/Icons.tsx src/components/ui/Sidebar.tsx
git commit -m "feat(admin): item Admin no sidebar so para super-admins"
```

---

## Task 6: Helpers puros de período e agregação

**Files:**
- Create: `src/lib/admin-usage.ts`
- Test: `src/lib/__tests__/admin-usage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__tests__/admin-usage.test.ts
import { describe, it, expect } from 'vitest'
import {
  resolvePeriodStart,
  aggregateByStore,
  sumUsage,
  type UsageRow,
} from '../admin-usage'

describe('resolvePeriodStart', () => {
  // 2026-06-11 12:00Z -> em America/Sao_Paulo (UTC-3) ainda é 2026-06-11
  const now = new Date('2026-06-11T12:00:00Z')

  it('dia => a data de hoje (SP)', () => {
    expect(resolvePeriodStart('dia', now)).toBe('2026-06-11')
  })

  it('semana => 6 dias antes de hoje (janela de 7 dias)', () => {
    expect(resolvePeriodStart('semana', now)).toBe('2026-06-05')
  })

  it('mes => primeiro dia do mês corrente', () => {
    expect(resolvePeriodStart('mes', now)).toBe('2026-06-01')
  })
})

describe('aggregateByStore', () => {
  const rows: UsageRow[] = [
    { store_id: 'a', prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, calls: 1 },
    { store_id: 'a', prompt_tokens: 20, completion_tokens: 6, total_tokens: 26, calls: 2 },
    { store_id: 'b', prompt_tokens: 5, completion_tokens: 1, total_tokens: 6, calls: 1 },
  ]
  const names = new Map([['a', 'Loja A'], ['b', 'Loja B']])

  it('soma por loja e ordena por total desc', () => {
    const out = aggregateByStore(rows, names)
    expect(out).toEqual([
      { storeId: 'a', storeName: 'Loja A', prompt: 30, completion: 10, total: 40, calls: 3 },
      { storeId: 'b', storeName: 'Loja B', prompt: 5, completion: 1, total: 6, calls: 1 },
    ])
  })

  it('usa "—" quando o nome da loja é desconhecido', () => {
    const out = aggregateByStore(rows, new Map())
    expect(out[0].storeName).toBe('—')
  })
})

describe('sumUsage', () => {
  it('soma os totais de todas as lojas', () => {
    const out = sumUsage([
      { storeId: 'a', storeName: 'A', prompt: 30, completion: 10, total: 40, calls: 3 },
      { storeId: 'b', storeName: 'B', prompt: 5, completion: 1, total: 6, calls: 1 },
    ])
    expect(out).toEqual({ prompt: 35, completion: 11, total: 46, calls: 4, stores: 2 })
  })

  it('stores conta só lojas com total > 0', () => {
    const out = sumUsage([
      { storeId: 'a', storeName: 'A', prompt: 0, completion: 0, total: 0, calls: 0 },
      { storeId: 'b', storeName: 'B', prompt: 5, completion: 1, total: 6, calls: 1 },
    ])
    expect(out.stores).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- admin-usage`
Expected: FAIL — `Cannot find module '../admin-usage'`.

- [ ] **Step 3: Implementar `admin-usage.ts`**

```ts
// src/lib/admin-usage.ts
export type Periodo = 'dia' | 'semana' | 'mes'

export interface UsageRow {
  store_id: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  calls: number
}

export interface StoreUsage {
  storeId: string
  storeName: string
  prompt: number
  completion: number
  total: number
  calls: number
}

export interface UsageTotals {
  prompt: number
  completion: number
  total: number
  calls: number
  stores: number
}

const SP_TZ = 'America/Sao_Paulo'

// Data de hoje no fuso de São Paulo, formato 'YYYY-MM-DD' (en-CA => ISO).
function spToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SP_TZ }).format(now)
}

// Início do período (inclusive) como 'YYYY-MM-DD' no fuso de SP, para comparar
// com a coluna `day` (date) da tabela ai_usage_daily.
export function resolvePeriodStart(periodo: Periodo, now: Date): string {
  const today = spToday(now)
  if (periodo === 'mes') return today.slice(0, 8) + '01'
  if (periodo === 'semana') {
    const base = new Date(today + 'T00:00:00Z')
    base.setUTCDate(base.getUTCDate() - 6)
    return base.toISOString().slice(0, 10)
  }
  return today // dia
}

export function aggregateByStore(
  rows: UsageRow[],
  names: Map<string, string>,
): StoreUsage[] {
  const map = new Map<string, StoreUsage>()
  for (const r of rows) {
    const cur = map.get(r.store_id) ?? {
      storeId: r.store_id,
      storeName: names.get(r.store_id) ?? '—',
      prompt: 0,
      completion: 0,
      total: 0,
      calls: 0,
    }
    cur.prompt += r.prompt_tokens
    cur.completion += r.completion_tokens
    cur.total += r.total_tokens
    cur.calls += r.calls
    map.set(r.store_id, cur)
  }
  return [...map.values()].sort((a, b) => b.total - a.total)
}

export function sumUsage(stores: StoreUsage[]): UsageTotals {
  return stores.reduce<UsageTotals>(
    (acc, s) => ({
      prompt: acc.prompt + s.prompt,
      completion: acc.completion + s.completion,
      total: acc.total + s.total,
      calls: acc.calls + s.calls,
      stores: acc.stores + (s.total > 0 ? 1 : 0),
    }),
    { prompt: 0, completion: 0, total: 0, calls: 0, stores: 0 },
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- admin-usage`
Expected: PASS (todos os describes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin-usage.ts src/lib/__tests__/admin-usage.test.ts
git commit -m "feat(admin): helpers de periodo e agregacao de consumo"
```

---

## Task 7: Seletor de período (client component)

**Files:**
- Create: `src/app/painel/(default)/_internal/PeriodSelector.tsx`

- [ ] **Step 1: Implementar o seletor**

```tsx
// src/app/painel/(default)/_internal/PeriodSelector.tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { Periodo } from '@/lib/admin-usage'

const OPCOES: { value: Periodo; label: string }[] = [
  { value: 'dia', label: 'Dia' },
  { value: 'semana', label: 'Semana' },
  { value: 'mes', label: 'Mês' },
]

export function PeriodSelector({ active }: { active: Periodo }) {
  const pathname = usePathname()
  return (
    <div className="inline-flex items-center gap-1 rounded-xl bg-ink-100 p-1">
      {OPCOES.map((o) => {
        const is = o.value === active
        return (
          <Link
            key={o.value}
            href={`${pathname}?periodo=${o.value}`}
            scroll={false}
            className={`px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors ${
              is
                ? 'bg-white text-ink-900 shadow-[0_1px_2px_rgba(15,23,42,0.06)]'
                : 'text-ink-500 hover:text-ink-900'
            }`}
          >
            {o.label}
          </Link>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add "src/app/painel/(default)/_internal/PeriodSelector.tsx"
git commit -m "feat(admin): seletor de periodo dia/semana/mes"
```

---

## Task 8: Página `/painel/_internal` (gate + dados + UI)

**Files:**
- Create: `src/app/painel/(default)/_internal/page.tsx`

> UI construída seguindo a identidade visual existente (PageHeader, StatCard, Card, EmptyState, classes `ink/brand/slate`). Para refinos visuais use a skill `frontend-design`.

- [ ] **Step 1: Implementar a página**

```tsx
// src/app/painel/(default)/_internal/page.tsx
import { notFound } from 'next/navigation'
import { getAuthedUser } from '@/lib/auth'
import { isPlatformAdmin } from '@/lib/platform-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  resolvePeriodStart,
  aggregateByStore,
  sumUsage,
  type Periodo,
  type UsageRow,
} from '@/lib/admin-usage'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatCard } from '@/components/ui/StatCard'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Icon } from '@/components/painel/Icons'
import { PeriodSelector } from './PeriodSelector'

export const dynamic = 'force-dynamic'

const PERIODOS: Periodo[] = ['dia', 'semana', 'mes']
const LABEL: Record<Periodo, string> = { dia: 'hoje', semana: 'últimos 7 dias', mes: 'este mês' }

const fmt = (n: number) => new Intl.NumberFormat('pt-BR').format(n)

export default async function AdminInternalPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>
}) {
  // Gate server-side: não-admin recebe 404 (rota se comporta como inexistente).
  const user = await getAuthedUser()
  if (!user || !isPlatformAdmin(user)) notFound()

  const sp = await searchParams
  const periodo: Periodo = PERIODOS.includes(sp.periodo as Periodo)
    ? (sp.periodo as Periodo)
    : 'dia'
  const start = resolvePeriodStart(periodo, new Date())

  // Leitura via service-role (ignora RLS) — só acontece após o gate de admin.
  const admin = createAdminClient()
  const [usageRes, storesRes] = await Promise.all([
    admin
      .from('ai_usage_daily')
      .select('store_id, prompt_tokens, completion_tokens, total_tokens, calls')
      .gte('day', start),
    admin.from('store_settings').select('id, store_name'),
  ])

  const rows: UsageRow[] = usageRes.data ?? []
  const names = new Map(
    (storesRes.data ?? []).map((s) => [s.id, s.store_name ?? '—'] as const),
  )
  const porLoja = aggregateByStore(rows, names)
  const totais = sumUsage(porLoja)
  const erro = Boolean(usageRes.error || storesRes.error)

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 md:py-8">
      <PageHeader
        title="Admin · Plataforma"
        subtitle="Consumo de tokens da IA por loja"
        actions={<PeriodSelector active={periodo} />}
      />

      {erro ? (
        <EmptyState
          icon={<Icon name="alert" className="h-6 w-6" />}
          title="Não foi possível carregar o consumo"
          description="Tente novamente em instantes."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label={`Tokens · ${LABEL[periodo]}`}
              value={fmt(totais.total)}
              tone="brand"
              emphasis="value"
              icon={<Icon name="sparkle" className="h-4 w-4" />}
            />
            <StatCard
              label="Prompt"
              value={fmt(totais.prompt)}
              tone="info"
              hint={`Completion: ${fmt(totais.completion)}`}
              icon={<Icon name="ai" className="h-4 w-4" />}
            />
            <StatCard
              label="Chamadas"
              value={fmt(totais.calls)}
              tone="neutral"
              icon={<Icon name="send" className="h-4 w-4" />}
            />
            <StatCard
              label="Lojas ativas"
              value={fmt(totais.stores)}
              tone="success"
              icon={<Icon name="store" className="h-4 w-4" />}
            />
          </div>

          <Card className="mt-6 overflow-hidden p-0">
            <div className="border-b border-slate-200/80 px-5 py-4">
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Consumo por loja
              </h2>
            </div>
            {porLoja.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  icon={<Icon name="receipt" className="h-6 w-6" />}
                  title="Sem consumo no período"
                  description="Nenhuma loja gerou tokens no intervalo selecionado."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                      <th className="px-5 py-3">Loja</th>
                      <th className="px-5 py-3 text-right">Prompt</th>
                      <th className="px-5 py-3 text-right">Completion</th>
                      <th className="px-5 py-3 text-right">Total</th>
                      <th className="px-5 py-3 text-right">Chamadas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {porLoja.map((s) => (
                      <tr key={s.storeId} className="hover:bg-slate-50/60">
                        <td className="px-5 py-3 font-medium text-slate-900">
                          {s.storeName}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums text-slate-600">
                          {fmt(s.prompt)}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums text-slate-600">
                          {fmt(s.completion)}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums font-semibold text-slate-900">
                          {fmt(s.total)}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums text-slate-600">
                          {fmt(s.calls)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
```

> Confirme que `src/components/ui/Card.tsx` aceita `className` e `p-0` (a maioria dos Cards do projeto recebe className). Se a API for diferente, troque o `<Card>` externo por `<div className="mt-6 overflow-hidden rounded-2xl border border-slate-200/80 bg-white">`. Os nomes de ícone usados (`alert`, `sparkle`, `ai`, `send`, `store`, `receipt`) existem em `Icons.tsx`.

- [ ] **Step 2: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Validar manualmente no navegador**

Run: `npm run dev`
- Como **não-admin** (e-mail fora de `PLATFORM_ADMIN_EMAILS`), acessar `/painel/_internal` → deve renderizar **404** e o sidebar não mostra "Admin".
- Setar `PLATFORM_ADMIN_EMAILS` com o seu e-mail no `.env.local`, reiniciar o dev, logar com esse e-mail → o item **Admin** aparece no sidebar; `/painel/_internal` carrega; alternar Dia/Semana/Mês muda os números (depois que houver dados gravados pelo chat-service).

- [ ] **Step 4: Commit**

```bash
git add "src/app/painel/(default)/_internal/page.tsx"
git commit -m "feat(admin): pagina /painel/_internal com consumo de tokens (gated 404)"
```

---

## Task 9: Verificação final

- [ ] **Step 1: Suíte completa (frontend)**

Run: `npm test`
Expected: PASS (incluindo `platform-admin` e `admin-usage`).

- [ ] **Step 2: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Suíte do chat-service**

Run (em `chat-service/`): `pytest -q`
Expected: PASS.

- [ ] **Step 4: Checklist de deploy (env)**

- [ ] `PLATFORM_ADMIN_EMAILS` configurada no ambiente da app Next (Vercel/EasyPanel) com os e-mails de admin.
- [ ] Migration `037_ai_usage_daily.sql` aplicada no banco de produção.
- [ ] `chat-service` redeployado com o novo `record_daily_usage`.

---

## Self-Review (preenchido)

- **Cobertura do spec:** identidade admin (Task 1), persistência/migration/tipo (Tasks 2-3), rota gated 404 + caminho discreto (Task 8), botão no sidebar (Tasks 4-5), UI com período (Tasks 6-8), testes (Tasks 1, 3, 6), env documentada (Task 9). ✔
- **Placeholders:** nenhum — todo passo tem código/comando concretos. ✔
- **Consistência de tipos:** `Periodo`, `UsageRow`, `StoreUsage`, `UsageTotals` definidos na Task 6 e usados igual nas Tasks 7-8; `isPlatformAdmin(user)` mesma assinatura nas Tasks 1, 4, 8; `record_daily_usage(store_id, prompt, completion, total, calls)` idêntico em db.py, pipeline, FakeDB e teste. ✔
