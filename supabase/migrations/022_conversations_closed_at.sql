-- 022_conversations_closed_at.sql
-- Adds conversations.closed_at so the funnel can count the "Fechado" stage
-- and compute cycle time precisely, replacing the updated_at proxy from Onda A.

ALTER TABLE conversations
  ADD COLUMN closed_at TIMESTAMPTZ;

-- Backfill existing closed conversations with their last-update time as a
-- best-effort approximation (the precise close time is unknowable in retrospect).
UPDATE conversations SET closed_at = updated_at WHERE status = 'closed';

-- Keep closed_at in sync with status transitions.
CREATE OR REPLACE FUNCTION set_conversation_closed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    NEW.closed_at = now();
  ELSIF NEW.status <> 'closed' THEN
    NEW.closed_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_conversations_closed_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_conversation_closed_at();

-- Index for the store-scoped funnel query (closed_at >= range_start).
CREATE INDEX idx_conversations_store_closed
  ON conversations (store_id, closed_at DESC)
  WHERE closed_at IS NOT NULL;
