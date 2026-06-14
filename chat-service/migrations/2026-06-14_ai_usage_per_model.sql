-- 2026-06-14: granularidade por MODELO + coluna cached_tokens em ai_usage_daily.
-- Objetivo: custo EXATO por loja. mini/nano e o input cacheado têm preços bem
-- diferentes; sem esse split o custo é só estimativa.
--
-- ORDEM DE DEPLOY: rode este SQL JUNTO com o deploy do código novo (o app passa
-- a gravar com ON CONFLICT (store_id, day, model)). A gravação de usage é
-- não-fatal (try/except no pipeline.py), então a janela de deploy é segura —
-- no pior caso perde-se algum registro de usage por alguns segundos.
--
-- Linhas já existentes recebem model='desconhecido' e cached_tokens=0 (o custo
-- delas continua estimado; só os dados NOVOS ficam exatos).

ALTER TABLE ai_usage_daily
  ADD COLUMN IF NOT EXISTS model         text   NOT NULL DEFAULT 'desconhecido',
  ADD COLUMN IF NOT EXISTS cached_tokens bigint NOT NULL DEFAULT 0;

ALTER TABLE ai_usage_daily DROP CONSTRAINT IF EXISTS ai_usage_daily_pkey;
ALTER TABLE ai_usage_daily ADD CONSTRAINT ai_usage_daily_pkey
  PRIMARY KEY (store_id, day, model);
