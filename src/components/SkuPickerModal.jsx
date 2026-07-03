import { useState, useEffect, useMemo } from 'react'
import { formatSkuRange, getUsedSkus, getFreeSkusForBatch, assignSlotSkus, skuOptionsForSlot } from '../utils/skuUtils'

// ── SKU koppel modal ───────────────────────────────────────────────────────
// Gedeeld tussen Verkopen.jsx (VintedOrderRow "SKU koppelen") en Aankopen.jsx —
// laat een bestaande batch/SKU-range kiezen voor 1 order. "Beschikbaar" is
// het aantal nog ongebruikte SKU's binnen de batch (batch-hoeveelheid minus
// reeds elders gekoppelde sku_ref-waarden, zie getFreeSkusForBatch), niet een
// statisch veld dat nooit daalde wanneer een SKU via dit scherm gekoppeld werd.
//
// onPickMultiple is optioneel: enkel als de aanroeper 'm meegeeft verschijnt
// de "+ Dit is eigenlijk meerdere artikelen"-optie (zelfde onderliggende
// assignSlotSkus/skuOptionsForSlot als BulkSkuModal in Verkopen.jsx, geen
// aparte herbouwde implementatie).
export default function SkuPickerModal({ batches, allOrders, excludeOrderId, onPick, onPickMultiple, onClose }) {
  const [q, setQ] = useState('')
  const [manualCount, setManualCount] = useState(undefined) // undefined = 1 (geen bundle)
  const [selectedBatch, setSelectedBatch] = useState(null)  // batch waarvoor nu N SKU's gekozen worden
  const [overrides, setOverrides] = useState({})            // slotKey -> handmatig gekozen SKU

  const count = manualCount === undefined ? 1 : manualCount

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
          (b.brand || '').toLowerCase().includes(lower) ||
          (b.category || '').toLowerCase().includes(lower)
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

  // ── Meerdere-artikelen-modus: N SKU-dropdowns uit de gekozen batch ───────
  if (selectedBatch) {
    const freeSkus = getFreeSkusForBatch(selectedBatch, usedSkus)
    const slotKeys = Array.from({ length: count }, (_, i) => `slot-${i}`)
    const slotSkus = assignSlotSkus(slotKeys, freeSkus, overrides)
    const range = formatSkuRange(selectedBatch.supplierPrefix, selectedBatch.startNum, selectedBatch.endNum)
    const filledCount = slotKeys.filter(k => slotSkus[k]).length

    const handleConfirm = async () => {
      const items = slotKeys.map(k => ({ sku: slotSkus[k], batch: selectedBatch })).filter(it => it.sku)
      if (!items.length) return
      await onPickMultiple(items)
      onClose()
    }

    return (
      <div className="modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
        <div className="modal" style={{ maxWidth: 420, padding: 0, overflow: 'hidden', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>Koppel SKU's ({count})</h2>
              <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => setSelectedBatch(null)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer', padding: 0 }}
              >← Andere batch</button>
              <span style={{ fontWeight: 700, fontSize: 13, color: '#818cf8', fontFamily: 'monospace' }}>{range}</span>
            </div>
          </div>

          <div style={{ padding: '14px 20px', maxHeight: 320, overflowY: 'auto' }}>
            {count > freeSkus.length && (
              <div style={{ fontSize: 11, color: '#f87171', fontWeight: 600, marginBottom: 10 }}>
                ⚠ Nog maar {freeSkus.length} SKU{freeSkus.length === 1 ? '' : "'s"} beschikbaar in deze batch
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {slotKeys.map((key, i) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: '#64748b', width: 48, flexShrink: 0 }}>Item {i + 1}</span>
                  <select
                    value={slotSkus[key] || ''}
                    onChange={e => setOverrides(prev => ({ ...prev, [key]: e.target.value }))}
                    disabled={!freeSkus.length}
                    style={{ flex: 1, fontFamily: 'monospace', fontSize: 12, fontWeight: 700, padding: '6px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: '#1e293b', color: '#f1f5f9', outline: 'none' }}
                  >
                    {!slotSkus[key] && <option value="">Geen vrije SKU</option>}
                    {skuOptionsForSlot(key, slotSkus, freeSkus).map(sku => <option key={sku} value={sku}>{sku}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <button
              onClick={handleConfirm}
              disabled={!filledCount}
              style={{ width: '100%', marginTop: 14, padding: '9px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 700, fontSize: 13, cursor: filledCount ? 'pointer' : 'default', opacity: filledCount ? 1 : 0.5 }}
            >
              Bevestig koppeling ({filledCount} SKU{filledCount === 1 ? '' : "'s"})
            </button>
          </div>
        </div>
      </div>
    )
  }

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
            placeholder="Zoek SKU, naam, merk, categorie…"
            style={{ width: '100%', padding: '8px 12px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#f1f5f9', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
          {onPickMultiple && (
            manualCount === undefined ? (
              <span
                onClick={() => setManualCount(2)}
                style={{ display: 'inline-block', marginTop: 10, fontSize: 11, color: '#94a3b8', cursor: 'pointer', userSelect: 'none' }}
              >+ Dit is eigenlijk meerdere artikelen</span>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>Aantal artikelen:</span>
                <input
                  type="number"
                  min={2}
                  value={manualCount}
                  onChange={e => setManualCount(e.target.value)}
                  onBlur={() => setManualCount(prev => {
                    let n = parseInt(prev, 10)
                    if (!Number.isFinite(n) || n < 2) n = 2
                    return n
                  })}
                  style={{ width: 48, fontSize: 12, fontWeight: 700, padding: '3px 6px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: '#1e293b', color: '#f1f5f9', textAlign: 'center', outline: 'none' }}
                />
                <span
                  onClick={() => setManualCount(undefined)}
                  style={{ fontSize: 11, color: '#f87171', cursor: 'pointer', userSelect: 'none' }}
                >✕ annuleer</span>
              </div>
            )
          )}
        </div>
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {items.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>Geen batches gevonden</div>
          ) : items.map(({ batch: b, available }) => {
            const range = formatSkuRange(b.supplierPrefix, b.startNum, b.endNum)
            return (
              <div
                key={b.id}
                onClick={async () => {
                  if (available === 0) return
                  // Bij "meerdere artikelen" eerst de batch kiezen en dan pas
                  // N SKU-dropdowns tonen (zie hierboven) — pas hier meteen
                  // afronden als er maar 1 item nodig is.
                  if (count > 1) { setSelectedBatch(b); return }
                  // Nooit de volledige batch-range ("MAU001-024") als sku_ref
                  // opslaan — dat is enkel de weergavetekst voor deze rij. Bij
                  // een klik hoort altijd het eerstvolgende vrije individuele
                  // SKU-nummer binnen de batch (bv. "MAU008") opgeslagen te
                  // worden, dezelfde getFreeSkusForBatch-logica als hierboven
                  // gebruikt voor het "beschikbaar"-aantal.
                  const sku = getFreeSkusForBatch(b, usedSkus)[0]
                  if (!sku) return
                  // Wachten tot onPick() de order daadwerkelijk heeft
                  // opgeslagen (en de lokale allOrders-state dus bijgewerkt
                  // is) VOORDAT dit scherm sluit — anders kan de gebruiker
                  // meteen een volgende order koppelen terwijl usedSkus hier
                  // nog de oude, niet-bijgewerkte lijst gebruikt, waardoor
                  // "beschikbaar" niet daalt.
                  await onPick(sku, b)
                  onClose()
                }}
                style={{ padding: '10px 20px', cursor: available > 0 ? 'pointer' : 'default', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(255,255,255,0.04)', opacity: available > 0 ? 1 : 0.5 }}
                onMouseEnter={e => e.currentTarget.style.background = '#1e293b'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: '#818cf8', fontFamily: 'monospace', flexShrink: 0 }}>{range}</span>
                  {b.brand && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#c4b5fd', background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap' }}>
                      {b.brand}
                    </span>
                  )}
                  {b.category && (
                    <span style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>{b.category}</span>
                  )}
                  {!b.brand && !b.category && b.name && (
                    <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>{b.name}</span>
                  )}
                </div>
                <span style={{ fontSize: 11, color: available > 0 ? '#4ade80' : '#64748b', fontWeight: 600, flexShrink: 0 }}>
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
