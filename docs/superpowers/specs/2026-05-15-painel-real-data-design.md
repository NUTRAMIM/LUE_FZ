# Menu Painel — dashboard de operação com dados reais

**Data:** 2026-05-15
**Branch base:** `feat/painel-redesign-real-model`

## Objetivo

Substituir os dados mockados do `/painel` por dados reais do banco. Hoje todo o
`PainelDashboard.tsx` e seus 3 filhos (`FunilCaptura`, `GapsConhecimento`,
`IntentCatalogo`) renderizam constantes TypeScript hardcoded. O painel vira a
**tela de operação** do dono da loja: visão ao vivo das sessões da IA, funil de
captura de leads, lacunas de conhecimento do RAG e desempenho do catálogo.

É um espelho de leitura — nenhuma métrica é editável aqui. As únicas ações
disparadas a partir do painel são navegação (abrir fila, abrir conversa) e o
aceite manual de conversa (decisão de produto abaixo).

## Decisões de produto

Resolvidas com o usuário em 2026-05-15:

- **Visita única = abrir o chat.** Não há tracking de pageview. O stage 1 do
  funil conta `visitor_id` distintos em `conversations`. Sem tabela `visits`.
- **Sem auto-expiração de sessão.** O evento "sessão expirou (180s)" sai do
  ticker. Conversa só fecha por trigger de venda ou ação manual. O ticker fica
  com 3 tipos: `CHAT` (sessão iniciada), `LEAD` (capturado), `HANDOFF`.
- **Aceite pelo vendedor é manual.** Existe uma ação explícita
  `acceptConversation(id)` que transiciona `ai_active → human_active`, grava
  `assigned_to` e registra um evento em `conversation_events`. O stage 5 do
  funil conta esses eventos no período.
- **Sem meta diária.** O Hero mostra só "Capturados hoje: 47", sem o `/60`.
- **Taxa de captura = leads / sessões de chat** no período do dia (não é mais
  % de meta). `(leads_hoje / sessões_hoje) × 100`.
- **Timezone fixo `America/Sao_Paulo`** para todos os recortes hoje/semana/mês.
- **Uptime sai do footer.** Era cosmético e não tinha fonte.
- **BLACKHOLE removido.** A tabela Intent × Catálogo passa a listar **apenas
  produtos que converteram** (`leads > 0`). O status `BLACKHOLE` sai do enum;
  restam `OK | STOCK OUT | SEM FOTO | DESC VAZIA`.

## Métricas e suas fontes

### Hero — números inline

| Métrica | Definição | Fonte |
|---|---|---|
| Leads esta semana | `count(leads)` desde início da semana | `leads.created_at`, `store_id` |
| Aguardam contato | leads de conversas `ai_active` sem `assigned_to` | join leads↔conversations |
| Parados há > 1h | subconjunto acima com `now() - last_message_at > 1h` | `conversations.last_message_at` |
| Capturados hoje | `count(leads)` do dia | `leads.created_at` |
| Taxa de captura | `leads_hoje / sessões_hoje × 100` | `leads` + `conversations` |
| Latência IA · p95 | `percentile_cont(0.95)` de `messages.latency_ms` (assistant, 24h) | `messages.latency_ms` (novo) |

### Hero — ticker "Atividade ao vivo"

3 streams unidos por `UNION ALL`, janela última 1h, ordenado por timestamp DESC:

- `CHAT` sessão iniciada → INSERT em `conversations`. Identificador
  `vis_<4 chars do visitor_id>`.
- `LEAD` capturado → INSERT em `leads`. Identificador `#<4 chars do id>`.
- `HANDOFF` → evento `handoff` em `conversation_events`. Nome do vendedor via
  `store_members.full_name`.

Footer "últ. evento" = `now() - max(event_time)`.

### PulseStripe

| Métrica | Definição |
|---|---|
| Sessões IA ativas | `conversations` com `status='ai_active'` e `last_message_at > now() - 5min` |
| Visitantes na loja | contagem do Realtime Presence channel (sem banco) |
| Leads sem atribuição | leads de conversas sem `assigned_to` (mesmo cálculo de "aguardam contato") |

### Funil de Captura

| Stage | Definição |
|---|---|
| 1. Visitas únicas | `count(distinct visitor_id)` em `conversations` no período |
| 2. Sessões de chat | `count(conversations)` no período |
| 3. Conversa qualificada | conversas com `count(messages) >= 3` |
| 4. Lead capturado | `count(leads)` com `whatsapp is not null` |
| 5. Aceito pelo vendedor | `count` de eventos `handoff` em `conversation_events` no período |
| 6. Fechado (marcado) | `conversations` com `closed_at` dentro do período |

Derivadas: drop-off `(1 - n+1/n)×100`; taxa vis→lead; taxa lead→fechado; ciclo
médio `avg(closed_at - first_message_at)`. Toggle Hoje/Semana/Mês.

### Gaps de Conhecimento (RAG)

- Sinal "sem resposta": n8n grava `messages.metadata.no_answer = true` quando o
  retrieval não acha match suficiente (`rag_min_score < 0.3` ou 0 docs).
- Top 5 perguntas: agrupar `messages.content` (role `user`) de conversas com
  resposta `no_answer`, contar ocorrências, ordenar DESC.
- Tag (`POLÍTICA DE ENTREGA` etc.): manual no MVP — tabela `question_tags`.
- Total pendentes = `count(distinct conversation_id)` com `no_answer`.

### Intent × Catálogo

Tabela **filtrada por `leads > 0`** (só produtos que converteram):

| Coluna | Fonte |
|---|---|
| Produto | `products.name` |
| Views | `count` em `product_views` no período |
| Menções | `count` de `messages` cujo `metadata.products_mentioned` contém o SKU |
| Leads | leads distintos de conversas que mencionaram o produto |
| Desc. | `length(trim(products.description)) > 0` |
| Foto | `array_length(products.image_urls, 1) > 0` |
| Status | `STOCK OUT` (stock=0) > `SEM FOTO` > `DESC VAZIA` > `OK` |

Footer da tabela: "X converteram este mês · Y total no catálogo".

### Footer LivePulse

Sessões, visitantes, p95, vendedores ON, fila, últ. evento — todos derivados das
fontes acima. **Uptime removido.** "Fila" = mesmo número de "leads sem
atribuição" (unificado). Versão/build lidos em build time.

## Mudanças de banco

Migrations seguem a numeração do projeto (última criada: 021).

### 022 — `conversations.closed_at`

```sql
-- 022_conversations_closed_at.sql
ALTER TABLE conversations
  ADD COLUMN closed_at TIMESTAMPTZ;

UPDATE conversations SET closed_at = updated_at WHERE status = 'closed';

CREATE OR REPLACE FUNCTION set_conversation_closed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status <> 'closed' THEN
    NEW.closed_at = now();
  ELSIF NEW.status <> 'closed' THEN
    NEW.closed_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_conversations_closed_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_conversation_closed_at();
```

Destrava stage 6 do funil, ciclo médio e taxa lead→fechado. Backfill usa
`updated_at` como aproximação para conversas já fechadas.

### 023 — `messages.latency_ms`

```sql
-- 023_messages_latency_ms.sql
ALTER TABLE messages ADD COLUMN latency_ms INT;

CREATE OR REPLACE FUNCTION calculate_message_latency()
RETURNS TRIGGER AS $$
DECLARE last_user_at TIMESTAMPTZ;
BEGIN
  IF NEW.role = 'assistant' THEN
    SELECT created_at INTO last_user_at
    FROM messages
    WHERE conversation_id = NEW.conversation_id AND role = 'user'
    ORDER BY created_at DESC LIMIT 1;
    IF last_user_at IS NOT NULL THEN
      NEW.latency_ms = (EXTRACT(EPOCH FROM (NEW.created_at - last_user_at)) * 1000)::INT;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_messages_latency BEFORE INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION calculate_message_latency();
```

Mede o delta DB-side user→assistant. Não inclui latência de rede do cliente —
limitação aceita (ver Riscos).

### 024 — `store_members`

```sql
-- 024_store_members.sql
CREATE TABLE store_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID NOT NULL REFERENCES store_settings(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('owner','agent','viewer')),
  full_name  TEXT NOT NULL,
  avatar_url TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (store_id, user_id)
);

CREATE INDEX idx_store_members_store ON store_members (store_id) WHERE is_active;

ALTER TABLE store_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "store_members_read"  ON store_members FOR SELECT
  USING (auth.uid() = store_id);
CREATE POLICY "store_members_write" ON store_members FOR ALL
  USING (auth.uid() = store_id);
```

Necessária para "vendedores X/Y ON" e para resolver o nome do vendedor no ticker
de handoff. Seed inicial: cada loja existente recebe uma linha `owner` com
`user_id = store_id` e `full_name` vindo do perfil em `store_settings`.

### 025 — `conversation_events`

```sql
-- 025_conversation_events.sql
CREATE TABLE conversation_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  store_id        UUID NOT NULL REFERENCES store_settings(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL CHECK (event_type IN ('handoff','closed','reopened')),
  from_status     TEXT,
  to_status       TEXT,
  actor_id        UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_conv_events_store_created ON conversation_events (store_id, created_at DESC);

ALTER TABLE conversation_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conv_events_read"   ON conversation_events FOR SELECT
  USING (auth.uid() = store_id);
CREATE POLICY "conv_events_insert" ON conversation_events FOR INSERT
  WITH CHECK (auth.uid() = store_id);

ALTER PUBLICATION supabase_realtime ADD TABLE conversation_events;
```

Log de transições de status. O stage 5 do funil e o ticker de handoff leem daqui
— `conversations.status` sozinho perderia histórico se uma conversa voltasse
para `ai_active`. Eventos são gravados pela action `acceptConversation` e por um
trigger em `conversations` para `closed`.

### 026 — `question_tags`

```sql
-- 026_question_tags.sql
CREATE TABLE question_tags (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id           UUID NOT NULL REFERENCES store_settings(id) ON DELETE CASCADE,
  pergunta_canonica  TEXT NOT NULL,
  tag                TEXT NOT NULL,
  created_at         TIMESTAMPTZ DEFAULT now(),
  UNIQUE (store_id, pergunta_canonica)
);

ALTER TABLE question_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "question_tags_all" ON question_tags FOR ALL
  USING (auth.uid() = store_id);
```

Mapeamento manual pergunta → tag para o widget de Gaps. Fase 1 deixa a tag em
branco; o operador classifica depois.

### 027 — `product_views`

```sql
-- 027_product_views.sql
CREATE TABLE product_views (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  store_id   UUID NOT NULL REFERENCES store_settings(id) ON DELETE CASCADE,
  visitor_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_product_views_store_created ON product_views (store_id, created_at DESC);
CREATE INDEX idx_product_views_product ON product_views (product_id);

ALTER TABLE product_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "product_views_insert" ON product_views FOR INSERT WITH CHECK (true);
CREATE POLICY "product_views_read"   ON product_views FOR SELECT
  USING (auth.uid() = store_id);
```

Counter por produto. Alimentado por uma server action chamada na rota de página
de produto (`/p/[sku]`, criada na Onda C).

### 028–032 — RPCs

Cinco RPCs `SECURITY INVOKER` (respeitam RLS), recebendo `p_store_id` e, quando
aplicável, `p_range TEXT ('day'|'week'|'month')`. Recortes de tempo usam
`now() AT TIME ZONE 'America/Sao_Paulo'`.

- **028 `get_painel_pulse(p_store_id)`** — bundle dos contadores do Hero,
  PulseStripe e footer num único shot: leads semana/hoje, aguardam contato,
  parados >1h, sem atribuição, sessões IA ativas, sessões hoje (para a taxa),
  p95 de latência.
- **029 `get_funnel_for_store(p_store_id, p_range)`** — 6 stages + drop-offs +
  taxas + ciclo médio. Assinatura completa esboçada na pesquisa; CTEs por stage.
- **030 `get_activity_feed_last_hour(p_store_id)`** — `UNION ALL` dos 3 streams
  (sessão iniciada, lead capturado, handoff), `LIMIT 100`.
- **031 `get_intent_catalog_for_store(p_store_id, p_range, p_order)`** — tabela
  de produtos **com `HAVING leads > 0`**, status calculado, ordenável por
  menções/views/leads.
- **032 `get_unanswered_questions(p_store_id, p_days)`** — top 5 perguntas com
  `no_answer`, contagem, `LEFT JOIN question_tags` para a tag.

### Tipos TS

Atualizar `src/types/database.ts`:
- `conversations`: adicionar `closed_at`.
- `messages`: adicionar `latency_ms`.
- Novas tabelas: `store_members`, `conversation_events`, `question_tags`,
  `product_views`.
- `leads`: confirmar `store_id`, `conversation_id`, `cep` (migration 013) —
  estavam ausentes do tipo.

## Backend — server actions

Arquivo novo: `src/actions/painel.ts`. Todas usam o server client autenticado;
RLS faz o scoping por loja.

- `getPainelPulse()` → RPC 028. Números do Hero/Pulse/footer.
- `getFunnel(range)` → RPC 029.
- `getActivityFeed()` → RPC 030.
- `getGaps()` → RPC 032.
- `getIntentCatalog(order)` → RPC 031.
- `acceptConversation(conversationId)` → `UPDATE conversations SET
  status='human_active', assigned_to=auth.uid()` + `INSERT conversation_events
  (event_type='handoff', from_status='ai_active', to_status='human_active',
  actor_id=auth.uid())`. Transação única.

A action `incrementProductView(sku)` vive em `src/actions/produtos.ts` (Onda C),
chamada pela rota `/p/[sku]`.

## Frontend

### Estrutura de arquivos

```
src/app/painel/page.tsx               ← Server Component: user + initial fetch
src/components/painel/
  PainelDashboard.tsx                 ← Client Component (rewrite: remove mocks)
  Hero.tsx                            ← extraído; consome pulse + activity feed
  PulseStripe.tsx                     ← extraído
  FunilCaptura.tsx                    ← rewrite: consome getFunnel
  GapsConhecimento.tsx                ← rewrite: consome getGaps
  IntentCatalogo.tsx                  ← rewrite: consome getIntentCatalog
  LivePulse.tsx                       ← extraído; sem uptime
src/actions/painel.ts                 ← actions acima
src/lib/realtime-painel.ts            ← hooks de Realtime e Presence
```

`Hero`, `PulseStripe` e `LivePulse` hoje são funções internas de
`PainelDashboard.tsx`. Extrair cada uma para arquivo próprio — o componente já
está grande e vai crescer com data fetching e estado.

### `page.tsx` (Server Component)

Carrega `user`, faz o fetch inicial de `getPainelPulse`, `getFunnel('month')`,
`getActivityFeed`, `getGaps`, `getIntentCatalog('mentions')` em paralelo e passa
tudo como props para `PainelDashboard`. `redirect('/login')` se sem user.

### Hooks de tempo real — `src/lib/realtime-painel.ts`

- `usePainelRealtime(storeId, handlers)` — channels `postgres_changes` em
  `conversations`, `leads`, `conversation_events` filtrados por `store_id`.
  Em qualquer evento, refetch debounced (~2s) de `getPainelPulse` e
  `getActivityFeed`. Cleanup remove os channels.
- `useVisitorsPresence(storeId)` — assina o Presence channel
  `store:<storeId>:visitors`. Retorna `count`. O lado que entra no channel é a
  página pública `/chat/[slug]` (mudança descrita abaixo).
- `useAgentsPresence(storeId)` — assina `store:<storeId>:agents`. Quem entra é a
  página `/conversas`. Retorna `{ online, total }` — `total` vem de
  `store_members` ativos (prop do server).

### Mudanças nos componentes

- **Hero**: remover `/60`; "Capturados hoje" mostra só o número. "Taxa de
  captura" recalculada (leads/sessões). Ticker consome `getActivityFeed` +
  realtime; sem linha "sessão expirou". Saudação "Bem-vinda, <nome>" usa o
  `full_name` do `store_members` owner.
- **PulseStripe**: 3 quadros ligados a `getPainelPulse` + `useVisitorsPresence`.
- **FunilCaptura**: toggle Hoje/Semana/Mês funcional — troca `range` e refetch.
  Drop-off e taxas calculados pelo RPC.
- **GapsConhecimento**: lista vinda de `getGaps`; "Abrir todos · N" usa o total
  real.
- **IntentCatalogo**: tabela vinda de `getIntentCatalog`, já filtrada por
  `leads > 0`. Remover `BLACKHOLE` do type `ProductStatus` e de `STATUS_CLS`.
  Ordenação "menções" funcional.
- **LivePulse**: remover o segmento de uptime. Versão de `package.json`, build
  de `process.env.NEXT_PUBLIC_BUILD_ID`.

## Mudanças no n8n

Workflow `chat-agent`: adicionar um **Code node** após o AI Agent, antes do
INSERT da mensagem `assistant`, que enriquece `messages.metadata`:

```
{
  products_mentioned: [<SKUs citados na resposta>],
  no_answer:          <true se rag_min_score < 0.3 ou 0 docs recuperados>,
  rag_docs_count:     <int>,
  rag_min_score:      <float>
}
```

Isso alimenta, de uma vez: a coluna MENÇÕES (Intent × Catálogo), o sinal de Gaps
(RAG) e telemetria de depuração. É pré-requisito da Onda C.

## Mudança na página pública do chat

`/chat/[slug]` passa a entrar no Presence channel `store:<storeId>:visitors` ao
montar (e a sair ao desmontar). É o que torna "Visitantes na loja" real, sem
tabela nem heartbeat HTTP. Mudança pequena e isolada no client component do chat.

## O que sai da UI atual

| Removido | Motivo |
|---|---|
| `/60` (meta diária) no Hero | Decisão: sem meta |
| Evento "sessão expirou (180s)" no ticker | Decisão: sem auto-expiração |
| Segmento "uptime 99,97%" no footer | Decisão: removido |
| Status `BLACKHOLE` (type + `STATUS_CLS`) | Decisão: tabela só com convertidos |
| Constantes mock `ACTIVITY`, `PULSE`, `STAGES`, `SUMMARY`, `GAPS`, `PRODUCTS` | Substituídas por dados reais |
| "sexta, 12 mai" hardcoded no Topbar | Data real (`America/Sao_Paulo`) |

A busca `⌘K` e o sino de notificações do Topbar permanecem como estão — são UI
puramente decorativa hoje e estão fora deste escopo.

## Fora do escopo (futuro)

- **Tabela `visits`** e tracking de pageview pré-chat — só se "visita única"
  precisar deixar de ser "abertura de chat".
- **Classificação automática de tags** dos Gaps (LLM inline ou clustering por
  embedding) — Fase 1 é tag manual.
- **Uptime real** derivado de `n8n_webhook_log` ou provider externo.
- **Convite de vendedores** — `store_members` nasce só com o owner; UI de
  convite é outro projeto.
- **View materializada** para Intent × Catálogo — só se a RPC virar gargalo.
- **Latência de rede cliente→servidor** na métrica p95 — exigiria timestamp do
  cliente.

## Fases de implementação

**Onda A — quick wins, sem migration.** Extrair `Hero`/`PulseStripe`/`LivePulse`
para arquivos próprios. Limpeza da UI (meta, uptime, sessão expirou, BLACKHOLE).
`getPainelPulse` como queries server-side diretas (ainda sem RPC). Presence de
visitantes. Funil stages 1–4 com queries diretas. Já mostra dados reais no Hero.

**Onda B — migrations P0 + funil/handoff completos.** Migrations 022–025. RPCs
028–030. `acceptConversation`. Presence de vendedores. Funil stages 5–6.
Latência p95 real. Ticker de handoff com nome real.

**Onda C — Intent + RAG.** Migrations 026–027. RPCs 031–032. Code node no n8n.
Rota `/p/[sku]` com `incrementProductView`. Widget de Gaps dinâmico. Tabela
Intent × Catálogo dinâmica.

## Riscos / pegadinhas

- **Backfill de `closed_at`** usa `updated_at`, que é impreciso para conversas
  fechadas antes da migration. Ciclo médio histórico fica aproximado; aceitar.
- **`latency_ms` mede só o lado DB** (user msg → assistant msg). Atrasos de rede
  no cliente entram como latência inflada. Documentar no tooltip do número.
- **Realtime + RLS**: o browser client precisa de sessão ativa para receber
  eventos — `auth.uid()` tem que bater com `store_id` do filtro.
- **Presence precisa de cleanup**: visitantes e vendedores precisam sair do
  channel ao desmontar, senão o contador infla. Hooks retornam cleanup.
- **`get_funnel_for_store` com toggle**: cada troca de range é um refetch. Sem
  cache no MVP — aceitável para 200 conversas/loja.
- **Stage 5 depende de `conversation_events`** existir e ser populado por
  `acceptConversation`. Conversas migradas para `human_active` antes da Onda B
  não terão evento — stage 5 começa a contar a partir do deploy.
- **`products_mentioned` depende do n8n**. Até o Code node estar no ar, MENÇÕES
  e LEADS-por-produto ficam zerados — a tabela Intent × Catálogo só ganha vida
  na Onda C.
- **`get_painel_pulse` é chamado a cada evento realtime** (debounced 2s). Em
  loja movimentada, garantir que o debounce segura — senão vira N+1 de RPC.
- **Numeração de migrations**: confirmar que 022 é o próximo livre antes de
  criar (a branch pode ter andado).
