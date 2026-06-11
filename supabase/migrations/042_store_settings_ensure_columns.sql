-- 042_store_settings_ensure_columns.sql
-- Garante TODAS as colunas que saveStoreSettings() grava em store_settings.
-- Conserta drift de schema em produção (migração aplicada manualmente foi pulada),
-- que fazia o upsert falhar com "Erro ao salvar configurações".
-- Idempotente: seguro re-rodar (tudo IF NOT EXISTS / constraints guardadas).

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS service_steps        TEXT[]        DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS service_instructions TEXT          DEFAULT '',
  ADD COLUMN IF NOT EXISTS payment_methods      TEXT[]        DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS delivery_methods     TEXT[]        DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS categories           TEXT[]        DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS seller_phone         TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS instagram_handle     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS store_bio            TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS logo_url             TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS min_order_enabled    BOOLEAN       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_order_quantity   INTEGER,
  ADD COLUMN IF NOT EXISTS min_order_value      NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS min_order_logic      TEXT          NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS faq                  JSONB         NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS discount_type        TEXT,
  ADD COLUMN IF NOT EXISTS discount_value       NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS discount_custom      TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'min_order_logic_valid'
      AND conrelid = 'store_settings'::regclass
  ) THEN
    ALTER TABLE store_settings
      ADD CONSTRAINT min_order_logic_valid
      CHECK (min_order_logic IN ('all','any'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'discount_type_valid'
      AND conrelid = 'store_settings'::regclass
  ) THEN
    ALTER TABLE store_settings
      ADD CONSTRAINT discount_type_valid
      CHECK (
        discount_type IS NULL OR
        discount_type IN ('percent_piece','percent_order','fixed_piece','custom')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'discount_value_non_negative'
      AND conrelid = 'store_settings'::regclass
  ) THEN
    ALTER TABLE store_settings
      ADD CONSTRAINT discount_value_non_negative
      CHECK (discount_value IS NULL OR discount_value >= 0);
  END IF;
END $$;
