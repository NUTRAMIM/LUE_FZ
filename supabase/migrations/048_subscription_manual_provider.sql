-- 048_subscription_manual_provider.sql
-- Permite provider 'manual' em store_subscriptions: acesso "comp" concedido
-- pelo super-admin no painel, sem provedor de pagamento (Stripe/MP).
ALTER TABLE store_subscriptions DROP CONSTRAINT IF EXISTS store_subscriptions_provider_check;
ALTER TABLE store_subscriptions ADD CONSTRAINT store_subscriptions_provider_check
  CHECK (provider IN ('stripe', 'mercadopago', 'manual'));
