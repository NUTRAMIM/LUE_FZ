# Plano de Performance — LUE FZ

**Data**: 2026-05-20
**Branch analisada**: `feat/painel-redesign-real-model`
**Tipo de análise**: estática (sem execução). Itens dependentes de medição em produção estão marcados `[PRECISA MEDIR]`.

---

## 1. Resumo do stack

- **Framework**: Next.js 16.2.4 + React 19.2.4 (App Router, Server Components, Server Actions). `next.config.ts` vazio — sem tuning de imagens, cache headers ou experimentais.
- **DB / Auth / Realtime / Storage**: Supabase via `@supabase/ssr@0.10.2` e `@supabase/supabase-js@2.104.1`. 28 migrations SQL versionadas.
- **Borda**: `middleware.ts` em runtime **nodejs** (não edge), aciona `supabase.auth.getUser()` por request em rotas não-asset.
- **Cache**: nenhum (sem Redis, sem `unstable_cache`, sem `revalidate`, sem CDN tuning). Todas as 7 rotas autenticadas declaram `export const dynamic = 'force-dynamic'`.
- **Realtime**: dashboard `/painel` mantém 3 channels Supabase Realtime simultâneos.

---

## 2. Mapeamento de índices vs queries

### 2.1 Índices existentes (extraídos de `supabase/migrations/*.sql`)

| Tabela | Índice | Origem |
|---|---|---|
| `products` | gin(to_tsvector('portuguese', name)), category, sku, is_available (parcial), user_id | 001, 006 |
| `products` | UNIQUE(user_id, sku) | 007 |
| `conversations` | status, updated_at DESC, visitor_id | 002 |
| `conversations` | (store_id, visitor_id) | 012 |
| `conversations` | (store_id, closed_at DESC) WHERE closed_at IS NOT NULL | 022 |
| `messages` | (conversation_id, created_at) | 002 |
| `messages` | (store_id, created_at DESC) | 019 |
| `leads` | whatsapp WHERE NOT NULL | 003 |
| `leads` | conversation_id, store_id | 013 |
| `leads` | (store_id, contacted_at) | 026 |
| `leads` | UNIQUE(conversation_id) | 014 |
| `store_settings` | chat_slug + UNIQUE(chat_slug) | 012 |
| `store_members` | user_id, UNIQUE(store_id, user_id) | 024 |
| `knowledge_gaps` | (store_id, created_at DESC), store_id WHERE resolved_at IS NULL | 027 |
| `product_mentions` | (store_id, product_id), (store_id, created_at DESC) | 028 |
| `documents` | ivfflat(embedding), metadata->>'user_id', UNIQUE(metadata->>'product_id') | 015 |

### 2.2 RPCs identificadas

| RPC | Migration | Uso |
|---|---|---|
| `list_conversations_for_store(p_store_id, p_status)` | 021 | `actions/conversas.ts:39` |
| `get_ai_latency_p95(p_store_id)` | 023 | `actions/painel.ts:80` |
| `match_documents(query, count, filter, threshold)` | 015, 016 | n8n (RAG) — fora do escopo |

### 2.3 Índices ausentes vs queries reais

| # | Query (arquivo:linha) | Predicados | Índice ausente |
|---|---|---|---|
| I1 | `actions/painel.ts:55-57` count `ai_active` + `assigned_to IS NULL` | `store_id, status, assigned_to, lead_id` | composto `(store_id, status) WHERE assigned_to IS NULL AND lead_id IS NOT NULL` |
| I2 | `actions/painel.ts:69-72` "active AI sessions" | `store_id, status, last_message_at >=` | `(store_id, status, last_message_at)` |
| I3 | `actions/painel.ts:75-77` "sessions today" | `store_id, created_at >=` | `(store_id, created_at)` |
| I4 | `actions/painel.ts:184-187` `vendorAccepted` | `store_id, status='human_active', updated_at >=` | `(store_id, status, updated_at)` (parcial onde status='human_active') |
| I5 | `actions/leads.ts:25-31` `getLeads` | `ORDER BY created_at DESC` por loja (RLS filtra `store_id`) | `(store_id, created_at DESC)` |
| I6 | `actions/painel.ts:175-180` leads do funnel | `store_id, whatsapp NOT NULL, created_at >=` | parcial `(store_id, created_at) WHERE whatsapp IS NOT NULL` |
| I7 | `RPC list_conversations_for_store` CTE `last_msg` (021:26-32) | `DISTINCT ON (conversation_id) ORDER BY conversation_id, created_at DESC WHERE store_id` | `(store_id, conversation_id, created_at DESC)` em `messages` |
| I8 | `RPC list_conversations_for_store` ORDER BY (021:57) | `c.store_id = X AND c.status = Y ORDER BY last_message_at DESC` | `(store_id, status, last_message_at DESC)` em `conversations` |

`idx_conversations_status` (sem prefixo `store_id`) é pouco seletivo num cenário multi-tenant — Postgres tende a preferir `idx_conversations_store_visitor` mesmo quando ele não cobre a coluna ordenada, causando sort em memória. **`[PRECISA MEDIR]`** com `EXPLAIN ANALYZE` em produção.

### 2.4 RLS — custo invisível

Migration 025 troca `auth.uid() = store_id` por subquery de membership:

```sql
USING (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid()))
```

Afeta `leads`, `conversations`, `messages`. A subquery vira `InitPlan` (executa 1× por query, usa `idx_store_members_user`). Custo extra **por query**: ~uma lookup numa tabela pequena. Não é gargalo isolado, mas multiplica nos painéis que disparam 7+ queries em paralelo (`/painel`). `knowledge_gaps` e `product_mentions` ainda usam `auth.uid() = store_id` (mais rápido, porém inconsistente — só o dono vê esses dados, agente vendedor não enxerga).

---

## 3. Achados ordenados por impacto

### A1 — `getUser()` em cascata por navegação (Auth / Alto / P)

- **Localização**:
  - `middleware.ts:50`
  - `app/painel/page.tsx:22`
  - `actions/painel.ts:30, 128, 238, 303, 357` (5 server actions)
  - inline em `app/painel/page.tsx:39` (consulta `store_settings` no client da página)
  - `lib/store-role.ts:13` (chamado em `/estoque:14`, `/loja:13`, `/equipe:13`)
- **O que faz**: cada `createClient()` server-side faz `cookies()` + `getUser()` valida o JWT junto ao Supabase Auth (round-trip rede). Em `/painel`, são **~7 chamadas a `getUser()` por carregamento**: middleware + page + 5 actions (`getPainelPulse`, `getFunnel`, `getActivityFeed`, `getKnowledgeGaps`, `getProductIntent`).
- **Por que impacta**: `supabase.auth.getUser()` não é local — força revalidação contra o endpoint `/auth/v1/user`. Mesmo com latência baixa (~30-80ms), serializado/encadeado em algumas das actions, a soma vira centenas de ms só de auth.
- **Evidência**: grep `getUser()` retornou 18 arquivos; em `actions/painel.ts` aparece 5×.
- **Impacto estimado**: **Alto**. Em `/painel`, é o piso de TTFB. `[PRECISA MEDIR]` quanto cada chamada custa em produção, mas estaticamente é o caso pior do diagnóstico.
- **Esforço**: **P** (passar `userId` resolvido pelo middleware via header/cache de request).

### A2 — N+1 com `signedReadUrl` em mensagens (N+1 / Alto / P)

- **Localização**: `actions/conversas.ts:92-101` (`getMessages`); `actions/chat.ts:103-112` (`ensureConversation`).
- **O que faz**: para cada mensagem retornada (até 500 em `getMessages`, até 200 em `ensureConversation`), chama `signedReadUrl(m.media_path)` que cria um cliente admin e chama `storage.createSignedUrl`. Usa `Promise.all`, então em paralelo, mas ainda **N round-trips ao Storage API**.

  ```ts
  // actions/conversas.ts:92
  return await Promise.all(
    data.map(async (m) => ({
      ...
      media_url: await signedReadUrl(m.media_path),
    })),
  )
  ```
  Note que **mesmo quando `m.media_path` é null** (mensagens de texto, maioria) a função entra, faz o early-return — mas ainda assim invoca `createAdminClient()` por item desnecessariamente em `chat-media.ts:5-18`. Releitura: `if (!path) return null` é o **primeiro statement** após criar nenhum cliente — beleza, retorna cedo sem criar cliente. Então o custo real é só pelas msgs com mídia.
- **Por que impacta**: conversas com muitas mensagens (chat ativo) com imagens/áudios geram N requests ao Storage. Cada uma é HTTP. Em `/conversas` o impacto é por clique de conversa; em `/chat/[slug]` é por carregamento.
- **Evidência**: trecho citado; pattern repetido em duas actions.
- **Impacto estimado**: **Alto** em conversas com mídia (imagens são esperadas no chat). Baixo em conversas só de texto.
- **Esforço**: **P** (substituir signed URLs por URLs públicas com bucket privado + RLS, ou batch helper). Bucket `chat-media` precisa ser revisitado — o atual gera URL fresca a cada listagem (TTL 24h em `chat-media.ts:3`).

### A3 — `force-dynamic` em todas as rotas autenticadas (Cache / Alto / M)

- **Localização**: `app/painel/page.tsx:17`, `app/conversas/page.tsx:6`, `app/estoque/page.tsx:8`, `app/leads/page.tsx:6`, `app/equipe/page.tsx:7`, `app/chat/[slug]/page.tsx:4` (e `/api/inventory/export`).
- **O que faz**: força SSR a cada request, ignora todo o data cache do Next. Combinado com a ausência de `unstable_cache` em qualquer action e `next.config.ts` vazio, não há *nenhuma* camada de cache entre o usuário e o Postgres.
- **Por que impacta**: cada navegação refaz tudo. Não há ISR, sem `revalidate`, sem `staleTimes` configurado. Mesmo dados quase-estáticos (`store_settings`, `default_stock_min`, lista de produtos) são re-buscados.
- **Evidência**: grep `force-dynamic` retornou 7 arquivos; nenhum uso de `unstable_cache`.
- **Impacto estimado**: **Alto** no carregamento subsequente (sem cache para reaproveitar). Médio na primeira visita (vai ao DB de qualquer jeito).
- **Esforço**: **M** — requer entender por que `force-dynamic` foi colocado (provavelmente porque `cookies()` em RSC força dynamic implicitamente; declarar pode ser redundante). Trocar por estratégia de cache por usuário: `unstable_cache` com tags ou `revalidateTag` em mutações.

### A4 — `getFunnel` Stage 3 puxa todas mensagens do período (N+1 disfarçado / Alto / M)

- **Localização**: `actions/painel.ts:153-173`.
- **O que faz**: para contar "conversas com ≥3 mensagens", busca **todas** as mensagens das conversas do período (`messages.in('conversation_id', convRows.map(...))`), traz pro Node, conta em `Map`.

  ```ts
  // actions/painel.ts:155-172
  const { data: msgs, error } = await supabase
    .from('messages')
    .select('conversation_id')
    .eq('store_id', store)
    .in('conversation_id', convRows.map((c) => c.id))
  // ... loop em JS pra contar
  ```
  Comentário no próprio código: `"MVP: busca as mensagens e agrega em memória. Onda B troca por RPC."` (linha 155).
- **Por que impacta**: numa loja ativa, mensagens crescem rápido. `in()` com 500+ conversation_ids vira query gigante; o payload retornado é proporcional a `messages × período`. Agregação no Node é O(N).
- **Evidência**: trecho + comentário do autor.
- **Impacto estimado**: **Alto** conforme volume cresce. `[PRECISA MEDIR]` payload em loja com tráfego real.
- **Esforço**: **M** — criar RPC `funnel_qualified_count(store_id, since)` retornando o int agregado direto do Postgres.

### A5 — `SELECT *` em `/estoque` carregando colunas pesadas (Banco / Médio / P)

- **Localização**: `app/estoque/page.tsx:18`.
- **O que faz**: `supabase.from('products').select('*')`. Os componentes (`EstoqueClient.tsx`, `ProductTable.tsx`) usam apenas: `id, sku, name, category, price, stock_quantity, stock_min`. Mas `*` inclui:
  - `description` (até 2000 chars)
  - `image_urls TEXT[]` (até N URLs de 500 chars cada — `actions/products.ts:9`)
  - `variants JSONB`, `attributes JSONB`
  - `cores TEXT[]`, `tamanhos TEXT[]`
- **Por que impacta**: payload de rede inflado, parsing JSON maior no cliente Supabase, mais memória no Node. Lojas com 500+ SKUs com fotos viram MB de JSON por listagem.
- **Evidência**: comparação entre as colunas retornadas e as efetivamente lidas em `EstoqueClient.tsx:34-54` e `ProductTable.tsx`.
- **Impacto estimado**: **Médio**. Só vira Alto se o catálogo for grande.
- **Esforço**: **P** — projeção explícita. Detalhes/edição carregam o resto sob demanda no Drawer.

### A6 — `listStoreMembers` em loop sequencial (N+1 / Médio / P)

- **Localização**: `actions/equipe.ts:51-60`.
- **O que faz**:
  ```ts
  for (const m of members) {
    const { data: u } = await admin.auth.admin.getUserById(m.user_id)
    rows.push({ ..., email: u.user?.email ?? '' })
  }
  ```
  Loop `await` serial — N membros = N round-trips ao Supabase Auth Admin.
- **Por que impacta**: cresce linear com tamanho do time. 10 membros ≈ 10× a latência de uma chamada admin.
- **Evidência**: trecho.
- **Impacto estimado**: **Médio** se time pequeno (≤5), **Alto** se time crescer.
- **Esforço**: **P** — `Promise.all(members.map(...))`.

### A7 — Sidebar refaz `getUser()` + role no cliente em toda página autenticada (Auth / Médio / P)

- **Localização**: `components/ui/Sidebar.tsx:235-260` (`loadRole`).
- **O que faz**: ao montar, faz `createClient().auth.getUser()` + `select role from store_members` no **browser**, só pra decidir quais itens do nav exibir.
- **Por que impacta**: bloqueia até a sidebar saber o role; mostra todos os itens por default (`isOwner = true` no fallback de linha 245). Duas requests redundantes em **toda** navegação para `/painel`, `/conversas`, `/leads`, `/estoque`, `/equipe`, `/loja`. Também `SuaUrlPublica` (`Sidebar.tsx:130-167`) refaz `getUser()` + query store_settings ao montar em `/loja`.
- **Evidência**: o server já chamou `getUser` + (se aplicável) `getStoreRole`; o resultado deveria descer via props.
- **Impacto estimado**: **Médio** (não bloqueia LCP, mas adiciona requests e flicker).
- **Esforço**: **P** — passar `role` via Server Component pra Sidebar como prop. Eliminar `useEffect` de role.

### A8 — Layout root carrega 3 fontes Google com 4 pesos cada (Bundle / Médio / P)

- **Localização**: `app/layout.tsx:5-24`.
- **O que faz**: `Sora` (4 pesos), `Plus_Jakarta_Sans` (4 pesos), `JetBrains_Mono` (4 pesos). Todos com `display: 'swap'` mas baixados na primeira carga.
- **Por que impacta**: 12 arquivos de fonte = peso de download na primeira visita. Afeta FCP em mobile/rede lenta.
- **Evidência**: trecho.
- **Impacto estimado**: **Médio** primeira visita; **Baixo** subsequente (cache de browser). `[PRECISA MEDIR]` quais pesos são realmente usados — provavelmente nem todos os 12.
- **Esforço**: **P** — auditar uso de cada peso e remover não-usados.

### A9 — Realtime: 3 channels Supabase abertos no `/painel` (Outro / Médio / M)

- **Localização**: `lib/realtime-painel.ts:14-126` (3 hooks: `useVisitorsPresence`, `usePainelPulse`, `usePainelActivity`).
- **O que faz**: cada hook abre um channel WebSocket separado. `usePainelPulse` e `usePainelActivity` escutam **o mesmo filtro** (`conversations` da loja) e disparam refetches independentes via server actions (debounce 2s cada).
- **Por que impacta**: dois channels ouvindo o mesmo evento = dobra de wakeups + duas server actions disparadas com 2s de delay cada (mais auth × 2). Não afeta first-load TTFB, mas degrada o uso contínuo.
- **Evidência**: linhas 60-68 e 105-117 mostram filtros idênticos.
- **Impacto estimado**: **Médio** durante uso prolongado, **Baixo** no first load.
- **Esforço**: **M** — consolidar em um único channel + um refetch que retorna pulse+activity num único RPC.

### A10 — `LojaForm` faz fetch client-side de `store_settings` (Cache / Médio / P)

- **Localização**: `app/loja/LojaForm.tsx` (componente client) — `useEffect` que cria cliente Supabase e busca `store_settings` (vi as imports nas primeiras 80 linhas, padrão típico).
- **O que faz**: a página `/loja` já tem o `user.id` server-side e poderia ter passado as configurações como props.
- **Por que impacta**: round-trip extra após hydrate; flicker no formulário.
- **Evidência**: parcial (li só o topo); padrão presente em `Sidebar.tsx:131-153`.
- **Impacto estimado**: **Médio** em `/loja`.
- **Esforço**: **P** — server fetch + props.

### A11 — Middleware em `runtime: 'nodejs'` faz `getUser()` em toda rota (Auth / Médio / M)

- **Localização**: `middleware.ts:50, 71`.
- **O que faz**: roda em Node (não Edge) e revalida sessão a cada request. Matcher exclui `_next/static`, `_next/image`, `favicon.ico`, `widget`, `api` — mas `/chat/[slug]` (público) passa por aqui também.
- **Por que impacta**: nodejs runtime no middleware tem cold start no Vercel. `getUser()` round-trip ao Auth API a cada request — mesmo nas páginas `/leads` e `/equipe` que sequer estão na lista de guarda (linhas 52-56), middleware ainda valida sessão sem efeito.
- **Evidência**: trecho do middleware; matcher e lista de guards inconsistentes.
- **Impacto estimado**: **Médio** (cumulativo com A1). `[PRECISA MEDIR]` cold start no Vercel.
- **Esforço**: **M** — investigar migração para Edge runtime (se `@supabase/ssr` suportar nesse setup) + decidir se `/chat/[slug]` precisa de middleware (não precisa auth).

### A12 — `idx_conversations_status` sem prefixo `store_id` (Índice / Médio / P)

- **Localização**: migração `002_conversations_messages.sql:16`.
- **O que faz**: `CREATE INDEX idx_conversations_status ON conversations (status)`. Num cenário multi-tenant esse índice tem baixa seletividade — uma loja qualquer pode ter milhares de `ai_active`.
- **Por que impacta**: queries do `getPainelPulse` filtram por `store_id AND status [AND ...]`. Sem índice composto `(store_id, status, ...)`, o planner usa `idx_conversations_store_visitor` (que cobre store_id mas não status) ou faz scan. **`[PRECISA MEDIR]`** com `EXPLAIN ANALYZE` em produção.
- **Evidência**: ver tabela 2.3 (I1, I2, I4, I8).
- **Impacto estimado**: **Médio→Alto** conforme volume.
- **Esforço**: **P** — criar índices compostos via nova migration.

### A13 — `idx_messages_store_created` cobre Realtime mas não a CTE `last_msg` (Índice / Médio / P)

- **Localização**: migration 021:26-32, índice em 019:20-21.
- **O que faz**: a CTE faz `DISTINCT ON (m.conversation_id) ... ORDER BY m.conversation_id, m.created_at DESC WHERE m.store_id = ?`. O índice `(store_id, created_at DESC)` ordena por created_at, não por conversation_id — força sort.
- **Por que impacta**: lista de conversas (carga inicial de `/conversas`) faz sort em messages. Volume cresce com mensagens.
- **Evidência**: divergência entre o ORDER BY da CTE e a chave do índice.
- **Impacto estimado**: **Médio**, escala com mensagens.
- **Esforço**: **P** — adicionar `(store_id, conversation_id, created_at DESC)`.

### A14 — `idx_products_sku` redundante com UNIQUE (Índice / Baixo / P)

- **Localização**: migration 001:23 + 007 (UNIQUE(user_id, sku) substitui o UNIQUE(sku) original).
- **O que faz**: `idx_products_sku` ficou órfão. Não atrapalha leitura mas ocupa espaço e atrasa writes.
- **Impacto**: **Baixo**.
- **Esforço**: **P**.

---

## 4. Plano de ação

### Fase 1 — Quick wins (baixo risco, alto impacto)

| # | Item | Arquivos | Risco | Validação |
|---|---|---|---|---|
| F1.1 | **Projetar colunas em `/estoque`** — trocar `select('*')` por lista explícita das colunas usadas. Drawer de detalhes faz fetch sob demanda das colunas pesadas. | `app/estoque/page.tsx:18`, `actions/products.ts` (nova `getProductDetails`), `components/estoque/ProductDetailsDrawer.tsx` | **Baixo** | Antes/depois: tamanho do payload da request `/estoque` (Network tab) + TTFB de `/estoque`. |
| F1.2 | **`listStoreMembers` em paralelo** — `Promise.all` no loop de `auth.admin.getUserById`. | `actions/equipe.ts:51-60` | **Baixo** | TTFB de `/equipe` em loja com ≥3 membros. |
| F1.3 | **Sidebar recebe `role` via props** — Server Component resolve role e passa pra `Sidebar` como prop. Eliminar `useEffect` de role. | `components/ui/Sidebar.tsx:231-260`, novo wrapper em layouts ou passar via context server-side. | **Baixo** | Eliminar 2 requests por navegação (visíveis no Network). |
| F1.4 | **`LojaForm` recebe settings via props** — server fetch + props. | `app/loja/page.tsx`, `app/loja/LojaForm.tsx` | **Baixo** | Eliminar 1 request + flicker em `/loja`. |
| F1.5 | **Auditar pesos das fontes** — remover pesos não usados em `Sora`/`Plus_Jakarta_Sans`/`JetBrains_Mono`. | `app/layout.tsx:5-24` + grep de `font-weight` no CSS | **Baixo** | Tamanho do payload de fontes na primeira visita. |
| F1.6 | **Dropar índice redundante `idx_products_sku`** | nova migration | **Baixo** | Tempo de INSERT/UPDATE em `products`. |

**Dependências**: nenhuma entre itens; podem ser feitos em paralelo.

### Fase 2 — Estrutural (cache, batch, índices)

| # | Item | Arquivos | Risco | Validação |
|---|---|---|---|---|
| F2.1 | **Cache do `getUser()` por request** — usar `cache()` do React (`import { cache } from 'react'`) ao redor de uma função `getAuthedUser()` que substitui as chamadas diretas a `supabase.auth.getUser()` em todas as actions/pages do mesmo request. Resolve A1. | `lib/supabase/server.ts` (nova `getAuthedUser`), todas as 5 actions do painel + `store-role.ts` + páginas. | **Médio** — precisa garantir que `cache()` está sendo importado de `react`, não de `next/cache`; e que cada request inicia com cache limpo (que é o comportamento esperado). | TTFB de `/painel` antes/depois; contagem de chamadas a `/auth/v1/user` no Supabase logs. |
| F2.2 | **RPC `funnel_qualified_count`** — substituir o "MVP" de Stage 3 do `getFunnel` por agregação no Postgres. Resolve A4. | nova migration + `actions/painel.ts:153-173` | **Médio** — replicar exatamente a semântica (≥3 mensagens). | Tempo da action `getFunnel` + payload retornado. |
| F2.3 | **Índices compostos** (resolve A12, A13, e A8/RLS): <br>– `(store_id, status, last_message_at DESC)` em `conversations` <br>– `(store_id, created_at)` em `conversations` <br>– `(store_id, conversation_id, created_at DESC)` em `messages` <br>– `(store_id, created_at DESC)` em `leads` <br>– parcial `(store_id, created_at) WHERE whatsapp IS NOT NULL` em `leads` | nova migration | **Baixo→Médio** — `CREATE INDEX CONCURRENTLY` para não travar writes. | `EXPLAIN ANALYZE` antes/depois das queries de `getPainelPulse`/`getFunnel`/`getLeads`. |
| F2.4 | **Cache de leitura por usuário** — `unstable_cache` em queries quase-estáticas (`store_settings`, `default_stock_min`, slug do chat). Tag por `store_id`. Invalidar via `revalidateTag` em `saveStoreSettings`/`saveProduct`. Possivelmente remover `force-dynamic` onde não for necessário (cookies forçam dynamic implicitamente). | `actions/store-settings.ts`, `actions/products.ts`, pages | **Médio** — atenção pra não cachear entre usuários (chave deve incluir `user.id`). | TTFB da segunda visita à mesma rota. |
| F2.5 | **Batch de signed URLs por conversa / TTL longo** — opção A: gerar URLs públicas com expiração maior e cachear no DB; opção B: substituir bucket privado por bucket público + path inscrutável (UUIDs já são); opção C: cache de signed URLs em memória/Redis por `media_path`. Resolve A2. | `lib/chat-media.ts`, `actions/chat.ts:103-112`, `actions/conversas.ts:92-101` | **Médio** — opção B muda modelo de segurança; precisa decisão. | Tempo de `getMessages` numa conversa com 50 mídias. |
| F2.6 | **Consolidar Realtime do painel num único channel** — um channel por loja escutando `conversations`; um único callback dispara refetch consolidado de pulse+activity via um RPC `get_painel_snapshot(store_id)`. Resolve A9. | `lib/realtime-painel.ts`, `actions/painel.ts` (nova RPC), `components/painel/PainelDashboard.tsx` | **Médio** — refatora hooks; manter signature da prop pra não impactar componentes filhos. | Nº de WebSocket connections abertas no DevTools; CPU no idle de `/painel`. |

**Dependências**:
- F2.1 deve vir antes de qualquer reorganização de actions (define a primitiva nova).
- F2.6 depende de F2.1 (RPC consolidada vai usar `getAuthedUser`).
- F2.3 é independente; pode ir junto com F2.2.

### Fase 3 — Avançado

| # | Item | Arquivos | Risco | Validação |
|---|---|---|---|---|
| F3.1 | **Migrar middleware para Edge runtime** — investigar se `@supabase/ssr@0.10.2` funciona em Edge (provavelmente sim). Reduz cold start. Resolve parte de A11. | `middleware.ts:67-72` | **Alto** — pode requerer adaptação se algum import for Node-only. | Cold-start de TTFB no Vercel Analytics. |
| F3.2 | **Corrigir matcher e guards do middleware** — incluir `/leads` e `/equipe` no `if (!user && ...)` (linha 52). Hoje passam pelo middleware (matcher inclui) mas não fazem redirect — a guarda só roda na page. (Observação: também é hardening de segurança — ver §6.) | `middleware.ts:52` | **Baixo** | Acessar `/leads` deslogado; deve redirect para `/login`. |
| F3.3 | **CDN/Image optimization** — `next/image` para o logo da loja e fotos de produto, com `loader` configurado pro Storage do Supabase. | `app/loja/page.tsx`, `components/loja/LogoUpload.tsx`, drawers de produto | **Médio** | LCP em `/estoque` (drawer com foto) e `/chat/[slug]` (avatar/logo). |
| F3.4 | **Code-splitting agressivo** — `ProductEditDrawer`, `ProductDetailsDrawer`, `LojaForm` via `next/dynamic` (componentes pesados de uso esporádico). | imports nas pages que consomem | **Baixo** | Bundle JS inicial de `/estoque` e `/loja`. |
| F3.5 | **Stale-while-revalidate no cliente** — para listas (leads, products, conversations), salvar último snapshot em localStorage com TTL curto; mostrar imediatamente e revalidar em background. | client components | **Médio** — gerencia stale data, pode confundir usuário. | Tempo até primeiro paint útil em navegação repetida. |

**Dependências**: F3.1 depende de F2.1 estar concluído (caso contrário multiplica cold start). F3.3 e F3.4 são independentes do resto.

---

## 5. Como medir local

Variáveis de ambiente necessárias (não estão no repo — confirme em `.env.local`):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL` (opcional, usado em `/loja`)

Comandos:

```bash
# Build de produção (mede de verdade, não dev server)
npm run build
npm run start

# Em outro terminal, abrir Chrome DevTools → Network/Performance → Disable cache
# Login, depois navegar para cada rota com Performance gravando:
#   1. /painel    (rota mais carregada — 5 queries paralelas + 3 realtime channels)
#   2. /estoque   (SELECT * em products)
#   3. /conversas (RPC list_conversations + abrir uma conversa com mídia)
#   4. /leads     (200 rows)
#   5. /equipe    (loop sequencial em auth admin)
#   6. /loja      (LojaForm refetch + QR code SVG)
```

Para cada rota, capturar do Performance/Network:
- **TTFB** do documento HTML
- **LCP** (Lighthouse ou Performance)
- **FCP**
- **Tempo total das requests do Network**
- **Top 3-5 requests mais lentas**

`npm run dev` mostra tempos diferentes de produção (HMR, sourcemaps). Use sempre `build && start` para medir.

---

## 6. Observações adicionais (fora do escopo de performance)

1. **Guarda de auth incompleta no middleware** — `middleware.ts:52` lista `/painel|/estoque|/loja|/conversas` mas omite `/leads` e `/equipe`. Hoje as pages têm guarda própria, então funciona, mas é inconsistente. Pequeno hardening.
2. **`isOwner` falha-aberto na Sidebar** — `Sidebar.tsx:245` define `isOwner = true` quando não consegue ler o usuário. O comentário explica que é cosmético (guarda real é server-side), mas vaza item "Painel" pra um vendedor com cookie quebrado, por exemplo.
3. **Dados mockados em produção no Sidebar** — `OPERADORES`/`AgenteIA`/`ProximaNaFila` (`Sidebar.tsx:27-32, 203-228, 34-65`) renderizam dados hardcoded ("Mariana A.", "em 3 chats", "2 conversas"). Confuso pra usuário real.
4. **`idx_conversations_status` (sem store_id)** — vide A12. Possivelmente removível depois que os índices compostos forem criados.
5. **RLS inconsistente** — `knowledge_gaps` e `product_mentions` ainda usam `auth.uid() = store_id` (single-tenant), enquanto `leads`/`conversations`/`messages` migraram pra membership (025). Agentes vendedores não veem gaps/intent.
6. **QR code gerado a cada request em `/loja`** — fora de escopo por sua instrução, mas vale anotar: `qrcode.toString` roda em todo carregamento da página (não é cacheado).
7. **`getMessages` paga `createAdminClient()` por mensagem** — não é um problema crítico, mas `signedReadUrl` cria um novo cliente Supabase admin em cada chamada (`chat-media.ts:9`). Reutilizar um cliente pode ajudar marginalmente.

---

## 7. Perguntas em aberto

1. **Plano de cache**: aceitável cachear leitura por `user.id` com TTL curto (ex.: 30s para `store_settings`, `default_stock_min`)? Há alguma constraint regulatória/UX que impede isso?
2. **`/chat/[slug]` precisa de middleware?** Hoje passa por ele à toa (não tem cookie de auth para validar). Pode ser excluído do matcher e ganhar cold-start melhor.
3. **Bucket `chat-media`** — pode virar público com paths inscrutáveis (UUIDs), ou precisa continuar privado por requisito de privacidade? Isso decide F2.5 (opção B vs A/C).
4. **Volume real**: alguma loja em produção tem mais de 1k produtos / 10k mensagens / 100 conversas ativas? Os índices ausentes (Fase 2) só importam de verdade acima desses thresholds. `[PRECISA MEDIR]` em produção.
5. **Edge runtime no middleware (F3.1)** — você está OK em testar essa migração ou prefere manter Node? Há dependências server-only no projeto que eu precise considerar?
6. **Realtime: vale a refatoração (F2.6)?** Os 3 channels só pesam em `/painel`. Se essa rota não é a mais usada no dia a dia, podemos deprio rizar.

Aguardo revisão antes de implementar qualquer item.
