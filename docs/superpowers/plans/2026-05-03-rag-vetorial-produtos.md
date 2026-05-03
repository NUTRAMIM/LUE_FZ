# RAG Vetorial de Produtos + Slim System Message Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a busca de produtos do agente principal (Supabase ilike, com bug) por busca semântica vetorial via Supabase pgvector + node n8n Vector Store, reduzir o system message e limpar nodes órfãos.

**Architecture:** Migration cria tabela `documents` (pgvector) + função `match_documents`. Workflow n8n separado (`LUE FZ - Ingestion Vetorial`) roda a cada 15 min, varre `products` da loja (filtrando por `updated_at`), monta o texto e upserta no `documents` via `Vector Store insert` + `Embeddings OpenAI`. Workflow principal (`My workflow 10`) tem `PRODUTOS1` substituída por `Supabase Vector Store` em modo `retrieve-as-tool`, system message reduzido, nodes órfãos removidos.

**Tech Stack:** Supabase (Postgres + pgvector), n8n (`@n8n/n8n-nodes-langchain.vectorStoreSupabase` v1.3, `@n8n/n8n-nodes-langchain.embeddingsOpenAi` v1.2, Schedule Trigger, Postgres node, Code node), OpenAI (`text-embedding-3-small`, `gpt-5.4-mini`).

**Spec:** `docs/superpowers/specs/2026-05-03-rag-vetorial-produtos-design.md`

**Note on testing:** Não há suite de testes automatizados para n8n workflows neste projeto. Verificação é (a) `mcp__n8n-mcp__validate_node` / `validate_workflow` para cada node/workflow construído, e (b) execução manual via chat do agente. Tasks terminam com checkpoint manual antes do commit.

**Note on n8n MCP:** As tools `mcp__n8n-mcp__n8n_*` (deploy, list, etc.) **não estão disponíveis** nesta sessão (a API do n8n não está conectada ao MCP). O usuário cria/edita os workflows na **UI do n8n** seguindo as instruções. Validação ainda é possível via `mcp__n8n-mcp__validate_workflow` passando o JSON exportado do n8n.

---

## File Structure

| Arquivo / Artefato | Status | Responsabilidade |
|---|---|---|
| `supabase/migrations/011_documents_pgvector.sql` | Create | Tabela `documents` + indexes + `match_documents` + RLS |
| Workflow n8n `LUE FZ - Ingestion Vetorial` | Create | Cron 15min: lê `products` mudados → upsert no `documents` |
| Workflow n8n `My workflow 10` | Modify | Remove `PRODUTOS1` + 2 órfãos. Adiciona Vector Store retrieve-as-tool + Embeddings. Reduz system message. |

---

## Task 1: Migration `011_documents_pgvector.sql`

**Files:**
- Create: `C:/LUE_FZ/supabase/migrations/011_documents_pgvector.sql`

- [ ] **Step 1: Create the migration file**

Create `C:/LUE_FZ/supabase/migrations/011_documents_pgvector.sql` with EXACTLY this content:

```sql
-- pgvector extension (idempotent; available in Supabase by default)
CREATE EXTENSION IF NOT EXISTS vector;

-- Vector documents table (compatible with n8n vectorStoreSupabase node)
CREATE TABLE documents (
  id        BIGSERIAL PRIMARY KEY,
  content   TEXT NOT NULL,
  metadata  JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding VECTOR(1536) NOT NULL
);

-- ANN index for cosine similarity search
CREATE INDEX documents_embedding_idx
  ON documents USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Multi-tenant index for filtering by user_id in metadata
CREATE INDEX documents_user_id_idx
  ON documents ((metadata->>'user_id'));

-- Unique index for upsert by product_id (ingestion idempotency)
CREATE UNIQUE INDEX documents_product_id_idx
  ON documents ((metadata->>'product_id'));

-- Function called by the n8n Supabase Vector Store retrieval node
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

-- RLS (multi-tenant): users only access their own documents
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

- [ ] **Step 2: Apply migration to Supabase**

In Supabase Studio (or `supabase db push` if local CLI is configured):
1. Open SQL Editor.
2. Paste the SQL from Step 1.
3. Click Run.

Expected: all statements succeed without error.

- [ ] **Step 3: Verify schema**

In Supabase Studio SQL Editor, run:

```sql
-- Check extension
SELECT extname FROM pg_extension WHERE extname = 'vector';

-- Check table
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'documents'
ORDER BY ordinal_position;

-- Check function
SELECT proname FROM pg_proc WHERE proname = 'match_documents';

-- Check indexes
SELECT indexname FROM pg_indexes WHERE tablename = 'documents';

-- Check RLS
SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'documents';
```

Expected:
- `vector` extension present.
- 4 columns: `id` (bigint), `content` (text), `metadata` (jsonb), `embedding` (USER-DEFINED).
- `match_documents` function present.
- 4 indexes: `documents_pkey`, `documents_embedding_idx`, `documents_user_id_idx`, `documents_product_id_idx`.
- RLS enabled (`relrowsecurity = true`).

- [ ] **Step 4: Commit**

```bash
git -C C:/LUE_FZ add supabase/migrations/011_documents_pgvector.sql
git -C C:/LUE_FZ commit -m "feat(db): add pgvector documents table for product RAG

Adds documents table, ivfflat index, match_documents function,
unique index by product_id for ingestion upsert, and RLS policies."
```

---

## Task 2: Build Ingestion Workflow in n8n UI

**Artifact:** New workflow `LUE FZ - Ingestion Vetorial` in n8n.

This workflow runs every 15 min, fetches products that changed since last run, and upserts them into `documents`.

- [ ] **Step 1: Create new workflow in n8n**

In n8n UI: New → Workflow. Name it: `LUE FZ - Ingestion Vetorial`.

- [ ] **Step 2: Add Schedule Trigger node**

| Field | Value |
|---|---|
| Node | `Schedule Trigger` (`n8n-nodes-base.scheduleTrigger`) |
| Trigger Interval | Minutes |
| Minutes Between Triggers | `15` |

- [ ] **Step 3: Add Set node "Config"**

| Field | Value |
|---|---|
| Node type | `Set` (`n8n-nodes-base.set`) v3.4 |
| Name | `Config` |
| Mode | Manual Mapping |

Assignments:

| Name | Type | Value |
|---|---|---|
| `store_id` | string | `c96ad899-bdaf-4ed4-919d-6f596e0f7db8` |
| `since_iso` | string | `={{ DateTime.now().minus({ minutes: 16 }).toISO() }}` |

(The 16-minute window has 1 min of overlap to avoid missing products updated right at the boundary.)

Connect: `Schedule Trigger` → `Config`.

- [ ] **Step 4: Add Supabase node "Get Updated Products"**

| Field | Value |
|---|---|
| Node type | `Supabase` (`n8n-nodes-base.supabase`) v1 |
| Name | `Get Updated Products` |
| Credential | `LUE FZ` |
| Operation | `Get All` |
| Table | `products` |
| Filters - Conditions: | (two rows) |
| 1: keyName=`user_id`, condition=`eq`, keyValue=`={{ $('Config').item.json.store_id }}` |
| 2: keyName=`updated_at`, condition=`gt`, keyValue=`={{ $('Config').item.json.since_iso }}` |
| Limit | (leave default, returns up to 1000) |

Connect: `Config` → `Get Updated Products`.

- [ ] **Step 5: Add IF node "Has Updates"**

| Field | Value |
|---|---|
| Node type | `IF` (`n8n-nodes-base.if`) v2.2 |
| Name | `Has Updates` |
| Condition | `{{ $input.all().length }}` greater than `0` (number) |

Connect: `Get Updated Products` → `Has Updates`.

If false branch: end (no updates this cycle).

- [ ] **Step 6: Add Code node "Build Doc Payload"**

| Field | Value |
|---|---|
| Node type | `Code` (`n8n-nodes-base.code`) v2 |
| Name | `Build Doc Payload` |
| Language | JavaScript |
| Mode | Run Once for All Items |

Code:

```javascript
const items = $input.all();

return items.map(item => {
  const p = item.json;

  // Build the text that will be embedded.
  const parts = [];
  if (p.name) parts.push(p.name);
  if (p.description) parts.push(p.description);
  if (p.category) parts.push('Categoria: ' + p.category);
  if (Array.isArray(p.cores) && p.cores.length) {
    parts.push('Cores: ' + p.cores.join(', '));
  }
  if (Array.isArray(p.tamanhos) && p.tamanhos.length) {
    parts.push('Tamanhos: ' + p.tamanhos.join(', '));
  }
  if (p.brand) parts.push('Marca: ' + p.brand);
  const content = parts.join('. ') + '.';

  // Build the metadata that will be stored alongside.
  const metadata = {
    user_id: p.user_id,
    product_id: p.id,
    name: p.name,
    category: p.category || null,
    price: p.price,
    cores: Array.isArray(p.cores) ? p.cores : [],
    tamanhos: Array.isArray(p.tamanhos) ? p.tamanhos : [],
    brand: p.brand || null,
    image_url: (Array.isArray(p.image_urls) && p.image_urls[0]) || null,
  };

  return { json: { content, metadata } };
});
```

Connect: `Has Updates` (true branch) → `Build Doc Payload`.

- [ ] **Step 7: Add Postgres node "Delete Existing Doc"**

| Field | Value |
|---|---|
| Node type | `Postgres` (`n8n-nodes-base.postgres`) v2.6 |
| Name | `Delete Existing Doc` |
| Credential | `Postgres account 2` (same one used by Postgres Chat Memory) |
| Operation | Execute Query |
| Query | (see below) |

Query (using parameter binding, `$1` = JSON-quoted product_id):

```sql
DELETE FROM documents
WHERE metadata->>'user_id'    = $1
  AND metadata->>'product_id' = $2;
```

Query Parameters (in order):
1. `={{ $json.metadata.user_id }}`
2. `={{ $json.metadata.product_id }}`

Connect: `Build Doc Payload` → `Delete Existing Doc`.

- [ ] **Step 8: Add Vector Store node "Insert Doc"**

| Field | Value |
|---|---|
| Node type | `Supabase Vector Store` (`@n8n/n8n-nodes-langchain.vectorStoreSupabase`) v1.3 |
| Name | `Insert Doc` |
| Credential | `LUE FZ` |
| Operation Mode | `Insert Documents` |
| Table Name | resourceLocator: mode=`id`, value=`documents` |
| Options → queryName | `match_documents` |

Connect: `Delete Existing Doc` (main output) → `Insert Doc`.

- [ ] **Step 9: Add Embeddings OpenAI node "Embeddings"**

| Field | Value |
|---|---|
| Node type | `Embeddings OpenAI` (`@n8n/n8n-nodes-langchain.embeddingsOpenAi`) v1.2 |
| Name | `Embeddings` |
| Credential | `OpenAi account` (same one used by main workflow) |
| Model | `text-embedding-3-small` (default) |
| Options → Dimensions | `1536` (default) |

Connect: `Embeddings.ai_embedding` → `Insert Doc.ai_embedding`.

- [ ] **Step 10: Add Default Data Loader node "Loader"**

The Vector Store insert mode requires an `ai_document` source. n8n provides `Default Data Loader` for this.

| Field | Value |
|---|---|
| Node type | `Default Data Loader` (`@n8n/n8n-nodes-langchain.documentDefaultDataLoader`) |
| Name | `Loader` |
| Type of Data | JSON |
| Mode | Load All Input Data |
| JSON Data Field | `content` |
| Options → Metadata → Add Field | (add 9 entries — one per metadata key) |

Metadata fields (each as `Set Manually`):

| Name | Value |
|---|---|
| `user_id` | `={{ $json.metadata.user_id }}` |
| `product_id` | `={{ $json.metadata.product_id }}` |
| `name` | `={{ $json.metadata.name }}` |
| `category` | `={{ $json.metadata.category }}` |
| `price` | `={{ $json.metadata.price }}` |
| `cores` | `={{ $json.metadata.cores }}` |
| `tamanhos` | `={{ $json.metadata.tamanhos }}` |
| `brand` | `={{ $json.metadata.brand }}` |
| `image_url` | `={{ $json.metadata.image_url }}` |

Connect: `Loader.ai_document` → `Insert Doc.ai_document`.

- [ ] **Step 11: Validate the workflow via MCP**

Export the workflow JSON from n8n (Workflow menu → Download). Then in this session run:

```
mcp__n8n-mcp__validate_workflow with the exported JSON
```

Expected: `valid: true`, no errors. Warnings about typeVersion or unused params are acceptable.

If errors: fix the corresponding node config in n8n UI and re-export → re-validate.

- [ ] **Step 12: Save and DO NOT activate yet**

Save the workflow. Leave it inactive. Activation happens in Task 5 after the backfill (Task 3).

---

## Task 3: Backfill — populate documents for all existing products

**Artifact:** One-time manual run of the ingestion workflow with the date filter relaxed.

- [ ] **Step 1: Temporarily relax the `since_iso` filter**

In n8n UI, open the `Config` Set node from the ingestion workflow. Change the `since_iso` assignment value from:

```
={{ DateTime.now().minus({ minutes: 16 }).toISO() }}
```

to:

```
2000-01-01T00:00:00Z
```

This pulls **all** products (since their `updated_at` is after year 2000).

- [ ] **Step 2: Execute the workflow once manually**

In n8n UI: click `Execute Workflow` (top-right). Wait for completion.

Watch the execution view: each node should turn green. The `Get Updated Products` node should show all products of the loja. The `Insert Doc` node should show one item per product.

- [ ] **Step 3: Verify documents count matches products count**

In Supabase Studio SQL Editor:

```sql
SELECT
  (SELECT COUNT(*) FROM products WHERE user_id = 'c96ad899-bdaf-4ed4-919d-6f596e0f7db8')
    AS products_count,
  (SELECT COUNT(*) FROM documents WHERE metadata->>'user_id' = 'c96ad899-bdaf-4ed4-919d-6f596e0f7db8')
    AS documents_count;
```

Expected: `products_count = documents_count`. If documents > products, the unique index by product_id was violated and there's a duplicate (re-run won't duplicate; check if the test added rows). If documents < products, an item failed to embed — inspect the n8n execution log for errors.

- [ ] **Step 4: Restore the original `since_iso` filter**

Change the `Config.since_iso` value back to:

```
={{ DateTime.now().minus({ minutes: 16 }).toISO() }}
```

Save the workflow.

- [ ] **Step 5: No commit needed for this task**

Task 3 produces no file changes. Move on.

---

## Task 4: Edit Main Workflow `My workflow 10`

**Artifact:** Edit existing workflow in n8n UI.

- [ ] **Step 1: Remove orphan nodes**

In n8n UI, open `My workflow 10`. Delete these two nodes (they have no useful connections):
- `AI Agent` (the one at position [2768, -1472], no connections)
- `Simple Memory1` (its `ai_memory` output points to an empty array)

- [ ] **Step 2: Remove `PRODUTOS1`**

Delete the `PRODUTOS1` node (`n8n-nodes-base.supabaseTool`). The connection `PRODUTOS1.ai_tool → AI Agent2.ai_tool` is removed automatically.

- [ ] **Step 3: Add `Supabase Vector Store` node**

| Field | Value |
|---|---|
| Node type | `Supabase Vector Store` (`@n8n/n8n-nodes-langchain.vectorStoreSupabase`) v1.3 |
| Name | `BUSCAR_PRODUTOS` |
| Credential | `LUE FZ` ⚠️ NOT "Supabase NUTRAMIM" |
| Operation Mode | `Retrieve Documents (As Tool for AI Agent)` |
| Tool Description | (see Step 6 below — the LLM reads this) |
| Table Name | resourceLocator: mode=`id`, value=`documents` |
| Limit (topK) | `5` |
| Options → Metadata Filter → metadataValues | (add 1 entry below) |

Metadata filter entry:

| Name | Value |
|---|---|
| `user_id` | `={{ $('Informaçoes da loja1').item.json.id }}` |

Position: `[3232, -816]` (or anywhere reasonable; visual only).

- [ ] **Step 4: Add `Embeddings OpenAI` node**

| Field | Value |
|---|---|
| Node type | `Embeddings OpenAI` (`@n8n/n8n-nodes-langchain.embeddingsOpenAi`) v1.2 |
| Name | `Embeddings OpenAI2` |
| Credential | `OpenAi account` |
| Model | `text-embedding-3-small` |
| Options → Dimensions | `1536` |

Position: `[3312, -592]`.

- [ ] **Step 5: Wire connections**

In the n8n UI:
1. Connect `Embeddings OpenAI2.ai_embedding` → `BUSCAR_PRODUTOS.ai_embedding`.
2. Connect `BUSCAR_PRODUTOS.ai_tool` → `AI Agent2.ai_tool`.

The `AI Agent2` should now have these AI sub-nodes connected:
- `OpenAI Chat Model2` (ai_languageModel) — already there
- `Postgres Chat Memory` (ai_memory) — already there
- `BUSCAR_PRODUTOS` (ai_tool) — new

- [ ] **Step 6: Set the tool description on `BUSCAR_PRODUTOS`**

Open `BUSCAR_PRODUTOS` → field **Tool Description**. Paste:

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

- [ ] **Step 7: Replace the system message of `AI Agent2`**

Open `AI Agent2` → Options → Override System Message. Replace the entire current text (the long one with "REGRA INVIOLÁVEL") with EXACTLY this:

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

- [ ] **Step 8: Validate the modified workflow via MCP**

Export the workflow JSON from n8n (Workflow menu → Download). Run:

```
mcp__n8n-mcp__validate_workflow with the exported JSON
```

Expected: `valid: true`. Address any errors before proceeding.

- [ ] **Step 9: Save the workflow**

Save (Ctrl+S). Leave it active (it was already active).

- [ ] **Step 10: No file commit needed**

Task 4 modifies n8n state, not files in this repo. Move on.

---

## Task 5: End-to-end manual verification

**Artifact:** Conversational tests via the n8n chat interface.

- [ ] **Step 1: Activate the ingestion workflow**

In n8n UI, open `LUE FZ - Ingestion Vetorial` and toggle Active = ON.

- [ ] **Step 2: Verify the chat trigger URL of the main workflow**

In n8n UI, open `My workflow 10` → `When chat message received` → copy the public Chat URL. Open it in a browser.

- [ ] **Step 3: Test 1 — semantic match by name**

Type: `tem blusinha?`

Expected:
- Agent calls `BUSCAR_PRODUTOS` once with something like "blusinha" or "blusa".
- Agent shows 1-3 products that semantically match "blusa" / "camiseta" / "top" — not always the same ones.
- Format: name, price, sizes, colors, image URL — campos vazios omitidos.

If agent returns the same 3 products as before this implementation, the vector search isn't being used — re-check Task 4 Step 5.

- [ ] **Step 4: Test 2 — semantic match by use case**

Type: `quero algo pra casamento`

Expected:
- Agent calls `BUSCAR_PRODUTOS` with "vestido casamento" or "vestido festa".
- Returns vestidos / festa-related products (semantic match — not exact word).

- [ ] **Step 5: Test 3 — discovery before search**

Type: `oi, vocês têm o que de roupa de inverno?`

Expected:
- Agent may ask a follow-up before calling the tool ("você prefere blusa, casaco, ou cardigan?").
- This was IMPOSSIBLE before because the system message had `REGRA INVIOLÁVEL: chame a tool ANTES de responder`. The slim message restores discovery behavior.

(If the agent jumps straight to a generic search, that's also acceptable — just verify it's not robotic.)

- [ ] **Step 6: Test 4 — negative path (tool returns nothing)**

Type a query that no product will match: `tem fralda descartável?`

Expected:
- Agent calls `BUSCAR_PRODUTOS`.
- Tool returns empty.
- Agent does NOT say "não encontrei". Per the Don'ts, it pivots: lists store categories or asks for more details.

- [ ] **Step 7: Test 5 — data collection cadence**

Have a longer conversation (3-4 turns) to confirm the agent asks for `nome` only after engagement, not in turn 1.

Expected:
- Turn 1: agent doesn't ask for any personal data.
- Turn 3+ (when conversation has substance): agent might ask "qual seu nome?".
- Agent never asks for nome+whatsapp+email in one message.

- [ ] **Step 8: Test 6 — ingestion picks up a new product**

In the LUE FZ web app or directly in Supabase Studio, INSERT a test product:

```sql
INSERT INTO products (user_id, sku, name, description, price, currency, category, cores, tamanhos)
VALUES (
  'c96ad899-bdaf-4ed4-919d-6f596e0f7db8',
  'TEST-RAG-001',
  'Camiseta de Teste RAG',
  'Camiseta de teste pra validar o pipeline vetorial. Cor neutra, algodão.',
  49.90,
  'BRL',
  'camiseta',
  '{"Branco","Preto"}',
  '{"P","M","G"}'
);
```

Wait up to 16 minutes (or click "Execute Workflow" on the ingestion workflow to trigger immediately).

Then in the chat:

Type: `tem alguma camiseta de teste?`

Expected: agent finds and returns "Camiseta de Teste RAG" (proves the cycle: insert → ingestion → vector → retrieval).

Cleanup:
```sql
DELETE FROM products WHERE sku = 'TEST-RAG-001';
```

(In the next ingestion cycle, the corresponding `documents` row will become orphan — manual cleanup is OUT OF SCOPE for this MVP. Document this as a known limitation; see "Path to scale" in the spec.)

- [ ] **Step 9: Test 7 — ingestion does not re-embed unchanged products**

Right after a successful ingestion run, check the next scheduled run's execution.

Expected: `Get Updated Products` returns 0 items (because no products had `updated_at` in the last 16 minutes), the workflow short-circuits at `Has Updates` IF, and no embeddings calls are made.

To verify: in n8n Executions list, click the most recent run → check that `Has Updates` IF went to the false branch and `Insert Doc` was NOT executed.

- [ ] **Step 10: No commit needed**

Task 5 produces no file changes.

---

## Self-Review Checklist (already run)

- [x] **Spec coverage:**
  - Schema (Task 1) ✓
  - Architecture before/after (Task 4 Steps 1-5) ✓
  - Ingestion workflow (Task 2) ✓
  - System message rewrite (Task 4 Step 7) ✓
  - Tool description (Task 4 Step 6) ✓
  - Backfill (Task 3) ✓
  - Acceptance criteria 1-7 (Task 5 Steps 3-9) ✓
  - Plano B / Path to scale — documented in spec, not implemented (intentional) ✓
- [x] **Placeholder scan:** No TBDs/TODOs. Each step has full code, full SQL, full UI instructions, or an exact MCP tool call.
- [x] **Type consistency:**
  - `documents` table schema (Task 1) matches metadata structure used in Code node (Task 2 Step 6) ✓
  - `match_documents` signature (Task 1) matches what `BUSCAR_PRODUTOS` expects (Task 4 Step 3) ✓
  - `metadata.user_id` is the same field used in: `documents_user_id_idx` (Task 1), Code node output (Task 2 Step 6), retrieval filter (Task 4 Step 3 Metadata Filter) ✓
  - `text-embedding-3-small` + `dimensions=1536` consistent across both Embeddings nodes ✓
