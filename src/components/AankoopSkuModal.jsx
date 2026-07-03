import { useState } from 'react'
import SkuPickerModal from './SkuPickerModal'
import { getNextSkuNum, formatSku, genId, getBatchUnitCost } from '../utils/skuUtils'

// ── Aankoop ↔ voorraad-batch koppeling ─────────────────────────────────────
// Vervangt de vorige "Voor mezelf"/"Voor de handel"-toggle: een aankoop die
// je doorverkoopt, koppel je hier ofwel aan een BESTAANDE batch (krijgt de
// eerstvolgende vrije SKU uit die batch, zelfde getUsedSkus/getFreeSkusForBatch
// als SkuPickerModal/BulkSkuModal in Verkopen.jsx), ofwel je maakt er een
// NIEUWE batch van (1 stuk, kostprijs = wat je er zelf voor betaalde). Geen
// koppeling nodig? Dan blijft het gewoon een persoonlijke aankoop zonder
// verdere actie — dat vervangt de oude "Voor mezelf"-knop impliciet.
export default function AankoopSkuModal({ order, suppliers, batches, allOrders, onClose, onConfirm }) {
  const [mode, setMode] = useState(null) // null | 'existing'
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '')
  const [saving, setSaving] = useState(false)

  const supplier = suppliers.find(s => s.id === supplierId)
  const price = parseFloat(order.price || 0)

  // SkuPickerModal berekent het eerstvolgende vrije individuele SKU-nummer
  // al zelf (zie getFreeSkusForBatch daar) en geeft dat door als `sku` — hier
  // enkel nog opslaan, niet nog eens herberekenen.
  const handlePickExisting = async (sku, batch) => {
    if (saving) return
    setSaving(true)
    try {
      await onConfirm({ sku, batchId: batch.id, costPrice: getBatchUnitCost(batch) })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleCreateNew = async () => {
    if (!supplier || saving) return
    setSaving(true)
    try {
      const startNum = getNextSkuNum(batches, supplier.prefix)
      const newBatch = {
        id: genId(),
        supplierPrefix: supplier.prefix,
        supplierId: supplier.id,
        startNum, endNum: startNum,
        name: order.title || '',
        brand: '',
        category: '',
        photo: order.photo_url || null,
        photos: order.photo_url ? [order.photo_url] : [],
        costPrice: price,
        importTax: 0,
        quantity: 1,
        purchaseDate: order.sale_date || new Date().toISOString().split('T')[0],
        note: `Aangemaakt vanuit aankoop (txn ${order.transaction_id || order.id})`,
      }
      const sku = formatSku(supplier.prefix, startNum)
      await onConfirm({ sku, batchId: newBatch.id, costPrice: price, newBatch })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  if (mode === 'existing') {
    return (
      <SkuPickerModal
        batches={batches}
        allOrders={allOrders}
        excludeOrderId={order.id}
        onPick={handlePickExisting}
        onClose={onClose}
      />
    )
  }

  return (
    <div className="modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 400, padding: 0, overflow: 'hidden' }}>
        <div className="modal-header" style={{ padding: '16px 20px 0' }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>SKU koppelen</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ padding: '16px 20px 20px' }}>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {order.title} — €{price.toFixed(2).replace('.', ',')}
          </div>

          <button
            onClick={() => setMode('existing')}
            className="btn btn-secondary"
            style={{ width: '100%', marginBottom: 16 }}
          >
            📦 Koppel aan bestaande batch
          </button>

          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.6px', textTransform: 'uppercase', marginBottom: 6 }}>
            Of: nieuwe batch aanmaken
          </div>
          {suppliers.length ? (
            <>
              <select
                value={supplierId}
                onChange={e => setSupplierId(e.target.value)}
                style={{ width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: 10 }}
              >
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.prefix} — {s.name}</option>)}
              </select>
              <button
                onClick={handleCreateNew}
                disabled={saving}
                className="btn btn-primary"
                style={{ width: '100%' }}
              >
                {saving ? 'Bezig…' : `+ Nieuwe batch (1 stuk, €${price.toFixed(2).replace('.', ',')})`}
              </button>
            </>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-3)', fontStyle: 'italic' }}>
              Geen leveranciers gevonden — maak er eerst een aan via "Nieuwe aankoop".
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
