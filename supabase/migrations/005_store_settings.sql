-- Configurações da loja (uma row por usuário)
CREATE TABLE store_settings (
  id                    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  store_name            TEXT NOT NULL,
  service_steps         TEXT[] DEFAULT '{}',
  service_instructions  TEXT DEFAULT '',
  payment_methods       TEXT[] DEFAULT '{}',
  delivery_methods      TEXT[] DEFAULT '{}',
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

-- Auto-update updated_at (reutiliza update_updated_at() da migration 002)
CREATE TRIGGER trg_store_settings_updated BEFORE UPDATE ON store_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: cada usuário só acessa sua própria row
ALTER TABLE store_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "store_settings_select" ON store_settings
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "store_settings_insert" ON store_settings
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "store_settings_update" ON store_settings
  FOR UPDATE USING (auth.uid() = id);
