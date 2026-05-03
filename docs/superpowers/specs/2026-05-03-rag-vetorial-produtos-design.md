# RAG Vetorial de Produtos + Slim System Message — Design

**Data:** 2026-05-03
**Status:** Aprovado para implementação
**Escopo:** Substituir a busca atual de produtos do agente principal (Supabase ilike sobre `category`) por busca semântica vetorial (Supabase pgvector via node n8n `vectorStoreSupabase`), reduzir o system message do agente, e limpar nodes órfãos.

## Motivação

O agente principal do workflow `My workflow 10` está com dois problemas:

1. **"Sempre os mesmos produtos"** — a tool `PRODUTOS1` tem um bug de expressão (`=keyValue: %{{ $fromAI(...) }}%`) que faz o filtro `category ilike` virar `'keyValue: %blusa%'`, que nunca casa. O Supabase devolve os 3 primeiros produtos do `user_id` por ordem padrão, sempre os mesmos.
2. **"Comunicação travada"** — o system message tem ~700 palavras com 50+ regras, "REGRA INVIOLÁVEL" e formatação rígida. Modelos modernos (GPT-4o+) ficam mais inteligentes com instruções enxutas.

Mesmo corrigindo o bug, a busca por `category ilike '%termo%'` continua frágil: "blusinha" não acha "Blusa", e a busca não cobre `name`/`description`. Solução de longo prazo é **busca semântica**.

A "RAG para substituir instruções" originalmente proposto foi **reformulado**: RAG entrega **conteúdo de conhecimento** em runtime — não substitui regras comportamentais, que precisam estar no system message (mesmo enxuto). Como a loja não tem corpus de conhecimento separado (FAQ, políticas) além do que já cabe em `store_settings`, **o RAG escopo desta entrega é só de produtos**.

## Decisões (capturadas no brainstorming)

| Pergunta | Decisão |
|---|---|
| Fix do bug `keyValue:` | **Skip** — vetorial substitui PRODUTOS1 inteira |
| Corpus de conhecimento | Só produtos (sem FAQ/políticas separados) |
| Onde guardar vetores | Supabase pgvector (mesma credencial "LUE FZ") |
| O que entra no embedding | Tudo: `name + description + category + cores + tamanhos + brand` |
| Quando gerar embeddings | Workflow n8n agendado a cada 15 min (event-driven documentado para escala futura) |
| Modelo do agente | Manter `gpt-5.4-mini` (confirmado pelo usuário) |
| Modelo de embedding | `text-embedding-3-small` (1536 dim, custo-benefício) |
| Redução do system message | Moderada (~350 palavras), instruções de uso da tool migram para o `description` da própria tool |
| Plano B se vetorial falhar | Documentado: tool `PRODUTOS_SQL` com ilike multi-coluna (sem bug) — não implementado agora |

## Arquitetura

### Antes
```
Chat → Edit Fields → Informações da loja → AI Agent2
                                              ├── OpenAI Chat Model (gpt-5.4-mini)
                                              ├── Postgres Chat Memory
                                              └── PRODUTOS1 (Supabase getAll, ilike, com bug)

Órfãos: AI Agent (sem conexões), Simple Memory1 (ai_memory → [])
```

### Depois — workflow principal (atendimento)
```
Chat → Edit Fields → Informações da loja → AI Agent2 (system message reduzido)
                                              ├── OpenAI Chat Model (gpt-5.4-mini)
                                              ├── Postgres Chat Memory
                                              └── BUSCAR_PRODUTOS (vectorStoreSupabase, retrieve-as-tool)
                                                    └── Embeddings OpenAI (text-embedding-3-small)

Órfãos removidos. Credencial "Supabase NUTRAMIM" do template substituída por "LUE FZ".
```

### Depois — workflow novo de ingestion (separado)
```
Schedule Trigger (15 min) → Supabase: SELECT products
                          → Supabase: SELECT documents (current state)
                          → Code: diff (novos / mudados via content_hash / removidos)
                          → Switch
                              ├─→ Vector Store: insert + Embeddings OpenAI
                              ├─→ Vector Store: update + Embeddings OpenAI
                              └─→ Supabase: delete documents
```

Dois workflows independentes. Falha em um não derruba o outro.

## Schema Postgres

Migration: `supabase/migrations/011_documents_pgvector.sql`

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documents (
  id        BIGSERIAL PRIMARY KEY,
  content   TEXT NOT NULL,
  metadata  JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding VECTOR(1536) NOT NULL
);

CREATE INDEX documents_embedding_idx
  ON documents USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX documents_user_id_idx
  ON documents ((metadata->>'user_id'));

CREATE UNIQUE INDEX documents_product_id_idx
  ON documents ((metadata->>'product_id'));

CREATE OR REPLACE FUNCTION match_documents (
  query_embedding VECTOR(1536),
  match_count     INT DEFAULT 5,
  filter          JSONB DEFAULT '{}'::jsonb
) RETURNS TABLE (
  id        BIGINT,
  content   TEXT,
  metadata  JSONB,
  similarity FLOAT
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    documents.id,
    documents.content,
    documents.metadata,
    1 - (documents.embedding <=> query_embedding) AS similarity
  FROM documents
  WHERE documents.metadata @> filter
  ORDER BY documents.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "documents_select_own" ON documents
  FOR SELECT USING (auth.uid()::text = metadata->>'user_id');

CREATE POLICY "documents_insert_own" ON documents
  FOR INSERT WITH CHECK (auth.uid()::text = metadata->>'user_id');

CREATE POLICY "documents_update_own" ON documents
  FOR UPDATE USING (auth.uid()::text = metadata->>'user_id');

CREATE POLICY "documents_delete_own" ON documents
  FOR DELETE USING (auth.uid()::text = metadata->>'user_id');
```

**Notas:**
- `vector(1536)` casa com `text-embedding-3-small`.
- `ivfflat lists=100` é bom até ~1M rows; migra pra `hnsw` quando passar disso.
- `metadata @> filter` é o operador que o LangChain usa por convenção.
- Index único por `product_id` permite upsert no workflow de ingestion sem duplicar.
- RLS protege o frontend (anon key). O n8n usa service_role e bypassa — ingestion funciona normal.

## Workflow de Ingestion (novo)

Nome: `LUE FZ - Ingestion Vetorial`. Independente do workflow de atendimento.

### Texto a embedar

Code node monta a string assim:
```
{name}. {description}. Categoria: {category}. Cores: {cores}. Tamanhos: {tamanhos}. Marca: {brand}.
```
Campos vazios/null são omitidos (não vira "Marca: null").

### Detecção de mudança

Code node calcula `sha256(text)` e guarda em `metadata.content_hash`. Se hash atual ≠ guardado, re-embed. Sem isso, todo ciclo re-embedaria tudo (custo OpenAI).

### Estrutura do `metadata` em `documents`

```json
{
  "user_id": "c96ad899-bdaf-4ed4-919d-6f596e0f7db8",
  "product_id": "<uuid do produto>",
  "name": "Blusa Manga Longa Canelada",
  "category": "blusa",
  "price": 89.90,
  "cores": ["Preto", "Azul"],
  "tamanhos": ["P", "M", "G"],
  "brand": "LUE",
  "image_url": "https://.../primeira-imagem.jpg",
  "content_hash": "a3f1b9c..."
}
```

`content` é o texto que foi embedado (mesmo texto usado pra calcular o hash). `image_url` é `products.image_urls[0]` (primeira URL do array). `name` está em metadata pra evitar que o agente precise parsear o `content`.

### Batches e limites

- Embeddings OpenAI processa batch nativamente; o node `Supabase Vector Store` aceita arrays.
- Limite seguro por chamada: **100 itens** (evita timeout / rate limit).
- Loop com `SplitInBatches` se houver mais que isso.

### Multi-tenant

Filtro inicial por `user_id` garante que o workflow processa **uma loja por execução**. Quando crescer:
- Parametrizar (sub-workflow chamado por loja), ou
- Workflow por tenant (cresce horizontal), ou
- Migrar para event-driven (ver "Path to scale").

### Backfill inicial

O **mesmo workflow** rodado uma vez manualmente popula `documents` com os produtos existentes. Sem código separado.

### Tratamento de erro

Se Embeddings OpenAI falhar pra um item (rate limit, conteúdo bloqueado), o item fica sem embedding nessa rodada. Próximo ciclo tenta de novo. O workflow não trava.

## Workflow Principal (atendimento) — Mudanças

| Operação | Detalhe |
|---|---|
| Remover | `PRODUTOS1` |
| Remover | `AI Agent` (órfão) |
| Remover | `Simple Memory1` (órfão) |
| Adicionar | `BUSCAR_PRODUTOS` (`@n8n/n8n-nodes-langchain.vectorStoreSupabase`, mode `retrieve-as-tool`) |
| Adicionar | `Embeddings OpenAI` (child do vector store) |
| Conectar | `BUSCAR_PRODUTOS.ai_tool` → `AI Agent2.ai_tool` |
| Conectar | `Embeddings OpenAI.ai_embedding` → `BUSCAR_PRODUTOS.ai_embedding` |
| Configurar | `tableName=documents`, `queryName=match_documents`, `topK=5`, `metadataFilter={"user_id": "{{ $('Informaçoes da loja1').item.json.id }}"}` |
| Substituir credencial | "Supabase NUTRAMIM" → "LUE FZ" |
| Editar | `AI Agent2.systemMessage` (texto novo abaixo) |

### Novo system message (~350 palavras)

```
# Persona
Você é o vendedor virtual da {{ $('Informaçoes da loja1').item.json.store_name }}.
Seja consultivo, claro e direto. Descubra a intenção antes de oferecer.

# Contexto da loja
- Categorias: {{ $('Informaçoes da loja1').item.json.categories }}
- Pagamento: {{ $('Informaçoes da loja1').item.json.payment_methods }}
- Entrega: {{ $('Informaçoes da loja1').item.json.delivery_methods }}
- Instruções da loja: {{ $('Informaçoes da loja1').item.json.service_instructions }}

# Tool disponível
BUSCAR_PRODUTOS — busca semântica no catálogo. Use quando a conversa
envolver disponibilidade, preço, tamanho, cor, recomendação ou
comparação de itens. A tool aceita linguagem natural ("blusa azul P",
"vestido floral", "calça jeans cintura alta") — não precisa normalizar.
Nunca invente produto, preço, tamanho, cor ou estoque: use só o que vier da tool.

# Apresentação de produtos
- Antes da lista, uma frase curta de transição.
- Máximo 3 produtos por mensagem.
- Por produto, mostre: nome, preço (R$), tamanhos, cores, link da imagem.
  Omita campos vazios.
- Se cores ou tamanhos tiverem mais de 6 itens, mostre 5 e diga "e mais".

# Coleta de dados
Outro sistema observa e registra. Você só pede naturalmente, um dado por vez:
- Nome quando a conversa engatar.
- WhatsApp quando o cliente demonstrar interesse real (comprar, reservar).
- Email quando fizer sentido (catálogo, lista de espera).
Não peça tudo junto. Não insista em dado recusado.

# Don'ts
- Não invente nada (produto, preço, prazo, desconto).
- Não use mais de 1 emoji por mensagem.
- Não exponha falha de busca — se a tool não trouxer nada, ofereça as
  categorias da loja e pergunte mais detalhes.
- Não force venda depois de "não" claro.
```

### Tool description (campo `description` de `BUSCAR_PRODUTOS`)

```
Busca semântica no catálogo de produtos da loja. Aceita linguagem
natural: nome do produto, descrição, ocasião de uso, características.

Exemplos de queries que funcionam bem:
- "blusa de manga longa"
- "vestido pra casamento"
- "calça jeans cintura alta tamanho M"
- "produto similar ao tênis branco"

Retorna até 5 produtos. Cada resultado traz no metadata: name, price,
category, cores, tamanhos, brand, image_url. A descrição completa do
produto está no campo content. Se não retornar nada, peça mais detalhes
ao cliente — não diga que falhou.
```

**Por que removi a "REGRA INVIOLÁVEL":** instruções tipo "você DEVE chamar a tool ANTES de responder" geram comportamento rígido — o modelo perde a capacidade de fazer perguntas de discovery ("que cor você prefere?") antes de buscar. A descrição da tool já diz quando usar; confiar no LLM.

## Plano B — Saída de emergência

Se a vetorial não performar (resultados ruins, custo alto, ingestion travando), reverter o workflow principal **sem desfazer migrations**:

1. Substituir `BUSCAR_PRODUTOS` (vector store) por uma tool `PRODUTOS_SQL`:
   ```
   Supabase Tool → operation: getAll
   Table: products
   Filter: user_id = {{ store.id }}
   Filter: name ilike %{{ $fromAI('termo') }}% OR
           description ilike %{{ $fromAI('termo') }}% OR
           category ilike %{{ $fromAI('termo') }}%
   Limit: 5
   ```
   Sem o bug `keyValue:`. Multi-coluna. Já é melhor que hoje.

2. Migration `011` e workflow de ingestion ficam **desativados**, não removidos. Reativar quando quiser tentar de novo.

3. Próximo nível se Plano B também não bastar: trocar ilike multi-coluna por **Postgres full-text** (`tsvector` + `to_tsquery('portuguese', ...)`) — ranking real, leva acentos e plurais em conta, sem custo de embedding.

Este Plano B é **doc, não código** — entra apenas como referência aqui.

## Path to Scale

A escolha atual (workflow agendado a cada 15 min) é "MVP-scale". Sinais de que é hora de migrar pra event-driven (B):

| Sinal | Limite aproximado | Ação |
|---|---|---|
| Ingestion > 5 min por execução | ~5k produtos/loja | Aumentar intervalo ou paralelizar batches |
| Custo OpenAI Embeddings > $50/mês | — | Verificar se `content_hash` está cortando re-embed |
| Lojista reclamando de produto recém-importado não aparecer | Lag de 15 min vira problema | **Migrar para webhook** |
| Catálogo total > 100k | Ivfflat lento | **Migrar index para `hnsw`** (`ALTER INDEX`) |
| Lojas > 50 | Workflow único é gargalo | Workflow por tenant, ou queue + worker pool |

### Migração A → B (event-driven)

- Adicionar **Webhook Trigger** ao workflow de ingestion, em paralelo ao Schedule.
- A rota `src/app/api/inventory/import/route.ts` chama esse webhook depois de inserir/atualizar produtos, passando os IDs alterados.
- O resto do workflow (build text → embed → upsert) **não muda**.
- Schedule pode virar reconciliação 1x/dia.

Migração é só **trocar gatilho**, não reescrever lógica.

## Fora do escopo

- Knowledge RAG (FAQ, políticas) — não há corpus separado.
- Implementação de webhook event-driven — adiada até sinais de escala.
- Implementação do Plano B — é apenas plano de fuga documentado.
- Migração de `ivfflat` → `hnsw` — só se passar de 100k rows.
- Multi-tenant ingestion (parametrizar por loja) — única loja em teste hoje.

## Critérios de sucesso

1. Em uma conversa de teste, mencionar um produto pelo **nome**, **descrição** ou **uso** retorna produtos relevantes (não os 3 sempre iguais).
2. Pedir variação ("a mesma blusa em P") traz produtos semelhantes, não os mesmos.
3. System message tem ≤ 400 palavras renderizadas.
4. Workflow de ingestion roda a cada 15 min, não acumula erro, não re-embedda tudo a cada ciclo.
5. Backfill inicial popula `documents` com 100% dos produtos do `user_id` de teste.
6. Workflow principal (atendimento) executa sem erros visíveis em 5 conversas de teste.
7. Se desativar o workflow de ingestion e adicionar 1 produto, o agente não acha esse produto até reativar.

## Arquivos / artefatos tocados

- `supabase/migrations/011_documents_pgvector.sql` (novo)
- `My workflow 10.json` (workflow principal — editado: nodes removidos, vector store + embeddings adicionados, system message novo, credencial corrigida)
- `LUE FZ - Ingestion Vetorial.json` (workflow novo)
- Credencial Supabase "LUE FZ" (já existe, sem mudança)
- Credencial OpenAI "OpenAi account" (já existe, sem mudança)
