-- ─────────────────────────────────────────────────────────────────────────
-- Migratie: SKU's zonder voorloopnullen (RIA20 i.p.v. RIA020)
-- ─────────────────────────────────────────────────────────────────────────
-- Achtergrond: de app genereert/toont SKU's voortaan zonder padding
-- (src/utils/skuUtils.js: formatSku/formatSkuRange). Batches (voorraad,
-- leverancier-tellers) slaan enkel startNum/endNum als GETAL op, dus die
-- tonen de nieuwe notatie vanzelf, overal in de app — geen migratie nodig.
--
-- De ENIGE plek waar een geformatteerde SKU-TEKST persistent opgeslagen
-- staat is vinted_orders.sku_ref (kommagescheiden bij bundel-orders, bv.
-- "RIA056, IND012"). Deze migratie herschrijft die kolom naar de nieuwe,
-- padding-vrije notatie.
--
-- Niet strikt noodzakelijk voor correcte werking: skuUtils.js's
-- getUsedSkus()/findBatchForSku() herkennen zowel de oude als de nieuwe
-- notatie (zie normalizeSku() in skuUtils.js), dus de app blijft ook zonder
-- deze migratie correct werken. Dit is puur om de opgeslagen data consistent
-- te maken met de nieuwe weergave.
--
-- Voer STAP 1 en 2 hieronder na elkaar uit in de Supabase SQL-editor.

-- ── STAP 1 — Backup/inspectie ───────────────────────────────────────────
-- Bekijk (en exporteer, bv. via de "Export"-knop van de SQL-editor) alle
-- rijen die STAP 2 gaat wijzigen, VOORDAT je die uitvoert. Bewaar dit
-- resultaat als je de migratie handmatig wil kunnen terugdraaien.
SELECT id, sku_ref
FROM vinted_orders
WHERE sku_ref ~ '[A-Za-z]{2,4}0\d';

-- ── STAP 2 — Migratie ────────────────────────────────────────────────────
-- Herschrijft elke SKU-code in sku_ref (kommagescheiden lijst mogelijk) naar
-- zijn padding-vrije vorm: "RIA056" -> "RIA56", "RIA056, IND012" ->
-- "RIA56, IND12". Puur tekstuele normalisatie van hetzelfde nummer — geen
-- enkele SKU verandert van batch of betekenis.
--
-- Omkeerbaar: STAP 1's export bevat de originele waarden om terug te zetten.
UPDATE vinted_orders
SET sku_ref = (
  SELECT string_agg(
    regexp_replace(trim(part), '^([A-Za-z]{2,4})0*(\d+)$', '\1\2'),
    ', '
  )
  FROM unnest(string_to_array(sku_ref, ',')) AS part
)
WHERE sku_ref ~ '[A-Za-z]{2,4}0\d';

-- ── STAP 3 — Controle ────────────────────────────────────────────────────
-- Moet 0 rijen teruggeven.
SELECT id, sku_ref
FROM vinted_orders
WHERE sku_ref ~ '[A-Za-z]{2,4}0\d';
