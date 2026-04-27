-- Webhook idempotency log for n8n
CREATE TABLE n8n_webhook_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      UUID NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

-- RLS
ALTER TABLE n8n_webhook_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "webhook_log_service" ON n8n_webhook_log FOR ALL
  USING (auth.role() = 'service_role');

-- Also add update_updated_at trigger to products (defined in migration 002)
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
