-- 016_match_documents_category_filter.sql
-- Estende `match_documents` (015) com filtro case-insensitive opcional por
-- categoria. O agente do n8n passa `category` no filter JSONB via $fromAI() —
-- assim a busca semântica só considera produtos da categoria certa, em vez de
-- precisar filtrar no prompt depois.
--
-- Comportamento:
--   * filter sem `category` (ou category=null/'')        → sem filtro de categoria
--   * filter com category='Top'                          → metadata->>'category' ILIKE 'Top'
--   * outros campos do filter (ex: user_id) continuam estritos (operador @>)

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
DECLARE
  strict_filter   JSONB;
  category_filter TEXT;
BEGIN
  -- Separa `category` (matching case-insensitive) do resto (matching estrito).
  strict_filter   := filter - 'category';
  category_filter := NULLIF(filter->>'category', '');

  RETURN QUERY
  SELECT
    documents.id,
    documents.content,
    documents.metadata,
    1 - (documents.embedding <=> query_embedding) AS similarity
  FROM documents
  WHERE documents.metadata @> strict_filter
    AND (
      category_filter IS NULL
      OR LOWER(documents.metadata->>'category') = LOWER(category_filter)
    )
    AND (1 - (documents.embedding <=> query_embedding)) > match_threshold
  ORDER BY documents.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
