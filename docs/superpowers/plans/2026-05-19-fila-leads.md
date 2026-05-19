# Fila de Leads (Plano 2 de 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar à equipe uma página `/leads` — a lista de todos os leads capturados pela IA, onde qualquer membro da loja vê nome/WhatsApp/interesse, copia o número e marca o lead como contatado.

**Architecture:** Migration 026 adiciona a `leads` as colunas de workflow (`interest_summary`, `contacted_at`, `contacted_by`, `contacted_by_name`). A página `/leads` (dono + vendedor) lê os leads via cliente autenticado — a RLS de membership do Plano 1 já faz o scoping por loja. `markLeadContacted` carimba o lead com o horário e o nome de quem contatou. O menu ganha o item Leads, e os redirects de não-dono passam a apontar para `/leads`.

**Tech Stack:** Next.js 16, React 19, Supabase (Postgres + RLS).

**Spec de referência:** `docs/superpowers/specs/2026-05-19-equipe-fila-leads-design.md` (este é o Plano 2; o Plano 1 — Equipe & multi-usuário — já está mergeado).

**Pré-requisito:** Plano 1 mergeado. A última migration do projeto é a `025`. A RLS de `leads` já é membership-based (`leads_select_member`/`leads_update_member`, migration 025).

---

## Refinamento sobre a spec

A spec previa `contacted_by UUID` e um `contacted_by_name` "resolvido" na hora de ler. Mas a RLS de `store_members` (`store_members_select_self`, `user_id = auth.uid()`) impede um membro de ler o nome de **outro** membro pelo cliente autenticado. Para evitar admin-client ou um RPC só para resolver nomes, o nome de quem contatou é **denormalizado** numa coluna `contacted_by_name` — `markLeadContacted` grava o nome (que o próprio chamador lê da sua própria linha de `store_members`, permitido pela RLS). `contacted_by` (o UUID) é mantido para auditoria.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/026_leads_workflow_fields.sql` (novo) | Colunas de workflow em `leads` |
| `src/types/database.ts` (modify) | Tipos: 4 colunas novas em `leads` |
| `src/actions/leads.ts` (novo) | `getLeads`, `markLeadContacted` |
| `src/components/leads/LeadsView.tsx` (novo) | Tela da fila (client) |
| `src/app/leads/layout.tsx` (novo) | Layout com Sidebar |
| `src/app/leads/page.tsx` (novo) | Server Component: auth + fetch |
| `src/components/ui/Sidebar.tsx` (modify) | Item de menu Leads |
| `src/app/painel/page.tsx`, `estoque/page.tsx`, `loja/page.tsx`, `equipe/page.tsx` (modify) | Redirect de não-dono `/conversas` → `/leads` |
| `src/components/painel/Hero.tsx` (modify) | Botão "Abrir fila de leads" vira link para `/leads` |

---

## Task 1: Migration 026 — colunas de workflow em `leads`

Esta task só **cria o arquivo SQL**. Aplicar ao Supabase é um passo de deploy manual (seção final).

**Files:**
- Create: `supabase/migrations/026_leads_workflow_fields.sql`

- [ ] **Step 1: Criar o arquivo**

Criar `supabase/migrations/026_leads_workflow_fields.sql` com este conteúdo exato:

```sql
-- 026_leads_workflow_fields.sql
-- Colunas de workflow da Fila de Leads: o resumo de interesse capturado pela
-- IA, e o marco "contatado" (quando e por quem).

ALTER TABLE leads
  ADD COLUMN interest_summary  TEXT,
  ADD COLUMN contacted_at      TIMESTAMPTZ,
  ADD COLUMN contacted_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN contacted_by_name TEXT;

-- Índice para a query da fila (lista por loja, separa novos de contatados).
CREATE INDEX idx_leads_store_contacted ON leads (store_id, contacted_at);
```

- [ ] **Step 2: Revisar o SQL**

Confira: todas as 4 colunas são nullable (leads antigos não têm); `contacted_by` é `ON DELETE SET NULL` (remover um vendedor não falha por causa de leads que ele contatou); `contacted_by_name` é o nome denormalizado para exibição. Status do lead é derivado: "Novo" = `contacted_at IS NULL`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/026_leads_workflow_fields.sql
git commit -m "feat(db): add leads workflow columns (interest, contacted)"
```

---

## Task 2: Tipos TS das colunas de `leads`

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Adicionar os campos ao tipo `leads`**

Em `src/types/database.ts`, no tipo da tabela `leads`, adicionar quatro campos às três formas — `Row`, `Insert`, `Update`:
- `interest_summary: string | null`
- `contacted_at: string | null`
- `contacted_by: string | null`
- `contacted_by_name: string | null`

Em `Row` os quatro são obrigatórios (`campo: tipo`); em `Insert` e `Update` são opcionais (`campo?: tipo`). Siga o estilo das colunas nullable que já existem no tipo `leads` (por exemplo `whatsapp`, `email`, `cep` — adicionadas da mesma forma).

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo. Há UM erro pré-existente não relacionado em `src/app/api/inventory/import/route.ts` (falta `user_id` num upsert) — aceitável, ignore só esse.

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts
git commit -m "feat(types): add leads workflow columns"
```

---

## Task 3: Server actions `getLeads` e `markLeadContacted`

**Files:**
- Create: `src/actions/leads.ts`

- [ ] **Step 1: Criar o arquivo**

Criar `src/actions/leads.ts`:

```ts
'use server'

import { createClient } from '@/lib/supabase/server'

export interface LeadRow {
  id: string
  name: string
  whatsapp: string
  interestSummary: string
  createdAt: string
  contactedAt: string | null
  contactedByName: string | null
}

// Lista os leads da loja. A RLS de membership (leads_select_member, migration
// 025) já faz o scoping — o cliente autenticado só enxerga os leads da loja
// do chamador, seja ele dono ou vendedor.
export async function getLeads(): Promise<LeadRow[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('leads')
    .select(
      'id, name, whatsapp, interest_summary, created_at, contacted_at, contacted_by_name',
    )
    .order('created_at', { ascending: false })
    .limit(200)
  if (error || !data) {
    console.error('getLeads error', error)
    return []
  }

  return data.map((l) => ({
    id: l.id,
    name: l.name ?? 'Sem nome',
    whatsapp: l.whatsapp ?? '',
    interestSummary: l.interest_summary ?? '',
    createdAt: l.created_at,
    contactedAt: l.contacted_at,
    contactedByName: l.contacted_by_name,
  }))
}

// Marca um lead como contatado: carimba o horário, o UUID e o nome de quem
// contatou. O nome vem da própria linha de store_members do chamador (a RLS
// store_members_select_self permite ler a própria linha). A RLS
// leads_update_member garante que só dá para marcar leads da própria loja.
export async function markLeadContacted(
  leadId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Não autenticado.' }

  const { data: member } = await supabase
    .from('store_members')
    .select('full_name')
    .eq('user_id', user.id)
    .maybeSingle()

  const { error } = await supabase
    .from('leads')
    .update({
      contacted_at: new Date().toISOString(),
      contacted_by: user.id,
      contacted_by_name: member?.full_name ?? null,
    })
    .eq('id', leadId)
  if (error) {
    console.error('markLeadContacted error', error)
    return { ok: false, error: 'Não foi possível marcar o lead.' }
  }
  return { ok: true }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo (apenas o erro pré-existente conhecido em `src/app/api/inventory/import/route.ts`). As colunas `interest_summary`/`contacted_at`/`contacted_by`/`contacted_by_name` são reconhecidas porque a Task 2 as adicionou ao tipo.

- [ ] **Step 3: Commit**

```bash
git add src/actions/leads.ts
git commit -m "feat(leads): add getLeads and markLeadContacted server actions"
```

---

## Task 4: Componente `LeadsView`

**Files:**
- Create: `src/components/leads/LeadsView.tsx`

- [ ] **Step 1: Criar o componente**

Criar `src/components/leads/LeadsView.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { markLeadContacted, type LeadRow } from '@/actions/leads'

function formatLeadDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function LeadsView({ leads }: { leads: LeadRow[] }) {
  const router = useRouter()
  const [tab, setTab] = useState<'novos' | 'contatados'>('novos')
  const [pending, startTransition] = useTransition()
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const novos = leads.filter((l) => !l.contactedAt)
  const contatados = leads.filter((l) => l.contactedAt)
  const shown = tab === 'novos' ? novos : contatados

  function handleContacted(id: string) {
    startTransition(async () => {
      const res = await markLeadContacted(id)
      if (res.ok) router.refresh()
    })
  }

  async function handleCopy(id: string, whatsapp: string) {
    try {
      await navigator.clipboard.writeText(whatsapp)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1400)
    } catch {
      // clipboard indisponível — ignora
    }
  }

  return (
    <div className="max-w-[1100px] mx-auto px-8 py-7">
      <div className="eyebrow text-ink-500">PIPELINE</div>
      <h1
        className="font-display font-bold text-ink-900 tracking-tight mt-1"
        style={{ fontSize: '26px' }}
      >
        Fila de leads
      </h1>

      <div className="mt-5 inline-flex rounded-xl bg-white border border-ink-200 p-0.5 text-[12px] font-semibold">
        <button
          type="button"
          onClick={() => setTab('novos')}
          className={
            tab === 'novos'
              ? 'px-3 py-1.5 rounded-lg bg-ink-900 text-white'
              : 'px-3 py-1.5 rounded-lg text-ink-600'
          }
        >
          Novos · {novos.length}
        </button>
        <button
          type="button"
          onClick={() => setTab('contatados')}
          className={
            tab === 'contatados'
              ? 'px-3 py-1.5 rounded-lg bg-ink-900 text-white'
              : 'px-3 py-1.5 rounded-lg text-ink-600'
          }
        >
          Contatados · {contatados.length}
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="card mt-5 px-6 py-10 text-center text-[13px] text-ink-500">
          {tab === 'novos'
            ? 'Nenhum lead novo.'
            : 'Nenhum lead contatado ainda.'}
        </div>
      ) : (
        <div className="card mt-5 divide-y divide-ink-100">
          {shown.map((l) => (
            <div key={l.id} className="px-5 py-4 flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-ink-900 truncate">
                  {l.name}
                </div>
                <div className="text-[12.5px] text-ink-500 truncate">
                  {l.interestSummary || 'Sem resumo de interesse'}
                </div>
                {l.contactedAt && (
                  <div className="eyebrow text-ink-400 mt-1">
                    CONTATADO
                    {l.contactedByName ? ` POR ${l.contactedByName}` : ''} ·{' '}
                    {formatLeadDate(l.contactedAt)}
                  </div>
                )}
              </div>
              <div className="text-[12.5px] font-mono text-ink-600 shrink-0">
                {l.whatsapp}
              </div>
              <div className="text-[11.5px] text-ink-400 tabular shrink-0">
                {formatLeadDate(l.createdAt)}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleCopy(l.id, l.whatsapp)}
                  className="text-[12.5px] font-semibold text-ink-700 hover:text-ink-900 px-2.5 py-1.5 rounded-lg ring-1 ring-ink-200"
                >
                  {copiedId === l.id ? 'Copiado!' : 'Copiar nº'}
                </button>
                {!l.contactedAt && (
                  <button
                    type="button"
                    onClick={() => handleContacted(l.id)}
                    disabled={pending}
                    className="text-[12.5px] font-semibold text-white bg-brand-600 hover:bg-brand-700 px-2.5 py-1.5 rounded-lg disabled:opacity-50"
                  >
                    Marcar contatado
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo (apenas o erro pré-existente conhecido em `src/app/api/inventory/import/route.ts`). `markLeadContacted` e `LeadRow` vêm de `@/actions/leads` (Task 3). As classes `card`, `eyebrow`, `text-ink-*`, `bg-brand-*`, `font-display`, `tabular` são convenções Tailwind existentes do projeto.

- [ ] **Step 3: Commit**

```bash
git add src/components/leads/LeadsView.tsx
git commit -m "feat(leads): add LeadsView queue component"
```

---

## Task 5: Rota `/leads` (layout + page)

**Files:**
- Create: `src/app/leads/layout.tsx`
- Create: `src/app/leads/page.tsx`

- [ ] **Step 1: Criar `layout.tsx`**

Criar `src/app/leads/layout.tsx` (idêntico em estrutura ao `src/app/equipe/layout.tsx`):

```tsx
import { Sidebar } from '@/components/ui/Sidebar'

export default function LeadsLayout({
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

Criar `src/app/leads/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getLeads } from '@/actions/leads'
import { LeadsView } from '@/components/leads/LeadsView'

export const dynamic = 'force-dynamic'

export default async function LeadsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const leads = await getLeads()
  return <LeadsView leads={leads} />
}
```

> `/leads` NÃO tem guarda de dono — dono e vendedor acessam. Só checa autenticação.

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo (apenas o erro pré-existente conhecido em `src/app/api/inventory/import/route.ts`).

- [ ] **Step 4: Commit**

```bash
git add "src/app/leads/layout.tsx" "src/app/leads/page.tsx"
git commit -m "feat(leads): add /leads route"
```

---

## Task 6: Item de menu Leads no Sidebar

**Files:**
- Modify: `src/components/ui/Sidebar.tsx`

- [ ] **Step 1: Adicionar o item Leads à constante `NAV`**

Em `src/components/ui/Sidebar.tsx`, a constante `NAV` hoje é:

```ts
const NAV: NavItem[] = [
  { href: '/painel', label: 'Painel', iconName: 'trend', ownerOnly: true },
  { href: '/conversas', label: 'Conversas', iconName: 'msgSq', badge: '12' },
  { href: '/estoque', label: 'Estoque', iconName: 'package', ownerOnly: true },
  { href: '/loja', label: 'Loja', iconName: 'store', ownerOnly: true },
  { href: '/equipe', label: 'Equipe', iconName: 'userX', ownerOnly: true },
]
```

Adicionar o item `Leads` logo após `Conversas` (sem `ownerOnly` — dono e vendedor veem). Para o `iconName`: abrir `src/components/painel/Icons.tsx`, ver os nomes de ícone disponíveis (o tipo `IconName`) e escolher o que melhor representa uma lista de leads/contatos — NÃO reusar `userX` (é do Equipe). Se nenhum encaixar perfeitamente, escolher o mais próximo; é uma imperfeição cosmética aceitável. A `NAV` fica:

```ts
const NAV: NavItem[] = [
  { href: '/painel', label: 'Painel', iconName: 'trend', ownerOnly: true },
  { href: '/conversas', label: 'Conversas', iconName: 'msgSq', badge: '12' },
  { href: '/leads', label: 'Leads', iconName: '<ÍCONE ESCOLHIDO>' },
  { href: '/estoque', label: 'Estoque', iconName: 'package', ownerOnly: true },
  { href: '/loja', label: 'Loja', iconName: 'store', ownerOnly: true },
  { href: '/equipe', label: 'Equipe', iconName: 'userX', ownerOnly: true },
]
```

Substitua `<ÍCONE ESCOLHIDO>` pelo nome de ícone real escolhido. O filtro de papel já existente (`NAV.filter((item) => isOwner || !item.ownerOnly)`) faz o item Leads aparecer para ambos os papéis automaticamente, já que ele não tem `ownerOnly`.

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo (apenas o erro pré-existente conhecido em `src/app/api/inventory/import/route.ts`). Se o `iconName` escolhido não for um membro válido do tipo `IconName`, o `tsc` acusa — nesse caso escolha outro nome que exista de fato em `Icons.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/Sidebar.tsx
git commit -m "feat(leads): add Leads nav item to sidebar"
```

---

## Task 7: Redirect de não-dono passa a apontar para `/leads`

No Plano 1, as páginas só-do-dono redirecionam o vendedor para `/conversas` (porque `/leads` ainda não existia). Agora que existe, o destino correto é `/leads`.

**Files:**
- Modify: `src/app/painel/page.tsx`
- Modify: `src/app/estoque/page.tsx`
- Modify: `src/app/loja/page.tsx`
- Modify: `src/app/equipe/page.tsx`

- [ ] **Step 1: Trocar o destino em cada uma das 4 páginas**

Em cada um dos quatro arquivos acima, existe exatamente uma linha:

```ts
  if ((await getStoreRole()) !== 'owner') redirect('/conversas')
```

Trocar `'/conversas'` por `'/leads'` nessa linha, nos quatro arquivos:

```ts
  if ((await getStoreRole()) !== 'owner') redirect('/leads')
```

Não alterar mais nada nesses arquivos.

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: nenhum erro novo (apenas o erro pré-existente conhecido em `src/app/api/inventory/import/route.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/app/painel/page.tsx src/app/estoque/page.tsx src/app/loja/page.tsx "src/app/equipe/page.tsx"
git commit -m "feat(leads): redirect non-owners to /leads instead of /conversas"
```

---

## Task 8: Botão "Abrir fila de leads" do Hero vira link

**Files:**
- Modify: `src/components/painel/Hero.tsx`

- [ ] **Step 1: Transformar o botão em link para `/leads`**

Em `src/components/painel/Hero.tsx`:

1. Adicionar o import do `Link` do Next no topo do arquivo (junto aos outros imports):

```tsx
import Link from 'next/link'
```

2. No JSX, existe um botão:

```tsx
            <button className="inline-flex items-center gap-2 bg-white text-brand-700 hover:bg-brand-50 transition-colors text-[13px] font-semibold px-4 py-2.5 rounded-xl">
              Abrir fila de leads <Icon name="arrow" className="w-4 h-4" />
            </button>
```

Trocar o `<button>` por um `<Link href="/leads">` mantendo as mesmas classes e o conteúdo:

```tsx
            <Link
              href="/leads"
              className="inline-flex items-center gap-2 bg-white text-brand-700 hover:bg-brand-50 transition-colors text-[13px] font-semibold px-4 py-2.5 rounded-xl"
            >
              Abrir fila de leads <Icon name="arrow" className="w-4 h-4" />
            </Link>
```

Não alterar o outro botão do Hero ("Ver relatório do dia") nem nada mais no arquivo.

- [ ] **Step 2: Build completo**

Run: `npm run build`
Expected: compila e faz typecheck. O ÚNICO erro aceitável é o pré-existente em `src/app/api/inventory/import/route.ts`. Qualquer outro erro é falha real a reportar.

- [ ] **Step 3: Commit**

```bash
git add src/components/painel/Hero.tsx
git commit -m "feat(leads): link Hero 'Abrir fila de leads' button to /leads"
```

---

## Deploy & n8n

**Migration:** aplicar `026_leads_workflow_fields.sql` ao Supabase (`supabase db push` ou SQL Editor). Até aplicar, a coluna `interest_summary` etc. não existe e `getLeads` falha em runtime. Passo manual — o agente executor NÃO aplica.

**n8n:** o workflow `chat-agent`, no passo de extração de lead, precisa passar a gravar um **resumo curto do interesse** em `leads.interest_summary` (ex.: "buquê de rosas para casamento") no mesmo upsert que já grava nome/WhatsApp. É uma alteração no workflow n8n (fora do código do app). Até ser feita, `interest_summary` fica nulo e a lista mostra "Sem resumo de interesse" — degradação graciosa.

**Verificação manual** (`npm run dev`, após aplicar a migration):
- Como dono ou vendedor, o menu mostra "Leads"; `/leads` lista os leads da loja com abas Novos/Contatados.
- "Copiar nº" copia o WhatsApp; "Marcar contatado" move o lead para a aba Contatados, mostrando quem contatou e quando.
- Logar como vendedor e abrir `/painel` direto redireciona para `/leads` (não mais `/conversas`).
- No painel, o botão "Abrir fila de leads" do Hero navega para `/leads`.

## Fora do escopo (futuro)

- Atribuição de leads a vendedores específicos.
- Ciclo de lead além de contatado (ganho/perdido, registro de venda).
- Realtime na página de Leads (hoje recarrega ao navegar).
- Desfazer "contatado".
- Wiring do stage 5 do funil do painel ("Lead contatado") a partir de `leads.contacted_at` — possível agora, mas é tarefa à parte.
