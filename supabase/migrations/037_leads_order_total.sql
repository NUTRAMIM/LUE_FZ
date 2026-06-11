-- 037_leads_order_total.sql
-- Valor total do pedido (soma de preço × qtd das peças), calculado no código do
-- agente e gravado na ficha do lead. Idempotente: seguro re-rodar.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS valor_total NUMERIC(10, 2);
