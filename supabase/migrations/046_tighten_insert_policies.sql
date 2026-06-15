-- 046_tighten_insert_policies.sql
-- Bloco 3 da auditoria de seguranca: aperta as policies de INSERT que estavam
-- com `WITH CHECK (true)` em conversations, messages, knowledge_gaps e
-- product_mentions. Com (true), qualquer cliente anon/authenticated podia
-- inserir linhas com QUALQUER store_id arbitrario (poison/spam cross-tenant nos
-- paineis de outras lojas).
--
-- Por que e seguro / NAO quebra producao:
--   Todos os inserts legitimos dessas tabelas passam por roles que BYPASSAM RLS
--   (a policy WITH CHECK nem e avaliada para eles):
--     - Front (Next.js): createAdminClient() = service_role
--         conversations -> chat.ts ensureConversation()
--         messages      -> chat.ts (ensureConversation/sendMessage)
--     - chat-service (Python): conexao asyncpg como role `postgres` (owner das
--       tabelas; sem FORCE ROW LEVEL SECURITY => bypassa RLS)
--         messages / knowledge_gaps / product_mentions -> app/db.py
--     - n8n: Supabase nodes via service_role
--   Nenhum insert legitimo usa a chave anon/authenticated. A nova policy so
--   passa a BLOQUEAR o que nao deveria existir (insert cross-tenant via anon),
--   e e forward-compatible: se um operador autenticado (membro da loja) vier a
--   inserir no futuro, o membership WITH CHECK o permite.
--
-- store_id NULL (conversations.store_id e nullable) => `NULL IN (...)` => NULL
-- => tratado como falso => insert bloqueado. Inserts legitimos sempre setam
-- store_id e usam service_role/postgres, entao nao sao afetados.

-- conversations
DROP POLICY IF EXISTS "conversations_insert" ON conversations;
CREATE POLICY "conversations_insert_member" ON conversations FOR INSERT
  WITH CHECK (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid()));

-- messages (store_id e NOT NULL e denormalizado da conversa via trigger)
DROP POLICY IF EXISTS "messages_insert" ON messages;
CREATE POLICY "messages_insert_member" ON messages FOR INSERT
  WITH CHECK (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid()));

-- knowledge_gaps
DROP POLICY IF EXISTS "kgaps_service_insert" ON knowledge_gaps;
CREATE POLICY "kgaps_insert_member" ON knowledge_gaps FOR INSERT
  WITH CHECK (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid()));

-- product_mentions
DROP POLICY IF EXISTS "pmentions_service_insert" ON product_mentions;
CREATE POLICY "pmentions_insert_member" ON product_mentions FOR INSERT
  WITH CHECK (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid()));
