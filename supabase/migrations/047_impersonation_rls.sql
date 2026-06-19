-- 047_impersonation_rls.sql
-- "Modo loja": permite que um super-admin opere uma loja-alvo como dono.
-- Mecanismo: header de request `x-impersonate-store` (injetado pelo client só
-- quando há cookie de impersonação), honrado APENAS para platform-admins.
-- As policies ganham um ramo ADITIVO `OR (linha == loja-alvo)` — o caminho do
-- usuário normal não muda (para ele app_impersonated_store() é sempre NULL).

-- Identidade de admin no banco (RLS não lê env). Seed manual via service-role.
CREATE TABLE IF NOT EXISTS platform_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
-- Sem policies: só a service-role acessa.

CREATE OR REPLACE FUNCTION app_is_platform_admin(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = uid);
$$;

-- Loja impersonada: lê o header, valida UUID, e só honra para admin.
-- Retorna NULL em qualquer outro caso (fail-closed).
CREATE OR REPLACE FUNCTION app_impersonated_store()
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  raw TEXT;
  sid UUID;
BEGIN
  -- Gate de admin primeiro: fail-closed e evita parsear o header de não-admin.
  IF NOT app_is_platform_admin(auth.uid()) THEN
    RETURN NULL;
  END IF;
  -- Lê e valida o header dentro do handler: qualquer erro de parse (header
  -- ausente/NULL, JSON malformado, UUID inválido) => NULL. Mantém o contrato
  -- fail-closed mesmo se request.headers contiver algo que não seja JSON.
  BEGIN
    raw := current_setting('request.headers', true)::json ->> 'x-impersonate-store';
    IF raw IS NULL OR raw = '' THEN
      RETURN NULL;
    END IF;
    sid := raw::uuid;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  RETURN sid;
END;
$$;

-- ===========================================================================
-- Block A — membership family (leads, conversations, messages, store_invites)
-- ===========================================================================

-- leads (eram membership puro — 025)
DROP POLICY IF EXISTS "leads_select_member" ON leads;
CREATE POLICY "leads_select_member" ON leads FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid())
         OR store_id = app_impersonated_store());

DROP POLICY IF EXISTS "leads_update_member" ON leads;
CREATE POLICY "leads_update_member" ON leads FOR UPDATE
  USING (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid())
         OR store_id = app_impersonated_store());

DROP POLICY IF EXISTS "leads_insert_member" ON leads;
CREATE POLICY "leads_insert_member" ON leads FOR INSERT
  WITH CHECK (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid())
              OR store_id = app_impersonated_store());

-- conversations (member; manter conversations_read_anon intacta)
DROP POLICY IF EXISTS "conversations_read_member" ON conversations;
CREATE POLICY "conversations_read_member" ON conversations FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid())
         OR store_id = app_impersonated_store());

DROP POLICY IF EXISTS "conversations_update_member" ON conversations;
CREATE POLICY "conversations_update_member" ON conversations FOR UPDATE
  USING (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid())
         OR store_id = app_impersonated_store());

-- messages (member; manter messages_read_anon intacta; insert do chat é service-role)
DROP POLICY IF EXISTS "messages_read_member" ON messages;
CREATE POLICY "messages_read_member" ON messages FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_members WHERE user_id = auth.uid())
         OR store_id = app_impersonated_store());

-- store_invites (SELECT owner; escrita é service-role nas actions)
DROP POLICY IF EXISTS "store_invites_select_owner" ON store_invites;
CREATE POLICY "store_invites_select_owner" ON store_invites FOR SELECT
  USING (store_id IN (SELECT store_id FROM store_members
                      WHERE user_id = auth.uid() AND role = 'owner')
         OR store_id = app_impersonated_store());

-- ===========================================================================
-- Block B — `auth.uid() = store_id` family
--           (knowledge_gaps, product_mentions, store_subscriptions)
-- ===========================================================================

DROP POLICY IF EXISTS "kgaps_owner_all" ON knowledge_gaps;
CREATE POLICY "kgaps_owner_all" ON knowledge_gaps FOR ALL
  USING (auth.uid() = store_id OR store_id = app_impersonated_store());

DROP POLICY IF EXISTS "pmentions_owner_all" ON product_mentions;
CREATE POLICY "pmentions_owner_all" ON product_mentions FOR ALL
  USING (auth.uid() = store_id OR store_id = app_impersonated_store());

DROP POLICY IF EXISTS "subs_owner_select" ON store_subscriptions;
CREATE POLICY "subs_owner_select" ON store_subscriptions FOR SELECT
  USING (auth.uid() = store_id OR store_id = app_impersonated_store());

-- ===========================================================================
-- Block C — store_settings (`auth.uid() = id`) e products (`auth.uid() = user_id`)
-- ===========================================================================

DROP POLICY IF EXISTS "store_settings_select" ON store_settings;
CREATE POLICY "store_settings_select" ON store_settings FOR SELECT
  USING (auth.uid() = id OR id = app_impersonated_store());

DROP POLICY IF EXISTS "store_settings_insert" ON store_settings;
CREATE POLICY "store_settings_insert" ON store_settings FOR INSERT
  WITH CHECK (auth.uid() = id OR id = app_impersonated_store());

DROP POLICY IF EXISTS "store_settings_update" ON store_settings;
CREATE POLICY "store_settings_update" ON store_settings FOR UPDATE
  USING (auth.uid() = id OR id = app_impersonated_store());

DROP POLICY IF EXISTS "products_read" ON products;
CREATE POLICY "products_read" ON products FOR SELECT
  USING (auth.uid() = user_id OR user_id = app_impersonated_store());

DROP POLICY IF EXISTS "products_write" ON products;
CREATE POLICY "products_write" ON products FOR ALL
  USING (auth.uid() = user_id OR user_id = app_impersonated_store());

-- ===========================================================================
-- Block D — storage policies (product-images, product-videos, store-logos)
--           Compara como texto para evitar cast de path inválido para uuid.
-- ===========================================================================

-- product-images
DROP POLICY IF EXISTS "product_images_insert_own" ON storage.objects;
CREATE POLICY "product_images_insert_own" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'product-images'
    AND (auth.uid()::text = (storage.foldername(name))[1]
         OR (storage.foldername(name))[1] = app_impersonated_store()::text));
DROP POLICY IF EXISTS "product_images_update_own" ON storage.objects;
CREATE POLICY "product_images_update_own" ON storage.objects FOR UPDATE
  USING (bucket_id = 'product-images'
    AND (auth.uid()::text = (storage.foldername(name))[1]
         OR (storage.foldername(name))[1] = app_impersonated_store()::text));
DROP POLICY IF EXISTS "product_images_delete_own" ON storage.objects;
CREATE POLICY "product_images_delete_own" ON storage.objects FOR DELETE
  USING (bucket_id = 'product-images'
    AND (auth.uid()::text = (storage.foldername(name))[1]
         OR (storage.foldername(name))[1] = app_impersonated_store()::text));

-- product-videos
DROP POLICY IF EXISTS "product_videos_insert_own" ON storage.objects;
CREATE POLICY "product_videos_insert_own" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'product-videos'
    AND (auth.uid()::text = (storage.foldername(name))[1]
         OR (storage.foldername(name))[1] = app_impersonated_store()::text));
DROP POLICY IF EXISTS "product_videos_update_own" ON storage.objects;
CREATE POLICY "product_videos_update_own" ON storage.objects FOR UPDATE
  USING (bucket_id = 'product-videos'
    AND (auth.uid()::text = (storage.foldername(name))[1]
         OR (storage.foldername(name))[1] = app_impersonated_store()::text));
DROP POLICY IF EXISTS "product_videos_delete_own" ON storage.objects;
CREATE POLICY "product_videos_delete_own" ON storage.objects FOR DELETE
  USING (bucket_id = 'product-videos'
    AND (auth.uid()::text = (storage.foldername(name))[1]
         OR (storage.foldername(name))[1] = app_impersonated_store()::text));

-- store-logos
DROP POLICY IF EXISTS "store_logos_insert_own" ON storage.objects;
CREATE POLICY "store_logos_insert_own" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'store-logos'
    AND (auth.uid()::text = (storage.foldername(name))[1]
         OR (storage.foldername(name))[1] = app_impersonated_store()::text));
DROP POLICY IF EXISTS "store_logos_update_own" ON storage.objects;
CREATE POLICY "store_logos_update_own" ON storage.objects FOR UPDATE
  USING (bucket_id = 'store-logos'
    AND (auth.uid()::text = (storage.foldername(name))[1]
         OR (storage.foldername(name))[1] = app_impersonated_store()::text));
DROP POLICY IF EXISTS "store_logos_delete_own" ON storage.objects;
CREATE POLICY "store_logos_delete_own" ON storage.objects FOR DELETE
  USING (bucket_id = 'store-logos'
    AND (auth.uid()::text = (storage.foldername(name))[1]
         OR (storage.foldername(name))[1] = app_impersonated_store()::text));
