-- 027_knowledge_gaps.sql
-- Tabela de perguntas sem resposta capturadas pelo Gap Detector do workflow
-- n8n. Consumida pelo painel `GapsConhecimento.tsx`.

CREATE TABLE knowledge_gaps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES store_settings(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  question        TEXT NOT NULL,
  tag             TEXT NOT NULL,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_kgaps_store_created ON knowledge_gaps (store_id, created_at DESC);
CREATE INDEX idx_kgaps_store_unresolved ON knowledge_gaps (store_id) WHERE resolved_at IS NULL;

ALTER TABLE knowledge_gaps ENABLE ROW LEVEL SECURITY;

-- Dono da loja vê tudo
CREATE POLICY "kgaps_owner_all" ON knowledge_gaps FOR ALL
  USING (auth.uid() = store_id);

-- O workflow n8n insere via service_role bypass; mas para o caso de inserir via
-- chave anon (não acontece hoje), permitimos insert irrestrito — store_id é
-- validado pelo FK.
CREATE POLICY "kgaps_service_insert" ON knowledge_gaps FOR INSERT WITH CHECK (true);
