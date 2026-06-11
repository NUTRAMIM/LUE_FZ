-- 038_leads_reseller.sql
-- Atacado: marca o lead como revendedor e guarda o carro-chefe dele.
-- Idempotente: seguro reaplicar.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS tipo_cliente TEXT NOT NULL DEFAULT 'varejo',
  ADD COLUMN IF NOT EXISTS carro_chefe  TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leads_tipo_cliente_valid'
      AND conrelid = 'leads'::regclass
  ) THEN
    ALTER TABLE leads
      ADD CONSTRAINT leads_tipo_cliente_valid
      CHECK (tipo_cliente IN ('varejo','revendedor'));
  END IF;
END $$;
