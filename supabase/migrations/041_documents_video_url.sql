-- 041_documents_video_url.sql
-- Estende a logica da 034: alem de image_urls, copia tambem video_url do
-- produto casado (por lower(name)+user_id) para o metadata do documento, para
-- que o BUSCAR_PRODUTOS consiga enviar o video no carrossel.
-- Idempotente: seguro re-rodar.

CREATE OR REPLACE FUNCTION documents_attach_image_urls()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  imgs jsonb;
  vid  text;
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

    SELECT p.video_url
      INTO vid
      FROM products p
     WHERE lower(p.name) = lower(NEW.metadata->>'name')
       AND p.user_id::text = NEW.metadata->>'user_id'
       AND p.video_url IS NOT NULL
     LIMIT 1;

    IF imgs IS NOT NULL THEN
      NEW.metadata := NEW.metadata || jsonb_build_object('image_urls', imgs);
    END IF;
    IF vid IS NOT NULL THEN
      NEW.metadata := NEW.metadata || jsonb_build_object('video_url', to_jsonb(vid));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- O trigger ja existe desde a 034 (trg_documents_attach_image_urls).
-- CREATE OR REPLACE FUNCTION acima atualiza a funcao in-place sem recriar o trigger.

-- Backfill do video_url nos documentos existentes (image_urls nao e refeito aqui pois
-- a 034 ja o preencheu; este UPDATE e seguro re-rodar pois so escreve video_url).
UPDATE documents d
   SET metadata = d.metadata || jsonb_build_object('video_url', to_jsonb(p.video_url))
  FROM products p
 WHERE lower(p.name) = lower(d.metadata->>'name')
   AND p.user_id::text = d.metadata->>'user_id'
   AND p.video_url IS NOT NULL;
