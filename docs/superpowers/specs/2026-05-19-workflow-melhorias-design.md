# Workflow do Chat Agent — Melhorias (interest_summary, humanização, anti-repetição, painéis reais) Design

**Status:** Spec aprovada → pronta para implementation plan
**Data:** 2026-05-19
**Escopo:** Aprimorar `n8n/workflow-chat-agent.json` em quatro frentes e religar dois painéis do `/painel` a dados reais gerados pelo workflow.

---

## 1. Contexto

O workflow atual (`LUE FZ - Chat Agent`) tem dois fluxos paralelos disparados pelo webhook do chat:

- **AI Agent2** — vendedor virtual com tool `BUSCAR_PRODUTOS` (vector store Supabase) e memória `Postgres Chat Memory`.
- **Lead Analyzer + Parse Lead + Get/IF/Update/Create Lead** — extrai nome/telefone/email/cep e faz upsert em `leads`.

A tabela `leads` já possui a coluna `interest_summary TEXT` (migration 026) que nunca é preenchida. Os componentes `src/components/painel/GapsConhecimento.tsx` e `src/components/painel/IntentCatalogo.tsx` exibem dados **totalmente hardcoded** — não há tabela nem server action por trás.

Quatro problemas alvo:

1. **Lead sem síntese de interesse** — o vendedor humano que recebe o lead na fila não tem contexto do que o cliente queria.
2. **AI Agent robótico** — respostas com padrão repetitivo, listas frias, sem micro-validações.
3. **BUSCAR_PRODUTOS repete o mesmo produto** — mesmo após o usuário aumentar `topK`, o agente continua devolvendo o primeiro produto da categoria toda vez que o cliente pede "mais tops". Causa raiz: query idêntica → embedding idêntico → mesma ordenação no vector store.
4. **Painéis com dados fictícios** — `GapsConhecimento` (perguntas sem resposta) e `IntentCatalogo` (produtos × menções × leads) não refletem realidade nenhuma da loja.

## 2. Objetivos e não-objetivos

**Objetivos:**

- Workflow grava `leads.interest_summary` automaticamente ao final de cada interação que produziu/atualizou lead.
- AI Agent2 responde de forma consultiva e variada, sem perder a regra de "não inventar nada".
- BUSCAR_PRODUTOS, em três chamadas consecutivas dentro de uma categoria, devolve produtos diferentes.
- Painéis `GapsConhecimento` e `IntentCatalogo` consomem dados reais escritos pelo workflow.

**Não-objetivos:**

- Reescrever a arquitetura do workflow (continua sendo um único webhook → branches paralelos).
- Trocar de modelo de LLM ou provedor.
- Mexer no funil (`FunilCaptura`) ou nas outras métricas do painel — já são reais.
- Aceitação humana de leads / handoff de vendedor — fora deste escopo.
- Customização visual dos painéis — só trocamos a fonte dos dados, mantemos o layout.

## 3. Mudanças no workflow n8n

### 3.1 Novo nó `Interest Summarizer`

**Tipo:** `@n8n/n8n-nodes-langchain.agent` com `gpt-5.4-mini`.

**Dispara:** depois de `Update Lead` E depois de `Create Lead` (ambos os branches do `IF Lead Exists` ligam a uma junção de fluxo — implementado conectando os dois ao mesmo `Interest Summarizer`).

**Input:** carrega as últimas 10 mensagens da conversa de uma vez:

```
Postgres node (operation: executeQuery)
SELECT role, content
FROM messages
WHERE conversation_id = '{{ $('Parse Lead').item.json.conversation_id }}'
ORDER BY created_at DESC
LIMIT 10
```

Esse Postgres node fica entre as branches Update/Create Lead e o Summarizer.

**System message (resumido):**

> Você sintetiza o interesse do cliente para o vendedor humano que vai assumir. Em 1-2 frases, descreva: categoria/tipo de produto procurado, atributos mencionados (cor, tamanho, ocasião, estilo, faixa de preço). Não invente nada. Se a conversa não revelou interesse claro, devolva exatamente `null`. Sem markdown, sem aspas, sem "O cliente..." no começo — vá direto ao ponto.

**Output processing:** um nó Code (`Parse Interest`) limpa o output (remove "null" → vazio, trim) e gera `{ interest_summary, lead_id }`.

**Update final:** nó Supabase `Update Lead Interest` faz UPDATE em `leads` filtrando por `conversation_id` E `store_id` (mesma chave usada no Get Lead), setando `interest_summary` apenas quando o valor não é vazio.

### 3.2 Reescrita do `systemMessage` do AI Agent2 (humanização)

Mantém todas as regras existentes (não inventar, BUSCAR_PRODUTOS com query+category, máximo 3 produtos por mensagem, coleta natural de dados, não insistir em "não").

Adiciona:

- **Tom:** "consultor amigo, não vendedor de loja". Fala com naturalidade, varia aberturas, usa micro-validações antes de listar (`"boa pedida"`, `"entendi"`, `"deixa eu te mostrar"`).
- **Estrutura variável:** não começar mensagens de produto sempre com "Aqui estão...". Alternar entre transições curtas: *"Achei esses três aqui:"*, *"Olha o que combina com isso:"*, *"Separei algumas opções:"*.
- **Espelhar energia:** se o cliente é breve, responder breve; se é detalhado, devolver detalhe.
- **Uma pergunta por vez** quando pedir detalhe (cor OU tamanho OU ocasião, nunca tudo).
- **Após "não" claro:** acolher e oferecer próximo passo natural ("Sem problemas. Quer que eu te mostre outra coisa ou prefere continuar olhando sozinha?"), nunca insistir.
- **Emoji:** máx 1 por mensagem, e nunca em mensagem só com informação de produto (preço/tamanho).

### 3.3 Anti-repetição no BUSCAR_PRODUTOS (Item 3)

**Causa raiz confirmada:** mesma `query` → mesma ordenação no vector store. Aumentar `topK` sozinho não resolve porque o agente continua mostrando os primeiros itens da lista.

**Fix em 3 camadas — todas no system prompt do AI Agent2 (zero código novo):**

1. **Memória de produtos mostrados:** instrução explícita para olhar o histórico da conversa (acessível via Postgres Chat Memory já conectada) e listar mentalmente todos os produtos já apresentados pelo nome.

2. **Variar a query em pedidos de "mais"/"outros"/"diferentes":** quando o cliente pede mais, o agente DEVE acrescentar um atributo diferente na `query` (mudar foco: se mostrou "floral", agora busca "liso" ou "estampado"; se mostrou "preto", agora busca outra cor). Isso muda o embedding e produz ordenação diferente.

3. **Filtro pós-resultado:** ao receber o array de resultados da tool, descartar todos cujo `name` já apareceu na conversa. Se sobrarem zero, chamar a tool de novo com query ainda mais distinta. Se sobrarem 1-3, apresentar todos.

4. **`topK` da tool BUSCAR_PRODUTOS:** subir de 5 para 12 — dá margem ao agente para filtrar repetidos sem rechamar a tool.

### 3.4 Novo nó `Gap Detector` (item 4a — knowledge_gaps)

**Tipo:** `@n8n/n8n-nodes-langchain.agent` com `gpt-5.4-mini`. Roda em paralelo ao AI Agent2 (mesma branch de saída do `Informaçoes da loja1`, igual ao Lead Analyzer hoje).

**Função:** decidir se a mensagem do cliente contém uma **pergunta que o catálogo + system prompt da loja não consegue responder**.

**Input:** mensagem do cliente (`chatInput`) + contexto compacto da loja (categorias, prazo/entrega/pagamento do `service_instructions` e `delivery_methods`).

**System message (resumido):**

> Você analisa a mensagem do cliente e detecta perguntas sem resposta pela loja. Retorne JSON puro: `{"is_gap": true|false, "question": "...", "tag": "POLÍTICA DE ENTREGA"|"PRAZO"|"ATACADO"|"SKU INEXISTENTE"|"PAGAMENTO"|"OUTROS"}`. Marque `is_gap: true` apenas se o cliente fez pergunta concreta cuja resposta NÃO está nas instruções da loja, nem no catálogo. Saudações, declarações de interesse e perguntas já cobertas pelo prompt da loja → `is_gap: false`.

**Saída:** node Code `Parse Gap` parseia JSON, e um `IF Has Gap` decide se insere na tabela.

**Insert:** node Supabase `Insert Gap` grava em `knowledge_gaps`:
```
conversation_id, store_id, question (normalizada lowercase trim), tag
```

### 3.5 Novo nó `Mention Extractor` (item 4b — product_mentions)

**Posição:** depois do `AI Agent2`, antes do `Respond to Webhook` (na branch principal). Não bloqueia a resposta — usa execução normal sequencial pois o Postgres write é rápido (<50ms).

**Função:** identificar quais produtos do catálogo apareceram no texto da resposta do agente E na mensagem do cliente.

**Fluxo:**

1. Node Supabase `Get Catalog` carrega `id, name` de todos os produtos da loja:
   ```
   table: products
   filters: user_id = store_id
   ```
2. Node Code `Match Mentions` recebe três coisas:
   - `aiOutput` = `$('AI Agent2').item.json.output`
   - `customerMsg` = `$('Edit Fields').item.json.chatInput`
   - `catalog` = array de `{id, name}`

   Para cada produto, testa `\bnome\b` (regex case-insensitive, fronteira de palavra) em cada um dos dois textos. Quando há sobreposição de nomes (ex: "Top" dentro de "Top Cropped Floral"), o match mais longo ganha — implementado ordenando o catálogo por `name.length DESC` antes de processar e marcando faixas de texto já consumidas.

   Saída: array de `{ product_id, source }` onde `source ∈ {ai_shown, customer_asked}`.

3. Node Code (`Build Mention Rows`) transforma o array de matches em um array de `json` items (um por linha), permitindo que o nó seguinte processe em batch.
4. Node Supabase `Insert Mentions` (operation: insert) grava cada match em `product_mentions`. Se o array vier vazio, n8n simplesmente não executa o nó.

**Edge cases endereçados:**

- Catálogo vazio → nó Code devolve `[]`, nada é inserido.
- Mesmo produto aparece em AI e na mensagem do cliente → duas linhas (sources diferentes), correto para análise.
- Produto sem nome (defensivo) → ignorado.

## 4. Mudanças no banco

### 4.1 Migration 027 — `knowledge_gaps`

```sql
CREATE TABLE knowledge_gaps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES store_settings(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  question        TEXT NOT NULL,
  tag             TEXT NOT NULL,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_kgaps_store_created ON knowledge_gaps (store_id, created_at DESC);
CREATE INDEX idx_kgaps_store_unresolved ON knowledge_gaps (store_id) WHERE resolved_at IS NULL;

ALTER TABLE knowledge_gaps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kgaps_owner_all" ON knowledge_gaps FOR ALL
  USING (auth.uid() = store_id);
CREATE POLICY "kgaps_service_insert" ON knowledge_gaps FOR INSERT WITH CHECK (true);
```

### 4.2 Migration 028 — `product_mentions`

```sql
CREATE TABLE product_mentions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES store_settings(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source          TEXT NOT NULL CHECK (source IN ('ai_shown', 'customer_asked')),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pmentions_store_product ON product_mentions (store_id, product_id);
CREATE INDEX idx_pmentions_store_created ON product_mentions (store_id, created_at DESC);

ALTER TABLE product_mentions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pmentions_owner_all" ON product_mentions FOR ALL
  USING (auth.uid() = store_id);
CREATE POLICY "pmentions_service_insert" ON product_mentions FOR INSERT WITH CHECK (true);
```

## 5. Mudanças no app Next.js

### 5.1 Server actions em `src/actions/painel.ts`

Adicionar duas funções:

```ts
export interface KnowledgeGap {
  count: number
  question: string
  tag: string
}

export async function getKnowledgeGaps(): Promise<{
  items: KnowledgeGap[]
  totalPending: number
}>
```

Estratégia: agrupa por `question` (lowercase, trim) usando `count(*)`, ordena por contagem desc, devolve top 5 + total não resolvido (`resolved_at IS NULL`). Implementação MVP em memória (`select question, tag where resolved_at is null` e agrega em JS); RPC dedicada fica para uma onda futura caso o volume cresça.

```ts
export interface ProductIntent {
  productId: string
  name: string
  mentions: number       // ai_shown + customer_asked
  leads: number          // distinct conversations com lead + esta menção
  hasDesc: boolean
  hasPhoto: boolean
  status: 'OK' | 'DESC VAZIA' | 'SEM FOTO' | 'STOCK OUT'
}

export async function getProductIntent(range: 'week'|'month'): Promise<{
  items: ProductIntent[]
  totalProducts: number
  withIssues: number
}>
```

Estratégia: 
- `product_mentions` agregada por `product_id` no range (group by + count), join com `products` para `name`, `description`, `image_urls`, `stock_quantity`. 
- `leads`: para cada produto, contar `conversation_id`s distintos que (a) têm pelo menos uma menção do produto E (b) têm registro em `leads.conversation_id` correspondente — uma query com `EXISTS (SELECT 1 FROM leads l WHERE l.conversation_id = pm.conversation_id)`.
- `status` derivado: `stock_quantity = 0` → STOCK OUT; `description IS NULL OR description = ''` → DESC VAZIA; `image_urls IS NULL OR array_length(image_urls, 1) IS NULL` → SEM FOTO; senão OK.
- Devolve top 5 ordenado por menções desc.

A coluna `views` do mock fica fora — não há fonte de dados para "visualizações" hoje, então o componente vai mostrar uma coluna a menos.

### 5.2 Componentes

`src/components/painel/GapsConhecimento.tsx`:
- Vira client component que recebe `gaps: KnowledgeGap[]` e `totalPending: number` como props.
- Renderiza vazio com mensagem "Nenhuma pergunta sem resposta na última semana" quando `gaps.length === 0`.
- Mantém visual idêntico (mesmo layout, mesmas classes).

`src/components/painel/IntentCatalogo.tsx`:
- Mesma estratégia: vira client component que recebe `items: ProductIntent[]`, `totalProducts`, `withIssues`.
- Remove a coluna VIEWS (sem dado).
- Estado vazio: "Sem menções de produtos nas conversas ainda".

`src/components/painel/PainelDashboard.tsx`:
- Passa `gaps` e `intent` para os dois componentes.

`src/app/painel/page.tsx`:
- Adiciona `getKnowledgeGaps()` e `getProductIntent('month')` ao `Promise.all` inicial.

## 6. Fluxo de dados consolidado

```
Webhook → Edit Fields → Informaçoes da loja1
                            ├──→ AI Agent2 ──→ Mention Extractor (Get Catalog → Match → Insert) ──→ Respond to Webhook
                            ├──→ Lead Analyzer → Parse Lead → IF Has Lead Data → Get Lead → IF Lead Exists
                            │                                                                    ├─→ Update Lead ─┐
                            │                                                                    └─→ Create Lead ─┤
                            │                                                                                     │
                            │                                                          Get Recent Messages ◄──────┘
                            │                                                                  │
                            │                                                         Interest Summarizer
                            │                                                                  │
                            │                                                            Parse Interest
                            │                                                                  │
                            │                                                          Update Lead Interest
                            │
                            └──→ Gap Detector → Parse Gap → IF Has Gap → Insert Gap
```

Branches paralelas não precisam se aguardar — n8n executa cada uma até o terminal. O único caminho que retorna ao webhook é o do `AI Agent2 → Respond to Webhook` (latência percebida pelo cliente continua igual).

## 7. Testes / verificação

**Workflow (manual no n8n após import):**

1. Mandar "oi" no chat → não deve criar gap, não deve criar lead, não deve criar mention. Resposta vem normal.
2. Mandar "quero um top floral" → deve chamar BUSCAR_PRODUTOS, mostrar até 3 produtos, criar `product_mentions` com os IDs realmente citados. Mandar "tem mais tops?" → deve mostrar produtos **diferentes**.
3. Mandar "meu nome é Mariana, whatsapp 11999998888" → deve criar lead. Aguardar workflow terminar → `leads.interest_summary` deve ter texto de 1-2 frases coerente com a conversa anterior sobre tops.
4. Mandar "vocês entregam em Niterói?" (assumindo loja não cobre Niterói) → deve criar `knowledge_gaps` com tag `POLÍTICA DE ENTREGA`.

**App (manual no /painel):**

5. Após os passos 2-4, abrir `/painel` → `GapsConhecimento` mostra a pergunta de Niterói com tag, contagem 1. `IntentCatalogo` mostra os produtos que apareceram, com `leads = 1` no que coincide com a conversa do lead criado.

**Tipos:**

6. `npx tsc --noEmit` deve passar limpo (exceto o erro pré-existente conhecido em `src/app/api/inventory/import/route.ts`).

**Validação do workflow JSON:**

7. `mcp__n8n-mcp__validate_workflow` no JSON final antes de pedir re-import.

## 8. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Mention Extractor com nome curto/genérico dá falso positivo (ex: "Top" em "tops") | Regex `\b` palavra-inteira + ordenar catálogo por nome length DESC + marcar faixa consumida |
| Gap Detector classifica saudação como gap | System prompt explícito + retornar `is_gap: false` por padrão + filtro `IF Has Gap` |
| Interest Summarizer alucina conteúdo não dito | System prompt explícito "não invente, devolva null se não há sinal" + parser aceita null |
| Vector store ainda repete depois das 3 camadas anti-repetição | Última camada do prompt instrui a rechamar tool com query ainda mais distinta; se mesmo assim falhar, o agente declara "não achei mais opções nessa linha, quer mudar o estilo?" |
| Performance — 3 nós LLM em paralelo por mensagem | Já temos 2 hoje (AI Agent + Lead Analyzer); adicionar Gap Detector + Interest Summarizer (este só roda quando lead existe) é incremento aceitável. Custo monitorado por uso. |
| Tabelas crescem sem bound | Índices por `store_id, created_at DESC` cobrem queries do painel; cleanup de registros antigos fica para uma onda futura (não bloqueia esta) |

## 9. Itens fora do escopo

- Trigger de re-cálculo de `interest_summary` quando o lead recebe mais mensagens depois — só roda no momento de criação/update inicial. Versão futura pode rodar via cron ou Realtime.
- Marcação manual de gap como "resolvido" pela UI — o campo `resolved_at` existe na tabela mas não há tela ainda. Botão "Completar respostas no catálogo" do mock continua sem ação.
- Tela de drilldown "Abrir todos · {N}" do GapsConhecimento — fica para onda futura.
- Tela de drilldown "Ver todos" do IntentCatalogo — idem.
- Ordenação configurável do IntentCatalogo (hoje só por menções desc).
- RPC dedicada para o agrupamento de gaps/intent — agregação inicial em JS é suficiente para volumes esperados.
