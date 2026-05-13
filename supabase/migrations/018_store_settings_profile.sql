-- 018_store_settings_profile.sql
-- Adds store profile fields (seller phone, instagram, bio, logo)
-- and a public storage bucket for logo uploads scoped per user.

-- 1. Profile columns on store_settings (idempotent)
ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS seller_phone     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS instagram_handle TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS store_bio        TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS logo_url         TEXT NOT NULL DEFAULT '';

-- 2. Public bucket for store logos (2MB cap, common image mimetypes)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'store-logos',
  'store-logos',
  true,
  2 * 1024 * 1024,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage RLS: anyone can read; each user manages only objects in {user.id}/...
DROP POLICY IF EXISTS "store_logos_select_public" ON storage.objects;
DROP POLICY IF EXISTS "store_logos_insert_own"    ON storage.objects;
DROP POLICY IF EXISTS "store_logos_update_own"    ON storage.objects;
DROP POLICY IF EXISTS "store_logos_delete_own"    ON storage.objects;

CREATE POLICY "store_logos_select_public" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'store-logos');

CREATE POLICY "store_logos_insert_own" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'store-logos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "store_logos_update_own" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'store-logos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "store_logos_delete_own" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'store-logos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
