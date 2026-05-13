-- 010_store_settings_min_order.sql
-- Wholesale minimum order: columns + check constraints.
-- Idempotent: safe to re-run after partial application.

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS min_order_enabled  BOOLEAN       NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_order_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS min_order_value    NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS min_order_logic    TEXT          NOT NULL DEFAULT 'all';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'min_order_quantity_positive'
      AND conrelid = 'store_settings'::regclass
  ) THEN
    ALTER TABLE store_settings
      ADD CONSTRAINT min_order_quantity_positive
      CHECK (min_order_quantity IS NULL OR min_order_quantity >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'min_order_value_non_negative'
      AND conrelid = 'store_settings'::regclass
  ) THEN
    ALTER TABLE store_settings
      ADD CONSTRAINT min_order_value_non_negative
      CHECK (min_order_value IS NULL OR min_order_value >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'min_order_logic_valid'
      AND conrelid = 'store_settings'::regclass
  ) THEN
    ALTER TABLE store_settings
      ADD CONSTRAINT min_order_logic_valid
      CHECK (min_order_logic IN ('all','any'));
  END IF;
END $$;
