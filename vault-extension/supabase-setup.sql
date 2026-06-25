CREATE TABLE IF NOT EXISTS vinted_orders (
  id TEXT PRIMARY KEY,
  transaction_id TEXT UNIQUE,
  title TEXT,
  price DECIMAL,
  buyer TEXT,
  country TEXT,
  status TEXT,
  item_url TEXT,
  label_url TEXT,
  photo_url TEXT,
  sale_date DATE,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  registered_in_vault BOOLEAN DEFAULT FALSE
);

-- Run these if the table already exists:
ALTER TABLE vinted_orders ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE vinted_orders ADD COLUMN IF NOT EXISTS sale_date DATE;
ALTER TABLE vinted_orders ADD COLUMN IF NOT EXISTS label_available BOOLEAN DEFAULT FALSE;
ALTER TABLE vinted_orders ADD COLUMN IF NOT EXISTS cost_price DECIMAL;
ALTER TABLE vinted_orders ADD COLUMN IF NOT EXISTS sku_ref TEXT;
ALTER TABLE vinted_orders ADD COLUMN IF NOT EXISTS photo_urls TEXT;
ALTER TABLE vinted_orders ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE vinted_orders ADD COLUMN IF NOT EXISTS shipping_method TEXT;
ALTER TABLE vinted_orders ADD COLUMN IF NOT EXISTS tracking_code TEXT;
ALTER TABLE vinted_orders ADD COLUMN IF NOT EXISTS buyer_name TEXT;

-- RLS policies — vereist zodat de Chrome extensie kan schrijven
-- Voer dit uit als de tabel leeg blijft na sync:
ALTER TABLE vinted_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "anon kan lezen"
  ON vinted_orders FOR SELECT TO anon USING (true);

CREATE POLICY IF NOT EXISTS "anon kan upserten"
  ON vinted_orders FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "anon kan updaten"
  ON vinted_orders FOR UPDATE TO anon USING (true) WITH CHECK (true);
