-- 019_messages_store_id.sql
-- Adds messages.store_id (denormalized from conversations) so we can filter
-- Realtime/queries per store and apply per-store RLS without a join.

-- 1. Add column + FK
ALTER TABLE messages
  ADD COLUMN store_id UUID REFERENCES store_settings(id) ON DELETE CASCADE;

-- 2. Backfill from parent conversation
UPDATE messages m
SET store_id = c.store_id
FROM conversations c
WHERE m.conversation_id = c.id;

-- 3. Require it (fails loud if any conversation still has NULL store_id)
ALTER TABLE messages
  ALTER COLUMN store_id SET NOT NULL;

-- 4. Index for store-scoped reads / Realtime filters
CREATE INDEX idx_messages_store_created
  ON messages (store_id, created_at DESC);

-- 5. Auto-populate store_id from the parent conversation on INSERT,
--    so callers (app actions, n8n) don't need to pass it explicitly.
CREATE OR REPLACE FUNCTION set_message_store_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.store_id IS NULL THEN
    SELECT store_id INTO NEW.store_id
    FROM conversations WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_messages_set_store_id
  BEFORE INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION set_message_store_id();

-- 6. Tighten RLS to mirror conversations: owner reads own store's messages;
--    anon keeps read access for the public chat path.
DROP POLICY IF EXISTS "messages_read" ON messages;

CREATE POLICY "messages_read_owner" ON messages
  FOR SELECT USING (auth.uid() = store_id);

CREATE POLICY "messages_read_anon" ON messages
  FOR SELECT USING (auth.role() = 'anon');
