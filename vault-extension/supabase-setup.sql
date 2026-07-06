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
-- "Geprint"-vinkje op de Labels-pagina — handmatig en automatisch (na
-- download) gezet, persistent zodat de status ook op andere apparaten klopt.
ALTER TABLE vinted_orders ADD COLUMN IF NOT EXISTS label_printed BOOLEAN DEFAULT FALSE;

-- Vinted's numerieke transaction/shipment-statuscodes — primaire bron voor
-- classifyOrderStage() (skuUtils.js) achter de Home-dashboard-statuskaarten,
-- taalonafhankelijk en dus betrouwbaarder dan tekst-matching op status.
ALTER TABLE vinted_orders ADD COLUMN IF NOT EXISTS transaction_status INTEGER;
ALTER TABLE vinted_orders ADD COLUMN IF NOT EXISTS shipment_status INTEGER;
ALTER TABLE vinted_orders ADD COLUMN IF NOT EXISTS is_completed BOOLEAN;

-- Uitbetalingsdatum — Vinted heeft geen los payout/cashout-veld op transaction,
-- maar conversation.messages bevat een bericht met event_type "completed"
-- ("Je verkoop is afgerond!") waarvan created_at_ts functioneel de
-- uitbetalingsdatum is (moment van overmaking naar de Vinted Portemonnee).
-- Niet elke (oudere) order heeft dit bericht — dan blijft dit veld NULL.
ALTER TABLE vinted_orders ADD COLUMN IF NOT EXISTS payout_date TIMESTAMPTZ;

-- Exact verkooptijdstip — sale_date (DATE) blijft datum-only voor bestaande
-- consumers (Aankopen.jsx/Labels.jsx/sortering), sold_at is de aparte
-- kolom met de volledige timestamp voor de Verkopen-kaart.
ALTER TABLE vinted_orders ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ;

-- Handmatige status-override voor eigen administratie/overzicht — staat los
-- van de automatische Vinted-status (status/transaction_status/shipment_status
-- blijven ongemoeid). NULL = geen override, toon de automatische badge.
-- Toegestane waarden staan in MANUAL_STATUSES (skuUtils.js): to_process,
-- prepared, shipped, done, dispute, cancelled.
ALTER TABLE vinted_orders ADD COLUMN IF NOT EXISTS manual_status TEXT;

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

-- ══════════════════════════════════════════════════════════════════
-- ONBOARDING-FLOW (Onboarding.jsx, ook aanpasbaar via Settings.jsx)
-- ══════════════════════════════════════════════════════════════════
-- purchase_method bepaalt welke Voorraad/Nieuw/Aankopen-UI zichtbaar is
-- (zie Nav.jsx/Aankopen.jsx): 'vinted' | 'suppliers' | 'both'.
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS purchase_method TEXT DEFAULT 'both';
-- auto_sync_sales/auto_sync_purchases bepalen of de "nieuw"-bucket in
-- content.js's refreshKnownOrders() nieuwe verkopen/aankopen automatisch
-- meesynct via de Home-sync-knop, i.p.v. enkel handmatig via de extensie.
-- Sinds de "Live synchronisatie"-toggles in het extensiepaneel (⚙) hebben
-- deze twee een tweede betekenis gekregen: ze bepalen ook of background.js's
-- chrome.alarms-timer (elke ~4 min, zie runLiveSync()) deze databron
-- periodiek op de achtergrond ververst, niet enkel na een handmatige trigger.
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS auto_sync_sales BOOLEAN DEFAULT TRUE;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS auto_sync_purchases BOOLEAN DEFAULT FALSE;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS auto_sync_labels BOOLEAN DEFAULT FALSE;
-- Bewust opt-in en los van auto_sync_labels hierboven: dit klikt zelf de
-- "Label aanmaken"-actie in de Vinted-conversatie aan (een echte schrijfactie
-- bij Vinted, gedetecteerd via DOM-tekst-match, ongeverifieerd tegen een
-- publieke API — zie createLabelViaTab() in background.js), dus staat
-- standaard UIT.
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS auto_create_labels BOOLEAN DEFAULT FALSE;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;

-- Wanneer de extensie de sessiecookie voor het laatst automatisch heeft
-- ververst (zie api/save-vinted-cookie.js) — de webapp-Instellingen-pagina
-- toont hiermee "✓ Automatisch gekoppeld" met tijdstip i.p.v. het vroegere
-- handmatige plak-veld (te technisch voor niet-technische gebruikers, en een
-- verlopen cookie faalde stil zonder dit tijdstip om op te vertrouwen).
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS vinted_cookie_updated_at TIMESTAMPTZ;

-- user_settings heeft (verderop in dit bestand) enkel een "authenticated"
-- RLS-policy — de Chrome-extensie gebruikt de anon-key (geen auth-sessie) en
-- kon dus vault_sync_requested/vault_sync_progress nooit lezen of resetten.
-- Deze view legt UITSLUITEND de sync-gerelateerde kolommen bloot (niet
-- vinted_cookie of andere gevoelige velden) zodat de extensie enkel deze
-- vlag kan lezen/bijwerken, zonder de rest van user_settings voor anon
-- open te zetten. Views draaien standaard met de rechten van de eigenaar
-- (niet de aanroeper), dus dit omzeilt bewust de RLS van de onderliggende
-- tabel — enkel voor deze kolommen. auto_sync_sales/auto_sync_purchases
-- toegevoegd zodat refreshKnownOrders() (content.js) weet of de "nieuw"-
-- bucket voor verkopen/aankopen automatisch mag meesynct worden; purchase_
-- method/onboarding_completed blijven bewust WEL buiten deze view — die
-- heeft de extensie niet nodig, enkel de webapp (via de normale
-- authenticated RLS hieronder). auto_sync_labels toegevoegd voor dezelfde
-- reden — de Live-synchronisatie-toggle voor Labels in het extensiepaneel.
CREATE OR REPLACE VIEW user_sync_status AS
  SELECT user_id, vault_sync_requested, vault_sync_progress, auto_sync_sales, auto_sync_purchases, auto_sync_labels, auto_create_labels FROM user_settings;

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

-- onboarding_completed is nieuw en staat voor ELKE rij (ook al langer
-- bestaande accounts) standaard op FALSE — zonder deze update zie je de
-- onboarding-flow dus ook als je al langer gebruiker bent. Voer dit 1x uit
-- voor je eigen (en eventuele andere bestaande) account(s) als je de
-- onboarding niet opnieuw wil doorlopen:
-- UPDATE user_settings SET onboarding_completed = true WHERE onboarding_completed = false;

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

-- Vinted-profiel (login/avatar) — laat Instellingen.jsx's VintedAccountLink
-- het echte gekoppelde account tonen i.p.v. enkel "Gekoppeld". Gezet door
-- handleVaultLink (nieuwe koppeling) en best-effort backfilled door
-- api/save-vinted-cookie.js (elk Vinted-bezoek), zodat ook al vóór deze
-- feature gekoppelde accounts het automatisch krijgen.
ALTER TABLE vinted_account_links ADD COLUMN IF NOT EXISTS vinted_login TEXT;
ALTER TABLE vinted_account_links ADD COLUMN IF NOT EXISTS vinted_photo TEXT;

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

-- ══════════════════════════════════════════════════════════════════
-- WHOP.COM ABONNEMENT-GATING (Upgrade.jsx, AdminUsers.jsx, api/whop-status.js)
-- ══════════════════════════════════════════════════════════════════

-- is_admin: bypast de Whop-check volledig (eigenaar + eventuele andere
-- beheerders) EN geeft toegang tot de "Gebruikers"-pagina. Bewust één vlag
-- voor beide — er is geen apart "owner"-concept nodig.
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

-- whop_status/whop_checked_at: server-side cache (enkel gelezen/geschreven
-- door api/whop-status.js via SERVICE_KEY) zodat we niet bij elke laadbeurt
-- Whop's API bevragen. NOOIT door de client zelf gelezen of geschreven —
-- zie de REVOKE hieronder.
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS whop_status TEXT;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS whop_checked_at TIMESTAMPTZ;

-- whop_email_override: enkel handmatig te zetten door een beheerder (via SQL
-- editor) — lost het "Whop-aankoop-e-mail wijkt af van Vault Resell-login-
-- e-mail"-scenario op zonder dat de gebruiker moet heraankopen. Zie ook de
-- UI-melding in Upgrade.jsx.
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS whop_email_override TEXT;

-- BELANGRIJK: de bestaande "user beheert eigen settings"-policy is FOR ALL
-- zonder kolom-restrictie — zonder deze REVOKE zou een technische gebruiker
-- via de browser-devtools zelf `is_admin: true` of `whop_status: 'active'`
-- naar hun eigen rij kunnen schrijven (zelf-toegekende admin-rechten /
-- zelf-toegekende betaalstatus). Enkel de service-role (die RLS én
-- kolom-grants omzeilt) mag deze kolommen nog schrijven — dat gebeurt
-- uitsluitend vanuit api/whop-status.js en api/admin-users.js.
REVOKE UPDATE (is_admin, whop_status, whop_checked_at, whop_email_override)
  ON user_settings FROM authenticated;

-- Eenmalig: geef je eigen account admin/eigenaar-rechten (bypast Whop volledig,
-- toont de "Gebruikers"-pagina). Zoek je UUID op via Dashboard → Authentication
-- → Users, zoals bij de bestaande MIGRATIE-sectie hierboven in dit bestand.
-- LET OP: dit moet het user_id zijn van het account waarmee je ECHT bent
-- ingelogd in de webapp (te controleren via Network-tab → een user_settings-
-- request → user_id=eq.<UUID> in de query-string) — niet zomaar een UUID uit
-- de Authentication-lijst, die kan van een ander/verweesd account zijn.
-- UPDATE user_settings SET is_admin = true WHERE user_id = '<JOUW_UUID>';

-- is_super_admin: apart van is_admin — geeft géén extra Whop-bypass of
-- gebruikers-zichtbaarheid bovenop is_admin (die heb je al via is_admin),
-- maar bepaalt WIE via de Gebruikers-pagina andermans is_admin-vlag mag
-- aan/uitzetten. Voorkomt dat een gewone beheerder (bv. iemand die je later
-- zelf admin maakt) op zijn beurt weer nieuwe beheerders kan aanstellen —
-- enkel jijzelf (of wie jij expliciet super-admin maakt) kan dat.
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT FALSE;
REVOKE UPDATE (is_super_admin) ON user_settings FROM authenticated;

-- Eenmalig: geef je eigen account super-admin (zelfde UUID-waarschuwing als
-- hierboven).
-- UPDATE user_settings SET is_admin = true, is_super_admin = true WHERE user_id = '<JOUW_UUID>';
