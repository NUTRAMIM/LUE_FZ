-- 015_match_documents_threshold.sql
-- Reescreve `match_documents` adicionando filtro por similaridade mínima.
-- Sem threshold, a função retorna sempre os topK mais próximos — mesmo que a
-- similaridade real seja baixa. Resultado: pedir "tops" e receber "jaqueta"
-- porque jaqueta é o mais próximo entre roupas no catálogo.
--
-- A função recria a tabela `documents` idempotentemente caso a migration
-- original (011) não tenha sido aplicada na instância.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  id        BIGSERIAL PRIMARY KEY,
  content   TEXT NOT NULL,
  metadata  JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding VECTOR(1536) NOT NULL
);

CREATE INDEX IF NOT EXISTS documents_embedding_idx
  ON documents USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS documents_user_id_idx
  ON documents ((metadata->>'user_id'));

CREATE UNIQUE INDEX IF NOT EXISTS documents_product_id_idx
  ON documents ((metadata->>'product_id'));

-- Drop e recria pra suportar a nova assinatura (com match_threshold).
DROP FUNCTION IF EXISTS match_documents(VECTOR, INT, JSONB);
DROP FUNCTION IF EXISTS match_documents(VECTOR, INT, JSONB, FLOAT);

CREATE OR REPLACE FUNCTION match_documents (
  query_embedding VECTOR(1536),
  match_count     INT     DEFAULT 5,
  filter          JSONB   DEFAULT '{}'::jsonb,
  match_threshold FLOAT   DEFAULT 0.3
) RETURNS TABLE (
  id         BIGINT,
  content    TEXT,
  metadata   JSONB,
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
    AND (1 - (documents.embedding <=> query_embedding)) > match_threshold
  ORDER BY documents.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
