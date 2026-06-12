-- 044_terms_acceptances.sql
-- Registro do aceite dos Termos de Uso + Politica de Privacidade pelo dono
-- da loja. Uma linha por (usuario, versao dos termos) = prova de consentimento.
-- Idempotente: seguro re-rodar.

CREATE TABLE IF NOT EXISTS terms_acceptances (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  terms_version TEXT NOT NULL,
  accepted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip            TEXT,
  user_agent    TEXT,
  UNIQUE (user_id, terms_version)
);

ALTER TABLE terms_acceptances ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'terms_acceptances'
      AND policyname = 'terms_acceptances_select_own'
  ) THEN
    CREATE POLICY "terms_acceptances_select_own" ON terms_acceptances
      FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'terms_acceptances'
      AND policyname = 'terms_acceptances_insert_own'
  ) THEN
    CREATE POLICY "terms_acceptances_insert_own" ON terms_acceptances
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
