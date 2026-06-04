-- 035_messages_reply_to.sql
-- Adds messages.reply_to_message_id so a message can quote/reply to an earlier
-- message in the same conversation (WhatsApp-style reply). ON DELETE SET NULL so
-- removing the quoted message does not break the reply.

ALTER TABLE messages
  ADD COLUMN reply_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;
