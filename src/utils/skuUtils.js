import { supabase } from './supabase'

export const genId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

export const pad = (n) => String(n).padStart(3, '0')

export function formatSku(prefix, num) {
  return `${prefix}${pad(num)}`
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
  if (startNum === endNum) return `${prefix}${pad(startNum)}`
  return `${prefix}${pad(startNum)}-${pad(endNum)}`
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
// Mapping opgebouwd uit live STATUS-MAPPING-logging (80+ orders):
//   transaction_status=510                 → geannuleerd/mislukt (terugbetaald)
//   is_completed===true                    → voltooid (dekt zowel 450 als 460,
//                                             ongeacht shipment_status-variant)
//   transaction_status=230, shipment_status=300 → onderweg (pakket echt in transit)
//   transaction_status=230, shipment_status=310 → bij afhaalpunt — het pakket
//                                             ligt al te wachten op ophalen
//                                             door de koper (postkantoor/
//                                             afhaalpunt), dat vóelt voor de
//                                             gebruiker niet meer als
//                                             "onderweg". Geen van beide
//                                             hoort ooit bij "te verzenden":
//                                             de verkoper heeft in BEIDE
//                                             gevallen al verzonden.
//   transaction_status=230, overige/onbekende shipment_status → onderweg
//                                             (veiligste default voor een
//                                             nog niet geziene variant)
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
    if (numericStatus === 230) return shipmentStatus === 310 ? 'at_pickup_point' : 'in_transit'
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
export function getUsedSkus(allOrders, excludeOrderIds = []) {
  const exclude = new Set(excludeOrderIds)
  const used = new Set()
  for (const o of allOrders || []) {
    if (exclude.has(o.id) || !o.sku_ref) continue
    o.sku_ref.split(',').forEach(s => { const t = s.trim().toUpperCase(); if (t) used.add(t) })
  }
  return used
}

export function getFreeSkusForBatch(batch, usedSkus) {
  const all = []
  for (let n = batch.startNum; n <= batch.endNum; n++) all.push(formatSku(batch.supplierPrefix, n))
  return all.filter(s => !usedSkus.has(s))
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
export function assignSlotSkus(slotKeys, freeSkus, overrides = {}) {
  const slotSkus = {}
  const claimed = new Set()
  for (const key of slotKeys) {
    let sku = overrides[key]
    if (!sku || !freeSkus.includes(sku) || claimed.has(sku)) {
      sku = freeSkus.find(s => !claimed.has(s)) || ''
    }
    slotSkus[key] = sku
    if (sku) claimed.add(sku)
  }
  return slotSkus
}

// Dropdown-opties voor 1 slot: alle vrije SKU's, min de SKU's die door
// ANDERE slots in dezelfde actie al gekozen zijn (de eigen huidige keuze
// blijft wel altijd zichtbaar in zijn eigen dropdown).
export function skuOptionsForSlot(slotKey, slotSkus, freeSkus) {
  const claimedByOthers = new Set(
    Object.entries(slotSkus).filter(([k]) => k !== slotKey).map(([, v]) => v)
  )
  return freeSkus.filter(s => s === slotSkus[slotKey] || !claimedByOthers.has(s))
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
