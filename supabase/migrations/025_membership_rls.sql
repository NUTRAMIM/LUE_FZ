-- 025_membership_rls.sql
-- Troca a RLS baseada em "auth.uid() = store_id" (dono-único) por membership.
-- A subquery aciona store_members_select_self (user_id = auth.uid()), que é
-- self-contida — sem recursão.

-- leads: a policy antiga (auth.role() = 'authenticated') deixava QUALQUER
-- usuário logado ver todos os leads de todas as lojas. Troca por membership.
DROP POLICY IF EXISTS "leads_all" ON leads;

CREATE POLICY "leads_select_member" ON leads FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid()));

CREATE POLICY "leads_update_member" ON leads FOR UPDATE
  USING (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid()));

CREATE POLICY "leads_insert_member" ON leads FOR INSERT
  WITH CHECK (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid()));

-- conversations: leitura/edição por membership; mantém o acesso anon do chat.
DROP POLICY IF EXISTS "conversations_read_owner" ON conversations;
CREATE POLICY "conversations_read_member" ON conversations FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "conversations_update" ON conversations;
CREATE POLICY "conversations_update_member" ON conversations FOR UPDATE
  USING (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid()));

-- messages: leitura por membership; mantém o acesso anon do chat.
DROP POLICY IF EXISTS "messages_read_owner" ON messages;
CREATE POLICY "messages_read_member" ON messages FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid()));
