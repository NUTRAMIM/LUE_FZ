-- Leads table
CREATE TABLE leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp        TEXT,
  name            TEXT,
  email           TEXT,
  source          TEXT DEFAULT 'chat',
  first_seen_at   TIMESTAMPTZ DEFAULT now(),
  last_seen_at    TIMESTAMPTZ DEFAULT now(),
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_leads_whatsapp ON leads (whatsapp) WHERE whatsapp IS NOT NULL;

-- RLS
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leads_all" ON leads FOR ALL USING (auth.role() = 'authenticated');

-- Add FK from conversations to leads (now that leads table exists)
ALTER TABLE conversations
  ADD CONSTRAINT fk_conversations_lead
  FOREIGN KEY (lead_id) REFERENCES leads(id);
