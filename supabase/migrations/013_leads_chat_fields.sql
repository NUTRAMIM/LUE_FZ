-- 013_leads_chat_fields.sql
-- Estende a tabela `leads` (003) com os campos que o workflow do n8n
-- "LUE FZ - Chat Agent" grava ao detectar dados pessoais no chat.

ALTER TABLE leads
  ADD COLUMN conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  ADD COLUMN store_id        UUID REFERENCES store_settings(id) ON DELETE CASCADE,
  ADD COLUMN cep             TEXT;

CREATE INDEX idx_leads_conversation ON leads (conversation_id);
CREATE INDEX idx_leads_store        ON leads (store_id);
