-- 026_leads_workflow_fields.sql
-- Colunas de workflow da Fila de Leads: o resumo de interesse capturado pela
-- IA, e o marco "contatado" (quando e por quem).

ALTER TABLE leads
  ADD COLUMN interest_summary  TEXT,
  ADD COLUMN contacted_at      TIMESTAMPTZ,
  ADD COLUMN contacted_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN contacted_by_name TEXT;

-- Índice para a query da fila (lista por loja, separa novos de contatados).
CREATE INDEX idx_leads_store_contacted ON leads (store_id, contacted_at);
