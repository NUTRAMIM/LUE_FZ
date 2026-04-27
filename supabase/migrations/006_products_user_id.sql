-- Add user_id column to products (links to auth.users)
ALTER TABLE products ADD COLUMN user_id UUID NOT NULL REFERENCES auth.users(id);

-- Replace unique constraint: sku alone → (user_id, sku)
ALTER TABLE products DROP CONSTRAINT products_sku_key;
ALTER TABLE products ADD CONSTRAINT products_user_sku_unique UNIQUE (user_id, sku);

-- Add index on user_id
CREATE INDEX idx_products_user_id ON products (user_id);

-- Update RLS policies to scope by user
DROP POLICY IF EXISTS "products_read" ON products;
DROP POLICY IF EXISTS "products_write" ON products;
CREATE POLICY "products_read" ON products FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "products_write" ON products FOR ALL USING (auth.uid() = user_id);
