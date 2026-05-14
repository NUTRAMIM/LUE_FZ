-- 021_list_conversations_rpc.sql
-- RPC para o menu de conversas do painel: retorna lista da loja com preview
-- da última mensagem, contador de não lidas e nome do lead num único shot.
-- SECURITY INVOKER => respeita RLS (auth.uid() = store_id em conversations
-- e em messages, da migration 019).

CREATE OR REPLACE FUNCTION list_conversations_for_store(
  p_store_id UUID,
  p_status   TEXT
)
RETURNS TABLE (
  id                   UUID,
  visitor_id           TEXT,
  lead_name            TEXT,
  status               TEXT,
  last_message_at      TIMESTAMPTZ,
  last_message_preview TEXT,
  last_message_role    TEXT,
  unread_count         BIGINT,
  created_at           TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH last_msg AS (
    SELECT DISTINCT ON (m.conversation_id)
      m.conversation_id, m.content, m.role, m.created_at
    FROM messages m
    WHERE m.store_id = p_store_id
    ORDER BY m.conversation_id, m.created_at DESC
  ),
  unread AS (
    SELECT m.conversation_id, count(*) AS n
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.store_id = p_store_id
      AND m.created_at > COALESCE(c.last_read_at, c.created_at)
    GROUP BY m.conversation_id
  )
  SELECT
    c.id,
    c.visitor_id,
    l.name,
    c.status,
    c.last_message_at,
    lm.content,
    lm.role,
    COALESCE(u.n, 0),
    c.created_at
  FROM conversations c
  LEFT JOIN leads     l  ON l.id  = c.lead_id
  LEFT JOIN last_msg  lm ON lm.conversation_id = c.id
  LEFT JOIN unread    u  ON u.conversation_id  = c.id
  WHERE c.store_id = p_store_id
    AND c.status   = p_status
  ORDER BY c.last_message_at DESC NULLS LAST
  LIMIT 200;
$$;
