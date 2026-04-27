-- RLS: cada usuário só vê/edita seus próprios produtos
DROP POLICY IF EXISTS "products_read" ON products;
DROP POLICY IF EXISTS "products_write" ON products;
CREATE POLICY "products_read" ON products FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "products_write" ON products FOR ALL USING (auth.uid() = user_id);
