-- 012_chat_slug_and_media.sql
-- Adds chat_slug per store, links conversations to store, and adds
-- message_type/media_path for image/audio support.

-- 1. chat_slug on store_settings
ALTER TABLE store_settings
  ADD COLUMN chat_slug TEXT UNIQUE;

UPDATE store_settings
SET chat_slug = lower(substring(md5(random()::text || id::text) for 8))
WHERE chat_slug IS NULL;

ALTER TABLE store_settings
  ALTER COLUMN chat_slug SET NOT NULL;

CREATE INDEX idx_store_settings_chat_slug ON store_settings (chat_slug);

-- 2. conversations.store_id
ALTER TABLE conversations
  ADD COLUMN store_id UUID REFERENCES store_settings(id) ON DELETE CASCADE;

CREATE INDEX idx_conversations_store_visitor
  ON conversations (store_id, visitor_id);

-- 3. messages.message_type, messages.media_path
ALTER TABLE messages
  ADD COLUMN message_type TEXT NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text', 'image', 'audio')),
  ADD COLUMN media_path TEXT;

-- 4. Tighter RLS for conversations: owner sees own; anon can read for now
DROP POLICY IF EXISTS "conversations_read" ON conversations;

CREATE POLICY "conversations_read_owner" ON conversations
  FOR SELECT USING (auth.uid() = store_id);

CREATE POLICY "conversations_read_anon" ON conversations
  FOR SELECT USING (auth.role() = 'anon');

-- 5. Trigger to auto-generate chat_slug for new store_settings rows
CREATE OR REPLACE FUNCTION generate_chat_slug()
RETURNS TRIGGER AS $$
DECLARE
  candidate TEXT;
  attempt INT := 0;
BEGIN
  IF NEW.chat_slug IS NOT NULL THEN
    RETURN NEW;
  END IF;
  LOOP
    candidate := lower(substring(md5(random()::text || NEW.id::text || attempt::text) for 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM store_settings WHERE chat_slug = candidate);
    attempt := attempt + 1;
    IF attempt >= 5 THEN
      candidate := lower(substring(replace(gen_random_uuid()::text, '-', '') for 8));
      EXIT;
    END IF;
  END LOOP;
  NEW.chat_slug := candidate;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_store_settings_chat_slug
  BEFORE INSERT ON store_settings
  FOR EACH ROW EXECUTE FUNCTION generate_chat_slug();
