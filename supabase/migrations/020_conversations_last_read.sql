-- 020_conversations_last_read.sql
-- Tracks when the store owner last viewed a conversation, so we can compute
-- an unread-messages counter per conversation in the painel.

ALTER TABLE conversations
  ADD COLUMN last_read_at TIMESTAMPTZ;

-- Backfill: existing conversations count as already-read up to now, otherwise
-- every old conversation would appear with full unread counts after deploy.
UPDATE conversations
SET last_read_at = COALESCE(last_message_at, created_at);
