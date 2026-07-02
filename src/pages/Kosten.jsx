import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../utils/supabase'
import { formatCurrency, formatDate, genId, fetchBusinessCosts, sumCosts } from '../utils/skuUtils'

export const COST_CATEGORIES = ['Verzendmateriaal', 'Software/Abonnementen', 'Uitrusting', 'Marketing', 'Overig']

const CATEGORY_COLORS = {
  'Verzendmateriaal':        '#2563eb',
  'Software/Abonnementen':   '#7c3aed',
  'Uitrusting':              '#d97706',
  'Marketing':               '#db2777',
  'Overig':                  '#6b7280',
}

function NewCostModal({ onClose, onSave }) {
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [costDate, setCostDate] = useState(new Date().toISOString().split('T')[0])
  const [category, setCategory] = useState(COST_CATEGORIES[0])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const close = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  const canSave = description.trim() && parseFloat(amount) > 0 && costDate

  const handleSave = async () => {
    if (!canSave || saving) return
    setSaving(true)
    try {
      await onSave({ description: description.trim(), amount: parseFloat(amount), cost_date: costDate, category })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 400 }}>
        <div className="modal-header">
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Nieuwe kost toevoegen</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Omschrijving</label>
            <input
              autoFocus
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="bv. Verzenddozen 50 stuks"
              style={{ width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Bedrag (€)</label>
              <input
                type="number" step="0.01" min="0"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0,00"
                style={{ width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Datum</label>
              <input
                type="date"
                value={costDate}
                onChange={e => setCostDate(e.target.value)}
                style={{ width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Categorie</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              style={{ width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }}
            >
              {COST_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 4, opacity: !canSave || saving ? 0.6 : 1 }}
          >
            {saving ? 'Bezig…' : '✓ Kost toevoegen'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CostRow({ cost, onDelete, invoiceUrl }) {
  const color = CATEGORY_COLORS[cost.category] || CATEGORY_COLORS.Overig
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
      borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {cost.description}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          {cost.category && (
            <span style={{ fontSize: 10, fontWeight: 700, color, background: `${color}1f`, padding: '2px 8px', borderRadius: 4 }}>
              {cost.category}
            </span>
          )}
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{formatDate(cost.cost_date)}</span>
          {invoiceUrl && (
            <a href={invoiceUrl} target="_blank" rel="noopener noreferrer" title="Gekoppelde factuur" style={{ fontSize: 11, color: 'var(--text-3)', textDecoration: 'none' }}>
              📎
            </a>
          )}
        </div>
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>
        {formatCurrency(cost.amount)}
      </div>
      <button
        onClick={() => onDelete(cost)}
        title="Verwijder"
        style={{ flexShrink: 0, fontSize: 17, lineHeight: 1, background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: '0 2px', fontWeight: 700, fontFamily: 'inherit' }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}
      >×</button>
    </div>
  )
}

// ── Facturen-archief ─────────────────────────────────────────────────────
// PDF's/afbeeldingen (PostNL-facturen, leveranciersbonnen, …) in de
// 'invoices' storage-bucket (public, zelfde opzet als 'labels'/'order-photos').
// Bestandsnaam/uploaddatum komen rechtstreeks uit storage.list() — daarvoor
// is geen aparte databastabel nodig. De optionele koppeling aan een kost
// loopt via business_costs.invoice_path (het storage-pad van het bestand).
function InvoiceRow({ file, publicUrl, costs, linkedCostId, onLink }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <a href={publicUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
          📄 {file.name}
        </a>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
          {formatDate((file.created_at || '').split('T')[0])}
        </div>
      </div>
      <select
        value={linkedCostId || ''}
        onChange={e => onLink(file.name, e.target.value || null)}
        style={{ fontSize: 11, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text-2)', fontFamily: 'inherit', maxWidth: 180 }}
      >
        <option value="">— koppel aan kost —</option>
        {costs.map(c => <option key={c.id} value={c.id}>{c.description}</option>)}
      </select>
      <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }}>
        ⬇
      </a>
    </div>
  )
}

export default function Kosten({ activeUserId }) {
  const [costs, setCosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [invoices, setInvoices] = useState([])
  const [invoicesLoading, setInvoicesLoading] = useState(true)
  const [uploading, setUploading] = useState(false)

  const refresh = useCallback(() => {
    setLoading(true)
    fetchBusinessCosts().then(rows => { setCosts(rows); setLoading(false) })
  }, [])

  const refreshInvoices = useCallback(async () => {
    setInvoicesLoading(true)
    const { data, error } = await supabase.storage.from('invoices').list('', { sortBy: { column: 'created_at', order: 'desc' } })
    if (error) console.warn('[Vault] invoices list error:', error)
    setInvoices((data || []).filter(f => f.name !== '.emptyFolderPlaceholder'))
    setInvoicesLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => { refreshInvoices() }, [refreshInvoices])

  const total = sumCosts(costs)

  const handleSave = async ({ description, amount, cost_date, category }) => {
    const row = { id: genId(), owner_id: activeUserId, description, amount, cost_date, category }
    const { error } = await supabase.from('business_costs').insert(row)
    if (error) { alert(`Opslaan mislukt: ${error.message}`); return }
    setCosts(prev => [row, ...prev])
  }

  const handleDelete = async (cost) => {
    if (!window.confirm(`"${cost.description}" verwijderen?`)) return
    await supabase.from('business_costs').delete().eq('id', cost.id)
    setCosts(prev => prev.filter(c => c.id !== cost.id))
  }

  const handleUpload = async (file) => {
    if (!file) return
    setUploading(true)
    const ext = file.name.split('.').pop()
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const { error } = await supabase.storage.from('invoices').upload(path, file)
    if (error) { alert(`Upload mislukt: ${error.message}`); setUploading(false); return }
    await refreshInvoices()
    setUploading(false)
  }

  const handleLinkInvoice = async (fileName, costId) => {
    // Ontkoppel eerst een eventuele vorige koppeling van dit bestand (een
    // factuur kan maar aan 1 kost tegelijk gekoppeld zijn).
    const prevLinked = costs.find(c => c.invoice_path === fileName)
    if (prevLinked && prevLinked.id !== costId) {
      await supabase.from('business_costs').update({ invoice_path: null }).eq('id', prevLinked.id)
    }
    if (costId) {
      await supabase.from('business_costs').update({ invoice_path: fileName }).eq('id', costId)
    }
    setCosts(prev => prev.map(c => {
      if (c.id === costId) return { ...c, invoice_path: fileName }
      if (c.invoice_path === fileName && c.id !== costId) return { ...c, invoice_path: null }
      return c
    }))
  }

  const invoicePublicUrl = (fileName) => supabase.storage.from('invoices').getPublicUrl(fileName).data.publicUrl

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Kosten</h1>
          <div className="page-subtitle">{loading ? '…' : `${costs.length} kosten geregistreerd`}</div>
        </div>
        <button className="btn btn-primary" onClick={() => setModalOpen(true)}>
          + Nieuwe kost toevoegen
        </button>
      </div>

      <div className="glass-card" style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>Totale bedrijfskosten</div>
        <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--red)' }}>
          {loading ? '…' : formatCurrency(total)}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>Laden…</div>
      ) : costs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">💸</div>
          <h3>Nog geen kosten geregistreerd</h3>
          <p>Voeg verzendmateriaal, abonnementen of andere bedrijfskosten toe.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {costs.map(cost => (
            <CostRow
              key={cost.id}
              cost={cost}
              onDelete={handleDelete}
              invoiceUrl={cost.invoice_path ? invoicePublicUrl(cost.invoice_path) : null}
            />
          ))}
        </div>
      )}

      {/* ── Facturen-archief ──────────────────────────────────────────── */}
      <div className="page-header" style={{ marginTop: 32 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>Facturen-archief</h2>
          <div className="page-subtitle">PostNL-facturen, leveranciersbonnen, …</div>
        </div>
        <label className="btn btn-secondary" style={{ cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.7 : 1 }}>
          {uploading ? 'Bezig…' : '⬆ Factuur uploaden'}
          <input
            type="file"
            accept="application/pdf,image/*"
            style={{ display: 'none' }}
            disabled={uploading}
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; handleUpload(f) }}
          />
        </label>
      </div>

      {invoicesLoading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>Laden…</div>
      ) : invoices.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🧾</div>
          <h3>Nog geen facturen geüpload</h3>
          <p>Upload PDF's of foto's van leveranciers- of verzendfacturen.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {invoices.map(file => (
            <InvoiceRow
              key={file.name}
              file={file}
              publicUrl={invoicePublicUrl(file.name)}
              costs={costs}
              linkedCostId={costs.find(c => c.invoice_path === file.name)?.id || ''}
              onLink={handleLinkInvoice}
            />
          ))}
        </div>
      )}

      {modalOpen && (
        <NewCostModal onClose={() => setModalOpen(false)} onSave={handleSave} />
      )}
    </div>
  )
}
