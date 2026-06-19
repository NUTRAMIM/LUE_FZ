-- Custo EXATO de IA por loja + atividade (mensagens da IA e atendimentos).
-- Usa ai_usage_daily com split por modelo e cached_tokens (preços jun/2026).
-- Linhas antigas (model='desconhecido', cached=0) caem no preço default (mini,
-- sem cache) — só os dados gravados após o deploy novo ficam 100% exatos.
WITH prices(model, in_usd, cached_usd, out_usd) AS (
  VALUES ('gpt-5-mini', 0.25, 0.025, 2.00),
         ('gpt-5-nano', 0.05, 0.005, 0.40),
         ('text-embedding-3-small', 0.02, 0.02, 0.0)
),
per_store AS (
  SELECT u.store_id,
         MIN(u.day) AS desde, MAX(u.day) AS ate,
         SUM(u.prompt_tokens)     AS prompt,
         SUM(u.cached_tokens)     AS cached,
         SUM(u.completion_tokens) AS compl,
         SUM(u.calls)             AS calls,
         SUM(((u.prompt_tokens - u.cached_tokens) * COALESCE(p.in_usd, 0.25)
              + u.cached_tokens     * COALESCE(p.cached_usd, 0.025)
              + u.completion_tokens * COALESCE(p.out_usd, 2.0)) / 1e6) AS usd
  FROM ai_usage_daily u
  LEFT JOIN prices p USING (model)
  GROUP BY u.store_id
),
msgs AS (   -- mensagens da IA e atendimentos no MESMO período da usage
  SELECT ps.store_id,
         COUNT(*) FILTER (WHERE m.role = 'assistant') AS ia_msgs,
         COUNT(DISTINCT m.conversation_id)            AS atendimentos
  FROM per_store ps
  JOIN messages m ON m.store_id = ps.store_id
       AND m.created_at::date BETWEEN ps.desde AND ps.ate
  GROUP BY ps.store_id
)
SELECT s.store_name,
       ps.calls,
       COALESCE(g.ia_msgs, 0)      AS ia_mensagens,
       COALESCE(g.atendimentos, 0) AS atendimentos,
       ps.prompt, ps.cached, ps.compl,
       ROUND(ps.usd::numeric, 4)          AS custo_usd,
       ROUND((ps.usd * 5.5)::numeric, 2)  AS custo_brl,
       ps.desde, ps.ate
FROM per_store ps
JOIN store_settings s ON s.id = ps.store_id
LEFT JOIN msgs g ON g.store_id = ps.store_id
ORDER BY custo_usd DESC;
