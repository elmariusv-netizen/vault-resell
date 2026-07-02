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
