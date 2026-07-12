import { useState, useEffect, useRef } from 'react'
import Modal from './Modal'
import { genId, formatSkuRange, formatCurrency, getRemainingQty, getBatchUnitCost } from '../utils/skuUtils'

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

// Elk item-rij = 1 batch/SKU + het aantal stuks dat daaruit verkocht wordt.
// Meerdere rijen (verschillende batches/leveranciers) vormen samen 1
// verkoop-registratie — zelfde patroon als een Vinted-bundelorder
// (handleBulkSkuConfirm in Verkopen.jsx): bij het opslaan wordt dit 1
// sales-entry PER rij, allemaal met dezelfde gedeelde vintedOrderId zodat ze
// als 1 "bestelling" tellen (zie orderKey() in skuUtils.js) en elk hun eigen
// SKU/leverancier-badge tonen — geen aparte, nieuwe datamodellering nodig.
let rowSeq = 0
const newRow = (batchId) => ({ key: `row-${++rowSeq}`, batchId, quantity: 1 })

export default function SaleModal({ data, onClose, onSave, defaultBatchId, prefill = null }) {
  const { batches, sales } = data
  const photoRef = useRef()

  const [items, setItems] = useState(() => [newRow(defaultBatchId || (batches[0]?.id ?? ''))])
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

  const isBundle = items.length > 1

  // Per rij: eigen batch + resterend voorraad, waarbij de hoeveelheid die
  // ANDERE rijen in dit concept-formulier al opeisen van diezelfde batch
  // ook meetelt — anders zou je bv. 2 losse rijen uit dezelfde batch van elk
  // "volledige voorraad resterend" kunnen laten zien terwijl ze samen te veel
  // opeisen.
  const rows = items.map((it) => {
    const batch = batches.find((b) => b.id === it.batchId)
    const claimedByOthers = items
      .filter((o) => o !== it && o.batchId === it.batchId)
      .reduce((sum, o) => sum + (parseInt(o.quantity) || 0), 0)
    const remaining = batch ? Math.max(0, getRemainingQty(batch, sales) - claimedByOthers) : 0
    const unitCost = batch ? getBatchUnitCost(batch) : 0
    return { ...it, batch, remaining, unitCost, quantity: parseInt(it.quantity) || 0 }
  })

  const firstBatch = rows[0]?.batch || null
  const liveCount = !isBundle ? (firstBatch?.liveCount || 0) : 0

  useEffect(() => { setFromLive(false) }, [items[0]?.batchId])
  useEffect(() => { if (isFree) setPrice('0') }, [isFree])

  const setRow = (key, patch) => setItems((prev) => prev.map((it) => it.key === key ? { ...it, ...patch } : it))
  const addRow = () => {
    const used = new Set(items.map((it) => it.batchId))
    const nextBatch = batches.find((b) => !used.has(b.id)) || batches[0]
    setItems((prev) => [...prev, newRow(nextBatch?.id ?? '')])
  }
  const removeRow = (key) => setItems((prev) => prev.length > 1 ? prev.filter((it) => it.key !== key) : prev)

  const totalQty = rows.reduce((sum, r) => sum + r.quantity, 0)
  const effectiveShipping = parseFloat(shippingCost) || 0
  const priceInput = parseFloat(price) || 0
  // Bij 1 rij is het ingevoerde bedrag de prijs PER STUK (ongewijzigd gedrag
  // t.o.v. voorheen). Bij meerdere rijen/batches is dat niet zinvol (items uit
  // verschillende batches hebben geen "gedeelde" stukprijs) — daar is het
  // ingevoerde bedrag de TOTALE verkoopprijs, gelijk verdeeld per stuk, exact
  // zoals een Vinted-bundelorder haar totale orderprijs verdeelt over de
  // gekoppelde items (zie perItemPrice in handleBulkSkuConfirm).
  const totalRevenue = isBundle ? priceInput : priceInput * totalQty
  const perUnitPrice = totalQty > 0 ? totalRevenue / totalQty : 0
  const totalCost = rows.reduce((sum, r) => sum + r.unitCost * r.quantity, 0)
  const totalProfit = totalRevenue - totalCost - effectiveShipping
  const profitPerUnit = totalQty > 0 ? (totalProfit / totalQty) : 0

  const liveExceeded = !isBundle && fromLive && totalQty > liveCount

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
    if (!canSave) return
    // Gedeelde groeperingssleutel voor een bundel — zelfde veld/mechanisme
    // als een Vinted-bundelorder (orderKey() in skuUtils.js telt sales met
    // dezelfde vintedOrderId als 1 "bestelling"); bij 1 rij blijft dit
    // ongezet, exact het oude gedrag.
    const groupId = isBundle ? genId() : null
    const shippingPerRow = effectiveShipping / rows.length
    const notes = [saleNotes.trim(), isBundle ? '(bundel-item)' : ''].filter(Boolean).join(' ')
    const salesToSave = rows.map((r) => ({
      id: genId(),
      ...(groupId ? { vintedOrderId: groupId } : {}),
      batchId: r.batchId,
      type: r.quantity > 1 ? 'bulk' : 'individual',
      quantity: r.quantity,
      salePrice: isFree ? 0 : perUnitPrice,
      platform: effectivePlatform,
      buyer,
      fees: 0,
      shippingCost: shippingPerRow,
      notes,
      date,
      fromLive: !isBundle && fromLive,
      photo: photo || null,
      links: links.filter((l) => l.trim()),
      shipped,
      shippedDate: shipped ? shippedDate : null,
      isFree,
      saleTime: saleTime || null,
    }))
    onSave(salesToSave)
    onClose()
  }

  const batchLabel = (b) => {
    const range = formatSkuRange(b.supplierPrefix, b.startNum, b.endNum)
    const name = b.name || b.brand || b.category || ''
    return `${range}${name ? ` — ${name}` : ''}`
  }

  const rowsValid = rows.length > 0 && rows.every((r) => r.batch && r.quantity >= 1 && r.quantity <= r.remaining)
  const canSave = isFree
    ? (rowsValid && !liveExceeded)
    : (priceInput > 0 && rowsValid && !liveExceeded)

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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ margin: 0 }}>SKU / Batch{isBundle ? ` (${items.length} items)` : ''}</label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={addRow} style={{ fontSize: 12 }}>
              + Batch toevoegen
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
            {rows.map((r) => (
              <div key={r.key} style={{ padding: isBundle ? 10 : 0, background: isBundle ? 'var(--bg-2)' : 'transparent', borderRadius: isBundle ? 10 : 0, border: isBundle ? '1px solid var(--border)' : 'none' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <select
                    value={r.batchId}
                    onChange={(e) => setRow(r.key, { batchId: e.target.value })}
                    style={{ flex: 1 }}
                  >
                    {batches.map((b) => (
                      <option key={b.id} value={b.id}>{batchLabel(b)}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    max={r.remaining}
                    value={r.quantity}
                    onChange={(e) => setRow(r.key, { quantity: e.target.value })}
                    title="Aantal stuks uit deze batch"
                    style={{ width: 64, flexShrink: 0 }}
                  />
                  {items.length > 1 && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-icon"
                      onClick={() => removeRow(r.key)}
                      title="Verwijder deze batch"
                      style={{ flexShrink: 0, fontSize: 16 }}
                    >
                      ×
                    </button>
                  )}
                </div>
                {r.batch && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginTop: 4 }}>
                    <span style={{ fontSize: 12, color: r.quantity > r.remaining ? 'var(--red)' : 'var(--text-2)' }}>
                      Resterend: <strong>{r.remaining}</strong> stuks
                      {!isBundle && liveCount > 0 && <span style={{ color: 'var(--blue)' }}> · {liveCount} live</span>}
                    </span>
                    {r.unitCost > 0 ? (
                      <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                        Inkoop/stuk: <strong style={{ color: 'var(--text)' }}>{formatCurrency(r.unitCost)}</strong>
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--yellow)' }}>⚠ Geen inkoopprijs ingesteld</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {!isBundle && liveCount > 0 && (
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

        <div className="form-row">
          <div className="form-group">
            <label>{isBundle ? 'Totale verkoopprijs (€)' : 'Verkoopprijs per stuk (€)'}</label>
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
        ) : price && rows.some((r) => r.batch) && (
          <div className="profit-preview">
            <div className="profit-row">
              <span>{isBundle ? 'Totale verkoopprijs' : 'Verkoopprijs'}{totalQty > 1 ? ` (${totalQty}×)` : ''}</span>
              <span>{formatCurrency(totalRevenue)}</span>
            </div>
            <div className="profit-row">
              <span>
                Inkoopprijs{isBundle ? ` (${items.length} batches, ${totalQty} stuks)` : totalQty > 1 ? ` × ${totalQty}` : ''}
                {totalCost === 0 && (
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
              <span>Netto winst{totalQty > 1 ? ` (${totalQty} stuks)` : ''}</span>
              <span className={totalProfit >= 0 ? 'val-green' : 'val-red'}>
                {formatCurrency(totalProfit)}
              </span>
            </div>
            {totalQty > 1 && (
              <div className="profit-row" style={{ opacity: 0.7 }}>
                <span>Winst per stuk (gemiddeld)</span>
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
