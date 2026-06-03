-- 036_revert_match_documents_compact_cores.sql
-- Reverte a 035: restaura `match_documents` exatamente como na 029 (DISTINCT ON
-- por nome + filtro de categoria + threshold, devolvendo content/metadata
-- intactos) e remove as funções auxiliares de resumo de cores.

-- Restaura a função sem o corte de cores (idêntica à 029).
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
  strict_filter   := filter - 'category';
  category_filter := NULLIF(filter->>'category', '');

  RETURN QUERY
  SELECT
    deduped.id,
    deduped.content,
    deduped.metadata,
    deduped.similarity
  FROM (
    SELECT DISTINCT ON (LOWER(documents.metadata->>'name'))
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
    ORDER BY
      LOWER(documents.metadata->>'name'),
      documents.embedding <=> query_embedding
  ) deduped
  ORDER BY deduped.similarity DESC
  LIMIT match_count;
END;
$$;

-- Remove as auxiliares criadas pela 035.
DROP FUNCTION IF EXISTS compact_cores_content(TEXT, JSONB, INT);
DROP FUNCTION IF EXISTS compact_cores_metadata(JSONB, INT);
