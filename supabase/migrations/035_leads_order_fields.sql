-- 035_leads_order_fields.sql
-- O agente registra o pedido do cliente (itens), a forma de pagamento e a
-- forma de entrega na ficha do lead. Idempotente: seguro re-rodar.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS pedido          JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS forma_pagamento TEXT,
  ADD COLUMN IF NOT EXISTS forma_entrega   TEXT;
