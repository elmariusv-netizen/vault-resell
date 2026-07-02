import { useState, useEffect, useMemo } from 'react'
import { formatSkuRange, getUsedSkus, getFreeSkusForBatch } from '../utils/skuUtils'

// ── SKU koppel modal ───────────────────────────────────────────────────────
// Gedeeld tussen Verkopen.jsx (VintedOrderRow "SKU koppelen") en Aankopen.jsx —
// laat een bestaande batch/SKU-range kiezen voor 1 order. "Beschikbaar" is
// het aantal nog ongebruikte SKU's binnen de batch (batch-hoeveelheid minus
// reeds elders gekoppelde sku_ref-waarden, zie getFreeSkusForBatch), niet een
// statisch veld dat nooit daalde wanneer een SKU via dit scherm gekoppeld werd.
export default function SkuPickerModal({ batches, allOrders, excludeOrderId, onPick, onClose }) {
  const [q, setQ] = useState('')

  const usedSkus = useMemo(() => getUsedSkus(allOrders, excludeOrderId ? [excludeOrderId] : []), [allOrders, excludeOrderId])

  const items = useMemo(() => {
    const lower = q.toLowerCase()
    return batches
      .filter(b => {
        if (!lower) return true
        const sku = formatSkuRange(b.supplierPrefix, b.startNum, b.endNum)
        return (
          sku.toLowerCase().includes(lower) ||
          (b.name || '').toLowerCase().includes(lower) ||
          (b.brand || '').toLowerCase().includes(lower)
        )
      })
      .map(b => ({ batch: b, available: getFreeSkusForBatch(b, usedSkus).length }))
      .sort((a, b) => b.available - a.available)
  }, [batches, q, usedSkus])

  useEffect(() => {
    const close = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  return (
    <div className="modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 420, padding: 0, overflow: 'hidden', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>Koppel SKU</h2>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Zoek SKU, naam, merk…"
            style={{ width: '100%', padding: '8px 12px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#f1f5f9', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {items.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>Geen batches gevonden</div>
          ) : items.map(({ batch: b, available }) => {
            const sku = formatSkuRange(b.supplierPrefix, b.startNum, b.endNum)
            return (
              <div
                key={b.id}
                onClick={() => { onPick(sku, b); onClose() }}
                style={{ padding: '10px 20px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                onMouseEnter={e => e.currentTarget.style.background = '#1e293b'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div>
                  <span style={{ fontWeight: 700, fontSize: 13, color: '#818cf8', fontFamily: 'monospace' }}>{sku}</span>
                  {(b.name || b.brand) && (
                    <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 10 }}>{b.brand || b.name}</span>
                  )}
                </div>
                <span style={{ fontSize: 11, color: available > 0 ? '#4ade80' : '#64748b', fontWeight: 600 }}>
                  {available > 0 ? `${available} beschikbaar` : 'uitverkocht'}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
