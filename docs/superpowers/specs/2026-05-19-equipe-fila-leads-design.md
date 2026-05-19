# Equipe & Fila de Leads — design

**Data:** 2026-05-19
**Branch base:** `feat/painel-redesign-real-model`

## Objetivo

Permitir que o dono da loja monte uma equipe de vendedores com login próprio, e dar a essa equipe uma **Fila de Leads** — uma lista de todos os leads que a IA capturou, com nome, WhatsApp e um resumo do interesse, onde qualquer vendedor pega o número, fala com o lead por fora (WhatsApp) e marca o lead como contatado.

Hoje a IA atende as conversas ponta a ponta; o trabalho do vendedor é dar follow-up nos leads capturados. Este é o primeiro recurso multi-usuário do app — até agora só o dono tinha acesso.

## Decisões de produto

Resolvidas com o usuário em 2026-05-19:

- **Acesso do vendedor:** o dono cria a conta do vendedor direto (email + senha provisória) numa tela de Equipe. Sem fluxo de convite por email; sem self-signup de vendedor.
- **Escopo do vendedor no app:** o vendedor vê apenas **Conversas** (chats da IA, read-only) e **Leads** (a fila). Não vê Painel, Estoque, Loja nem Equipe.
- **Sem atribuição.** Os leads não são distribuídos a vendedores específicos. Todos os vendedores veem todos os leads da loja num só lugar; qualquer um pega e contata.
- **Ciclo do lead:** apenas **Novo → Contatado**. Não há "ganho/perdido" nem registro de venda. "Contatado" é o único marco.
- **Interesse:** um resumo curto capturado pela IA (n8n), gravado junto com o lead, exibido direto na lista.
- **RLS:** modelo de membership uniforme (`store_members`), com o dono seedado como membro `owner`.

## Modelo de dados

Migrations seguem a numeração do projeto (última criada: `023`).

### Migration 024 — `store_members`

```sql
-- 024_store_members.sql
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

-- Seed: cada loja existente vira sua própria dona (store_id = user.id em todo o
-- projeto). full_name aproveita o store_name até o dono editar (fora de escopo).
INSERT INTO store_members (store_id, user_id, role, full_name)
SELECT id, id, 'owner', store_name FROM store_settings;

ALTER TABLE store_members ENABLE ROW LEVEL SECURITY;

-- Cada usuário enxerga só a(s) própria(s) membership(s). É o que as subqueries
-- de RLS das outras tabelas precisam, e não referencia store_members de volta
-- (sem recursão). Escrita acontece só via service role (admin client).
CREATE POLICY "store_members_select_self" ON store_members
  FOR SELECT USING (user_id = auth.uid());
```

Sem policies de escrita: `INSERT`/`UPDATE`/`DELETE` só pelo service role (as server actions de Equipe usam o admin client). O seed roda como superuser na migration, então RLS não o bloqueia.

### Migration 025 — colunas de workflow em `leads`

```sql
-- 025_leads_workflow_fields.sql
ALTER TABLE leads
  ADD COLUMN interest_summary TEXT,
  ADD COLUMN contacted_at     TIMESTAMPTZ,
  ADD COLUMN contacted_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX idx_leads_store_contacted
  ON leads (store_id, contacted_at);
```

`contacted_by` é `ON DELETE SET NULL` para que remover um vendedor não falhe por causa de leads que ele contatou. Status do lead é derivado: "Novo" = `contacted_at IS NULL`, "Contatado" = preenchido.

### Migration 026 — reescrita de RLS para membership

Substitui as policies hoje baseadas em `auth.uid() = store_id` por membership. O predicado de membership reutilizado:

```sql
store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid())
```

A subquery aciona a RLS de `store_members` (`store_members_select_self`), que é `user_id = auth.uid()` — self-contida, sem recursão.

```sql
-- 026_membership_rls.sql

-- leads: troca a policy permissiva por membership.
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

As policies `conversations_read_anon`, `conversations_insert`, `messages_read_anon` e `messages_insert` **permanecem** — o chat público (anon) continua intacto. n8n grava `leads`/`messages` com o service role, que ignora RLS.

### Tipos TS

Atualizar `src/types/database.ts`:
- Nova tabela `store_members` (Row/Insert/Update).
- `leads`: adicionar `interest_summary`, `contacted_at`, `contacted_by` (todos `… | null`).

## Equipe — página só do dono

Rota nova **`/equipe`** (Server Component; redireciona não-dono para `/leads`).

Arquivo novo `src/actions/equipe.ts` — todas as actions usam o **admin client** (`src/lib/supabase/admin.ts`, service role), porque criar usuários do Auth exige privilégio admin e listar membros da loja precisa contornar a RLS `store_members_select_self`. Antes de qualquer operação, a action confirma que o chamador é `owner` (consulta `store_members` do `auth.uid()`).

- `listStoreMembers(): Promise<MemberRow[]>` — membros da loja do dono (nome, email, role). Email vem de `auth.users` via admin.
- `createVendor({ fullName, email, password }): Promise<{ ok: boolean; error?: string }>` —
  1. `admin.auth.admin.createUser({ email, password, email_confirm: true })`;
  2. `INSERT store_members (store_id = ownerId, user_id = novo.id, role = 'agent', full_name)`.
  Em erro (email duplicado etc.), devolve mensagem amigável.
- `removeVendor(memberId): Promise<{ ok: boolean }>` — apaga a linha `store_members` e o `auth.users` correspondente. Bloqueia remover a si mesmo / o `owner`.

UI: `src/app/equipe/page.tsx` (server: auth + role-check + `listStoreMembers`) renderiza `EquipeView` (client) — lista de membros com botão remover, e um form "Adicionar vendedor" (nome, email, senha provisória). O dono comunica a senha ao vendedor por fora; sem fluxo de reset no MVP.

## Fila de Leads

Rota nova **`/leads`** (Server Component; dono e vendedor têm acesso).

Arquivo novo `src/actions/leads.ts`:
- `getLeads(): Promise<LeadRow[]>` — leads da loja via client autenticado (RLS de membership faz o scoping), ordenados por `created_at` desc, limit 200. `LeadRow`: `id`, `name`, `whatsapp`, `interest_summary`, `created_at`, `contacted_at`, `contacted_by_name` (resolvido de `store_members`).
- `markLeadContacted(leadId): Promise<{ ok: boolean }>` — `UPDATE leads SET contacted_at = now(), contacted_by = auth.uid() WHERE id = $1`. A RLS de membership garante que só dá para marcar leads da própria loja.

UI: `src/app/leads/page.tsx` (server: auth + `getLeads`) renderiza `LeadsView` (client):
- Tabela com nome, WhatsApp, interesse (resumo), data, status.
- Abas **Novos / Contatados** (filtro client-side por `contacted_at`), no espírito das abas Ativas/Encerradas de `/conversas`.
- Por linha: botão **copiar número** (`navigator.clipboard`) e, para leads novos, botão **marcar contatado**. Leads contatados mostram quem contatou e quando.
- Empty states para cada aba.
- Sem realtime no MVP — a página é buscada ao navegar. Realtime fica como melhoria futura.

É o destino do botão "Abrir fila de leads" do Hero do painel — esse botão passa a apontar para `/leads`.

## Menu e roteamento por papel

O papel do usuário é resolvido **server-side** no layout autenticado (consulta `store_members` do `auth.uid()`) e passado ao `Sidebar`.

- **Dono:** Painel, Conversas, Leads, Estoque, Loja, Equipe.
- **Vendedor (`agent`):** Conversas, Leads.

`Sidebar` recebe `role` por prop e filtra o array `NAV`. Os widgets mockados do Sidebar (`OPERADORES`, `ProximaNaFila`) ficam como estão — fora de escopo.

Proteção de rota: cada página só-do-dono (`/painel`, `/estoque`, `/loja`, `/equipe`) checa `role === 'owner'` no seu Server Component e redireciona vendedor para `/leads`. Após login, o destino depende do papel: dono → `/painel`, vendedor → `/leads`.

**Signup do dono:** o fluxo de cadastro de um novo dono (que hoje cria a linha `store_settings`) passa a criar **também** a linha `store_members` `owner`. Sem isso, donos criados após esta feature ficariam sem membership e a RLS os trancaria para fora dos próprios dados.

## Mudança no n8n

O workflow `chat-agent`, no passo de extração de lead, passa a gravar um **resumo curto do interesse** em `leads.interest_summary` (ex.: "buquê de rosas para casamento") no mesmo upsert que já grava nome/WhatsApp. É a única dependência externa: até o workflow ser atualizado, `interest_summary` fica nulo e a lista mostra o lead sem o resumo (degradação graciosa).

## Fora do escopo (futuro)

- Atribuição de leads a vendedores específicos; "pegar/travar" um lead.
- Ciclo de lead além de contatado (ganho/perdido, registro de venda).
- Realtime na página de Leads.
- Edição de membro (renomear, trocar papel), reset de senha, desativar sem apagar.
- Convite por email / self-signup de vendedor.
- Um usuário em múltiplas lojas (o schema permite, o MVP assume uma).
- Wiring do "vendedores X/Y ON" do painel (agora possível com `store_members`, mas é tarefa à parte).

## Riscos / pegadinhas

- **RLS é mudança sensível de segurança.** Testar: um vendedor vê os leads/conversas da própria loja e **não** os de outra loja; o dono continua vendo tudo. A subquery de membership não recursa porque `store_members_select_self` é `user_id = auth.uid()`.
- **`leads` sai de RLS aberta** (`auth.role() = 'authenticated'`, qualquer logado via tudo) **para membership** — é um aperto de segurança e uma mudança de comportamento. Confirmar que o n8n (service role) continua inserindo leads sem problema.
- **Signup do dono precisa criar a `store_members` row** — senão novos donos ficam trancados para fora. É um ponto fácil de esquecer.
- **Remover vendedor apaga o `auth.users`** — `leads.contacted_by` é `ON DELETE SET NULL`, então não quebra; confirmar que nenhuma outra FK para `auth.users` referencia o vendedor sem `ON DELETE` definido.
- **Senha provisória** — o dono define e comunica por fora; o vendedor segue com ela (sem reset no MVP). Aceitável para a equipe pequena do alvo.
- **Numeração de migrations:** confirmar que `024` é o próximo livre antes de criar.
