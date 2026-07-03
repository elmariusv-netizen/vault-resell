import { useState, useRef } from 'react'
import Modal from './Modal'
import { formatSkuRange } from '../utils/skuUtils'

export default function EditBatchModal({ batch, suppliers, onClose, onSave }) {
  const [form, setForm] = useState({
    name: batch.name || '',
    brand: batch.brand || '',
    category: batch.category || '',
    costPrice: batch.costPrice ?? '',
    importTax: batch.importTax ?? '',
    quantity: batch.quantity ?? '',
    purchaseDate: batch.purchaseDate || '',
    note: batch.note || '',
    supplierPrefix: batch.supplierPrefix || '',
    photos: batch.photos || (batch.photo ? [batch.photo] : []),
  })

  const photoRef = useRef()
  const skuDisplay = formatSkuRange(batch.supplierPrefix, batch.startNum, batch.endNum)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const handlePhotos = (e) => {
    const files = Array.from(e.target.files)
    files.forEach((file) => {
      const reader = new FileReader()
      reader.onload = (ev) => set('photos', [...form.photos, ev.target.result])
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  const removePhoto = (i) => set('photos', form.photos.filter((_, idx) => idx !== i))

  const handleSave = () => {
    onSave({
      ...form,
      photo: form.photos[0] || null,
      costPrice: parseFloat(form.costPrice) || 0,
      importTax: parseFloat(form.importTax) || 0,
      quantity: parseInt(form.quantity) || batch.quantity,
    })
    onClose()
  }

  return (
    <Modal
      title={`Bewerken — ${skuDisplay}`}
      onClose={onClose}
      className="modal-lg"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Annuleer</button>
          <button className="btn btn-primary" onClick={handleSave}>Opslaan</button>
        </>
      }
    >
      <div className="form">
        <div style={{ background: 'var(--bg-input)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--text-2)' }}>
          <strong style={{ color: 'var(--green)', fontFamily: 'monospace' }}>{skuDisplay}</strong>
          {' '}· {batch.quantity} stuks · {suppliers.find(s => s.prefix === batch.supplierPrefix)?.name || batch.supplierPrefix}
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Naam / Omschrijving</label>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="bv. Ralph Lauren Trui" />
          </div>
          <div className="form-group">
            <label>Merk</label>
            <input value={form.brand} onChange={(e) => set('brand', e.target.value)} placeholder="bv. Ralph Lauren" />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Categorie</label>
            <input value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="bv. Truien, Hemdjes..." />
          </div>
        </div>

        {/* Multi-photo upload */}
        <div className="form-group">
          <label>Foto's</label>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, alignItems: 'center' }}>
            {form.photos.map((p, i) => (
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
        </div>

        <div className="form-section">
          <div className="form-section-label">Inkoop</div>
          <div className="form-row">
            <div className="form-group">
              <label>Inkoopprijs per stuk (€)</label>
              <input type="number" step="0.01" min="0" value={form.costPrice} onChange={(e) => set('costPrice', e.target.value)} placeholder="0,00" />
            </div>
            <div className="form-group">
              <label>Import tax totaal (€)</label>
              <input type="number" step="0.01" min="0" value={form.importTax} onChange={(e) => set('importTax', e.target.value)} placeholder="0,00" />
            </div>
          </div>
          <div className="form-row" style={{ marginTop: 14 }}>
            <div className="form-group">
              <label>Aantal aangekocht</label>
              <input type="number" min="1" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Aankoopdatum</label>
              <input type="date" value={form.purchaseDate} onChange={(e) => set('purchaseDate', e.target.value)} />
            </div>
          </div>
        </div>

        <div className="form-group">
          <label>Notitie</label>
          <textarea value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="Optionele notitie..." />
        </div>
      </div>
    </Modal>
  )
}
