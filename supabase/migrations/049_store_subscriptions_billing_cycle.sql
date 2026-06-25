-- 049_store_subscriptions_billing_cycle.sql
-- Adiciona o ciclo de cobrança (mensal/trimestral) à assinatura. Necessário
-- para o webhook do MP saber por quantos dias liberar (30 vs 90) e para a UI
-- mostrar/alternar o ciclo. NULL = legado/desconhecido (tratado como mensal).

ALTER TABLE store_subscriptions
  ADD COLUMN IF NOT EXISTS billing_cycle TEXT
  CHECK (billing_cycle IN ('monthly', 'quarterly'));
