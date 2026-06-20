import { useState, useMemo, useRef } from 'react'
import { genId, getNextRange, formatSkuRange, formatCurrency } from '../utils/skuUtils'

export default function NewSKU({ data, updateData, onNavigate }) {
  const { batches, suppliers } = data

  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '')
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [category, setCategory] = useState('')
  const [condition, setCondition] = useState('A')
  const [photo, setPhoto] = useState(null)
  const [costPrice, setCostPrice] = useState('')
  const [importTax, setImportTax] = useState('')
  const [quantity, setQuantity] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0])
  const [note, setNote] = useState('')
  const fileRef = useRef()

  const supplier = suppliers.find((s) => s.id === supplierId)

  const skuPreview = useMemo(() => {
    if (!supplier || !quantity || parseInt(quantity) < 1) return null
    const { startNum, endNum } = getNextRange(batches, supplier.prefix, parseInt(quantity))
    return { range: formatSkuRange(supplier.prefix, startNum, endNum), startNum, endNum }
  }, [supplier, quantity, batches])

  const totalCost = useMemo(() => {
    const q = parseInt(quantity) || 0
    const c = parseFloat(costPrice) || 0
    const t = parseFloat(importTax) || 0
    return q * (c + t)
  }, [quantity, costPrice, importTax])

  const handlePhoto = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setPhoto(ev.target.result)
    reader.readAsDataURL(file)
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
      condition,
      photo,
      costPrice: parseFloat(costPrice) || 0,
      importTax: parseFloat(importTax) || 0,
      quantity: q,
      purchaseDate,
      note,
    }
    updateData({ batches: [...batches, batch] })
    onNavigate('inventory')
  }

  const CONDITION_DESC = { A: 'Als nieuw', B: 'Goede staat', C: 'Acceptabel' }

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
              <div className="form-group">
                <label>Conditie</label>
                <div className="seg-group">
                  {['A', 'B', 'C'].map((c) => (
                    <button
                      type="button" key={c}
                      className={`seg-btn${condition === c ? ' active' : ''}`}
                      onClick={() => setCondition(c)}
                      title={CONDITION_DESC[c]}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{CONDITION_DESC[condition]}</div>
              </div>
            </div>

            <div className="form-group" style={{ marginTop: 0 }}>
              <label>Foto (optioneel)</label>
              <div className="photo-upload" onClick={() => fileRef.current.click()}>
                {photo
                  ? <img src={photo} alt="preview" />
                  : <div><div style={{ fontSize: 24, marginBottom: 6 }}>📷</div><div>Klik om foto te uploaden</div></div>
                }
              </div>
              <input ref={fileRef} type="file" accept="image/*" onChange={handlePhoto} style={{ display: 'none' }} />
              {photo && (
                <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => setPhoto(null)}>
                  Foto verwijderen
                </button>
              )}
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
                <label>Import tax per stuk (€)</label>
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
