-- 039_products_video_url.sql
-- URL única de vídeo por produto. Aparece como último slide do carrossel no chat.
ALTER TABLE products ADD COLUMN IF NOT EXISTS video_url text;
