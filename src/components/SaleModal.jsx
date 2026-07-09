import { useState, useMemo, useEffect, useRef } from 'react'
import Modal from './Modal'
import { genId, formatSkuRange, calcSaleProfit, formatCurrency, getRemainingQty, getBatchUnitCost } from '../utils/skuUtils'

const PLATFORMS = ['Vinted', 'WhatsApp', 'Instagram', 'Lokaal', 'Ander']

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

export default function SaleModal({ data, onClose, onSave, defaultBatchId, prefill = null }) {
  const { batches, sales } = data
  const photoRef = useRef()

  const [batchId, setBatchId] = useState(defaultBatchId || (batches[0]?.id ?? ''))
  const [type, setType] = useState('individual')
  const [qty, setQty] = useState(1)
  const [price, setPrice] = useState(prefill?.price != null ? String(prefill.price) : '')
  const [platform, setPlatform] = useState('Vinted')
  const [customPlatform, setCustomPlatform] = useState('')
  const [buyer, setBuyer] = useState(prefill?.buyer || '')
  const [shippingCost, setShippingCost] = useState('')
  const [saleNotes, setSaleNotes] = useState(prefill?.notes || '')
  const [date, setDate] = useState(prefill?.date || new Date().toISOString().split('T')[0])
  const [fromLive, setFromLive] = useState(false)
  const [photo, setPhoto] = useState(null)
  const [links, setLinks] = useState(prefill?.url ? [prefill.url] : [])
  const [photoLoading, setPhotoLoading] = useState(false)
  const [shipped, setShipped] = useState(false)
  const [shippedDate, setShippedDate] = useState(new Date().toISOString().split('T')[0])
  const [isFree, setIsFree] = useState(false)
  const [saleTime, setSaleTime] = useState('')

  const batch = batches.find((b) => b.id === batchId)
  const remaining = batch ? getRemainingQty(batch, sales) : 0
  const liveCount = batch?.liveCount || 0

  const unitCostPrice = batch ? (parseFloat(batch.costPrice) || 0) : 0
  // importTax is een TOTAAL bedrag voor de hele batch, geen bedrag per stuk
  // — zie getBatchUnitCost() in skuUtils.js.
  const unitImportTax = batch ? (parseFloat(batch.importTax) || 0) / (batch.quantity || 1) : 0
  const unitCost = batch ? getBatchUnitCost(batch) : 0

  useEffect(() => { setFromLive(false) }, [batchId])
  useEffect(() => { if (isFree) setPrice('0') }, [isFree])

  const effectiveQty = type === 'bulk' ? parseInt(qty) || 1 : 1
  const effectiveShipping = parseFloat(shippingCost) || 0
  const salePrice = parseFloat(price) || 0

  const profitPerUnit = salePrice - unitCost - (effectiveQty > 0 ? effectiveShipping / effectiveQty : 0)
  const totalRevenue = salePrice * effectiveQty
  const totalCost = unitCost * effectiveQty
  const totalProfit = totalRevenue - totalCost - effectiveShipping

  const profit = batch && !isFree ? calcSaleProfit(
    { quantity: effectiveQty, salePrice, shippingCost: effectiveShipping, fees: 0 },
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

  const effectivePlatform = platform === 'Ander' ? (customPlatform.trim() || 'Ander') : platform

  const handleSave = () => {
    if (!batch || (!price && !isFree)) return
    const sale = {
      id: genId(),
      batchId,
      type,
      quantity: effectiveQty,
      salePrice: isFree ? 0 : parseFloat(price),
      platform: effectivePlatform,
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
      saleTime: saleTime || null,
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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginTop: 4 }}>
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                Resterend: <strong>{remaining}</strong> stuks
                {liveCount > 0 && <span style={{ color: 'var(--blue)' }}> · {liveCount} live</span>}
              </span>
              {unitCost > 0 ? (
                <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                  Inkoop/stuk:{' '}
                  <strong style={{ color: 'var(--text)' }}>{formatCurrency(unitCostPrice)}</strong>
                  {unitImportTax > 0 && (
                    <> + <strong style={{ color: 'var(--text)' }}>{formatCurrency(unitImportTax)}</strong> tax</>
                  )}
                  {' = '}
                  <strong style={{ color: 'var(--text)' }}>{formatCurrency(unitCost)}</strong>
                </span>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--yellow)' }}>
                  ⚠ Geen inkoopprijs ingesteld
                </span>
              )}
            </div>
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
          <label>Tijdstip (optioneel)</label>
          <input
            type="time"
            value={saleTime}
            onChange={(e) => setSaleTime(e.target.value)}
            style={{ maxWidth: 160 }}
          />
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Gebruikt voor het heatmap in het dashboard</span>
        </div>

        <div className="form-group">
          <label>Platform</label>
          <div className="platform-group">
            {PLATFORMS.map((p) => (
              <button
                key={p}
                className={`platform-btn${platform === p ? ' active' : ''}`}
                onClick={() => setPlatform(p)}
              >
                {p}
              </button>
            ))}
          </div>
          {platform === 'Ander' && (
            <input
              type="text"
              placeholder="Naam van het platform"
              value={customPlatform}
              onChange={(e) => setCustomPlatform(e.target.value)}
              style={{ marginTop: 8 }}
            />
          )}
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
        ) : price && batch && (
          <div className="profit-preview">
            <div className="profit-row">
              <span>Verkoopprijs{effectiveQty > 1 ? ` (${effectiveQty}×)` : ''}</span>
              <span>{formatCurrency(totalRevenue)}</span>
            </div>
            <div className="profit-row">
              <span>
                Inkoopprijs/stuk{effectiveQty > 1 ? ` × ${effectiveQty}` : ''}
                {unitCostPrice > 0 && unitImportTax > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 4 }}>
                    ({formatCurrency(unitCostPrice)} + {formatCurrency(unitImportTax)} tax)
                  </span>
                )}
                {unitCost === 0 && (
                  <span style={{ fontSize: 11, color: 'var(--yellow)', marginLeft: 4 }}>niet ingesteld</span>
                )}
              </span>
              <span className="val-red">-{formatCurrency(totalCost)}</span>
            </div>
            {effectiveShipping > 0 && (
              <div className="profit-row">
                <span>Verzendkost</span>
                <span className="val-red">-{formatCurrency(effectiveShipping)}</span>
              </div>
            )}
            <div className="profit-row total">
              <span>Netto winst{effectiveQty > 1 ? ` (${effectiveQty} stuks)` : ''}</span>
              <span className={totalProfit >= 0 ? 'val-green' : 'val-red'}>
                {formatCurrency(totalProfit)}
              </span>
            </div>
            {effectiveQty > 1 && (
              <div className="profit-row" style={{ opacity: 0.7 }}>
                <span>Winst per stuk</span>
                <span className={profitPerUnit >= 0 ? 'val-green' : 'val-red'}>
                  {formatCurrency(profitPerUnit)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
