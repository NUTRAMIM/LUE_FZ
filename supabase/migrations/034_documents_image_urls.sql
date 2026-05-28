-- 034_documents_image_urls.sql
-- O índice vetorial (tabela `documents`) guardava só UMA imagem por produto no
-- metadata (`image_url`, singular), enquanto a tabela `products` tem o array
-- completo (`image_urls`, até 3 fotos). O agente de chat lê o metadata e por
-- isso só conseguia enviar 1 foto por produto.
--
-- Esta migration corrige a indexação:
--   1. Função + trigger que, ao inserir/atualizar um documento, copia o array
--      `image_urls` do produto correspondente para o metadata. Assim, mesmo
--      quando a indexação externa recriar os documentos, o array é preenchido.
--   2. Backfill dos documentos já existentes.
--
-- Casamento documento -> produto por LOWER(name) + user_id. Decisão herdada da
-- migration 029: `product_id` no metadata é instável entre reindexações (casa
-- ~35%), enquanto name+user_id casa ~95%.
--
-- Idempotente: seguro re-rodar.

CREATE OR REPLACE FUNCTION documents_attach_image_urls()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  imgs jsonb;
BEGIN
  IF NEW.metadata ? 'name' AND NEW.metadata ? 'user_id' THEN
    SELECT to_jsonb(p.image_urls)
      INTO imgs
      FROM products p
     WHERE lower(p.name) = lower(NEW.metadata->>'name')
       AND p.user_id::text = NEW.metadata->>'user_id'
       AND p.image_urls IS NOT NULL
       AND array_length(p.image_urls, 1) > 0
     LIMIT 1;

    IF imgs IS NOT NULL THEN
      NEW.metadata := NEW.metadata || jsonb_build_object('image_urls', imgs);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_documents_attach_image_urls ON documents;
CREATE TRIGGER trg_documents_attach_image_urls
  BEFORE INSERT OR UPDATE OF metadata ON documents
  FOR EACH ROW
  EXECUTE FUNCTION documents_attach_image_urls();

-- Backfill dos documentos já indexados.
UPDATE documents d
   SET metadata = d.metadata || jsonb_build_object('image_urls', to_jsonb(p.image_urls))
  FROM products p
 WHERE lower(p.name) = lower(d.metadata->>'name')
   AND p.user_id::text = d.metadata->>'user_id'
   AND p.image_urls IS NOT NULL
   AND array_length(p.image_urls, 1) > 0;
