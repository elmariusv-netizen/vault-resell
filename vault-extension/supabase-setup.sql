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

-- Auto-sync vlag (webapp → extensie)
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS vault_sync_requested BOOLEAN DEFAULT FALSE;

-- Storage bucket voor handmatig geüploade foto's en video's
INSERT INTO storage.buckets (id, name, public)
  VALUES ('order-photos', 'order-photos', true)
  ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════════════════════════════
-- MULTI-USER AUTH — voer dit uit in Supabase SQL Editor
-- Vereist: Authentication → Providers → Email ingeschakeld in dashboard
-- ══════════════════════════════════════════════════════════════════

-- 1. owner_id kolommen toevoegen
ALTER TABLE vinted_orders  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id);
ALTER TABLE user_settings  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id);

-- 2. Verwijder de oude open (anon) lees-policy
DROP POLICY IF EXISTS "anon kan lezen" ON vinted_orders;

-- 3. Nieuwe policies: authenticated users zien alleen eigen data
--    Anon INSERT/UPDATE blijft bestaan zodat de Chrome extensie kan blijven schrijven.
CREATE POLICY "user ziet eigen orders"
  ON vinted_orders FOR SELECT TO authenticated
  USING (auth.uid() = owner_id);

CREATE POLICY "user beheert eigen orders"
  ON vinted_orders FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- 4. user_settings RLS
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user ziet eigen settings" ON user_settings;
CREATE POLICY "user beheert eigen settings"
  ON user_settings FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- ══════════════════════════════════════════════════════════════════
-- MIGRATIE — voer dit uit NA je eerste login in de webapp
--
-- 1. Zoek je Supabase user UUID op:
--    Dashboard → Authentication → Users → kopieer je UUID
--
-- 2. Vervang <JOUW_UUID> hieronder en voer uit:
-- ══════════════════════════════════════════════════════════════════

-- UPDATE vinted_orders  SET owner_id = '<JOUW_UUID>' WHERE owner_id IS NULL;
-- UPDATE user_settings  SET owner_id = '<JOUW_UUID>', user_id = '<JOUW_UUID>' WHERE owner_id IS NULL;

-- ══════════════════════════════════════════════════════════════════
-- USER DATA (suppliers, batches, sales, documents, …)
-- Vervangt localStorage — voer dit uit in Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_data (
  owner_id   UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  payload    JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user beheert eigen data"
  ON user_data FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);
