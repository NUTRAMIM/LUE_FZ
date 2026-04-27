-- Products table (inventory)
CREATE TABLE products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku           TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  price         NUMERIC(10,2) NOT NULL,
  compare_at_price NUMERIC(10,2),
  currency      TEXT NOT NULL DEFAULT 'BRL',
  category      TEXT,
  brand         TEXT,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  is_available  BOOLEAN GENERATED ALWAYS AS (stock_quantity > 0) STORED,
  image_urls    TEXT[],
  variants      JSONB DEFAULT '[]',
  attributes    JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_products_name ON products USING gin(to_tsvector('portuguese', name));
CREATE INDEX idx_products_category ON products (category);
CREATE INDEX idx_products_sku ON products (sku);
CREATE INDEX idx_products_available ON products (is_available) WHERE is_available = true;

-- RLS
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_read" ON products FOR SELECT USING (true);
CREATE POLICY "products_write" ON products FOR ALL USING (auth.role() = 'authenticated');
