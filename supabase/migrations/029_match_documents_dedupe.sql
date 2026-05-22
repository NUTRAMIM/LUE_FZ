-- 029_match_documents_dedupe.sql
-- O text splitter da indexação quebrou descrições longas (listas de cores,
-- tamanhos) em múltiplos chunks por produto. Cada chunk virou um documento
-- separado em `documents`, todos apontando para o mesmo produto. A busca
-- semântica retornava `match_count` "documentos diferentes" que na prática
-- eram só 1-2 produtos únicos repetidos.
--
-- Esta migration redefine `match_documents` aplicando DISTINCT ON pelo nome
-- do produto (case-insensitive). Cada produto agora aparece no máximo uma
-- vez por chamada, e a similaridade reportada é a do chunk MAIS PRÓXIMO
-- daquele produto ao embedding da query.
--
-- Por que dedup por `name` e não por `product_id`:
-- foi observado que o mesmo produto aparece em `documents` com `product_id`
-- diferentes (re-indexação criou linhas novas). O nome é mais estável.

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
