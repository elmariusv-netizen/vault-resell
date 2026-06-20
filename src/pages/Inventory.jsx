import { useState, useMemo } from 'react'
import EditBatchModal from '../components/EditBatchModal'
import SaleModal from '../components/SaleModal'
import { formatSkuRange, formatCurrency, formatDate, getRemainingQty, getSupplierColor } from '../utils/skuUtils'

function LiveModal({ batch, remaining, onClose, onSave }) {
  const liveCount = batch.liveCount || 0
  const maxAdd = remaining - liveCount
  const [amount, setAmount] = useState(Math.max(1, Math.min(1, maxAdd)))

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 400 }}>
        <div className="modal-header">
          <h2>Live zetten op Vinted</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="form">
          <div style={{ display: 'flex', gap: 20, padding: '4px 0', fontSize: 13, color: 'var(--text-2)' }}>
            <span>Live: <strong style={{ color: 'var(--blue)' }}>{liveCount}</strong></span>
            <span>Beschikbaar: <strong>{maxAdd}</strong></span>
            <span>Resterend: <strong>{remaining}</strong></span>
          </div>
          <div className="form-group">
            <label>Aantal toevoegen aan live</label>
            <input
              type="number"
              min="1"
              max={maxAdd}
              value={amount}
              onChange={(e) => setAmount(parseInt(e.target.value) || 0)}
            />
            {maxAdd === 0 && (
              <span style={{ fontSize: 12, color: 'var(--yellow)' }}>Alle beschikbare items staan al live</span>
            )}
          </div>
          {liveCount > 0 && (
            <div className="form-group">
              <label>Of verwijder van live</label>
              <button
                className="btn btn-secondary"
                style={{ width: '100%' }}
                onClick={() => { onSave(-liveCount); onClose() }}
              >
                Alles van live verwijderen ({liveCount} items)
              </button>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Annuleer</button>
          <button
            className="btn btn-primary"
            onClick={() => { onSave(amount); onClose() }}
            disabled={amount < 1 || amount > maxAdd}
          >
            Live zetten
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Inventory({ data, updateData }) {
  const { batches, sales, suppliers } = data

  const [search, setSearch] = useState('')
  const [filterSupplier, setFilterSupplier] = useState('all')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterCondition, setFilterCondition] = useState('all')
  const [editBatch, setEditBatch] = useState(null)
  const [saleBatch, setSaleBatch] = useState(null)
  const [liveBatch, setLiveBatch] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const categories = useMemo(() => {
    const cats = [...new Set(batches.map((b) => b.category).filter(Boolean))]
    return ['all', ...cats]
  }, [batches])

  const filtered = useMemo(() => {
    return batches.filter((b) => {
      if (filterSupplier !== 'all' && b.supplierPrefix !== filterSupplier) return false
      if (filterCategory !== 'all' && b.category !== filterCategory) return false
      if (filterCondition !== 'all' && b.condition !== filterCondition) return false
      if (search) {
        const q = search.toLowerCase()
        const sku = formatSkuRange(b.supplierPrefix, b.startNum, b.endNum).toLowerCase()
        return (
          sku.includes(q) ||
          b.name?.toLowerCase().includes(q) ||
          b.brand?.toLowerCase().includes(q) ||
          b.category?.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [batches, filterSupplier, filterCategory, filterCondition, search])

  const handleEditSave = (id, updates) =>
    updateData({ batches: batches.map((b) => (b.id === id ? { ...b, ...updates } : b)) })

  const handleDelete = (id) => {
    updateData({
      batches: batches.filter((b) => b.id !== id),
      sales: sales.filter((s) => s.batchId !== id),
    })
    setConfirmDelete(null)
  }

  const handleSaveSale = (sale) => {
    const updates = { sales: [...sales, sale] }
    if (sale.fromLive) {
      updates.batches = batches.map((b) =>
        b.id === sale.batchId
          ? { ...b, liveCount: Math.max(0, (b.liveCount || 0) - (sale.quantity || 1)) }
          : b
      )
    }
    updateData(updates)
  }

  const handleSetLive = (delta) => {
    if (!liveBatch) return
    const remaining = getRemainingQty(liveBatch, sales)
    updateData({
      batches: batches.map((b) =>
        b.id === liveBatch.id
          ? { ...b, liveCount: Math.max(0, Math.min((b.liveCount || 0) + delta, remaining)) }
          : b
      ),
    })
    setLiveBatch(null)
  }

  const conditionColor = { A: 'var(--green)', B: 'var(--yellow)', C: 'var(--red)' }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Voorraad</h1>
          <div className="page-subtitle">{filtered.length} batch{filtered.length !== 1 ? 'es' : ''}</div>
        </div>
      </div>

      <div className="filters">
        <input
          className="search-input"
          placeholder="Zoek SKU, naam, merk…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="filter-select"
          value={filterSupplier}
          onChange={(e) => setFilterSupplier(e.target.value)}
        >
          <option value="all">Alle leveranciers</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.prefix}>{s.prefix} — {s.name}</option>
          ))}
        </select>
        <select
          className="filter-select"
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
        >
          {categories.map((c) => (
            <option key={c} value={c}>{c === 'all' ? 'Alle categorieën' : c}</option>
          ))}
        </select>
        {['all', 'A', 'B', 'C'].map((c) => (
          <button
            key={c}
            className={`filter-chip${filterCondition === c ? ' active' : ''}`}
            onClick={() => setFilterCondition(c)}
          >
            {c === 'all' ? 'Alles' : `Conditie ${c}`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📦</div>
          <h3>Geen resultaten</h3>
          <p>Pas de filters aan of voeg een nieuwe aankoop toe.</p>
        </div>
      ) : (
        <div className="batch-list">
          {filtered.map((b) => {
            const remaining = getRemainingQty(b, sales)
            const pct = b.quantity > 0 ? (remaining / b.quantity) * 100 : 0
            const sold = b.quantity - remaining
            const liveCount = b.liveCount || 0
            const sku = formatSkuRange(b.supplierPrefix, b.startNum, b.endNum)
            const color = getSupplierColor(suppliers, b.supplierPrefix)
            const sup = suppliers.find((s) => s.prefix === b.supplierPrefix)
            const unitCost = (b.costPrice || 0) + (b.importTax || 0)

            return (
              <div className="batch-card" key={b.id} style={{ borderLeft: `3px solid ${color}30` }}>
                <div className="batch-card-header">
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flex: 1, minWidth: 0 }}>
                    {b.photo ? (
                      <img
                        src={b.photo}
                        alt=""
                        style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)', flexShrink: 0 }}
                      />
                    ) : (
                      <div style={{
                        width: 48, height: 48, borderRadius: 10,
                        background: color + '15', border: `1px solid ${color}25`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0, fontSize: 18,
                      }}>
                        🏷
                      </div>
                    )}

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
                        <span className="sku-tag" style={{ background: color + '18', color }}>
                          {sku}
                        </span>
                        {b.brand && <span style={{ fontWeight: 700, fontSize: 14 }}>{b.brand}</span>}
                        {b.name && !b.brand && <span style={{ fontSize: 14, color: 'var(--text-2)' }}>{b.name}</span>}
                        {b.condition && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
                            background: conditionColor[b.condition] + '18',
                            color: conditionColor[b.condition],
                            border: `1px solid ${conditionColor[b.condition]}30`,
                          }}>
                            {b.condition}
                          </span>
                        )}
                      </div>
                      <div className="batch-card-meta">
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block' }} />
                          {sup?.name || b.supplierPrefix}
                        </span>
                        {b.category && <span>{b.category}</span>}
                        <span>{formatDate(b.purchaseDate)}</span>
                        {unitCost > 0 && <span style={{ color: 'var(--text-3)' }}>{formatCurrency(unitCost)}/stuk</span>}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 28, fontWeight: 800, color: remaining === 0 ? 'var(--text-3)' : 'var(--text)', letterSpacing: '-0.04em', lineHeight: 1 }}>
                        {remaining}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                        / {b.quantity} stuks
                      </div>
                    </div>

                    <div className="batch-card-actions">
                      <button
                        className="btn btn-sm"
                        style={{ background: 'rgba(62,207,255,0.1)', color: 'var(--blue)', border: '1px solid rgba(62,207,255,0.25)' }}
                        onClick={() => setLiveBatch(b)}
                        disabled={remaining === 0}
                        title="Markeer als live op Vinted"
                      >
                        Live
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => setSaleBatch(b)}
                        disabled={remaining === 0}
                      >
                        Verkoop
                      </button>
                      <button
                        className="btn btn-secondary btn-sm btn-icon"
                        onClick={() => setEditBatch(b)}
                        title="Bewerken"
                        style={{ fontSize: 15 }}
                      >
                        ✏️
                      </button>
                      <button
                        className="btn btn-danger btn-sm btn-icon"
                        onClick={() => setConfirmDelete(b.id)}
                        title="Verwijderen"
                        style={{ fontSize: 15 }}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-3)', marginBottom: 6, flexWrap: 'wrap', gap: 4 }}>
                    <span>
                      {remaining} voorraad
                      {liveCount > 0 && (
                        <span style={{ color: 'var(--blue)' }}> · {liveCount} live</span>
                      )}
                      <span> · {sold} verkocht</span>
                    </span>
                    <span>{pct.toFixed(0)}% resterend</span>
                  </div>
                  <div className="progress-bar" style={{ height: 4 }}>
                    <div
                      className="progress-fill"
                      style={{ width: `${pct}%`, background: pct > 50 ? 'var(--green)' : pct > 20 ? 'var(--yellow)' : 'var(--red)' }}
                    />
                  </div>
                  {b.note && (
                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 10, fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span>💬</span> {b.note}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editBatch && (
        <EditBatchModal
          batch={editBatch}
          suppliers={suppliers}
          onClose={() => setEditBatch(null)}
          onSave={(updates) => { handleEditSave(editBatch.id, updates); setEditBatch(null) }}
        />
      )}

      {saleBatch && (
        <SaleModal
          data={data}
          defaultBatchId={saleBatch.id}
          onClose={() => setSaleBatch(null)}
          onSave={handleSaveSale}
        />
      )}

      {liveBatch && (
        <LiveModal
          batch={liveBatch}
          remaining={getRemainingQty(liveBatch, sales)}
          onClose={() => setLiveBatch(null)}
          onSave={handleSetLive}
        />
      )}

      {confirmDelete && (
        <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && setConfirmDelete(null)}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div className="modal-header">
              <h2>Batch verwijderen?</h2>
              <button className="modal-close" onClick={() => setConfirmDelete(null)}>×</button>
            </div>
            <p style={{ color: 'var(--text-2)', fontSize: 14, lineHeight: 1.6 }}>
              Dit verwijdert de batch én alle bijhorende verkopen. Deze actie kan niet ongedaan worden gemaakt.
            </p>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Annuleer</button>
              <button className="btn btn-danger" onClick={() => handleDelete(confirmDelete)}>Definitief verwijderen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
