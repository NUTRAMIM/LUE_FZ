-- 043_seed_store_owner_member_security_definer.sql
-- Conserta erro 42501 ("new row violates RLS policy for store_members") ao
-- salvar uma loja NOVA. O trigger AFTER INSERT em store_settings insere a
-- membership 'owner' em store_members, mas store_members só tem policy de
-- SELECT — nenhuma de INSERT (por design: escrita só via privilégio elevado).
--
-- A função rodava como invoker (default), então o INSERT caía na RLS do
-- usuário logado e era negado. SECURITY DEFINER faz a função rodar com o
-- privilégio do dono, contornando a RLS — que é a intenção original.
-- Idempotente: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION seed_store_owner_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO store_members (store_id, user_id, role, full_name)
  VALUES (NEW.id, NEW.id, 'owner', NEW.store_name)
  ON CONFLICT (store_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
