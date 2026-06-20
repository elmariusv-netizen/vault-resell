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
    .reduce((sum, s) => sum + (s.quantity || 0), 0)
  return Math.max(0, batch.quantity - sold)
}

export function calcSaleProfit(sale, batch) {
  const unitCost = (batch.costPrice || 0) + (batch.importTax || 0)
  const totalCost = unitCost * (sale.quantity || 1)
  const totalRevenue = (sale.salePrice || 0) * (sale.quantity || 1)
  const fees = sale.fees || 0
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

export function getSupplierColor(suppliers, prefix) {
  const s = suppliers.find((s) => s.prefix === prefix)
  return s?.color || '#666'
}
