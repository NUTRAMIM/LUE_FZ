-- 017_products_stock_min.sql
-- Adiciona estoque mínimo por produto e default global da loja.
-- stock_min = 0 significa "usar default da loja".

ALTER TABLE products
  ADD COLUMN stock_min int NOT NULL DEFAULT 0;

ALTER TABLE store_settings
  ADD COLUMN default_stock_min int NOT NULL DEFAULT 5;
