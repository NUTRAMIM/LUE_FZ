-- 035_match_documents_compact_cores.sql
-- O catálogo da Facilzap vem como combinações cor+tamanho, então um único
-- produto tem ~200 cores distintas mesmo após o dedup do parser (cada par
-- bicolor é uma variante real). O `BUSCAR_PRODUTOS` do chat-agent puxa topK
-- documentos e cada um volta com a lista inteira DUAS vezes: no `content`
-- (trecho "Cores: a, b, c...") e no `metadata.cores` (array). Isso despeja
-- milhares de strings de cor no contexto do LLM a cada busca.
--
-- Esta migration resume as cores APENAS no retorno de `match_documents`:
--   - `content`: troca a lista por uma amostra + contagem
--     ("Cores: a, b, c (+196 de 204)").
--   - `metadata.cores`: corta para as primeiras N e adiciona `cores_total`.
--
-- Não toca no que está gravado (lista completa continua em `documents` e
-- `products`) nem no vetor de similaridade (usa `documents.embedding`, intacto)
-- -> qualidade da busca não muda e não precisa re-ingerir nada. O workflow de
-- ingestion externo continua igual.
--
-- Preserva o DISTINCT ON por nome (migration 029) e o filtro de categoria +
-- threshold (migration 016).

-- Amostra + contagem dentro do texto livre do `content`.
CREATE OR REPLACE FUNCTION compact_cores_content(
  content TEXT,
  meta    JSONB,
  keep    INT DEFAULT 8
) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN content IS NULL
      OR jsonb_typeof(meta->'cores') <> 'array'
      OR jsonb_array_length(meta->'cores') <= keep
    THEN content
    ELSE regexp_replace(
      content,
      'Cores: [^.]*',
      'Cores: '
        || (SELECT string_agg(elem #>> '{}', ', ' ORDER BY ord)
              FROM jsonb_array_elements(meta->'cores')
                   WITH ORDINALITY AS t(elem, ord)
             WHERE ord <= keep)
        || ' (+' || (jsonb_array_length(meta->'cores') - keep)
        || ' de ' || jsonb_array_length(meta->'cores') || ')'
    )
  END;
$$;

-- Corta `metadata.cores` para as primeiras N e registra o total real.
CREATE OR REPLACE FUNCTION compact_cores_metadata(
  meta JSONB,
  keep INT DEFAULT 8
) RETURNS JSONB LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(meta->'cores') <> 'array'
      OR jsonb_array_length(meta->'cores') <= keep
    THEN meta
    ELSE meta
      || jsonb_build_object('cores_total', jsonb_array_length(meta->'cores'))
      || jsonb_build_object('cores', (
           SELECT jsonb_agg(elem ORDER BY ord)
             FROM jsonb_array_elements(meta->'cores')
                  WITH ORDINALITY AS t(elem, ord)
            WHERE ord <= keep
         ))
  END;
$$;

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
    compact_cores_content(deduped.content, deduped.metadata, 8) AS content,
    compact_cores_metadata(deduped.metadata, 8)                 AS metadata,
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
