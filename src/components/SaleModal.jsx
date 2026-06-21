import { useState, useMemo, useEffect, useRef } from 'react'
import Modal from './Modal'
import { genId, formatSkuRange, calcSaleProfit, formatCurrency, getRemainingQty } from '../utils/skuUtils'

const PLATFORMS = [
  { value: 'Vinted', label: 'Vinted', tooltip: null },
  {
    value: 'Privé persoon',
    label: 'Privé persoon',
    tooltip: 'Gewone privéverkoop — standaard BTW-regels van toepassing',
  },
  {
    value: 'Medeverkoper/Groothandel',
    label: 'Medeverkoper/Groothandel',
    tooltip: 'Verkoop aan andere reseller of groothandel — andere BTW-regels kunnen van toepassing zijn',
  },
]

async function compressPhoto(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const maxDim = 480
        const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * ratio)
        canvas.height = Math.round(img.height * ratio)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.78))
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  })
}

function LinkRow({ value, onChange, onRemove }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        type="url"
        placeholder="https://www.vinted.be/items/…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ flex: 1 }}
      />
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-icon"
        onClick={onRemove}
        style={{ flexShrink: 0, fontSize: 16, padding: '5px 9px' }}
      >
        ×
      </button>
    </div>
  )
}

export default function SaleModal({ data, onClose, onSave, defaultBatchId }) {
  const { batches, sales } = data
  const photoRef = useRef()

  const [batchId, setBatchId] = useState(defaultBatchId || (batches[0]?.id ?? ''))
  const [type, setType] = useState('individual')
  const [qty, setQty] = useState(1)
  const [price, setPrice] = useState('')
  const [platform, setPlatform] = useState('Vinted')
  const [buyer, setBuyer] = useState('')
  const [shippingCost, setShippingCost] = useState('')
  const [saleNotes, setSaleNotes] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [fromLive, setFromLive] = useState(false)
  const [photo, setPhoto] = useState(null)
  const [links, setLinks] = useState([])
  const [photoLoading, setPhotoLoading] = useState(false)
  const [shipped, setShipped] = useState(false)
  const [shippedDate, setShippedDate] = useState(new Date().toISOString().split('T')[0])
  const [isFree, setIsFree] = useState(false)

  const batch = batches.find((b) => b.id === batchId)
  const remaining = batch ? getRemainingQty(batch, sales) : 0
  const liveCount = batch?.liveCount || 0

  useEffect(() => { setFromLive(false) }, [batchId])
  useEffect(() => { if (isFree) setPrice('0') }, [isFree])

  const effectiveQty = type === 'bulk' ? parseInt(qty) || 1 : 1
  const effectiveShipping = parseFloat(shippingCost) || 0

  const profit = batch && !isFree ? calcSaleProfit(
    { quantity: effectiveQty, salePrice: parseFloat(price) || 0, shippingCost: effectiveShipping, fees: 0 },
    batch
  ) : null

  const liveExceeded = fromLive && effectiveQty > liveCount

  const handlePhoto = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setPhotoLoading(true)
    try {
      const dataUrl = await compressPhoto(file)
      setPhoto(dataUrl)
    } finally {
      setPhotoLoading(false)
      e.target.value = ''
    }
  }

  const addLink = () => setLinks((l) => [...l, ''])
  const updateLink = (i, val) => setLinks((l) => l.map((x, idx) => idx === i ? val : x))
  const removeLink = (i) => setLinks((l) => l.filter((_, idx) => idx !== i))

  const handleSave = () => {
    if (!batch || (!price && !isFree)) return
    const sale = {
      id: genId(),
      batchId,
      type,
      quantity: effectiveQty,
      salePrice: isFree ? 0 : parseFloat(price),
      platform,
      buyer,
      fees: 0,
      shippingCost: effectiveShipping,
      notes: saleNotes.trim(),
      date,
      fromLive,
      photo: photo || null,
      links: links.filter((l) => l.trim()),
      shipped,
      shippedDate: shipped ? shippedDate : null,
      isFree,
    }
    onSave(sale)
    onClose()
  }

  const batchLabel = (b) => {
    const range = formatSkuRange(b.supplierPrefix, b.startNum, b.endNum)
    const name = b.name || b.brand || b.category || ''
    return `${range}${name ? ` — ${name}` : ''}`
  }

  const canSave = isFree
    ? (batch && effectiveQty <= remaining && !liveExceeded)
    : (price && batch && effectiveQty <= remaining && !liveExceeded)

  return (
    <Modal
      title="Verkoop registreren"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Annuleer</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!canSave}>
            Opslaan
          </button>
        </>
      }
    >
      <div className="form">
        {/* Gratis weggegeven toggle */}
        <div
          className={`free-toggle${isFree ? ' active' : ''}`}
          onClick={() => setIsFree(f => !f)}
        >
          <span>{isFree ? '✓' : '○'}</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Gratis weggegeven</div>
            <div style={{ fontSize: 11, color: isFree ? 'var(--green)' : 'var(--text-3)' }}>
              Prijs wordt €0 — item wordt uit voorraad gehaald
            </div>
          </div>
        </div>

        <div className="form-group">
          <label>SKU / Batch</label>
          <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>{batchLabel(b)}</option>
            ))}
          </select>
          {batch && (
            <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
              Resterend: {remaining} stuks{liveCount > 0 && <span style={{ color: 'var(--blue)' }}> · {liveCount} live</span>}
            </span>
          )}
        </div>

        {liveCount > 0 && (
          <div className="form-group">
            <label>Herkomst</label>
            <div className="toggle-group">
              <button className={`toggle-btn${!fromLive ? ' active' : ''}`} onClick={() => setFromLive(false)}>
                Directe voorraad
              </button>
              <button className={`toggle-btn${fromLive ? ' active' : ''}`} onClick={() => setFromLive(true)}>
                Van Vinted live ({liveCount})
              </button>
            </div>
            {liveExceeded && (
              <span style={{ fontSize: 12, color: 'var(--red)' }}>Meer dan live items!</span>
            )}
          </div>
        )}

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
              disabled={isFree}
              style={isFree ? { opacity: 0.4 } : {}}
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
                key={p.value}
                className={`platform-btn${platform === p.value ? ' active' : ''}`}
                title={p.tooltip || undefined}
                onClick={() => setPlatform(p.value)}
              >
                {p.label}
                {p.tooltip && <span style={{ marginLeft: 4, opacity: 0.5, fontSize: 10 }}>ⓘ</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Verzendkost (€, optioneel)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="0,00"
              value={shippingCost}
              onChange={(e) => setShippingCost(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Koper (optioneel)</label>
            <input type="text" placeholder="Naam of @handle" value={buyer} onChange={(e) => setBuyer(e.target.value)} />
          </div>
        </div>

        {/* Pakket verzonden */}
        <div className="form-group">
          <label>Verzending</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`toggle-btn${shipped ? ' active' : ''}`}
              onClick={() => setShipped(s => !s)}
              style={{ flex: 'none', minWidth: 160 }}
            >
              {shipped ? '✓ Pakket verzonden' : 'Pakket verzonden'}
            </button>
            {shipped && (
              <input
                type="date"
                value={shippedDate}
                onChange={(e) => setShippedDate(e.target.value)}
                style={{ flex: 1, minWidth: 140 }}
              />
            )}
          </div>
        </div>

        {/* Photo */}
        <div className="form-group">
          <label>Foto (optioneel)</label>
          {photo ? (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <img
                src={photo}
                alt="item"
                style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)', flexShrink: 0 }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => { photoRef.current.value = ''; photoRef.current.click() }}
                  disabled={photoLoading}
                >
                  Vervang
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPhoto(null)}
                  disabled={photoLoading}
                >
                  × Verwijder
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => { photoRef.current.value = ''; photoRef.current.click() }}
              disabled={photoLoading}
              style={{ alignSelf: 'flex-start' }}
            >
              {photoLoading ? 'Laden…' : '📷 Foto toevoegen'}
            </button>
          )}
          <input ref={photoRef} type="file" accept="image/*" onChange={handlePhoto} style={{ display: 'none' }} />
        </div>

        {/* Links */}
        <div className="form-group">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
            <label style={{ margin: 0 }}>Links (optioneel)</label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addLink} style={{ fontSize: 12 }}>
              + Link toevoegen
            </button>
          </div>
          {links.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {links.map((url, i) => (
                <LinkRow key={i} value={url} onChange={(v) => updateLink(i, v)} onRemove={() => removeLink(i)} />
              ))}
            </div>
          )}
          {links.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Voeg een Vinted link of andere URL toe</div>
          )}
        </div>

        {/* Notes */}
        <div className="form-group">
          <label>Notities (optioneel)</label>
          <textarea
            placeholder="Interne notitie over deze verkoop…"
            value={saleNotes}
            onChange={(e) => setSaleNotes(e.target.value)}
            style={{ minHeight: 56 }}
          />
        </div>

        {/* Profit preview */}
        {isFree ? (
          <div className="profit-preview">
            <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 13, padding: '6px 0' }}>
              Gratis weggegeven — geen winstberekening
            </div>
          </div>
        ) : profit && price && (
          <div className="profit-preview">
            <div className="profit-row">
              <span>Omzet ({effectiveQty}×)</span>
              <span>{formatCurrency(profit.totalRevenue)}</span>
            </div>
            <div className="profit-row">
              <span>Inkoopprijs</span>
              <span className="val-red">-{formatCurrency(profit.totalCost)}</span>
            </div>
            {effectiveShipping > 0 && (
              <div className="profit-row">
                <span>Verzendkost</span>
                <span className="val-red">-{formatCurrency(effectiveShipping)}</span>
              </div>
            )}
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
