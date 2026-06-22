-- 049_leads_order_discount_fields.sql
-- Rastreabilidade do desconto de atacado no pedido do lead.
-- valor_total passa a guardar o LÍQUIDO (com desconto). valor_bruto guarda a
-- soma preço×qtd sem desconto; desconto_aplicado = valor_bruto - valor_total.
-- Idempotente: seguro re-rodar.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS valor_bruto       NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS desconto_aplicado NUMERIC(10, 2);
