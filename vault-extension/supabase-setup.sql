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
ALTER TABLE vinted_orders ADD COLUMN IF NOT EXISTS item_titles TEXT;
ALTER TABLE vinted_orders ADD COLUMN IF NOT EXISTS batch_id TEXT;
ALTER TABLE vinted_orders ADD COLUMN IF NOT EXISTS label_pdf_url TEXT;

-- Storage bucket voor vooraf gecropte 4x6-labels (automatisch gevuld door
-- api/label-prefetch.js zodra een label beschikbaar komt)
INSERT INTO storage.buckets (id, name, public)
  VALUES ('labels', 'labels', true)
  ON CONFLICT DO NOTHING;

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
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS vault_sync_progress JSONB;

-- user_settings heeft (verderop in dit bestand) enkel een "authenticated"
-- RLS-policy — de Chrome-extensie gebruikt de anon-key (geen auth-sessie) en
-- kon dus vault_sync_requested/vault_sync_progress nooit lezen of resetten.
-- Deze view legt UITSLUITEND de sync-gerelateerde kolommen bloot (niet
-- vinted_cookie of andere gevoelige velden) zodat de extensie enkel deze
-- vlag kan lezen/bijwerken, zonder de rest van user_settings voor anon
-- open te zetten. Views draaien standaard met de rechten van de eigenaar
-- (niet de aanroeper), dus dit omzeilt bewust de RLS van de onderliggende
-- tabel — enkel voor deze 3 kolommen.
CREATE OR REPLACE VIEW user_sync_status AS
  SELECT user_id, vault_sync_requested, vault_sync_progress FROM user_settings;

GRANT SELECT, UPDATE ON user_sync_status TO anon;

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

-- ══════════════════════════════════════════════════════════════════
-- VINTED ACCOUNT KOPPELING (Vinted userId ↔ Supabase owner_id)
-- Laat de Chrome extensie (anon key) de juiste owner_id opzoeken
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS vinted_account_links (
  vinted_user_id TEXT PRIMARY KEY,
  owner_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  linked_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE vinted_account_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user beheert eigen link"
  ON vinted_account_links FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "anon kan lezen voor sync"
  ON vinted_account_links FOR SELECT TO anon USING (true);

-- ══════════════════════════════════════════════════════════════════
-- PENDING LINKS (tijdelijke koppelsessie webapp ↔ extensie)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pending_links (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  vinted_user_id TEXT,
  linked         BOOLEAN DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE pending_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user beheert eigen pending link"
  ON pending_links FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "anon kan updaten voor koppeling"
  ON pending_links FOR UPDATE TO anon USING (true);

CREATE POLICY "anon kan lezen voor koppeling"
  ON pending_links FOR SELECT TO anon USING (true);

-- ══════════════════════════════════════════════════════════════════
-- GENEGEERDE ORDERS — voorkomt dat een bewust verwijderde order (✕/bulk-
-- verwijderen in Verkopen.jsx/Aankopen.jsx) bij de volgende sync gewoon
-- terugkomt. api/sync-order.js checkt deze tabel vóór elke upsert — dat
-- endpoint is de enige gegarandeerde chokepoint voor alle sync-paden (Home-
-- knop, extensie-checkbox-flows, achtergrond-refresh).
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ignored_orders (
  owner_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL,
  ignored_at     TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (owner_id, transaction_id)
);

ALTER TABLE ignored_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user beheert eigen ignored orders"
  ON ignored_orders FOR ALL TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- ══════════════════════════════════════════════════════════════════
-- BEDRIJFSKOSTEN + FACTUREN-ARCHIEF (Kosten.jsx)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS business_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  category TEXT,
  cost_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE business_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user beheert eigen kosten" ON business_costs FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- Optionele koppeling met een geüploade factuur (storage-pad in de
-- 'invoices'-bucket hieronder) — laat 1 kost verwijzen naar 1 factuurbestand.
ALTER TABLE business_costs ADD COLUMN IF NOT EXISTS invoice_path TEXT;

-- Storage bucket voor geüploade facturen/bonnen (PDF/afbeeldingen),
-- zelfde opzet als de bestaande 'labels'/'order-photos'-buckets (public,
-- geen aparte object-RLS — het pad zelf is al niet te raden).
INSERT INTO storage.buckets (id, name, public)
  VALUES ('invoices', 'invoices', true)
  ON CONFLICT DO NOTHING;
