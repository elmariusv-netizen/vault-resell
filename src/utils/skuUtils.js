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
  if (sale.isFree) {
    const unitCost = (batch.costPrice || 0) + (batch.importTax || 0)
    const totalCost = unitCost * (sale.quantity || 1)
    return { totalCost, totalRevenue: 0, fees: 0, profit: 0 }
  }
  const unitCost = (batch.costPrice || 0) + (batch.importTax || 0)
  const totalCost = unitCost * (sale.quantity || 1)
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

// ── Status badge — gedeeld tussen Verkopen.jsx en Aankopen.jsx ─────────────
// labelAvailable moet hier al de geverifieerde waarde zijn (isLabelReady(order)
// hierboven, niet enkel het ruwe order.label_available of een gok op
// statustekst) — anders duiken orders zonder écht ophaalbaar label toch op
// als "Label gereed", precies de bug die de Labels-pagina eerder al oploste
// via de PDF-verificatie maar die elders los stond.
export function getStatusBadge(status, labelAvailable) {
  const s = (status || '').toLowerCase()
  if (labelAvailable)
    return { label: 'Label gereed', color: '#d97706', bg: 'rgba(245,158,11,0.12)' }
  if (s.includes('geleverd') || s.includes('delivered') || s.includes('ontvangen'))
    return { label: 'Geleverd', color: '#16a34a', bg: 'rgba(22,163,74,0.1)' }
  if (s.includes('verzond') || s.includes('shipped') || s.includes('transit') || s.includes('onderweg'))
    return { label: 'Onderweg', color: '#2563eb', bg: 'rgba(37,99,235,0.1)' }
  if (s.includes('complet') || s.includes('voltooid') || s.includes('closed') || s.includes('afgerond'))
    return { label: 'Voltooid', color: '#16a34a', bg: 'rgba(22,163,74,0.1)' }
  if (s.includes('cancel') || s.includes('geannul'))
    return { label: 'Geannuleerd', color: '#dc2626', bg: 'rgba(220,38,38,0.1)' }
  if (status) return { label: status.length > 36 ? status.slice(0, 36) + '…' : status, color: '#6b7280', bg: 'rgba(107,114,128,0.08)' }
  return null
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
