import { useState, useMemo } from 'react'
import Modal from './Modal'
import { genId, formatSkuRange, calcSaleProfit, formatCurrency, getRemainingQty } from '../utils/skuUtils'

const PLATFORMS = ['Vinted', 'Privé', 'B2B']

export default function SaleModal({ data, onClose, onSave, defaultBatchId }) {
  const { batches, sales, suppliers } = data

  const [batchId, setBatchId] = useState(defaultBatchId || (batches[0]?.id ?? ''))
  const [type, setType] = useState('individual')
  const [qty, setQty] = useState(1)
  const [price, setPrice] = useState('')
  const [platform, setPlatform] = useState('Vinted')
  const [buyer, setBuyer] = useState('')
  const [fees, setFees] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])

  const batch = batches.find((b) => b.id === batchId)
  const remaining = batch ? getRemainingQty(batch, sales) : 0

  const vintedFee = useMemo(() => {
    if (platform !== 'Vinted' || !price) return 0
    return +(parseFloat(price) * 0.05 + 0.7).toFixed(2)
  }, [platform, price])

  const effectiveFees = fees !== '' ? parseFloat(fees) || 0 : (platform === 'Vinted' ? vintedFee : 0)
  const effectiveQty = type === 'bulk' ? parseInt(qty) || 1 : 1
  const profit = batch ? calcSaleProfit(
    { quantity: effectiveQty, salePrice: parseFloat(price) || 0, fees: effectiveFees },
    batch
  ) : null

  const handleSave = () => {
    if (!batch || !price) return
    const sale = {
      id: genId(),
      batchId,
      type,
      quantity: effectiveQty,
      salePrice: parseFloat(price),
      platform,
      buyer,
      fees: effectiveFees,
      date,
    }
    onSave(sale)
    onClose()
  }

  const batchLabel = (b) => {
    const range = formatSkuRange(b.supplierPrefix, b.startNum, b.endNum)
    const name = b.name || b.brand || b.category || ''
    return `${range}${name ? ` — ${name}` : ''}`
  }

  return (
    <Modal
      title="Verkoop registreren"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Annuleer</button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={!price || !batchId || effectiveQty > remaining}
          >
            Opslaan
          </button>
        </>
      }
    >
      <div className="form">
        <div className="form-group">
          <label>SKU / Batch</label>
          <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>{batchLabel(b)}</option>
            ))}
          </select>
          {batch && (
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
              Resterend: {remaining} stuks
            </span>
          )}
        </div>

        <div className="form-group">
          <label>Type</label>
          <div className="toggle-group">
            <button className={`toggle-btn${type === 'individual' ? ' active' : ''}`} onClick={() => setType('individual')}>
              Individueel
            </button>
            <button className={`toggle-btn${type === 'bulk' ? ' active' : ''}`} onClick={() => setType('bulk')}>
              Bulk
            </button>
          </div>
        </div>

        {type === 'bulk' && (
          <div className="form-group">
            <label>Aantal stuks</label>
            <input
              type="number"
              min="1"
              max={remaining}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
            {effectiveQty > remaining && (
              <span style={{ fontSize: 12, color: 'var(--red)' }}>Meer dan resterend!</span>
            )}
          </div>
        )}

        <div className="form-row">
          <div className="form-group">
            <label>Verkoopprijs per stuk (€)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="0,00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Datum</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        <div className="form-group">
          <label>Platform</label>
          <div className="platform-group">
            {PLATFORMS.map((p) => (
              <button
                key={p}
                className={`platform-btn${platform === p ? ' active' : ''}`}
                onClick={() => {
                  setPlatform(p)
                  setFees('')
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Fees (€){platform === 'Vinted' && fees === '' ? ` — auto: ${formatCurrency(vintedFee)}` : ''}</label>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder={platform === 'Vinted' ? vintedFee.toFixed(2) : '0,00'}
              value={fees}
              onChange={(e) => setFees(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Koper (optioneel)</label>
            <input type="text" placeholder="Naam of @handle" value={buyer} onChange={(e) => setBuyer(e.target.value)} />
          </div>
        </div>

        {profit && price && (
          <div className="profit-preview">
            <div className="profit-row">
              <span>Omzet ({effectiveQty}×)</span>
              <span>{formatCurrency(profit.totalRevenue)}</span>
            </div>
            <div className="profit-row">
              <span>Inkoopprijs</span>
              <span className="val-red">-{formatCurrency(profit.totalCost)}</span>
            </div>
            <div className="profit-row">
              <span>Fees</span>
              <span className="val-red">-{formatCurrency(effectiveFees)}</span>
            </div>
            <div className="profit-row total">
              <span>Netto winst</span>
              <span className={profit.profit >= 0 ? 'val-green' : 'val-red'}>
                {formatCurrency(profit.profit)}
              </span>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
