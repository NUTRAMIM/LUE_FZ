-- 028_product_mentions.sql
-- Tabela de menções de produtos no chat. Populada pelo Mention Extractor do
-- workflow n8n (matching por nome no output do AI Agent e na mensagem do
-- cliente). Consumida pelo painel `IntentCatalogo.tsx`.

CREATE TABLE product_mentions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES store_settings(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source          TEXT NOT NULL CHECK (source IN ('ai_shown', 'customer_asked')),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pmentions_store_product ON product_mentions (store_id, product_id);
CREATE INDEX idx_pmentions_store_created ON product_mentions (store_id, created_at DESC);

ALTER TABLE product_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pmentions_owner_all" ON product_mentions FOR ALL
  USING (auth.uid() = store_id);

CREATE POLICY "pmentions_service_insert" ON product_mentions FOR INSERT WITH CHECK (true);
