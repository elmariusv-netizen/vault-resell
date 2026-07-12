import { useState, useMemo, useRef, useEffect } from 'react'
import EditBatchModal from '../components/EditBatchModal'
import SaleModal from '../components/SaleModal'
import MediaModal from '../components/MediaModal'
import SkuDetailModal from '../components/SkuDetailModal'
import {
  genId, formatSku, formatSkuRange, formatCurrency, formatDate,
  getRemainingQty, getSupplierColor, getBatchUnitCost, findBatchForSku,
} from '../utils/skuUtils'
import { supabase } from '../utils/supabase'

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
            <input type="number" min="1" max={maxAdd} value={amount}
              onChange={(e) => setAmount(parseInt(e.target.value) || 0)} />
            {maxAdd === 0 && (
              <span style={{ fontSize: 12, color: 'var(--yellow)' }}>Alle beschikbare items staan al live</span>
            )}
          </div>
          {liveCount > 0 && (
            <div className="form-group">
              <label>Of verwijder van live</label>
              <button className="btn btn-secondary" style={{ width: '100%' }}
                onClick={() => { onSave(-liveCount); onClose() }}>
                Alles van live verwijderen ({liveCount} items)
              </button>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Annuleer</button>
          <button className="btn btn-primary"
            onClick={() => { onSave(amount); onClose() }}
            disabled={amount < 1 || amount > maxAdd}>
            Live zetten
          </button>
        </div>
      </div>
    </div>
  )
}

// Toont de écht actieve Vinted-listings die de extensie voor deze batch
// herkende (via sku_ref-match, zie active_listings/api/sync-listings.js) —
// i.p.v. enkel het handmatige liveCount-getal. Listings zonder herkenbare
// SKU in hun titel duiken hier nooit op (zie SKU-detectie/🔖 SKU-tab).
function LiveListingsModal({ batch, listings, onClose }) {
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h2>Actief op Vinted — {formatSkuRange(batch.supplierPrefix, batch.startNum, batch.endNum)}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="form">
          {listings.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6, padding: '8px 0' }}>
              Geen actieve Vinted-listings gevonden met een herkenbare SKU voor deze batch.
              Zet de SKU (via de 🔖 SKU-tab in de extensie) in de titel of beschrijving van je
              listing, en open even de 🏪 Listings-tab in de extensie — dan verschijnen ze hier.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {listings.map((l) => (
                <a key={l.id} href={l.url || `https://www.vinted.be/items/${l.id}`} target="_blank" rel="noreferrer"
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', textDecoration: 'none', color: 'inherit' }}>
                  {l.photo_url ? (
                    <img src={l.photo_url} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 44, height: 44, borderRadius: 8, background: 'var(--bg-2)', flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.title || '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{l.sku_ref || 'geen SKU'}</div>
                  </div>
                  {l.price != null && <div style={{ fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{formatCurrency(l.price)}</div>}
                </a>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Sluiten</button>
        </div>
      </div>
    </div>
  )
}

async function compressPhoto(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const maxDim = 360
        const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * ratio)
        canvas.height = Math.round(img.height * ratio)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.72))
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  })
}

const STATUS_LABEL = { voorraad: 'In voorraad', live: 'Live', verkocht: 'Verkocht' }
const STATUS_CLASS = { voorraad: 'badge-green', live: 'badge-blue', verkocht: 'badge-gray' }

export default function Inventory({ data, updateData }) {
  const { batches, sales, suppliers } = data
  const skuPhotos = data.skuPhotos || {}

  const [tab, setTab] = useState('batches')
  const [batchVideos, setBatchVideos] = useState({})
  const [mediaBatch, setMediaBatch] = useState(null)

  const [search, setSearch] = useState('')
  const [filterSupplier, setFilterSupplier] = useState('all')
  const [filterCategory, setFilterCategory] = useState('all')

  const [editBatch, setEditBatch] = useState(null)
  const [saleBatch, setSaleBatch] = useState(null)
  const [liveBatch, setLiveBatch] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [activeListings, setActiveListings] = useState([])
  const [liveListingsBatch, setLiveListingsBatch] = useState(null)

  // Actieve Vinted-listings (door de extensie gesynct, zie active_listings/
  // api/sync-listings.js) — voor de klikbare "Live"-badge hieronder.
  useEffect(() => {
    supabase.from('active_listings').select('id,title,photo_url,price,sku_ref,url').then(({ data, error }) => {
      if (error) { console.warn('[Vault] actieve listings ophalen mislukt:', error.message); return }
      setActiveListings(data || [])
    })
  }, [])

  const listingsByBatchId = useMemo(() => {
    const map = {}
    activeListings.forEach((l) => {
      const batch = findBatchForSku(batches, l.sku_ref)
      if (batch) (map[batch.id] ||= []).push(l)
    })
    return map
  }, [activeListings, batches])

  const [skuSearch, setSkuSearch] = useState('')
  const [skuStatus, setSkuStatus] = useState('all')
  const [skuSupplier, setSkuSupplier] = useState('all')
  const [skuDetail, setSkuDetail] = useState(null) // batch to show in detail modal
  const [pendingSkuCode, setPendingSkuCode] = useState(null)
  const skuPhotoRef = useRef()

  const updateSkuPhoto = (code, dataUrl) =>
    updateData({ skuPhotos: { ...skuPhotos, [code]: dataUrl } })

  const removeSkuPhoto = (code) => {
    const updated = { ...skuPhotos }
    delete updated[code]
    updateData({ skuPhotos: updated })
  }

  const addBatchVideo = (batchId, url, name) =>
    setBatchVideos((prev) => ({
      ...prev,
      [batchId]: [...(prev[batchId] || []), { id: genId(), url, name }],
    }))

  const removeBatchVideo = (batchId, videoId) =>
    setBatchVideos((prev) => {
      const vid = (prev[batchId] || []).find((v) => v.id === videoId)
      if (vid) URL.revokeObjectURL(vid.url)
      return { ...prev, [batchId]: (prev[batchId] || []).filter((v) => v.id !== videoId) }
    })

  const categories = useMemo(() => {
    const cats = [...new Set(batches.map((b) => b.category).filter(Boolean))]
    return ['all', ...cats]
  }, [batches])

  const filtered = useMemo(() => {
    return batches.filter((b) => {
      if (filterSupplier !== 'all' && b.supplierPrefix !== filterSupplier) return false
      if (filterCategory !== 'all' && b.category !== filterCategory) return false
      if (search) {
        const q = search.toLowerCase()
        const sku = formatSkuRange(b.supplierPrefix, b.startNum, b.endNum).toLowerCase()
        return sku.includes(q) || b.name?.toLowerCase().includes(q) || b.brand?.toLowerCase().includes(q)
      }
      return true
    })
  }, [batches, filterSupplier, filterCategory, search])

  const handleEditSave = (id, updates) =>
    updateData({ batches: batches.map((b) => (b.id === id ? { ...b, ...updates } : b)) })

  const handleDelete = (id) => {
    updateData({ batches: batches.filter((b) => b.id !== id), sales: sales.filter((s) => s.batchId !== id) })
    setConfirmDelete(null)
  }

  // newSales is een array (1 item voor een gewone verkoop, meerdere voor een
  // bundel met meerdere batches/leveranciers — zie SaleModal.jsx).
  const handleSaveSale = (newSales) => {
    const updates = { sales: [...sales, ...newSales] }
    const liveSales = newSales.filter((s) => s.fromLive)
    if (liveSales.length) {
      updates.batches = batches.map((b) => {
        const dec = liveSales.filter((s) => s.batchId === b.id).reduce((sum, s) => sum + (s.quantity || 1), 0)
        return dec ? { ...b, liveCount: Math.max(0, (b.liveCount || 0) - dec) } : b
      })
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

  const allSkuItems = useMemo(() => {
    return batches.flatMap((b) => {
      const bSales = sales.filter((s) => s.batchId === b.id)
      const soldCount = bSales.reduce((s, x) => s + (x.quantity || 1), 0)
      const liveCount = b.liveCount || 0
      const sup = suppliers.find((s) => s.prefix === b.supplierPrefix)

      return Array.from({ length: b.endNum - b.startNum + 1 }, (_, i) => {
        const num = b.startNum + i
        const code = formatSku(b.supplierPrefix, num)
        const status = i < soldCount ? 'verkocht' : i < soldCount + liveCount ? 'live' : 'voorraad'
        return {
          code, batchId: b.id, num,
          prefix: b.supplierPrefix,
          supName: sup?.name || b.supplierPrefix,
          supColor: sup?.color || '#666',
          brand: b.brand || '',
          name: b.name || '',
          costPrice: getBatchUnitCost(b),
          status,
          photo: skuPhotos[code] || null,
        }
      })
    })
  }, [batches, sales, suppliers, skuPhotos])

  const filteredSkuItems = useMemo(() => {
    return allSkuItems.filter((item) => {
      if (skuStatus !== 'all' && item.status !== skuStatus) return false
      if (skuSupplier !== 'all' && item.prefix !== skuSupplier) return false
      if (skuSearch) {
        const q = skuSearch.toLowerCase()
        return (
          item.code.toLowerCase().includes(q) ||
          item.brand.toLowerCase().includes(q) ||
          item.name.toLowerCase().includes(q) ||
          item.supName.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [allSkuItems, skuSearch, skuStatus, skuSupplier])

  const handleSkuPhotoClick = (code) => {
    setPendingSkuCode(code)
    skuPhotoRef.current.value = ''
    skuPhotoRef.current.click()
  }

  const handleSkuPhotoChange = async (e) => {
    const file = e.target.files[0]
    if (!file || !pendingSkuCode) return
    const dataUrl = await compressPhoto(file)
    updateSkuPhoto(pendingSkuCode, dataUrl)
    setPendingSkuCode(null)
  }

  const batchPhotoCount = (b) => {
    let n = 0
    for (let i = b.startNum; i <= b.endNum; i++) {
      if (skuPhotos[formatSku(b.supplierPrefix, i)]) n++
    }
    return n
  }

  const batchVideoCount = (batchId) => (batchVideos[batchId] || []).length

  const handleSkuSell = (item) => {
    const batch = batches.find((b) => b.id === item.batchId)
    if (batch) setSaleBatch(batch)
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Voorraad</h1>
          <div className="page-subtitle">
            {batches.length} batch{batches.length !== 1 ? 'es' : ''} · {allSkuItems.length} items
          </div>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="toggle-group" style={{ marginBottom: 22, maxWidth: 420 }}>
        <button className={`toggle-btn${tab === 'batches' ? ' active' : ''}`} onClick={() => setTab('batches')}>
          Batches ({batches.length})
        </button>
        <button className={`toggle-btn${tab === 'sku' ? ' active' : ''}`} onClick={() => setTab('sku')}>
          SKU Overzicht ({allSkuItems.length})
        </button>
      </div>

      {/* ═══════════ BATCHES TAB ═══════════ */}
      {tab === 'batches' && (
        <>
          <div className="filters">
            <input className="search-input" placeholder="Zoek SKU, naam, merk…"
              value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="filter-select" value={filterSupplier} onChange={(e) => setFilterSupplier(e.target.value)}>
              <option value="all">Alle leveranciers</option>
              {suppliers.map((s) => <option key={s.id} value={s.prefix}>{s.prefix} — {s.name}</option>)}
            </select>
            <select className="filter-select" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
              {categories.map((c) => <option key={c} value={c}>{c === 'all' ? 'Alle categorieën' : c}</option>)}
            </select>
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
                const unitCost = getBatchUnitCost(b)
                const pCount = batchPhotoCount(b)
                const vCount = batchVideoCount(b.id)
                const primaryPhoto = b.photos?.[0] || b.photo

                return (
                  <div className="batch-card" key={b.id} style={{ borderLeft: `3px solid ${color}30` }}>
                    <div className="batch-card-header">
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flex: 1, minWidth: 0 }}>
                        {primaryPhoto ? (
                          <img src={primaryPhoto} alt=""
                            style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)', flexShrink: 0 }} />
                        ) : (
                          <div style={{ width: 48, height: 48, borderRadius: 10, background: color + '15', border: `1px solid ${color}25`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 18 }}>
                            🏷
                          </div>
                        )}

                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
                            <span className="sku-tag" style={{ background: color + '18', color }}>{sku}</span>
                            {b.brand && <span style={{ fontWeight: 700, fontSize: 14 }}>{b.brand}</span>}
                            {b.name && !b.brand && <span style={{ fontSize: 14, color: 'var(--text-2)' }}>{b.name}</span>}
                          </div>
                          <div className="batch-card-meta">
                            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block' }} />
                              {sup?.name || b.supplierPrefix}
                            </span>
                            {b.category && <span>{b.category}</span>}
                            <span>{formatDate(b.purchaseDate)}</span>
                            {unitCost > 0 && <span style={{ color: 'var(--text-3)' }}>{formatCurrency(unitCost)}/stuk</span>}
                            {(pCount > 0 || vCount > 0) && (
                              <span style={{ color: 'var(--text-3)' }}>
                                {pCount > 0 && `📷 ${pCount}`}
                                {pCount > 0 && vCount > 0 && ' '}
                                {vCount > 0 && `📹 ${vCount}`}
                              </span>
                            )}
                            {b.photos?.length > 1 && (
                              <span style={{ color: 'var(--text-3)', fontSize: 10 }}>+{b.photos.length - 1} foto's</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 28, fontWeight: 800, color: remaining === 0 ? 'var(--text-3)' : 'var(--text)', letterSpacing: '-0.04em', lineHeight: 1 }}>
                            {remaining}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>/ {b.quantity} stuks</div>
                        </div>

                        <div className="batch-card-actions">
                          <button
                            className="btn btn-sm"
                            style={{ background: 'var(--blue-dim)', color: 'var(--blue)', border: '1px solid rgba(37,99,235,0.2)' }}
                            onClick={() => setLiveBatch(b)}
                            disabled={remaining === 0}
                            title="Live zetten op Vinted"
                          >
                            Live
                          </button>
                          <button className="btn btn-primary btn-sm" onClick={() => setSaleBatch(b)} disabled={remaining === 0}>
                            Verkoop
                          </button>
                          <button
                            className="btn btn-secondary btn-sm btn-icon"
                            onClick={() => setMediaBatch(b)}
                            title="Foto's & video's beheren"
                            style={{ fontSize: 14 }}
                          >
                            📷
                          </button>
                          <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setEditBatch(b)} title="Bewerken" style={{ fontSize: 14 }}>
                            ✏️
                          </button>
                          <button className="btn btn-danger btn-sm btn-icon" onClick={() => setConfirmDelete(b.id)} title="Verwijderen" style={{ fontSize: 14 }}>
                            🗑
                          </button>
                        </div>
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-3)', marginBottom: 6, flexWrap: 'wrap', gap: 4 }}>
                        <span>
                          {remaining} voorraad
                          {liveCount > 0 && <span style={{ color: 'var(--blue)' }}> · {liveCount} live</span>}
                          <span> · {sold} verkocht</span>
                          {' · '}
                          <span
                            onClick={(e) => { e.stopPropagation(); setLiveListingsBatch(b) }}
                            style={{ color: 'var(--blue)', textDecoration: 'underline', cursor: 'pointer' }}
                            title="Bekijk de echte actieve listings op Vinted voor deze batch"
                          >
                            {(listingsByBatchId[b.id]?.length || 0)} live op Vinted
                          </span>
                        </span>
                        <span>{pct.toFixed(0)}% resterend</span>
                      </div>
                      <div className="progress-bar" style={{ height: 4 }}>
                        <div className="progress-fill" style={{ width: `${pct}%`, background: pct > 50 ? 'var(--green)' : pct > 20 ? 'var(--yellow)' : 'var(--red)' }} />
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
        </>
      )}

      {/* ═══════════ SKU OVERZICHT TAB ═══════════ */}
      {tab === 'sku' && (
        <>
          <div className="filters" style={{ marginBottom: 16 }}>
            <input
              className="search-input"
              placeholder="Zoek SKU, merk, naam…"
              value={skuSearch}
              onChange={(e) => setSkuSearch(e.target.value)}
              style={{ minWidth: 200 }}
            />
            <select className="filter-select" value={skuSupplier} onChange={(e) => setSkuSupplier(e.target.value)}>
              <option value="all">Alle leveranciers</option>
              {suppliers.map((s) => <option key={s.id} value={s.prefix}>{s.prefix} — {s.name}</option>)}
            </select>
            {['all', 'voorraad', 'live', 'verkocht'].map((s) => (
              <button key={s} className={`filter-chip${skuStatus === s ? ' active' : ''}`}
                onClick={() => setSkuStatus(s)}>
                {s === 'all' ? 'Alle statussen' : STATUS_LABEL[s]}
              </button>
            ))}
            <span style={{ fontSize: 12, color: 'var(--text-3)', marginLeft: 4 }}>
              {filteredSkuItems.length} items
            </span>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 56 }}>Foto</th>
                  <th>SKU</th>
                  <th>Leverancier</th>
                  <th>Merk / Naam</th>
                  <th>Prijs</th>
                  <th>Status</th>
                  <th style={{ width: 90 }}>Actie</th>
                </tr>
              </thead>
              <tbody>
                {filteredSkuItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>
                      Geen items gevonden
                    </td>
                  </tr>
                ) : (
                  filteredSkuItems.map((item) => (
                    <tr key={item.code} style={{ cursor: 'pointer' }}
                      onClick={() => setSkuDetail(batches.find((b) => b.id === item.batchId) || null)}>
                      <td style={{ padding: '8px 10px' }}>
                        <div
                          onClick={() => handleSkuPhotoClick(item.code)}
                          title="Klik om foto te uploaden"
                          style={{
                            width: 40, height: 40, borderRadius: 8, overflow: 'hidden',
                            cursor: 'pointer', border: `1px solid ${item.photo ? 'var(--border)' : item.supColor + '30'}`,
                            background: item.photo ? 'transparent' : item.supColor + '12',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          {item.photo ? (
                            <img src={item.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <span style={{ fontSize: 16 }}>📷</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className="sku-tag" style={{ background: item.supColor + '14', color: item.supColor }}>
                          {item.code}
                        </span>
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.supColor, flexShrink: 0 }} />
                          <span style={{ color: 'var(--text-2)', fontSize: 12 }}>{item.prefix}</span>
                        </span>
                      </td>
                      <td>
                        {item.brand && <span style={{ fontWeight: 600 }}>{item.brand}</span>}
                        {item.brand && item.name && <span style={{ color: 'var(--text-3)', margin: '0 4px' }}>·</span>}
                        {item.name && <span style={{ color: 'var(--text-2)', fontSize: 12 }}>{item.name}</span>}
                        {!item.brand && !item.name && <span style={{ color: 'var(--text-3)' }}>—</span>}
                      </td>
                      <td style={{ fontWeight: 500, color: 'var(--text-2)' }}>
                        {item.costPrice > 0 ? formatCurrency(item.costPrice) : '—'}
                      </td>
                      <td>
                        <span className={`badge ${STATUS_CLASS[item.status]}`}>
                          {STATUS_LABEL[item.status]}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px' }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => setSkuDetail(batches.find((b) => b.id === item.batchId) || null)}
                            style={{ fontSize: 11, padding: '4px 8px' }}
                            title="SKU details bekijken"
                          >
                            📊
                          </button>
                          {item.status !== 'verkocht' && (
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => handleSkuSell(item)}
                              style={{ fontSize: 11, padding: '4px 10px' }}
                            >
                              Verkoop
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <input ref={skuPhotoRef} type="file" accept="image/*" onChange={handleSkuPhotoChange} style={{ display: 'none' }} />
        </>
      )}

      {/* ═══════════ MODALS ═══════════ */}
      {editBatch && (
        <EditBatchModal
          batch={editBatch}
          suppliers={suppliers}
          onClose={() => setEditBatch(null)}
          onSave={(updates) => { handleEditSave(editBatch.id, updates); setEditBatch(null) }}
        />
      )}

      {mediaBatch && (
        <MediaModal
          batch={mediaBatch}
          supColor={getSupplierColor(suppliers, mediaBatch.supplierPrefix)}
          skuPhotos={skuPhotos}
          onUpdatePhoto={updateSkuPhoto}
          onRemovePhoto={removeSkuPhoto}
          batchVideos={batchVideos}
          onAddVideo={addBatchVideo}
          onRemoveVideo={removeBatchVideo}
          onClose={() => setMediaBatch(null)}
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

      {liveListingsBatch && (
        <LiveListingsModal
          batch={liveListingsBatch}
          listings={listingsByBatchId[liveListingsBatch.id] || []}
          onClose={() => setLiveListingsBatch(null)}
        />
      )}

      {skuDetail && (
        <SkuDetailModal
          batch={skuDetail}
          sales={sales}
          suppliers={suppliers}
          onClose={() => setSkuDetail(null)}
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
