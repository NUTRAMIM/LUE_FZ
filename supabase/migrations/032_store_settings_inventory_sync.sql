-- Campos para auto-sync periódico do catálogo (URL salva + telemetria)
ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS inventory_source_url     TEXT,
  ADD COLUMN IF NOT EXISTS inventory_last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inventory_last_error     TEXT;
