-- 037_ai_usage_daily.sql
-- Consumo de tokens da IA agregado por loja e por dia (fuso America/Sao_Paulo).
-- Escrito pelo chat-service (service-role) via UPSERT incremental em
-- record_daily_usage. Lido apenas pelo painel de super-admin (service-role).

CREATE TABLE ai_usage_daily (
  store_id          UUID NOT NULL REFERENCES store_settings(id) ON DELETE CASCADE,
  day               DATE NOT NULL,
  prompt_tokens     BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  total_tokens      BIGINT NOT NULL DEFAULT 0,
  calls             INTEGER NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, day)
);

CREATE INDEX idx_ai_usage_daily_day ON ai_usage_daily (day);

ALTER TABLE ai_usage_daily ENABLE ROW LEVEL SECURITY;
-- Sem policies: nenhum acesso via cliente anon/authenticated.
-- Apenas a service-role (que ignora RLS) lê e escreve.
