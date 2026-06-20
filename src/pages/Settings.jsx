import { useState } from 'react'
import { genId, getNextSkuLabel, formatSku } from '../utils/skuUtils'
import { clearData } from '../utils/storage'

const COLORS = ['#00ff88', '#4fc3f7', '#ce93d8', '#ffb74d', '#80cbc4', '#ff7043', '#f06292', '#aed581', '#ffd60a', '#3ecfff']

function SupplierModal({ supplier, onClose, onSave }) {
  const [prefix, setPrefix] = useState(supplier?.prefix || '')
  const [name, setName] = useState(supplier?.name || '')
  const [color, setColor] = useState(supplier?.color || COLORS[0])

  const handleSave = () => {
    if (!prefix.trim() || !name.trim()) return
    onSave({ prefix: prefix.toUpperCase().trim().slice(0, 4), name: name.trim(), color })
    onClose()
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h2>{supplier ? 'Leverancier bewerken' : 'Leverancier toevoegen'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="form">
          <div className="form-group">
            <label>Prefix (max 4 tekens)</label>
            <input
              value={prefix}
              onChange={(e) => setPrefix(e.target.value.slice(0, 4).toUpperCase())}
              placeholder="bv. ABC"
              disabled={!!supplier}
              style={supplier ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
            />
            {supplier && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Prefix kan niet gewijzigd worden</div>}
          </div>
          <div className="form-group">
            <label>Naam</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="bv. Mijn leverancier" />
          </div>
          <div className="form-group">
            <label>Kleur</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`color-dot${color === c ? ' selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Annuleer</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!prefix || !name}>Opslaan</button>
        </div>
      </div>
    </div>
  )
}

function ConfirmModal({ title, message, onCancel, onConfirm, danger }) {
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onCancel}>×</button>
        </div>
        <p style={{ color: 'var(--text-2)', fontSize: 14, lineHeight: 1.7 }}>{message}</p>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>Annuleer</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>
            Bevestig
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Settings({ data, updateData, onExport, activeUserId }) {
  const { suppliers, batches, sales } = data
  const [editSupplier, setEditSupplier] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmDeleteSup, setConfirmDeleteSup] = useState(null)

  const handleAdd = (s) => {
    if (suppliers.some((x) => x.prefix === s.prefix)) {
      alert(`Prefix "${s.prefix}" bestaat al.`); return
    }
    updateData({ suppliers: [...suppliers, { id: genId(), ...s }] })
  }

  const handleEdit = (id, s) =>
    updateData({ suppliers: suppliers.map((x) => (x.id === id ? { ...x, ...s } : x)) })

  const handleDeleteSup = (id) => {
    const sup = suppliers.find((s) => s.id === id)
    updateData({
      suppliers: suppliers.filter((s) => s.id !== id),
      batches: batches.filter((b) => b.supplierPrefix !== sup?.prefix),
      sales: sales.filter((s) => {
        const b = batches.find((x) => x.id === s.batchId)
        return b?.supplierPrefix !== sup?.prefix
      }),
    })
    setConfirmDeleteSup(null)
  }

  const importData = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result)
        if (parsed.batches && parsed.suppliers) { updateData(parsed); alert('Data geïmporteerd!') }
        else alert('Ongeldig bestandsformaat.')
      } catch { alert('Fout bij het inlezen van het bestand.') }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Instellingen</h1>
          <div className="page-subtitle">Beheer leveranciers en app data</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 760 }}>
        {/* Suppliers */}
        <div className="glass-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Leveranciers</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{suppliers.length} leveranciers geconfigureerd</div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setAddOpen(true)}>+ Toevoegen</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {suppliers.map((s) => {
              const sBatches = batches.filter((b) => b.supplierPrefix === s.prefix)
              const bCount = sBatches.length
              const maxEnd = sBatches.reduce((m, b) => Math.max(m, b.endNum || 0), 0)
              const lastSku = maxEnd > 0 ? formatSku(s.prefix, maxEnd) : null
              const nextSku = getNextSkuLabel(batches, s.prefix)
              return (
                <div
                  key={s.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    background: 'var(--bg-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-lg)',
                    padding: '12px 16px',
                    transition: 'border-color 0.15s',
                  }}
                >
                  <div
                    style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: s.color + '18', border: `1px solid ${s.color}30`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, display: 'block' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 800, color: s.color, fontSize: 14 }}>{s.prefix}</span>
                      <span style={{ fontWeight: 500, fontSize: 14 }}>{s.name}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span>{bCount} batch{bCount !== 1 ? 'es' : ''}</span>
                      {lastSku && (
                        <>
                          <span>·</span>
                          <span>Laatste: <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--text-2)' }}>{lastSku}</span></span>
                          <span>·</span>
                          <span style={{ color: s.color, fontWeight: 600 }}>
                            Volgende bestelling begint bij{' '}
                            <span style={{ fontFamily: 'monospace', fontWeight: 800 }}>{nextSku}</span>
                          </span>
                        </>
                      )}
                      {!lastSku && (
                        <span style={{ color: s.color, fontWeight: 600 }}>
                          Eerste SKU: <span style={{ fontFamily: 'monospace', fontWeight: 800 }}>{nextSku}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditSupplier(s)}>Bewerk</button>
                    <button className="btn btn-danger btn-sm" onClick={() => setConfirmDeleteSup(s.id)}>Verwijder</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Data management */}
        <div className="glass-card">
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 20 }}>Data beheer</div>
          {[
            {
              title: 'Exporteer data',
              desc: 'Download alle data als JSON bestand',
              action: <button className="btn btn-secondary btn-sm" onClick={onExport}>Exporteer</button>,
            },
            {
              title: 'Importeer data',
              desc: 'Laad een eerder geëxporteerd JSON bestand',
              action: (
                <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                  Importeer
                  <input type="file" accept=".json" onChange={importData} style={{ display: 'none' }} />
                </label>
              ),
            },
            {
              title: 'Reset naar begindata',
              desc: 'Verwijdert alles en herstelt de originele startdata',
              danger: true,
              action: <button className="btn btn-danger btn-sm" onClick={() => setConfirmReset(true)}>Reset</button>,
            },
          ].map((item, i, arr) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 0',
                borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 500, color: item.danger ? 'var(--red)' : 'var(--text)' }}>{item.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{item.desc}</div>
              </div>
              {item.action}
            </div>
          ))}
        </div>

        {/* Info */}
        <div className="glass-card">
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Info</div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.8 }}>
            <div>Vault Resell — lokale resell tracker</div>
            <div>Data opgeslagen in localStorage · geen externe server nodig</div>
            <div style={{ marginTop: 10, display: 'flex', gap: 24 }}>
              <span>Batches: <strong style={{ color: 'var(--text-2)' }}>{batches.length}</strong></span>
              <span>Verkopen: <strong style={{ color: 'var(--text-2)' }}>{sales.length}</strong></span>
              <span>Leveranciers: <strong style={{ color: 'var(--text-2)' }}>{suppliers.length}</strong></span>
            </div>
          </div>
        </div>
      </div>

      {addOpen && <SupplierModal onClose={() => setAddOpen(false)} onSave={handleAdd} />}
      {editSupplier && (
        <SupplierModal
          supplier={editSupplier}
          onClose={() => setEditSupplier(null)}
          onSave={(s) => { handleEdit(editSupplier.id, s); setEditSupplier(null) }}
        />
      )}
      {confirmDeleteSup && (
        <ConfirmModal
          title="Leverancier verwijderen?"
          message="Dit verwijdert ook alle batches en verkopen van deze leverancier. Niet ongedaan te maken."
          onCancel={() => setConfirmDeleteSup(null)}
          onConfirm={() => handleDeleteSup(confirmDeleteSup)}
          danger
        />
      )}
      {confirmReset && (
        <ConfirmModal
          title="Alles resetten?"
          message="Alle batches, verkopen en leveranciers worden verwijderd en teruggezet naar de begindata. Dit kan niet ongedaan worden gemaakt."
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => { clearData(activeUserId); window.location.reload() }}
          danger
        />
      )}
    </div>
  )
}
