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
