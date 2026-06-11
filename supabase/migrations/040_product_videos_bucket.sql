-- 040_product_videos_bucket.sql
-- Bucket publico para videos de produtos. Leitura publica (front consome por
-- URL direta). Escrita/update/delete restritos ao dono via primeiro segmento
-- do path (<user_id>/<uuid>.ext). Limite 20 MB.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-videos',
  'product-videos',
  true,
  20971520,
  ARRAY['video/mp4','video/webm','video/quicktime']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "product_videos_select_public" ON storage.objects;
DROP POLICY IF EXISTS "product_videos_insert_own"    ON storage.objects;
DROP POLICY IF EXISTS "product_videos_update_own"    ON storage.objects;
DROP POLICY IF EXISTS "product_videos_delete_own"    ON storage.objects;

CREATE POLICY "product_videos_select_public" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'product-videos');

CREATE POLICY "product_videos_insert_own" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'product-videos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "product_videos_update_own" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'product-videos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "product_videos_delete_own" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'product-videos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
