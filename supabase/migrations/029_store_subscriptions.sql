-- 029_store_subscriptions.sql
-- Assinaturas da loja (planos pagos). Uma linha por store_id (UNIQUE).
-- Suporta dois providers: Stripe (cartão, recorrente) e Mercado Pago (Pix
-- one-shot, ativa 30 dias). Consumida pelas Server Actions de billing e pelo
-- middleware para gating de rotas protegidas (/painel, /estoque, /loja,
-- /conversas).
--
-- Escrita acontece SOMENTE via service_role nos webhooks (/api/stripe/webhook
-- e /api/mercadopago/webhook). RLS permite leitura ao dono.

CREATE TABLE store_subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id                UUID NOT NULL UNIQUE REFERENCES store_settings(id) ON DELETE CASCADE,
  plan_id                 TEXT NOT NULL,
  provider                TEXT NOT NULL CHECK (provider IN ('stripe', 'mercadopago')),
  status                  TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'canceled', 'pending', 'incomplete')),

  -- Stripe (NULL quando provider='mercadopago')
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT UNIQUE,
  stripe_price_id         TEXT,

  -- Mercado Pago (NULL quando provider='stripe')
  mp_customer_id          TEXT,
  mp_subscription_id      TEXT UNIQUE,
  mp_payment_id           TEXT,

  current_period_end      TIMESTAMPTZ,
  cancel_at_period_end    BOOLEAN NOT NULL DEFAULT FALSE,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subs_status ON store_subscriptions (status);
CREATE INDEX idx_subs_stripe_customer ON store_subscriptions (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX idx_subs_period_end ON store_subscriptions (current_period_end) WHERE status = 'active';

ALTER TABLE store_subscriptions ENABLE ROW LEVEL SECURITY;

-- Dono lê sua própria assinatura. Escrita só via service_role (webhooks).
CREATE POLICY "subs_owner_select" ON store_subscriptions FOR SELECT
  USING (auth.uid() = store_id);

-- ---------------------------------------------------------------------------
-- payment_events: log de eventos de webhook (Stripe + MP), usado para
-- idempotência. PK = event.id (Stripe) ou {provider}_{notif_id} (MP).
-- Antes de processar um evento, o webhook tenta inserir aqui; se conflitar,
-- o evento já foi processado e é ignorado.
-- ---------------------------------------------------------------------------

CREATE TABLE payment_events (
  id            TEXT PRIMARY KEY,
  provider      TEXT NOT NULL CHECK (provider IN ('stripe', 'mercadopago')),
  type          TEXT NOT NULL,
  payload       JSONB NOT NULL,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_events_provider_type ON payment_events (provider, type);

ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
-- Sem policy de SELECT/INSERT pública. Só service_role escreve/lê (debug).
