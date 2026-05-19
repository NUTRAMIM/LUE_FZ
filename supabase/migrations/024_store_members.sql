-- 024_store_members.sql
-- Membership de loja: o dono e os vendedores de cada loja. Base do app
-- multi-usuário e do novo modelo de RLS.

CREATE TABLE store_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   UUID NOT NULL REFERENCES store_settings(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('owner', 'agent')),
  full_name  TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (store_id, user_id)
);

CREATE INDEX idx_store_members_user ON store_members (user_id);

-- Seed: cada loja existente vira sua própria dona (store_id = user.id em todo
-- o projeto). full_name aproveita o store_name.
INSERT INTO store_members (store_id, user_id, role, full_name)
SELECT id, id, 'owner', store_name FROM store_settings
ON CONFLICT (store_id, user_id) DO NOTHING;

ALTER TABLE store_members ENABLE ROW LEVEL SECURITY;

-- Cada usuário enxerga só a própria membership. Self-contido (não referencia
-- store_members de volta), então as subqueries de RLS das outras tabelas não
-- recursam. Escrita acontece só via service role (admin client).
CREATE POLICY "store_members_select_self" ON store_members
  FOR SELECT USING (user_id = auth.uid());

-- Toda store_settings nova ganha automaticamente a membership 'owner' do dono.
CREATE OR REPLACE FUNCTION seed_store_owner_member()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO store_members (store_id, user_id, role, full_name)
  VALUES (NEW.id, NEW.id, 'owner', NEW.store_name)
  ON CONFLICT (store_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_store_settings_owner_member
  AFTER INSERT ON store_settings
  FOR EACH ROW EXECUTE FUNCTION seed_store_owner_member();
