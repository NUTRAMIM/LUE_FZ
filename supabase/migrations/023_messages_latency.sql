-- 023_messages_latency.sql
-- Adds messages.latency_ms (AI response time, DB-side) and a per-store p95 RPC
-- for the painel's "Latência IA · p95" metric.

ALTER TABLE messages
  ADD COLUMN latency_ms INT;

-- On each assistant message, record milliseconds since the most recent user
-- message in the same conversation. NULL when there is no preceding user msg.
CREATE OR REPLACE FUNCTION calculate_message_latency()
RETURNS TRIGGER AS $$
DECLARE
  last_user_at TIMESTAMPTZ;
BEGIN
  IF NEW.role = 'assistant' THEN
    SELECT created_at INTO last_user_at
    FROM messages
    WHERE conversation_id = NEW.conversation_id AND role = 'user'
    ORDER BY created_at DESC
    LIMIT 1;
    IF last_user_at IS NOT NULL THEN
      NEW.latency_ms = GREATEST(
        0,
        (EXTRACT(
          EPOCH FROM (COALESCE(NEW.created_at, now()) - last_user_at)
        ) * 1000)::INT
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_messages_latency
  BEFORE INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION calculate_message_latency();

-- p95 of AI latency over the last 24h for one store.
-- SECURITY INVOKER => respects the messages_read_owner RLS (auth.uid() = store_id).
CREATE OR REPLACE FUNCTION get_ai_latency_p95(p_store_id UUID)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT COALESCE(
    percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms),
    0
  )::INT
  FROM messages
  WHERE store_id = p_store_id
    AND role = 'assistant'
    AND latency_ms IS NOT NULL
    AND created_at > now() - interval '24 hours';
$$;
