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
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  registered_in_vault BOOLEAN DEFAULT FALSE
);
