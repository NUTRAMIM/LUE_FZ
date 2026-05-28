-- 033_store_settings_faq_discount.sql
-- FAQ (perguntas e respostas) + desconto de atacado em store_settings.
-- Idempotente: seguro re-rodar após aplicação parcial.

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS faq             JSONB         NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS discount_type   TEXT,
  ADD COLUMN IF NOT EXISTS discount_value  NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS discount_custom TEXT;

DO $$
BEGIN
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
