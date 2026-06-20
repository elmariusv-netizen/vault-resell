import { useState, useRef } from 'react'
import Modal from './Modal'
import { formatSkuRange } from '../utils/skuUtils'

export default function EditBatchModal({ batch, suppliers, onClose, onSave }) {
  const [form, setForm] = useState({
    name: batch.name || '',
    brand: batch.brand || '',
    category: batch.category || '',
    condition: batch.condition || 'A',
    costPrice: batch.costPrice ?? '',
    importTax: batch.importTax ?? '',
    quantity: batch.quantity ?? '',
    purchaseDate: batch.purchaseDate || '',
    note: batch.note || '',
    supplierPrefix: batch.supplierPrefix || '',
    photo: batch.photo || null,
  })

  const fileRef = useRef()
  const skuDisplay = formatSkuRange(batch.supplierPrefix, batch.startNum, batch.endNum)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const handlePhoto = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => set('photo', ev.target.result)
    reader.readAsDataURL(file)
  }

  const handleSave = () => {
    onSave({
      ...form,
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
          <div className="form-group">
            <label>Conditie</label>
            <div className="seg-group">
              {['A', 'B', 'C'].map((c) => (
                <button key={c} className={`seg-btn${form.condition === c ? ' active' : ''}`} onClick={() => set('condition', c)}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="form-group">
          <label>Foto</label>
          <div className="photo-upload" onClick={() => fileRef.current.click()}>
            {form.photo
              ? <img src={form.photo} alt="preview" />
              : <span>Klik om foto te uploaden</span>}
          </div>
          <input ref={fileRef} type="file" accept="image/*" onChange={handlePhoto} style={{ display: 'none' }} />
          {form.photo && (
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 4 }} onClick={() => set('photo', null)}>
              Foto verwijderen
            </button>
          )}
        </div>

        <div className="form-section">
          <div className="form-section-label">Inkoop</div>
          <div className="form-row">
            <div className="form-group">
              <label>Inkoopprijs per stuk (€)</label>
              <input type="number" step="0.01" min="0" value={form.costPrice} onChange={(e) => set('costPrice', e.target.value)} placeholder="0,00" />
            </div>
            <div className="form-group">
              <label>Import tax per stuk (€)</label>
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
