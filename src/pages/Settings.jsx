import { useState, useRef } from 'react'
import { genId, getNextSkuLabel, formatSku, formatDate } from '../utils/skuUtils'
import { clearData } from '../utils/storage'
import { supabase } from '../utils/supabase'

const COLORS = ['#00ff88', '#4fc3f7', '#ce93d8', '#ffb74d', '#80cbc4', '#ff7043', '#f06292', '#aed581', '#ffd60a', '#3ecfff']

function Kbd({ children }) {
  return (
    <kbd style={{
      fontFamily: 'monospace', fontSize: 11, padding: '1px 7px', borderRadius: 4,
      background: 'var(--bg-3, rgba(0,0,0,0.07))', border: '1px solid var(--border)',
      color: 'var(--text-2)', display: 'inline-block',
    }}>{children}</kbd>
  )
}

function Mono({ children }) {
  return (
    <code style={{
      fontFamily: 'monospace', fontSize: 12, padding: '1px 6px', borderRadius: 4,
      background: 'rgba(79,70,229,0.1)', color: '#818cf8',
    }}>{children}</code>
  )
}

function VintedKoppeling({ vintedCookie, onSave, activeUserId }) {
  const [open, setOpen]           = useState(false)
  const [cookieInput, setCookieInput] = useState('')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  const isConnected = !!vintedCookie
  const masked = vintedCookie
    ? vintedCookie.slice(0, 8) + '••••••••••••' + vintedCookie.slice(-4)
    : ''

  const close = () => { setOpen(false); setCookieInput(''); setError('') }

  const handleSave = async () => {
    const val = cookieInput.trim()
    if (!val) return
    setSaving(true)
    setError('')
    try {
      const { error: e } = await supabase
        .from('user_settings')
        .upsert({ user_id: activeUserId, vinted_cookie: val }, { onConflict: 'user_id' })
      if (e) throw e
      localStorage.setItem('vault-vinted-cookie', val)
      onSave(val)
      close()
    } catch (e) {
      setError(e.message || 'Opslaan mislukt. Bestaat de user_settings tabel al in Supabase?')
    }
    setSaving(false)
  }

  const handleDisconnect = async () => {
    try {
      await supabase
        .from('user_settings')
        .upsert({ user_id: activeUserId, vinted_cookie: null }, { onConflict: 'user_id' })
    } catch {}
    localStorage.removeItem('vault-vinted-cookie')
    onSave(null)
    close()
  }

  const STEPS = [
    <span>Ga naar <strong>vinted.be</strong> en log in op je account</span>,
    <span>Druk op <Kbd>F12</Kbd> om DevTools te openen</span>,
    <span>Klik op het tabblad <strong>Console</strong></span>,
    <span>
      Plak dit commando en druk op <Kbd>Enter</Kbd> — het kopieert alle cookies naar je klembord:
      <br />
      <code style={{
        display: 'block', marginTop: 6, padding: '7px 10px',
        background: 'var(--bg-3, rgba(0,0,0,0.08))', borderRadius: 6,
        fontFamily: 'monospace', fontSize: 13, color: 'var(--text)',
        userSelect: 'all', cursor: 'text',
      }}>copy(document.cookie)</code>
    </span>,
    <span>Plak het resultaat hieronder — dit bevat automatisch de XSRF-TOKEN en alle andere vereiste cookies</span>,
  ]

  return (
    <div className="glass-card">
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 12, flexShrink: 0,
          background: isConnected ? 'rgba(0,255,136,0.1)' : 'var(--bg-2)',
          border: `1px solid ${isConnected ? 'rgba(0,255,136,0.3)' : 'var(--border)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
        }}>
          🛒
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Vinted koppeling</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2, fontFamily: isConnected ? 'monospace' : 'inherit' }}>
            {isConnected ? masked : 'Niet gekoppeld — voeg je sessie-cookie toe om listings en labels te activeren'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
          {isConnected && !open && (
            <span style={{
              fontSize: 11, fontWeight: 700, color: 'var(--green)',
              background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.25)',
              padding: '3px 10px', borderRadius: 100,
            }}>✓ Actief</span>
          )}
          {isConnected ? (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => open ? close() : setOpen(true)}>
                {open ? 'Sluiten' : 'Vervang'}
              </button>
              <button className="btn btn-danger btn-sm" onClick={handleDisconnect}>Ontkoppel</button>
            </>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)} disabled={open}>
              Koppel Vinted account
            </button>
          )}
        </div>
      </div>

      {/* Expandable form */}
      {open && (
        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Step-by-step instructions */}
          <div style={{
            background: 'var(--bg-2)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)', padding: '14px 16px',
          }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, color: 'var(--text)' }}>
              Hoe je de sessie-cookie kopieert:
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {STEPS.map((step, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
                  <span style={{
                    width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                    background: 'rgba(79,70,229,0.12)', color: '#818cf8',
                    fontSize: 11, fontWeight: 800,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{i + 1}</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Textarea */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>
              Plak hier de volledige cookie string (resultaat van copy(document.cookie))
            </label>
            <textarea
              value={cookieInput}
              onChange={(e) => { setCookieInput(e.target.value); setError('') }}
              placeholder="_vinted_fr_session=eyJ...; XSRF-TOKEN=abc123; ..."
              rows={4}
              spellCheck={false}
              autoComplete="off"
              style={{
                width: '100%', fontFamily: 'monospace', fontSize: 12, resize: 'vertical',
                padding: '10px 12px', boxSizing: 'border-box', lineHeight: 1.5,
              }}
            />
          </div>

          {error && (
            <div style={{
              fontSize: 12, color: 'var(--red)', lineHeight: 1.6,
              background: 'rgba(239,68,68,0.08)', padding: '8px 12px', borderRadius: 8,
              border: '1px solid rgba(239,68,68,0.15)',
            }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={close}>Annuleer</button>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSave}
              disabled={!cookieInput.trim() || saving}
            >
              {saving ? 'Opslaan…' : 'Opslaan'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

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
            />
            {supplier && (
              <div style={{ fontSize: 11, color: 'var(--yellow)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span>⚠</span> Wijzigen updatet alle SKU codes van deze leverancier
              </div>
            )}
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

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

const PLATFORMS_KEY = 'vault-platforms'

function PlatformsSection() {
  const load = () => { try { return JSON.parse(localStorage.getItem(PLATFORMS_KEY) || '[]') } catch { return [] } }
  const [platforms, setPlatforms] = useState(load)
  const [newName, setNewName]     = useState('')
  const [newUrl,  setNewUrl]      = useState('')

  const save = (list) => {
    setPlatforms(list)
    localStorage.setItem(PLATFORMS_KEY, JSON.stringify(list))
  }

  const add = () => {
    const name = newName.trim()
    if (!name) return
    if (platforms.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      alert(`Platform "${name}" bestaat al.`); return
    }
    save([...platforms, { id: Date.now().toString(), name, url: newUrl.trim() }])
    setNewName(''); setNewUrl('')
  }

  const remove = (id) => save(platforms.filter(p => p.id !== id))

  return (
    <div className="glass-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Verkoopplatforms</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Verschijnen in het platformfilter op de Verkopen pagina</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {platforms.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center', padding: '12px 0' }}>Nog geen platforms toegevoegd</div>
        )}
        {platforms.map(p => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '10px 14px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
              {p.url && <div style={{ fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.url}</div>}
            </div>
            <button className="btn btn-danger btn-sm" onClick={() => remove(p.id)}>Verwijder</button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Naam (bv. Vinted, Depop)"
          style={{ flex: '1 1 120px', minWidth: 0 }}
        />
        <input
          value={newUrl}
          onChange={e => setNewUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="URL (optioneel)"
          style={{ flex: '2 1 180px', minWidth: 0 }}
        />
        <button className="btn btn-primary btn-sm" onClick={add} disabled={!newName.trim()} style={{ whiteSpace: 'nowrap' }}>
          + Toevoegen
        </button>
      </div>
    </div>
  )
}

export default function Settings({ data, updateData, onExport, activeUserId, vintedCookie, onVintedCookieChange, supabaseUser, onSignOut }) {
  const { suppliers, batches, sales } = data
  const documents = data.documents || []

  const [editSupplier, setEditSupplier] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmDeleteSup, setConfirmDeleteSup] = useState(null)
  const docRef = useRef()

  const handleAdd = (s) => {
    if (suppliers.some((x) => x.prefix === s.prefix)) {
      alert(`Prefix "${s.prefix}" bestaat al.`); return
    }
    updateData({ suppliers: [...suppliers, { id: genId(), ...s }] })
  }

  const handleEdit = (id, updates) => {
    const oldSup = suppliers.find((s) => s.id === id)
    const oldPrefix = oldSup?.prefix
    const newPrefix = updates.prefix

    let updatedBatches = batches
    let updatedSkuPhotos = data.skuPhotos || {}

    if (newPrefix && newPrefix !== oldPrefix) {
      if (suppliers.some((s) => s.id !== id && s.prefix === newPrefix)) {
        alert(`Prefix "${newPrefix}" is al in gebruik.`); return
      }
      updatedBatches = batches.map((b) =>
        b.supplierPrefix === oldPrefix ? { ...b, supplierPrefix: newPrefix } : b
      )
      const newSkuPhotos = {}
      Object.entries(updatedSkuPhotos).forEach(([key, val]) => {
        const newKey = key.startsWith(oldPrefix)
          ? newPrefix + key.slice(oldPrefix.length)
          : key
        newSkuPhotos[newKey] = val
      })
      updatedSkuPhotos = newSkuPhotos
    }

    updateData({
      suppliers: suppliers.map((x) => (x.id === id ? { ...x, ...updates } : x)),
      batches: updatedBatches,
      skuPhotos: updatedSkuPhotos,
    })
  }

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

  const uploadDocument = (e) => {
    const files = Array.from(e.target.files)
    files.forEach((file) => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const doc = {
          id: genId(),
          name: file.name,
          date: new Date().toISOString().split('T')[0],
          size: file.size,
          type: file.type,
          data: ev.target.result,
        }
        updateData({ documents: [...(data.documents || []), doc] })
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  const downloadDocument = (doc) => {
    const a = document.createElement('a')
    a.href = doc.data
    a.download = doc.name
    a.click()
  }

  const deleteDocument = (id) => {
    updateData({ documents: documents.filter((d) => d.id !== id) })
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Instellingen</h1>
          <div className="page-subtitle">Beheer leveranciers, documenten en app data</div>
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
                  }}
                >
                  <div
                    style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: s.color + '18', border: `1px solid ${s.color}30`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
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
                            Volgende: <span style={{ fontFamily: 'monospace', fontWeight: 800 }}>{nextSku}</span>
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

        {/* Documents */}
        <div className="glass-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Documenten</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                Facturen, bonnen en leverancierscontracten
              </div>
            </div>
            <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>
              + Upload
              <input ref={docRef} type="file" accept=".pdf,image/*" multiple onChange={uploadDocument} style={{ display: 'none' }} />
            </label>
          </div>

          {documents.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--text-3)', fontSize: 13 }}>
              Geen documenten. Upload facturen, bonnen of contracten.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px',
                    background: 'var(--bg-2)',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ fontSize: 20, flexShrink: 0 }}>
                    {doc.type?.includes('pdf') ? '📄' : '🖼'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {doc.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                      {formatDate(doc.date)}{doc.size ? ` · ${formatSize(doc.size)}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => downloadDocument(doc)}>
                      ↓ Download
                    </button>
                    <button
                      className="btn btn-danger btn-sm btn-icon"
                      onClick={() => deleteDocument(doc.id)}
                      style={{ fontSize: 14 }}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Vinted koppeling */}
        <VintedKoppeling
          vintedCookie={vintedCookie}
          onSave={onVintedCookieChange}
          activeUserId={activeUserId}
        />

        {/* Platforms */}
        <PlatformsSection />

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

        {/* Account */}
        {supabaseUser && (
          <div className="glass-card">
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Account</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{supabaseUser.email}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3, fontFamily: 'monospace' }}>{supabaseUser.id}</div>
              </div>
              <button
                className="btn btn-danger btn-sm"
                onClick={onSignOut}
              >Uitloggen</button>
            </div>
          </div>
        )}

        {/* Info */}
        <div className="glass-card">
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Info</div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.8 }}>
            <div>Vault Resell — lokale resell tracker</div>
            <div>Data opgeslagen in localStorage · geen externe server nodig</div>
            <div style={{ marginTop: 10, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <span>Batches: <strong style={{ color: 'var(--text-2)' }}>{batches.length}</strong></span>
              <span>Verkopen: <strong style={{ color: 'var(--text-2)' }}>{sales.length}</strong></span>
              <span>Leveranciers: <strong style={{ color: 'var(--text-2)' }}>{suppliers.length}</strong></span>
              <span>Documenten: <strong style={{ color: 'var(--text-2)' }}>{documents.length}</strong></span>
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
