# Termos de Uso + Aceite Obrigatório — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Obrigar o dono da loja (owner) a ler e aceitar os Termos de Uso + Política de Privacidade logo após criar a conta, registrando o aceite (versão, data, IP) como prova de consentimento.

**Architecture:** Gate no middleware espelhando o billing gate já existente: owner sem aceite da versão atual é redirecionado para `/termos`. A página `/termos` é publicamente legível (modo leitura) e mostra o formulário de aceite só para o owner logado pendente. O aceite é gravado pela server action `acceptTerms()` na tabela `terms_acceptances`. A versão dos termos é uma constante; mudá-la re-dispara o gate.

**Tech Stack:** Next.js 16.2.4 (App Router) + React 19, Supabase (Postgres + Auth + RLS) via `@supabase/ssr`, TypeScript 5, Tailwind v4, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-11-termos-de-uso-aceite-obrigatorio-design.md`

**Convenções do repo (não reinventar):**
- Migrations SQL em `supabase/migrations/NNN_*.sql`, idempotentes, numeração sequencial. Última = `042` → esta usa **`043`**. São aplicadas manualmente no Supabase (não há runner automático no repo).
- `src/types/database.ts` é o tipo `Database` mantido à mão; toda tabela nova precisa entrar aqui senão o client tipado recusa a query.
- Server client: `createClient()` de `@/lib/supabase/server` (async).
- Usuário autenticado: `getAuthedUser()` de `@/lib/auth` (retorna `{ id, email, ... } | null`).
- Testes Vitest colocados em `__tests__/`. Comando: `npm test` (= `vitest run --passWithNoTests`).

---

### Task 1: Migration `043` — tabela `terms_acceptances`

**Files:**
- Create: `supabase/migrations/043_terms_acceptances.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- 043_terms_acceptances.sql
-- Registro do aceite dos Termos de Uso + Politica de Privacidade pelo dono
-- da loja. Uma linha por (usuario, versao dos termos) = prova de consentimento.
-- Idempotente: seguro re-rodar.

CREATE TABLE IF NOT EXISTS terms_acceptances (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  terms_version TEXT NOT NULL,
  accepted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip            TEXT,
  user_agent    TEXT,
  UNIQUE (user_id, terms_version)
);

ALTER TABLE terms_acceptances ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'terms_acceptances'
      AND policyname = 'terms_acceptances_select_own'
  ) THEN
    CREATE POLICY "terms_acceptances_select_own" ON terms_acceptances
      FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'terms_acceptances'
      AND policyname = 'terms_acceptances_insert_own'
  ) THEN
    CREATE POLICY "terms_acceptances_insert_own" ON terms_acceptances
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
```

- [ ] **Step 2: Aplicar no Supabase**

Rode o SQL acima no SQL Editor do projeto Supabase (mesmo fluxo manual das migrations anteriores). Não há runner automático no repo.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/043_terms_acceptances.sql
git commit -m "feat(db): tabela terms_acceptances para registro de aceite dos termos"
```

---

### Task 2: Tipar a tabela em `database.ts`

**Files:**
- Modify: `src/types/database.ts` (adicionar entrada em `public.Tables`)

- [ ] **Step 1: Adicionar o tipo da tabela**

Em `src/types/database.ts`, logo após a abertura `Tables: {` (linha ~11), insira a nova tabela como primeira entrada:

```ts
      terms_acceptances: {
        Row: {
          id: string
          user_id: string
          terms_version: string
          accepted_at: string
          ip: string | null
          user_agent: string | null
        }
        Insert: {
          id?: string
          user_id: string
          terms_version: string
          accepted_at?: string
          ip?: string | null
          user_agent?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          terms_version?: string
          accepted_at?: string
          ip?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
```

- [ ] **Step 2: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos relativos a `terms_acceptances`.

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts
git commit -m "feat(types): adiciona terms_acceptances ao Database"
```

---

### Task 3: `src/lib/terms.ts` — versão + helpers (TDD)

**Files:**
- Create: `src/lib/terms.ts`
- Test: `src/lib/__tests__/terms.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// src/lib/__tests__/terms.test.ts
import { describe, it, expect } from 'vitest'
import { shouldGateTerms } from '@/lib/terms'

describe('shouldGateTerms', () => {
  it('gateia owner que ainda nao aceitou a versao atual', () => {
    expect(shouldGateTerms({ role: 'owner', hasAcceptedCurrent: false })).toBe(true)
  })

  it('libera owner que ja aceitou', () => {
    expect(shouldGateTerms({ role: 'owner', hasAcceptedCurrent: true })).toBe(false)
  })

  it('nunca gateia agent (vendedor), aceito ou nao', () => {
    expect(shouldGateTerms({ role: 'agent', hasAcceptedCurrent: false })).toBe(false)
    expect(shouldGateTerms({ role: 'agent', hasAcceptedCurrent: true })).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npm test -- terms`
Expected: FAIL — `Cannot find module '@/lib/terms'`.

- [ ] **Step 3: Implementar `terms.ts`**

```ts
// src/lib/terms.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Versao corrente dos termos. Bump desta string re-dispara o gate de aceite
// para todos os owners (eles precisam aceitar a nova versao).
export const TERMS_VERSION = '2026-06-11'

export type StoreRole = 'owner' | 'agent'

// Decisao pura do gate: so o dono (owner) e gateado, e so enquanto nao
// aceitou a versao atual. Agents (vendedores) nunca passam pelo gate — a
// relacao contratual e do dono.
export function shouldGateTerms(params: {
  role: StoreRole
  hasAcceptedCurrent: boolean
}): boolean {
  return params.role !== 'agent' && !params.hasAcceptedCurrent
}

// Consulta se o usuario ja aceitou a versao atual. Usada no middleware e na
// pagina /termos.
export async function hasAcceptedCurrentTerms(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('terms_acceptances')
    .select('id')
    .eq('user_id', userId)
    .eq('terms_version', TERMS_VERSION)
    .maybeSingle()
  return !!data
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npm test -- terms`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/terms.ts src/lib/__tests__/terms.test.ts
git commit -m "feat(terms): versao dos termos + helpers de gate (TDD)"
```

---

### Task 4: Conteúdo do documento — `src/content/terms.tsx`

**Files:**
- Create: `src/content/terms.tsx`

> Os marcadores `[RAZÃO SOCIAL]`, `[CNPJ]`, `[CIDADE/UF]`, `[EMAIL]`, `[DPO]` são preenchidos pelo usuário com os dados reais. Texto é modelo estrutural, não aconselhamento jurídico — revisar com o jurídico antes de publicar.

- [ ] **Step 1: Criar o componente do documento**

```tsx
// src/content/terms.tsx
// Documento de Termos de Uso + Politica de Privacidade (LGPD). Acoplado a
// TERMS_VERSION em src/lib/terms.ts: ao alterar o texto de forma material,
// faca o bump da versao para re-disparar o aceite.

function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="mt-7 first:mt-0">
      <h2 className="font-display text-[16px] font-bold text-ink-900">{title}</h2>
      <div className="mt-2 space-y-2 text-[13.5px] leading-relaxed text-ink-700">
        {children}
      </div>
    </section>
  )
}

export function TermsDocument() {
  return (
    <article className="prose-none">
      <p className="text-[12.5px] text-ink-500">
        Versão de 11 de junho de 2026. Última atualização: 11/06/2026.
      </p>

      <Section id="t1" title="1. Identificação das partes">
        <p>
          Estes Termos de Uso e a Política de Privacidade regem o uso da
          plataforma LUE FZ (&quot;Plataforma&quot;), de titularidade de
          [RAZÃO SOCIAL], inscrita no CNPJ sob nº [CNPJ], com sede em
          [CIDADE/UF] (&quot;LUE&quot;, &quot;nós&quot;). &quot;Usuário&quot; ou
          &quot;Lojista&quot; é a pessoa física ou jurídica que cria uma conta e
          contrata a Plataforma. &quot;Cliente final&quot; é o consumidor que
          interage com o atendimento da loja do Usuário.
        </p>
      </Section>

      <Section id="t2" title="2. Descrição do serviço">
        <p>
          A Plataforma oferece atendimento ao cliente por meio de um agente de
          inteligência artificial em um chat público, painel de operador com
          possibilidade de intervenção humana (takeover), gestão de estoque,
          captação e gestão de leads e gestão de equipe. Os recursos disponíveis
          dependem do plano contratado.
        </p>
      </Section>

      <Section id="t3" title="3. Conta, acesso e elegibilidade">
        <p>
          O Usuário declara ter pelo menos 18 anos e capacidade civil para
          contratar. É responsável pela veracidade dos dados cadastrais, pela
          guarda de suas credenciais e por toda atividade realizada em sua conta,
          inclusive por vendedores que convidar para a equipe.
        </p>
      </Section>

      <Section id="t4" title="4. Assinatura, planos e pagamento">
        <p>
          O acesso é prestado mediante assinatura recorrente, conforme o plano
          escolhido. Os pagamentos são processados por terceiros (Stripe e
          Mercado Pago, inclusive via PIX). A assinatura é renovada
          automaticamente até cancelamento pelo Usuário. O cancelamento
          interrompe renovações futuras; condições de reembolso seguem a
          legislação aplicável. A inadimplência pode resultar na suspensão do
          acesso.
        </p>
      </Section>

      <Section id="t5" title="5. Uso da inteligência artificial">
        <p>
          As respostas do agente de IA são geradas automaticamente e podem
          conter erros, imprecisões ou informações desatualizadas. O Usuário é
          responsável por supervisionar o atendimento e pode assumir a conversa a
          qualquer momento (takeover). A IA não garante vendas nem substitui
          aconselhamento profissional, jurídico, médico ou financeiro.
        </p>
      </Section>

      <Section id="t6" title="6. Conteúdo do Usuário e estoque">
        <p>
          O Usuário é o único responsável pela veracidade e legalidade das
          informações que cadastra ou importa, incluindo produtos, preços,
          disponibilidade e condições de venda. A LUE não verifica e não se
          responsabiliza por esse conteúdo.
        </p>
      </Section>

      <Section id="t7" title="7. Proteção de dados pessoais (LGPD)">
        <p>
          No tratamento dos dados pessoais dos Clientes finais coletados pela
          Plataforma (como nome, telefone/WhatsApp, e-mail e histórico de
          conversas), o Usuário atua como <strong>Controlador</strong> e a LUE
          como <strong>Operadora</strong>, nos termos da Lei nº 13.709/2018
          (LGPD). Cabe ao Usuário definir as bases legais e obter os
          consentimentos necessários junto aos seus Clientes finais. A LUE adota
          medidas de segurança razoáveis e trata os dados conforme as instruções
          do Usuário e esta Política. Solicitações de titulares e comunicação de
          incidentes devem ser direcionadas a [DPO] / [EMAIL].
        </p>
      </Section>

      <Section id="t8" title="8. Uso aceitável">
        <p>
          É vedado usar a Plataforma para fins ilícitos, comercializar produtos
          proibidos por lei, enviar spam, violar direitos de terceiros, realizar
          engenharia reversa, sobrecarregar ou tentar burlar mecanismos de
          segurança e cobrança.
        </p>
      </Section>

      <Section id="t9" title="9. Propriedade intelectual">
        <p>
          A Plataforma, seu código, marca e demais elementos são de titularidade
          da LUE. O Usuário mantém a titularidade de seus dados, marca e
          conteúdo, concedendo à LUE licença limitada para operá-los na prestação
          do serviço.
        </p>
      </Section>

      <Section id="t10" title="10. Disponibilidade e terceiros">
        <p>
          A LUE empenha-se em manter a Plataforma disponível, mas não garante
          funcionamento ininterrupto ou livre de erros. O serviço depende de
          fornecedores terceiros (como provedores de hospedagem, banco de dados e
          de modelos de IA), cujas indisponibilidades podem afetar a operação.
        </p>
      </Section>

      <Section id="t11" title="11. Limitação de responsabilidade">
        <p>
          Na máxima extensão permitida pela lei, a LUE não responde por danos
          indiretos, lucros cessantes ou perda de dados decorrentes do uso ou da
          impossibilidade de uso da Plataforma. A responsabilidade total da LUE
          fica limitada aos valores pagos pelo Usuário nos 12 meses anteriores ao
          evento que originou a reclamação.
        </p>
      </Section>

      <Section id="t12" title="12. Suspensão e encerramento">
        <p>
          A LUE pode suspender ou encerrar contas que violem estes Termos. O
          Usuário pode encerrar a conta a qualquer momento. Após o encerramento,
          os dados podem ser excluídos conforme os prazos legais e de retenção
          aplicáveis.
        </p>
      </Section>

      <Section id="t13" title="13. Alterações destes Termos">
        <p>
          Estes Termos podem ser atualizados. Alterações materiais serão
          comunicadas e, quando aplicável, exigirão novo aceite para continuar
          usando a Plataforma.
        </p>
      </Section>

      <Section id="t14" title="14. Lei aplicável e foro">
        <p>
          Estes Termos são regidos pelas leis brasileiras. Fica eleito o foro da
          comarca de [CIDADE/UF] para dirimir quaisquer controvérsias, com
          renúncia a qualquer outro, por mais privilegiado que seja.
        </p>
      </Section>

      <Section id="t15" title="15. Registro do aceite">
        <p>
          Ao marcar a caixa de concordância e prosseguir, o Usuário declara que
          leu e concorda com estes Termos. O aceite é registrado com a versão do
          documento, data, hora e endereço IP, servindo como prova do
          consentimento.
        </p>
      </Section>
    </article>
  )
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/content/terms.tsx
git commit -m "feat(terms): documento de Termos de Uso + Politica de Privacidade"
```

---

### Task 5: Server action `acceptTerms()`

**Files:**
- Create: `src/actions/terms.ts`

- [ ] **Step 1: Implementar a action**

```ts
// src/actions/terms.ts
'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'
import { TERMS_VERSION } from '@/lib/terms'

// Grava o aceite da versao atual dos termos para o usuario logado e leva ao
// painel. IP e user agent vem dos headers da request (prova de consentimento).
export async function acceptTerms() {
  const user = await getAuthedUser()
  if (!user) redirect('/login')

  const h = await headers()
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null
  const userAgent = h.get('user-agent') ?? null

  const supabase = await createClient()
  await supabase.from('terms_acceptances').upsert(
    {
      user_id: user.id,
      terms_version: TERMS_VERSION,
      ip,
      user_agent: userAgent,
    },
    { onConflict: 'user_id,terms_version', ignoreDuplicates: true },
  )

  redirect('/painel')
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/actions/terms.ts
git commit -m "feat(terms): server action acceptTerms grava aceite com IP"
```

---

### Task 6: Componente client de aceite + página `/termos`

**Files:**
- Create: `src/components/termos/TermosAceite.tsx`
- Create: `src/app/termos/page.tsx`

- [ ] **Step 1: Criar o componente client de aceite**

```tsx
// src/components/termos/TermosAceite.tsx
'use client'

import { useState } from 'react'
import { acceptTerms } from '@/actions/terms'

// Envolve o documento (passado como children) com checkbox obrigatorio e
// botao de aceite. O botao so habilita quando a caixa esta marcada.
export function TermosAceite({ children }: { children: React.ReactNode }) {
  const [agreed, setAgreed] = useState(false)

  return (
    <div className="mx-auto max-w-[760px] px-4 py-8 sm:px-6">
      <header className="mb-6">
        <div className="eyebrow text-ink-500">OBRIGATÓRIO · ANTES DE COMEÇAR</div>
        <h1 className="mt-1.5 font-display text-[24px] font-bold tracking-tight text-ink-900">
          Termos de Uso e Política de Privacidade
        </h1>
        <p className="mt-1.5 text-[13.5px] text-ink-500">
          Leia e confirme para acessar seu painel.
        </p>
      </header>

      <div className="max-h-[55vh] overflow-y-auto rounded-2xl border border-ink-200 bg-white p-5 sm:p-7">
        {children}
      </div>

      <form action={acceptTerms} className="mt-5">
        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-ink-50 p-4">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-brand-600"
          />
          <span className="text-[13.5px] text-ink-800">
            Li e concordo com os Termos de Uso e a Política de Privacidade.
          </span>
        </label>

        <button
          type="submit"
          disabled={!agreed}
          className="mt-4 w-full rounded-xl bg-brand-600 px-4 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Aceitar e continuar
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Criar a página `/termos`**

```tsx
// src/app/termos/page.tsx
import { getAuthedUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { hasAcceptedCurrentTerms } from '@/lib/terms'
import { TermsDocument } from '@/content/terms'
import { TermosAceite } from '@/components/termos/TermosAceite'

export const dynamic = 'force-dynamic'

export default async function TermosPage() {
  const user = await getAuthedUser()

  // Owner logado que ainda nao aceitou a versao atual ve o formulario de aceite.
  if (user) {
    const supabase = await createClient()
    const accepted = await hasAcceptedCurrentTerms(supabase, user.id)
    if (!accepted) {
      return (
        <TermosAceite>
          <TermsDocument />
        </TermosAceite>
      )
    }
  }

  // Visitante deslogado ou usuario que ja aceitou: documento em modo leitura.
  return (
    <main className="mx-auto max-w-[760px] px-4 py-8 sm:px-6">
      <h1 className="mb-6 font-display text-[24px] font-bold tracking-tight text-ink-900">
        Termos de Uso e Política de Privacidade
      </h1>
      <div className="rounded-2xl border border-ink-200 bg-white p-5 sm:p-7">
        <TermsDocument />
      </div>
    </main>
  )
}
```

- [ ] **Step 3: Verificar build da rota**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/components/termos/TermosAceite.tsx src/app/termos/page.tsx
git commit -m "feat(termos): pagina /termos com aceite obrigatorio e modo leitura"
```

---

### Task 7: Gate no middleware

**Files:**
- Modify: `src/middleware.ts`

- [ ] **Step 1: Importar o helper e a versão**

No topo de `src/middleware.ts`, junto aos imports existentes, adicione:

```ts
import { hasAcceptedCurrentTerms } from '@/lib/terms'
```

- [ ] **Step 2: Declarar a lista de rotas gateadas por termos**

Logo após a constante `BILLING_GATED` (linha ~24), adicione:

```ts
// Rotas que exigem aceite dos Termos para o owner. /termos fica de fora
// (precisa abrir para aceitar) e nao entra aqui para nao criar loop.
const TERMS_GATED = [
  '/painel',
  '/estoque',
  '/loja',
  '/conversas',
  '/equipe',
  '/leads',
  '/planos',
] as const
```

- [ ] **Step 3: Inserir o gate após resolver membership**

Em `src/middleware.ts`, logo após o bloco que resolve `membership` (a atribuição `membership = data ?? null` dentro do `if (user)`, ~linha 99) e **antes** do bloco de billing (`if (user && needsBilling ...)`), insira:

```ts
  // Gate de Termos de Uso: owner sem aceite da versao atual vai para /termos.
  // Agents nunca sao gateados (a relacao contratual e do dono).
  const needsTerms = TERMS_GATED.some((p) => pathname.startsWith(p))
  if (user && needsTerms && membership?.role !== 'agent') {
    const accepted = await hasAcceptedCurrentTerms(supabase, user.id)
    if (!accepted) {
      const url = request.nextUrl.clone()
      url.pathname = '/termos'
      return NextResponse.redirect(url)
    }
  }
```

- [ ] **Step 4: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Verificação manual no dev server**

Run: `npm run dev`
Com uma conta **owner sem aceite**, acesse `http://localhost:3000/painel`.
Expected: redireciona para `/termos`. Marque o checkbox → "Aceitar e continuar" → cai em `/painel`. Recarregue `/painel`: permanece (não redireciona mais). Com uma conta **agent**, acesse `/conversas`: não é redirecionado para `/termos`.

- [ ] **Step 6: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(middleware): gate de aceite de termos para o owner"
```

---

### Task 8: Links para reler os termos (login + sidebar)

**Files:**
- Modify: `src/app/login/page.tsx` (rodapé)
- Modify: `src/components/ui/Sidebar.tsx` (rodapé do `SidebarBody`)

- [ ] **Step 1: Link no rodapé do login**

Em `src/app/login/page.tsx`, substitua o parágrafo do rodapé (`© 2026 LUE · Acesso seguro`) por:

```tsx
        <p className="mt-6 text-center text-[11px] text-slate-400">
          © 2026 LUE · Acesso seguro ·{' '}
          <a href="/termos" className="underline hover:text-slate-600">
            Termos e Privacidade
          </a>
        </p>
```

- [ ] **Step 2: Link no rodapé da sidebar**

Em `src/components/ui/Sidebar.tsx`, dentro do bloco `{/* Footer */}` do `SidebarBody`, logo após o `</div>` que fecha a linha do usuário (perfil + botão sair) e antes do fechamento do `<div className="p-3 border-t ...">`, adicione:

```tsx
          <a
            href="/termos"
            className="mt-1 block px-2 text-[11px] text-ink-400 hover:text-ink-600"
          >
            Termos de Uso e Privacidade
          </a>
```

- [ ] **Step 3: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/app/login/page.tsx src/components/ui/Sidebar.tsx
git commit -m "feat(termos): links para reler os termos no login e na sidebar"
```

---

### Task 9: Verificação final

**Files:** nenhum (validação)

- [ ] **Step 1: Rodar a suíte de testes**

Run: `npm test`
Expected: PASS (inclui `terms.test.ts` com 3 testes; nenhuma regressão).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: sem erros novos.

- [ ] **Step 3: Build de produção**

Run: `npm run build`
Expected: build conclui sem erros; rota `/termos` aparece na saída.

- [ ] **Step 4: Commit (se houver ajustes)**

```bash
git add -A
git commit -m "chore(termos): ajustes finais pos-verificacao"
```

---

## Notas de implementação

- **Dados jurídicos pendentes:** os marcadores `[RAZÃO SOCIAL]`, `[CNPJ]`, `[CIDADE/UF]`, `[EMAIL]`, `[DPO]` em `src/content/terms.tsx` devem ser preenchidos com os dados reais fornecidos pelo usuário antes de publicar.
- **Bump de versão futuro:** ao alterar materialmente o texto dos termos, atualize `TERMS_VERSION` em `src/lib/terms.ts` — isso força todos os owners a aceitarem de novo.
- **`/termos` é pública para leitura** (não está em `AUTH_PROTECTED`): visitante deslogado vê o documento em modo leitura; o formulário de aceite só aparece para owner logado pendente. Isso permite o link no rodapé do login.
- **Migration aplicada manualmente:** a Task 1 só cria o arquivo SQL; aplicar no Supabase é passo manual (Step 2), como nas migrations anteriores.
