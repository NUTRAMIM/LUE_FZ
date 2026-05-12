-- 014_leads_conversation_unique.sql
-- Garante que cada conversa tem no máximo 1 lead. Permite upsert por
-- conversation_id no fluxo de extração de dados do chat (n8n).

ALTER TABLE leads
  ADD CONSTRAINT leads_conversation_id_unique UNIQUE (conversation_id);
