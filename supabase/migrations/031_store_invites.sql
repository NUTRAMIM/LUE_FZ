-- 031_store_invites.sql
-- Convites pendentes pra um email virar vendedor (agent) de uma loja.
-- O owner gera um token e copia o link; o vendedor abre /convite/{token},
-- define senha e a conta vira agent. Sem dependência de SMTP.

CREATE TABLE store_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id    UUID NOT NULL REFERENCES store_settings(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  full_name   TEXT NOT NULL,
  token       TEXT NOT NULL UNIQUE,
  invited_by  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (store_id, email)
);

CREATE INDEX idx_store_invites_token ON store_invites (token);

ALTER TABLE store_invites ENABLE ROW LEVEL SECURITY;

-- Owner enxerga convites da própria loja. INSERT/UPDATE/DELETE via service
-- role nas server actions — sem policy de escrita pra anon/authenticated.
CREATE POLICY "store_invites_select_owner" ON store_invites FOR SELECT
  USING (store_id IN (
    SELECT store_id FROM store_members
    WHERE user_id = auth.uid() AND role = 'owner'
  ));
