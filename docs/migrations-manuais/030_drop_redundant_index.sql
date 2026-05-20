-- F1.6 — drop de índice redundante em products.
-- APLICAR MANUALMENTE no Supabase Dashboard > SQL Editor.
--
-- Motivo: a migration 007 substituiu UNIQUE(sku) por UNIQUE(user_id, sku).
-- O índice `idx_products_sku` (criado em 001) ficou redundante — toda query
-- que filtra por SKU também filtra por user_id (cf. inventory/import upsert
-- com onConflict: 'user_id,sku', e o lookup em route.ts antes do upsert).
--
-- DROP INDEX em índice secundário (não-UNIQUE, não-PK) só pega lock ACCESS
-- EXCLUSIVE por tempo muito curto. Mesmo assim, prefira janela de baixa carga.

DROP INDEX IF EXISTS idx_products_sku;
