-- Contagem de atividade da IA por loja a partir de um início (date, fuso SP).
-- Agrega no banco (a tabela messages cresce; o client Supabase limita 1000 linhas).
CREATE OR REPLACE FUNCTION painel_atividade_ia(p_inicio date)
RETURNS TABLE (store_id uuid, ia_mensagens bigint, atendimentos bigint)
LANGUAGE sql STABLE AS $$
  SELECT m.store_id,
         COUNT(*) FILTER (WHERE m.role = 'assistant') AS ia_mensagens,
         COUNT(DISTINCT m.conversation_id)            AS atendimentos
  FROM messages m
  WHERE m.created_at >= (p_inicio::timestamp AT TIME ZONE 'America/Sao_Paulo')
  GROUP BY m.store_id;
$$;
