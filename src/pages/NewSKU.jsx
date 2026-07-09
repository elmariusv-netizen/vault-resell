import { useState, useMemo, useRef } from 'react'
import { genId, getNextRange, formatSkuRange, formatCurrency, getNextSkuLabel } from '../utils/skuUtils'

const COLORS = ['#00ff88', '#4fc3f7', '#ce93d8', '#ffb74d', '#80cbc4', '#ff7043', '#f06292', '#aed581', '#ffd60a', '#3ecfff']

// Foto's staan als volledige-resolutie base64 in `photos` (voor opslag/thumbnail).
// Voor de AI-aanvraag verkleinen we naar max 1024px zodat de request klein en
// snel blijft — de Vercel-functie heeft een payload-limiet en het model heeft
// geen baat bij de volledige foto-resolutie.
function downscaleForAI(dataUrl, maxDim = 1024, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => reject(new Error('foto kon niet geladen worden'))
    img.src = dataUrl
  })
}

export default function NewSKU({ data, updateData, onNavigate }) {
  const { batches, suppliers } = data

  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '')
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [photos, setPhotos] = useState([])
  const [costPrice, setCostPrice] = useState('')
  const [importTax, setImportTax] = useState('')
  const [quantity, setQuantity] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0])
  const [note, setNote] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState('')

  const [showNewSupplier, setShowNewSupplier] = useState(false)
  const [newSupPrefix, setNewSupPrefix] = useState('')
  const [newSupName, setNewSupName] = useState('')
  const [newSupColor, setNewSupColor] = useState(COLORS[0])

  const photoRef = useRef()

  const supplier = suppliers.find((s) => s.id === supplierId)

  const skuPreview = useMemo(() => {
    if (!supplier || !quantity || parseInt(quantity) < 1) return null
    const { startNum, endNum } = getNextRange(batches, supplier.prefix, parseInt(quantity))
    return { range: formatSkuRange(supplier.prefix, startNum, endNum), startNum, endNum }
  }, [supplier, quantity, batches])

  // importTax is een TOTAAL bedrag voor de hele batch (bv. 1 douanefactuur
  // voor de hele zending), geen bedrag per stuk — komt dus maar 1x bij de
  // totale inkoopkost, niet vermenigvuldigd met het aantal.
  const totalCost = useMemo(() => {
    const q = parseInt(quantity) || 0
    const c = parseFloat(costPrice) || 0
    const t = parseFloat(importTax) || 0
    return q * c + t
  }, [quantity, costPrice, importTax])

  const handlePhotos = (e) => {
    const files = Array.from(e.target.files)
    files.forEach((file) => {
      const reader = new FileReader()
      reader.onload = (ev) => setPhotos((prev) => [...prev, ev.target.result])
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  const removePhoto = (i) => setPhotos((prev) => prev.filter((_, idx) => idx !== i))

  const handleGenerate = async () => {
    if (!photos.length || generating) return
    setGenerating(true)
    setGenerateError('')
    try {
      const small = await Promise.all(photos.slice(0, 2).map((p) => downscaleForAI(p)))
      const images = small.map((dataUrl) => {
        const [, mimeType, data] = dataUrl.match(/^data:(.+?);base64,(.+)$/) || []
        return { mimeType, data }
      })
      const res = await fetch('/api/generate-listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images }),
      })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) {
        setGenerateError(result.message || 'Genereren mislukt. Probeer opnieuw of vul handmatig in.')
        return
      }
      if (result.title) setName(result.title)
      if (result.description) setDescription(result.description)
      if (result.brand && !brand) setBrand(result.brand)
      if (result.category && !category) setCategory(result.category)
    } catch {
      setGenerateError('Genereren mislukt — check je internetverbinding en probeer opnieuw.')
    } finally {
      setGenerating(false)
    }
  }

  const handleCreateSupplier = () => {
    if (!newSupPrefix.trim() || !newSupName.trim()) return
    const prefix = newSupPrefix.toUpperCase().slice(0, 4)
    if (suppliers.some((s) => s.prefix === prefix)) {
      alert(`Prefix "${prefix}" bestaat al.`); return
    }
    const newSup = { id: genId(), prefix, name: newSupName.trim(), color: newSupColor }
    updateData({ suppliers: [...suppliers, newSup] })
    setSupplierId(newSup.id)
    setShowNewSupplier(false)
    setNewSupPrefix('')
    setNewSupName('')
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!supplier || !quantity) return
    const q = parseInt(quantity)
    const { startNum, endNum } = getNextRange(batches, supplier.prefix, q)
    const batch = {
      id: genId(),
      supplierPrefix: supplier.prefix,
      supplierId: supplier.id,
      startNum,
      endNum,
      name,
      brand,
      category,
      description,
      photo: photos[0] || null,
      photos,
      costPrice: parseFloat(costPrice) || 0,
      importTax: parseFloat(importTax) || 0,
      quantity: q,
      purchaseDate,
      note,
    }
    updateData({ batches: [...batches, batch] })
    onNavigate('inventory')
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Nieuwe aankoop</h1>
          <div className="page-subtitle">Voeg een nieuwe batch toe aan je voorraad</div>
        </div>
      </div>

      <div style={{ maxWidth: 720 }}>
        <form className="form" onSubmit={handleSubmit}>

          {/* SKU continuity overview */}
          {suppliers.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
              {suppliers.map((s) => {
                const next = getNextSkuLabel(batches, s.prefix)
                const isActive = supplier?.prefix === s.prefix
                return (
                  <div
                    key={s.id}
                    onClick={() => setSupplierId(s.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      background: isActive ? s.color + '14' : 'var(--surface)',
                      border: `1px solid ${isActive ? s.color + '40' : 'var(--border)'}`,
                      borderRadius: 'var(--r-lg)',
                      padding: '8px 14px',
                      cursor: 'pointer',
                      transition: 'all 0.14s',
                      flex: '1 1 auto',
                      minWidth: 0,
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                        {s.name.length > 16 ? s.prefix : s.name}
                      </div>
                      <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 800, color: isActive ? s.color : 'var(--text-2)' }}>
                        Volgende: {next}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Supplier + quantity */}
          <div className="glass-card">
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-3)', marginBottom: 16 }}>
              Leverancier & hoeveelheid
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Leverancier</label>
                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.prefix} — {s.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Aantal aangekocht</label>
                <input
                  type="number" min="1" value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0" required
                />
              </div>
            </div>

            {/* Inline new supplier */}
            {!showNewSupplier ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowNewSupplier(true)}
                style={{ marginTop: 8, alignSelf: 'flex-start' }}
              >
                + Nieuwe leverancier aanmaken
              </button>
            ) : (
              <div style={{ marginTop: 12, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 16 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12, color: 'var(--text-2)' }}>Nieuwe leverancier</div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Prefix (max 4 tekens)</label>
                    <input
                      value={newSupPrefix}
                      onChange={(e) => setNewSupPrefix(e.target.value.slice(0, 4).toUpperCase())}
                      placeholder="ABC"
                    />
                  </div>
                  <div className="form-group">
                    <label>Naam</label>
                    <input
                      value={newSupName}
                      onChange={(e) => setNewSupName(e.target.value)}
                      placeholder="Leverancier naam"
                    />
                  </div>
                </div>
                <div className="form-group" style={{ marginTop: 0 }}>
                  <label>Kleur</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`color-dot${newSupColor === c ? ' selected' : ''}`}
                        style={{ background: c }}
                        onClick={() => setNewSupColor(c)}
                      />
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleCreateSupplier}
                    disabled={!newSupPrefix || !newSupName}
                  >
                    Aanmaken
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowNewSupplier(false)}>
                    Annuleer
                  </button>
                </div>
              </div>
            )}

            {skuPreview && (
              <div style={{
                marginTop: 14,
                background: 'var(--green-dim)',
                border: '1px solid var(--green-border)',
                borderRadius: 'var(--r-lg)',
                padding: '12px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}>
                <span style={{ fontSize: 18 }}>🏷</span>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--green)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 2 }}>SKU bereik</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 800, color: 'var(--green)' }}>
                    {skuPreview.range}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Product info */}
          <div className="glass-card">
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-3)', marginBottom: 16 }}>
              Product info
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Naam / Omschrijving</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="bv. Ralph Lauren Trui" />
              </div>
              <div className="form-group">
                <label>Merk</label>
                <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="bv. Ralph Lauren" />
              </div>
            </div>
            <div className="form-row" style={{ marginTop: 0 }}>
              <div className="form-group">
                <label>Categorie</label>
                <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="bv. Truien, Hemdjes…" />
              </div>
            </div>

            {/* Multi-photo upload */}
            <div className="form-group" style={{ marginTop: 0 }}>
              <label>Foto's</label>
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, alignItems: 'center' }}>
                {photos.map((p, i) => (
                  <div key={i} style={{ position: 'relative', flexShrink: 0 }}>
                    <img
                      src={p}
                      alt={`foto ${i + 1}`}
                      style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)', display: 'block' }}
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      style={{
                        position: 'absolute', top: -6, right: -6,
                        width: 20, height: 20, borderRadius: '50%',
                        background: 'var(--red)', color: '#fff',
                        border: 'none', cursor: 'pointer',
                        fontSize: 12, lineHeight: '20px', textAlign: 'center',
                        padding: 0,
                      }}
                    >
                      ×
                    </button>
                    {i === 0 && (
                      <div style={{ position: 'absolute', bottom: 4, left: 4, fontSize: 9, background: 'rgba(0,0,0,0.55)', color: '#fff', borderRadius: 3, padding: '1px 4px' }}>
                        hoofd
                      </div>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => { photoRef.current.value = ''; photoRef.current.click() }}
                  style={{
                    width: 80, height: 80, borderRadius: 10,
                    border: '2px dashed var(--border-strong)',
                    background: 'var(--bg-2)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', flexShrink: 0,
                    color: 'var(--text-3)', fontSize: 22, gap: 4,
                  }}
                >
                  <span>+</span>
                  <span style={{ fontSize: 9, letterSpacing: '.04em' }}>FOTO</span>
                </button>
              </div>
              <input ref={photoRef} type="file" accept="image/*" multiple onChange={handlePhotos} style={{ display: 'none' }} />
              {photos.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                  Eerste foto wordt gebruikt als thumbnail
                </div>
              )}
            </div>

            {/* AI-titel/beschrijving-voorstel — vult enkel de velden hierboven,
                niets wordt automatisch opgeslagen. Gebruiker kan alles nog
                aanpassen vóór "Aankoop opslaan". */}
            <div className="form-group" style={{ marginTop: 0 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleGenerate}
                disabled={!photos.length || generating}
              >
                {generating ? '✨ Bezig met genereren…' : '✨ Genereer titel & beschrijving'}
              </button>
              {!photos.length && (
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>Voeg eerst een foto toe.</div>
              )}
              {generateError && (
                <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 6 }}>{generateError}</div>
              )}
            </div>

            <div className="form-group" style={{ marginTop: 0 }}>
              <label>Beschrijving (optioneel)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Wordt gebruikt als Vinted-omschrijving — pas gerust aan na AI-voorstel"
              />
            </div>
          </div>

          {/* Purchase details */}
          <div className="glass-card">
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-3)', marginBottom: 16 }}>
              Inkoop details
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Inkoopprijs per stuk (€)</label>
                <input type="number" step="0.01" min="0" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} placeholder="0,00" />
              </div>
              <div className="form-group">
                <label>Import tax totaal (€)</label>
                <input type="number" step="0.01" min="0" value={importTax} onChange={(e) => setImportTax(e.target.value)} placeholder="0,00" />
              </div>
            </div>
            <div className="form-group" style={{ marginTop: 0, maxWidth: 240 }}>
              <label>Aankoopdatum</label>
              <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
            </div>

            {totalCost > 0 && (
              <div style={{
                marginTop: 16,
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)',
                padding: '12px 16px',
                fontSize: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <span style={{ color: 'var(--text-3)' }}>Totale inkoopkost</span>
                <span style={{ fontWeight: 700, fontSize: 16 }}>{formatCurrency(totalCost)}</span>
              </div>
            )}
          </div>

          {/* Note */}
          <div className="form-group">
            <label>Notitie (optioneel)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optionele notitie over deze batch…" />
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="submit" className="btn btn-primary" disabled={!supplierId || !quantity}>
              Aankoop opslaan
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => onNavigate('inventory')}>
              Annuleer
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
