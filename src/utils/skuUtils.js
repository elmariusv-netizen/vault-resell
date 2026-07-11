import { supabase } from './supabase'

export const genId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

// SKU's krijgen geen voorloopnullen meer (RIA20 i.p.v. RIA020, RIA100 blijft
// RIA100) — enige plek waar het nummer bij de prefix geplakt wordt, dus alle
// weergaves (Home/Inventory/Stats/Settings/... gebruiken allemaal formatSku/
// formatSkuRange) tonen vanzelf de nieuwe notatie. Bestaande batches (die
// enkel startNum/endNum als getal opslaan, geen geformatteerde string) tonen
// dus automatisch de nieuwe notatie — enkel al opgeslagen SKU-tékst
// (vinted_orders.sku_ref) is geschreven vóór deze wijziging en moet apart
// gemigreerd worden, zie vault-extension/migrate-sku-no-padding.sql en
// normalizeSku()/getUsedSkus() hieronder (die blijven ook de oude, gepadde
// notatie herkennen, migratie of niet).
export function formatSku(prefix, num) {
  return `${prefix}${num}`
}

export function getNextSkuNum(batches, prefix) {
  const maxEnd = batches
    .filter((b) => b.supplierPrefix === prefix)
    .reduce((m, b) => Math.max(m, b.endNum || 0), 0)
  return maxEnd + 1
}

export function getNextSkuLabel(batches, prefix) {
  return formatSku(prefix, getNextSkuNum(batches, prefix))
}

export function formatSkuRange(prefix, startNum, endNum) {
  if (startNum === endNum) return `${prefix}${startNum}`
  return `${prefix}${startNum}-${endNum}`
}

export function getNextRange(batches, supplierPrefix, quantity) {
  const sup = batches.filter((b) => b.supplierPrefix === supplierPrefix)
  const maxEnd = sup.reduce((m, b) => Math.max(m, b.endNum || 0), 0)
  const startNum = maxEnd + 1
  const endNum = startNum + quantity - 1
  return { startNum, endNum }
}

export function getRemainingQty(batch, sales) {
  const sold = sales
    .filter((s) => s.batchId === batch.id)
    .reduce((sum, s) => sum + (s.quantity || 1), 0)
  return Math.max(0, batch.quantity - sold)
}

export function calcSaleProfit(sale, batch) {
  const totalCost = getBatchUnitCost(batch) * (sale.quantity || 1)
  if (sale.isFree) {
    return { totalCost, totalRevenue: 0, fees: 0, profit: 0 }
  }
  const totalRevenue = (sale.salePrice || 0) * (sale.quantity || 1)
  const fees = (sale.fees || 0) + (sale.shippingCost || 0)
  const profit = totalRevenue - totalCost - fees
  return { totalCost, totalRevenue, fees, profit }
}

export function formatCurrency(n) {
  if (n == null || isNaN(n)) return '€0,00'
  return new Intl.NumberFormat('nl-BE', {
    style: 'currency',
    currency: 'EUR',
  }).format(n)
}

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d)) return dateStr
  return d.toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function formatDateLong(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d)) return dateStr
  return new Intl.DateTimeFormat('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' }).format(d)
}

// Zelfde als formatDateLong, maar met het exacte tijdstip erbij (bv. voor
// vinted_orders.sold_at, dat — in tegenstelling tot sale_date — een
// volledige timestamp bevat) — "28 juni 2026, 15:10". nl-BE's ingebouwde
// datetime-format zet er "om" tussen i.p.v. een komma, dus datum en tijd
// worden apart geformatteerd en zelf samengevoegd.
export function formatDateTimeLong(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d)) return dateStr
  const time = new Intl.DateTimeFormat('nl-BE', { hour: '2-digit', minute: '2-digit' }).format(d)
  return `${formatDateLong(dateStr)}, ${time}`
}

export function getSupplierColor(suppliers, prefix) {
  const s = suppliers.find((s) => s.prefix === prefix)
  return s?.color || '#666'
}

export function normalizePlatform(p) {
  if (p === 'Privé') return 'Privé persoon'
  if (p === 'B2B') return 'Medeverkoper/Groothandel'
  return p || p
}

// Enige bron van waarheid voor "is er een écht geverifieerd label
// beschikbaar" — gebruikt door zowel Verkopen.jsx (kaart-badge) als
// Labels.jsx (lijst-query), zodat ze nooit meer uit elkaar kunnen lopen.
// label_available wordt UITSLUITEND op true gezet door api/label-prefetch.js
// nadat de PDF-magic-bytes-check geslaagd is (zie ook label_pdf_url, dat
// tegelijk gezet wordt) — nooit op basis van Vinted's eigen statustekst
// (transactionUserStatus/"verzendlabel"), want die bleek onbetrouwbaar.
export function isLabelReady(order) {
  return !!(order?.label_available && order?.label_pdf_url)
}

export const COUNTRY_FLAGS = { BE:'🇧🇪',NL:'🇳🇱',FR:'🇫🇷',DE:'🇩🇪',ES:'🇪🇸',IT:'🇮🇹',PL:'🇵🇱',CZ:'🇨🇿',PT:'🇵🇹',SE:'🇸🇪',FI:'🇫🇮',LT:'🇱🇹',LV:'🇱🇻',EE:'🇪🇪' }

// ── Status-classificatie — enige bron van waarheid voor "is deze order al
// verzonden/afgeleverd", gedeeld tussen getStatusBadge() hieronder en de
// Home-dashboard-statistieken (Verkopen.jsx-status is de bron, niet een
// losse handmatige vlag) ─────────────────────────────────────────────────
export function isCancelledStatus(status) {
  return /cancel|geannul/i.test(status || '')
}

export function isFinishedStatus(status) {
  const s = (status || '').toLowerCase()
  return s.includes('geleverd') || s.includes('delivered') || s.includes('ontvangen')
      || s.includes('complet') || s.includes('voltooid') || s.includes('closed') || s.includes('afgerond')
}

export function isInTransitStatus(status) {
  if (isFinishedStatus(status)) return false
  const s = (status || '').toLowerCase()
  return s.includes('verzond') || s.includes('shipped') || s.includes('transit') || s.includes('onderweg')
}

// ── Order-fase-classificatie — PRIMAIR op Vinted's numerieke transaction/
// shipment-statuscodes (taalonafhankelijk, dus betrouwbaarder dan tekst-
// matching), met de tekst-classificatie hierboven als FALLBACK voor orders
// die nog geen transaction_status/is_completed hebben (nog niet opnieuw
// gesynct sinds die velden zijn toegevoegd — dan is transaction_status null).
//
// Mapping opgebouwd uit live STATUS-MAPPING-logging (80+ orders), plus een
// gerichte correctie (2026-07) na een live vergelijking tegen Vinted's eigen
// statustekst: transaction_status=230 wordt bereikt zodra het verzendlabel
// klaarstaat, NIET pas zodra de verkoper het pakket ook echt afgeeft — de
// shipment_status maakt dat onderscheid pas. shipment_status=230 bleek in de
// praktijk exact "Verzendlabel is naar de verkoper gestuurd." te zijn (dus
// nog te verzenden), niet "onderweg" zoals de vorige "veiligste default"
// aannam — die default stond dus verkeerd om.
//   transaction_status=510                 → geannuleerd/mislukt (terugbetaald)
//   is_completed===true                    → voltooid (dekt zowel 450 als 460,
//                                             ongeacht shipment_status-variant)
//   transaction_status=230, shipment_status=300 → onderweg (pakket echt in transit)
//   transaction_status=230, shipment_status=310 → bij afhaalpunt — het pakket
//                                             ligt al te wachten op ophalen
//                                             door de koper (postkantoor/
//                                             afhaalpunt), dat vóelt voor de
//                                             gebruiker niet meer als
//                                             "onderweg".
//   transaction_status=230, overige/onbekende shipment_status (bv. 230 zelf)
//                                           → te verzenden (label staat klaar,
//                                             maar is nog niet als "verzonden"
//                                             of "bij afhaalpunt" bevestigd)
//   transaction_status=430                 → gepauzeerd (probleemgeval, telt
//                                             nergens in mee — geen normale
//                                             voortgang)
//   overige/onbekende codes                → te verzenden (nog geen van de
//                                             bovenstaande fases bereikt)
export function classifyOrderStage(order) {
  const numericStatus = order?.transaction_status ?? order?.transactionStatus
  const shipmentStatus = order?.shipment_status ?? order?.shipmentStatus
  const isCompleted = order?.is_completed ?? order?.isCompleted

  if (numericStatus != null) {
    if (numericStatus === 510) return 'cancelled'
    if (isCompleted === true) return 'finished'
    if (numericStatus === 230) {
      if (shipmentStatus === 310) return 'at_pickup_point'
      if (shipmentStatus === 300) return 'in_transit'
      return 'to_ship'
    }
    if (numericStatus === 430) return 'paused'
    return 'to_ship'
  }

  // Fallback: tekst-classificatie voor orders zonder numerieke velden. Kent
  // (nog) geen apart "bij afhaalpunt" — zo'n order valt hier terug op
  // 'to_ship', dezelfde bestaande beperking als vóór deze numerieke fix.
  const status = order?.status
  if (isCancelledStatus(status)) return 'cancelled'
  if (isFinishedStatus(status)) return 'finished'
  if (isInTransitStatus(status)) return 'in_transit'
  return 'to_ship'
}

// ── Status badge — gedeeld tussen Verkopen.jsx en Aankopen.jsx ─────────────
// labelAvailable moet hier al de geverifieerde waarde zijn (isLabelReady(order)
// hierboven, niet enkel het ruwe order.label_available of een gok op
// statustekst) — anders duiken orders zonder écht ophaalbaar label toch op
// als "Label gereed", precies de bug die de Labels-pagina eerder al oploste
// via de PDF-verificatie maar die elders los stond.
export function getStatusBadge(status, labelAvailable) {
  if (labelAvailable)
    return { label: 'Label gereed', color: '#d97706', bg: 'rgba(245,158,11,0.12)' }
  if (isFinishedStatus(status))
    return { label: /geleverd|delivered|ontvangen/i.test(status || '') ? 'Geleverd' : 'Voltooid', color: '#16a34a', bg: 'rgba(22,163,74,0.1)' }
  if (isInTransitStatus(status))
    return { label: 'Onderweg', color: '#2563eb', bg: 'rgba(37,99,235,0.1)' }
  if (isCancelledStatus(status))
    return { label: 'Geannuleerd', color: '#dc2626', bg: 'rgba(220,38,38,0.1)' }
  if (status) return { label: status.length > 36 ? status.slice(0, 36) + '…' : status, color: '#6b7280', bg: 'rgba(107,114,128,0.08)' }
  return null
}

// ── Handmatige status — overschrijft de automatische Vinted-status enkel voor
// weergave/administratie (order.status zelf blijft ongemoeid, dus de
// automatische classificatie hierboven blijft altijd correct werken). Wordt
// opgeslagen in vinted_orders.manual_status (TEXT, nullable) — null betekent
// "geen override, toon de automatische badge".
export const MANUAL_STATUSES = [
  { value: 'to_process', label: 'À traiter',  icon: '⏱', color: '#d97706', bg: 'rgba(217,119,6,0.12)' },
  { value: 'prepared',   label: 'Préparée',   icon: '📦', color: '#2563eb', bg: 'rgba(37,99,235,0.12)' },
  { value: 'shipped',    label: 'Expédiée',   icon: '🚚', color: '#9333ea', bg: 'rgba(147,51,234,0.12)' },
  { value: 'done',       label: 'Terminée',   icon: '✓',  color: '#16a34a', bg: 'rgba(22,163,74,0.12)' },
  { value: 'dispute',    label: 'En litige',  icon: '⚠',  color: '#ea580c', bg: 'rgba(234,88,12,0.12)' },
  { value: 'cancelled',  label: 'Annulée',    icon: '⊗',  color: '#6b7280', bg: 'rgba(107,114,128,0.10)' },
]

export function getManualStatus(value) {
  return MANUAL_STATUSES.find(s => s.value === value) || null
}

// Effectieve badge voor read-only weergave (bv. de detail-modal): handmatige
// keuze heeft voorrang, anders de automatische badge — dezelfde voorrangsregel
// als de klikbare badge op de kaart, zodat beide plekken nooit uiteenlopen.
export function getEffectiveStatusBadge(order) {
  const manual = getManualStatus(order?.manual_status)
  if (manual) return { label: manual.label, icon: manual.icon, color: manual.color, bg: manual.bg }
  const auto = getStatusBadge(order?.status, isLabelReady(order))
  return auto ? { ...auto, icon: null } : null
}

// ── Gedeelde "welke SKU's zijn al gebruikt"-logica ─────────────────────────
// Enige bron van waarheid voor zowel SkuPickerModal (los, per order) als
// BulkSkuModal (bulk) — beide moeten exact hetzelfde "beschikbaar"-getal
// tonen voor dezelfde batch, anders lopen ze uiteen.
//
// Een SKU telt als "gebruikt" zodra hij voorkomt in het sku_ref-veld van een
// ANDERE vinted_orders-rij (sku_ref kan een kommagescheiden lijst zijn bij
// bundel-orders). Orders in excludeOrderIds (de order(s) die je nu net aan
// het (her)koppelen bent) tellen niet mee — hun eigen bestaande koppeling mag
// herzien worden zonder zichzelf te blokkeren.
// Herleidt een los SKU-tekstfragment naar zijn canonieke, padding-vrije vorm
// ("RIA056" én "RIA56" -> "RIA56") — zodat een sku_ref die nog in de oude
// notatie staat (geschreven vóór de SKU-migratie, zie
// vault-extension/migrate-sku-no-padding.sql) nooit per ongeluk als "vrij"
// getoond wordt tegenover freeSkus (die sinds formatSku() hierboven zonder
// padding genereert) — deze normalisatie werkt dus ook als die migratie nog
// niet gedraaid is.
function normalizeSku(text) {
  const m = String(text).trim().match(/^([A-Za-z]{2,4})[\s-]?0*(\d+)$/)
  return m ? `${m[1].toUpperCase()}${m[2]}` : String(text).trim().toUpperCase()
}

export function getUsedSkus(allOrders, excludeOrderIds = []) {
  const exclude = new Set(excludeOrderIds)
  const used = new Set()
  for (const o of allOrders || []) {
    if (exclude.has(o.id) || !o.sku_ref) continue
    o.sku_ref.split(',').forEach(s => { const t = normalizeSku(s); if (t) used.add(t) })
  }
  return used
}

export function getFreeSkusForBatch(batch, usedSkus) {
  const all = []
  for (let n = batch.startNum; n <= batch.endNum; n++) all.push(formatSku(batch.supplierPrefix, n))
  return all.filter(s => !usedSkus.has(s))
}

// ── Tekst → batch matching — enige bron van waarheid om een RUWE, ergens
// gedetecteerde SKU-tekst (bv. uit een Vinted-advertentietitel/-beschrijving,
// zie de auto-registratie in Verkopen.jsx) te herleiden naar de bestaande
// aankoop-batch waartoe hij hoort. Herbruikt dezelfde velden als
// getFreeSkusForBatch/formatSku (supplierPrefix + startNum/endNum) i.p.v. een
// aparte matching-implementatie — zodat er nooit 2 losse "wat is dit
// SKU-nummer"-interpretaties kunnen ontstaan.
// Accepteert notatie-varianten: hoofdletters/kleine letters, met of zonder
// spatie/koppelteken tussen prefix en nummer ("RIA056" / "RIA 056" /
// "ria-056"), en nummers zonder voorloop-nullen ("RIA56").
export function findBatchForSku(batches, skuText) {
  if (!skuText) return null
  const m = String(skuText).trim().match(/^([A-Za-z]{2,4})[\s-]?(\d{1,6})$/)
  if (!m) return null
  const prefix = m[1].toUpperCase()
  const num = parseInt(m[2], 10)
  return (batches || []).find(b => b.supplierPrefix === prefix && num >= b.startNum && num <= b.endNum) || null
}

// Eenheidskostprijs (COGS) van 1 artikel uit een batch — enige bron van
// waarheid bij het koppelen van een BESTAANDE batch aan een order, gedeeld
// tussen SkuPickerModal se aanroepers (Verkopen.jsx "SKU koppelen",
// AankoopSkuModal) en BulkSkuModal, zodat cost_price nooit op 2 plekken
// anders berekend wordt.
// importTax is een TOTAAL bedrag voor de hele batch (ingevoerd bij het
// aanmaken van de batch in Voorraad), geen bedrag per stuk — moet dus eerst
// door de batch-hoeveelheid gedeeld worden vóór het bij costPrice (dat al wél
// een per-stuk bedrag is) opgeteld wordt.
export function getBatchUnitCost(batch) {
  const unitTax = (batch?.importTax || 0) / (batch?.quantity || 1)
  return (batch?.costPrice || 0) + unitTax
}

// ── Slot-toewijzing voor meerdere SKU-dropdowns uit dezelfde batch — enige
// bron van waarheid, gedeeld tussen BulkSkuModal en SkuPickerModal se
// "meerdere artikelen"-modus, zodat er geen 2 losse implementaties van
// dezelfde claim-logica ontstaan.
//
// Elk slot krijgt de handmatige override (overrides[key]) als die zelf nog
// vrij is en niet al door een EERDER slot geclaimd werd binnen dezelfde
// actie, anders de eerste nog niet-geclaimde vrije SKU. Voorkomt dat
// dezelfde SKU tweemaal in 1 actie terechtkomt.
//
// freeSkus mag een vaste array zijn (elk slot dezelfde pool — bv. SkuPickerModal,
// altijd 1 batch) OF een functie (slotKey) => string[] die per slot een EIGEN
// pool teruggeeft (bv. BulkSkuModal se multi-leverancier-modus, waar elk item
// in een bundel-verkoop uit een andere batch/leverancier mag komen).
export function assignSlotSkus(slotKeys, freeSkus, overrides = {}) {
  const freeSkusFor = typeof freeSkus === 'function' ? freeSkus : () => freeSkus
  const slotSkus = {}
  const claimed = new Set()
  for (const key of slotKeys) {
    const free = freeSkusFor(key)
    let sku = overrides[key]
    if (!sku || !free.includes(sku) || claimed.has(sku)) {
      sku = free.find(s => !claimed.has(s)) || ''
    }
    slotSkus[key] = sku
    if (sku) claimed.add(sku)
  }
  return slotSkus
}

// Dropdown-opties voor 1 slot: alle vrije SKU's (uit de eigen pool van dit
// slot — zie freeSkus-uitleg hierboven), min de SKU's die door ANDERE slots
// in dezelfde actie al gekozen zijn (de eigen huidige keuze blijft wel altijd
// zichtbaar in zijn eigen dropdown).
export function skuOptionsForSlot(slotKey, slotSkus, freeSkus) {
  const free = (typeof freeSkus === 'function' ? freeSkus(slotKey) : freeSkus)
  const claimedByOthers = new Set(
    Object.entries(slotSkus).filter(([k]) => k !== slotKey).map(([, v]) => v)
  )
  return free.filter(s => s === slotSkus[slotKey] || !claimedByOthers.has(s))
}

// ── Titel-keyword-matching — voor Stats.jsx's beste-categorie/kleur/maat-
// analyse: producttitels bevatten geen apart category/color/size-veld, dus
// worden die via keyword-matching uit de vrije titeltekst herleid (dezelfde
// aanpak als Verkopen.jsx's eigen, losse merk/maat/kleur-detectie voor de
// meta-regel onder een order — hier een eigen kopie omdat Verkopen.jsx zijn
// lijsten module-lokaal houdt).
//
// 'shirt'/'t-shirt'/'tshirt' staan bewust NIET in deze lijst maar in de
// aparte GENERIC_SHIRT_MAP hieronder — titels vermelden "shirt" vaak als
// generieke/SEO-vertaling náást een specifiekere term ("polo shirt", "hemd
// shirt chemise"), dus zou 'shirt' anders altijd winnen van 'polo'/'hemd' en
// alles onder "T-shirts" laten vallen (bevestigd: dit was precies de bug
// achter een foutieve "T-shirts"-top-categorie terwijl de meeste verkopen
// polo's/overhemden waren). 'hemd'/'chemise' zijn toegevoegd — ontbraken
// eerder volledig, enkel 'overhemd' werd herkend.
const CATEGORIES_MAP = [
  ['polo', "Polo's"], ['hoodie', 'Hoodies'],
  ['sweater', 'Truien'], ['trui', 'Truien'],
  ['overhemd', 'Overhemden'], ['hemd', 'Overhemden'], ['chemise', 'Overhemden'],
  ['vest', 'Vesten'],
  ['jacket', 'Jassen'], ['coat', 'Jassen'], ['jas', 'Jassen'],
  ['jeans', 'Jeans'], ['broek', 'Broeken'], ['pants', 'Broeken'], ['short', 'Shorts'],
  ['jurk', 'Jurken'], ['dress', 'Jurken'], ['rok', 'Rokken'],
  ['blouse', 'Blouses'],
  ['sneakers', 'Schoenen'], ['schoenen', 'Schoenen'], ['boots', 'Schoenen'],
  ['pet', 'Petten'], ['muts', 'Mutsen'], ['sjaal', 'Sjaals'],
  ['tas', 'Tassen'], ['riem', 'Riemen'],
]
// Generieke restcategorie — enkel gebruikt als niets uit CATEGORIES_MAP
// ergens in de titel voorkomt (zie detectTitleMeta hieronder).
const GENERIC_SHIRT_MAP = [['t-shirt', 'T-shirts'], ['tshirt', 'T-shirts'], ['shirt', 'T-shirts']]
const TITLE_COLORS_MAP = [
  ['zwart','Zwart'], ['black','Zwart'], ['wit','Wit'], ['white','Wit'],
  ['blauw','Blauw'], ['blue','Blauw'], ['navy','Blauw'], ['marineblauw','Blauw'],
  ['rood','Rood'], ['red','Rood'], ['roze','Roze'], ['pink','Roze'], ['fuchsia','Roze'],
  ['groen','Groen'], ['green','Groen'], ['kaki','Kaki'], ['khaki','Kaki'], ['olijf','Groen'],
  ['geel','Geel'], ['yellow','Geel'], ['paars','Paars'], ['purple','Paars'], ['violet','Paars'],
  ['oranje','Oranje'], ['orange','Oranje'], ['grijs','Grijs'], ['grey','Grijs'], ['gray','Grijs'],
  ['beige','Beige'], ['creme','Beige'], ['cream','Beige'], ['ecru','Beige'],
  ['bruin','Bruin'], ['brown','Bruin'], ['camel','Bruin'], ['cognac','Bruin'],
  ['bordeaux','Bordeaux'], ['wijnrood','Bordeaux'], ['lila','Lila'], ['mintgroen','Groen'],
]
const TITLE_SIZES = ['xxxl','xxl','xl','xs','xxs','3xl','2xl','one size',
  '50','48','46','44','42','40','38','36','34','32','30',
  '27','28','29','31','33','s','m','l']

// Geeft het label terug van de match die het EERST in de titel zelf
// voorkomt (kleinste string-index), i.p.v. de eerste match volgens de vaste
// volgorde van de keyword-lijst — een titel als "roze wit gestreept" moet
// "Roze" opleveren (eerst genoemd = hoofdkleur), niet "Wit" enkel omdat
// 'wit' toevallig eerder in TITLE_COLORS_MAP staat dan 'roze'.
function firstMatchByPosition(t, map) {
  let best = null, bestIdx = Infinity
  for (const [kw, label] of map) {
    const idx = t.indexOf(kw)
    if (idx !== -1 && idx < bestIdx) { bestIdx = idx; best = label }
  }
  return best
}

// Herleidt categorie/kleur/maat uit een vrije producttitel via keyword-
// matching (case-insensitive). Categorie valt pas op de generieke
// GENERIC_SHIRT_MAP terug als niets uit CATEGORIES_MAP matcht. Maat
// gebruikt een woordgrens-regex (i.p.v. .includes()) zodat bv. de maat "s"
// niet per ongeluk binnenin een ander woord matcht, en kiest — net als
// categorie/kleur — de maat die het eerst in de titel voorkomt.
export function detectTitleMeta(title) {
  const t = (title || '').toLowerCase()
  const category = firstMatchByPosition(t, CATEGORIES_MAP) || firstMatchByPosition(t, GENERIC_SHIRT_MAP) || ''
  const color = firstMatchByPosition(t, TITLE_COLORS_MAP) || ''
  let size = '', sizeIdx = Infinity
  for (const s of TITLE_SIZES) {
    const m = t.match(new RegExp(`(?:^|\\s|maat\\s*)(${s})(?:\\s|$|/)`, 'i'))
    if (m && m.index < sizeIdx) { sizeIdx = m.index; size = s.toUpperCase() }
  }
  return { category, color, size }
}

// ── Bedrijfskosten — gedeeld tussen Kosten.jsx (totaal bovenaan) en
// Stats.jsx (aftrek van de netto winst), zodat ze nooit uit elkaar kunnen
// lopen. business_costs is een losse, RLS-beveiligde tabel (owner_id =
// auth.uid()), dus dit gaat via een directe Supabase-query, niet via de
// user_data/payload-blob die batches/sales/suppliers bevat.
export async function fetchBusinessCosts() {
  const { data, error } = await supabase
    .from('business_costs')
    .select('*')
    .order('cost_date', { ascending: false })
  if (error) { console.warn('[Vault] business_costs fetch error:', error); return [] }
  return data || []
}

export function sumCosts(costs) {
  return (costs || []).reduce((s, c) => s + (parseFloat(c.amount) || 0), 0)
}
