import Modal from './Modal'
import { formatCurrency, formatDate, formatSkuRange, calcSaleProfit, getBatchUnitCost } from '../utils/skuUtils'

const Stat = ({ label, value, color }) => (
  <div style={{ background: 'var(--bg-2)', borderRadius: 10, padding: '14px 16px' }}>
    <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
      {label}
    </div>
    <div style={{ fontSize: 20, fontWeight: 800, color: color || 'var(--text)' }}>
      {value}
    </div>
  </div>
)

export default function SkuDetailModal({ batch, sales, suppliers, onClose }) {
  if (!batch) return null

  const sup       = suppliers.find((s) => s.prefix === batch.supplierPrefix)
  const batchSales = sales.filter((s) => s.batchId === batch.id && !s.isFree)
  const freeSales  = sales.filter((s) => s.batchId === batch.id &&  s.isFree)

  const soldCount  = batchSales.reduce((n, s) => n + (s.quantity || 1), 0) +
                     freeSales.reduce((n, s)  => n + (s.quantity || 1), 0)
  const revenue    = batchSales.reduce((n, s) => n + (s.salePrice || 0) * (s.quantity || 1), 0)
  const avgPrice   = soldCount > 0 ? revenue / soldCount : 0
  const unitCost   = getBatchUnitCost(batch)

  const profits = batchSales.map((s) => calcSaleProfit(s, batch))
  const totalProfit = profits.reduce((n, p) => n + (p?.profit || 0), 0)

  const sku = formatSkuRange(batch.supplierPrefix, batch.startNum, batch.endNum)

  return (
    <Modal title={`SKU Detail — ${sku}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Identity */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 13 }}>
          {sup && (
            <span style={{
              background: (sup.color || '#666') + '18',
              color: sup.color || '#666',
              border: `1px solid ${sup.color || '#666'}30`,
              borderRadius: 6, padding: '3px 10px', fontWeight: 600,
            }}>
              {sup.name || sup.prefix}
            </span>
          )}
          {(batch.brand || batch.name) && (
            <span style={{ color: 'var(--text-2)', alignSelf: 'center' }}>
              {batch.brand}{batch.brand && batch.name ? ' · ' : ''}{batch.name}
            </span>
          )}
          {batch.category && (
            <span style={{ color: 'var(--text-3)', alignSelf: 'center' }}>{batch.category}</span>
          )}
        </div>

        {/* Stats grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          <Stat label="Inkoop / stuk" value={formatCurrency(unitCost)} />
          <Stat label="Omvang batch" value={`${batch.quantity} stuks`} />
          <Stat label="Verkocht" value={soldCount} color="var(--blue)" />
          <Stat label="Gem. verkoopprijs" value={soldCount ? formatCurrency(avgPrice) : '—'} />
          <Stat label="Totale omzet" value={formatCurrency(revenue)} />
          <Stat label="Totale winst" value={formatCurrency(totalProfit)}
            color={totalProfit >= 0 ? 'var(--green)' : 'var(--red)'} />
        </div>

        {/* Recent sales */}
        {batchSales.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Verkopen ({batchSales.length})
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[...batchSales].sort((a, b) => new Date(b.date) - new Date(a.date)).map((s) => {
                const p = calcSaleProfit(s, batch)
                return (
                  <div key={s.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '7px 10px', background: 'var(--bg-2)', borderRadius: 8, fontSize: 12,
                  }}>
                    <span style={{ color: 'var(--text-2)' }}>{formatDate(s.date)}{s.buyer ? ` · ${s.buyer}` : ''}</span>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      <span style={{ fontWeight: 600 }}>{formatCurrency((s.salePrice || 0) * (s.quantity || 1))}</span>
                      {p && (
                        <span style={{ fontWeight: 600, color: p.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {p.profit >= 0 ? '+' : ''}{formatCurrency(p.profit)}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
