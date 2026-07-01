import { useState, useRef, useEffect, useCallback } from 'react'
import { PDFDocument } from 'pdf-lib'
import { supabase } from '../utils/supabase'
import { genId } from '../utils/skuUtils'

const OUT_W = 288
const OUT_H = 432

// ── Ondersteunde carriers ─────────────────────────────────────────────────────
const CARRIERS = [
  { name: 'PostNL',        abbr: 'PNL', color: '#FF6200' },
  { name: 'Mondial Relay', abbr: 'MR',  color: '#002D62' },
  { name: 'Vinted Go',     abbr: 'VG',  color: '#007782' },
  { name: 'Bpost',         abbr: 'bp',  color: '#E30613' },
  { name: 'DPD',           abbr: 'DPD', color: '#DC0032' },
]

function CarrierBadges() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
      {CARRIERS.map((c) => (
        <div
          key={c.name}
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            background: c.color, color: '#fff',
            padding: '5px 12px 5px 6px', borderRadius: 100,
            fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
          }}
        >
          <span style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: '50%',
            background: 'rgba(255,255,255,0.22)',
            fontSize: 9, fontWeight: 800, letterSpacing: '0.2px',
          }}>
            {c.abbr}
          </span>
          {c.name}
        </div>
      ))}
    </div>
  )
}

// ── Formatters ─────────────────────────────────────────────────────────────
function formatPrice(price, currency = 'EUR') {
  try { return new Intl.NumberFormat('nl-BE', { style: 'currency', currency }).format(price) }
  catch { return `€${Number(price).toFixed(2)}` }
}

function formatOrderDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('nl-BE', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return iso }
}

function getStatusBadge(status) {
  const s = (status || '').toLowerCase()
  if (s.includes('verzendlabel')) return { label: 'Label gereed', color: '#d97706', bg: 'rgba(245,158,11,0.12)' }
  if (s.includes('verzond') || s.includes('shipped') || s.includes('onderweg')) return { label: 'Onderweg', color: '#2563eb', bg: 'rgba(37,99,235,0.1)' }
  if (s.includes('geleverd') || s.includes('delivered')) return { label: 'Geleverd', color: '#16a34a', bg: 'rgba(22,163,74,0.1)' }
  if (status) return { label: status.length > 36 ? status.slice(0, 36) + '…' : status, color: '#6b7280', bg: 'rgba(107,114,128,0.08)' }
  return { label: 'Label gereed', color: '#d97706', bg: 'rgba(245,158,11,0.12)' }
}

// ── Skeleton card ─────────────────────────────────────────────────────────────
function SkeletonCard() {
  const box = (w, h, r = 6) => (
    <div style={{ width: w, height: h, borderRadius: r, background: 'var(--border)', flexShrink: 0 }} />
  )
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      border: '1px solid var(--border)', borderRadius: 'var(--r-xl)',
      padding: '14px 18px', opacity: 0.5,
    }}>
      {box(52, 52, 10)}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {box('55%', 13)}
        {box('35%', 11)}
      </div>
      {box(148, 32, 8)}
    </div>
  )
}

// ── Vinted order kaart ────────────────────────────────────────────────────────
function OrderCard({ order, onDownload, isDownloading, isDone }) {
  const badge = getStatusBadge(order.status)
  const buyer = order.buyer_name || order.buyer || ''

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      background: isDone ? 'rgba(0,255,136,0.04)' : 'var(--surface)',
      border: `1px solid ${isDone ? 'rgba(0,255,136,0.25)' : 'var(--border)'}`,
      borderRadius: 'var(--r-xl)', padding: '14px 18px',
      transition: 'border-color .2s, background .2s',
    }}>
      {/* Foto */}
      <div style={{
        width: 52, height: 52, borderRadius: 'var(--r-md)',
        background: 'var(--bg-2)', border: '1px solid var(--border)',
        flexShrink: 0, overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {order.photo_url
          ? <img src={order.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.target.style.display = 'none' }} />
          : <span style={{ fontSize: 22 }}>📦</span>}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {order.title}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ color: 'var(--green)', fontWeight: 700 }}>{formatPrice(order.price, order.currency)}</span>
          {buyer && <span>· {buyer}</span>}
          {order.sale_date && <span>· {formatOrderDate(order.sale_date)}</span>}
          <span style={{ fontSize: 10, color: badge.color, background: badge.bg, padding: '2px 8px', borderRadius: 5, fontWeight: 700, border: `1px solid ${badge.color}30` }}>
            {badge.label}
          </span>
        </div>
      </div>

      {/* Acties */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {isDone && (
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', whiteSpace: 'nowrap' }}>
            ✓ Gedownload
          </span>
        )}
        <button
          className="btn btn-primary btn-sm"
          onClick={onDownload}
          disabled={isDownloading}
          style={{ whiteSpace: 'nowrap' }}
        >
          {isDownloading ? 'Downloaden…' : '⬇ Download 4×6 label'}
        </button>
      </div>
    </div>
  )
}

// ── Handmatig label toevoegen (modal) ──────────────────────────────────────────
function ManualLabelModal({ onClose, onAdd }) {
  const [dragOver, setDragOver] = useState(false)
  const [phase, setPhase]       = useState('idle') // idle | uploading | preview | error
  const [error, setError]       = useState(null)
  const [preview, setPreview]   = useState(null)   // { name, blob, previewUrl }
  const fileInputRef = useRef(null)

  useEffect(() => {
    return () => { if (preview?.previewUrl) URL.revokeObjectURL(preview.previewUrl) }
  }, [preview])

  const cropFile = async (file) => {
    setPhase('uploading')
    setError(null)
    try {
      const res = await fetch('/api/label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf' },
        body: file,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const previewUrl = URL.createObjectURL(blob)
      setPreview({ name: file.name, blob, previewUrl })
      setPhase('preview')
    } catch (e) {
      setError(`Croppen mislukt: ${e.message}`)
      setPhase('error')
    }
  }

  const handleFiles = (fileList) => {
    const file = Array.from(fileList).find((f) => f.type === 'application/pdf')
    if (!file) { setError('Kies een PDF-bestand.'); setPhase('error'); return }
    cropFile(file)
  }

  const confirmAdd = () => {
    onAdd({ name: preview.name, blob: preview.blob })
    onClose()
  }

  useEffect(() => {
    const close = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 420, padding: 24 }}>
        <div className="modal-header">
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Handmatig label toevoegen</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {phase === 'idle' && (
          <div
            className={`drop-zone${dragOver ? ' drag-over' : ''}`}
            style={{ marginTop: 16 }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="drop-icon">📄</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>
              Sleep een PDF-label hier
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>of klik om te bladeren</div>
            <input
              ref={fileInputRef} type="file" accept=".pdf,application/pdf"
              onChange={(e) => { if (e.target.files.length) handleFiles(e.target.files); e.target.value = '' }}
              style={{ display: 'none' }}
            />
          </div>
        )}

        {phase === 'uploading' && (
          <div style={{ marginTop: 16, padding: '40px 0', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>⏳</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>
              Label wordt gecropt naar 4×6…
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div style={{ marginTop: 16 }}>
            <div style={{
              padding: '12px 14px', borderRadius: 10, fontSize: 13,
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)',
              color: 'var(--red)', lineHeight: 1.6, marginBottom: 12,
            }}>
              {error}
            </div>
            <button className="btn btn-secondary" onClick={() => setPhase('idle')} style={{ width: '100%' }}>
              Opnieuw proberen
            </button>
          </div>
        )}

        {phase === 'preview' && preview && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10 }}>
              Voorbeeld van het gecropte 4×6 label:
            </div>
            <div style={{
              display: 'flex', justifyContent: 'center', marginBottom: 16,
              background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12,
            }}>
              <embed
                src={`${preview.previewUrl}#toolbar=0&navpanes=0&scrollbar=0`}
                type="application/pdf"
                style={{ width: 120, height: 180, border: '1px solid var(--border)', borderRadius: 4 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={onClose} style={{ flex: 1 }}>Annuleer</button>
              <button className="btn btn-primary" onClick={confirmAdd} style={{ flex: 1 }}>✓ Toevoegen</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Hoofdcomponent ────────────────────────────────────────────────────────────
export default function Labels({ vintedCookie }) {
  const [orders, setOrders]           = useState([])
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [ordersError, setOrdersError] = useState(null)
  const [downloading, setDownloading] = useState(new Set())
  const [downloaded, setDownloaded]   = useState(new Set())

  const [manualItems, setManualItems] = useState([])
  const [modalOpen, setModalOpen]     = useState(false)
  const [printing, setPrinting]       = useState(false)

  // ── Vinted orders met beschikbaar label ophalen ─────────────────────────
  const fetchOrders = useCallback(() => {
    setOrdersLoading(true)
    setOrdersError(null)
    supabase
      .from('vinted_orders')
      .select('*')
      .eq('label_available', true)
      .order('synced_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { setOrdersError(error.message); setOrdersLoading(false); return }
        setOrders(data || [])
        setOrdersLoading(false)
      })
  }, [])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  const labelParams = (order) => new URLSearchParams(
    order.label_url
      ? { label_url: order.label_url }
      : { transaction_id: order.transaction_id || order.id }
  )

  const labelHeaders = () => (vintedCookie ? { 'x-vinted-cookie': vintedCookie } : {})

  // ── Label downloaden ───────────────────────────────────────────────────────
  const downloadLabel = useCallback(async (order) => {
    setDownloading((prev) => new Set([...prev, order.id]))
    try {
      const res = await fetch(`/api/label?${labelParams(order)}`, { headers: labelHeaders() })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `label-${order.transaction_id || order.id}-4x6.pdf`
      a.click()
      URL.revokeObjectURL(url)
      setDownloaded((prev) => new Set([...prev, order.id]))
    } catch (e) {
      alert(`Download mislukt: ${e.message}`)
    }
    setDownloading((prev) => { const n = new Set(prev); n.delete(order.id); return n })
  }, [vintedCookie])

  // ── Handmatige labels (al gecropt naar 4×6 door /api/label) ───────────────
  const addManualItem = ({ name, blob }) => {
    const previewUrl = URL.createObjectURL(blob)
    setManualItems((prev) => [...prev, { id: genId(), name, blob, previewUrl }])
  }
  const removeManualItem = (id) => {
    setManualItems((prev) => {
      const item = prev.find((i) => i.id === id)
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
      return prev.filter((i) => i.id !== id)
    })
  }

  // ── Alle labels printen (combineren tot één PDF) ──────────────────────────
  const printAll = async () => {
    if (!orders.length && !manualItems.length) return
    setPrinting(true)
    try {
      const outPdf = await PDFDocument.create()

      for (const order of orders) {
        try {
          const res = await fetch(`/api/label?${labelParams(order)}`, { headers: labelHeaders() })
          if (!res.ok) continue
          const bytes   = new Uint8Array(await res.arrayBuffer())
          const srcPdf  = await PDFDocument.load(bytes, { ignoreEncryption: true })
          const [embedded] = await outPdf.embedPdf(srcPdf, [0])
          const page = outPdf.addPage([OUT_W, OUT_H])
          page.drawPage(embedded, { x: 0, y: 0, width: OUT_W, height: OUT_H })
        } catch (e) { console.warn('[Vault] printAll order mislukt:', order.id, e.message) }
      }

      for (const item of manualItems) {
        try {
          // item.blob is al door /api/label gecropt naar exact 4×6 — gewoon embedden
          const bytes = new Uint8Array(await item.blob.arrayBuffer())
          const srcPdf = await PDFDocument.load(bytes, { ignoreEncryption: true })
          const [embedded] = await outPdf.embedPdf(srcPdf, [0])
          const page = outPdf.addPage([OUT_W, OUT_H])
          page.drawPage(embedded, { x: 0, y: 0, width: OUT_W, height: OUT_H })
        } catch (e) { console.warn('[Vault] printAll manueel mislukt:', item.name, e.message) }
      }

      if (!outPdf.getPageCount()) {
        alert('Geen labels konden worden opgehaald.')
        setPrinting(false)
        return
      }

      const pdfBytes = await outPdf.save()
      const url = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `vault-labels-${new Date().toISOString().split('T')[0]}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Fout bij printen: ' + err.message)
    }
    setPrinting(false)
  }

  const totalCount = orders.length + manualItems.length

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Labels</h1>
          <div className="page-subtitle">Klaarstaande Vinted verzendlabels</div>
        </div>
        <button className="btn btn-secondary" onClick={() => setModalOpen(true)}>
          ➕ Handmatig label toevoegen
        </button>
      </div>

      <CarrierBadges />
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 20 }}>
        Alle verzendlabels worden automatisch herkend en uitgeknipt op 4×6 voor je Munbyn printer.
      </div>

      {/* ── Vinted labels ────────────────────────────────────────────────── */}
      <div className="glass-card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Beschikbare labels</span>
              {!ordersLoading && orders.length > 0 && (
                <span style={{
                  fontSize: 11, fontWeight: 700, color: '#818cf8',
                  background: 'rgba(79,70,229,0.1)', padding: '2px 8px', borderRadius: 100,
                }}>{orders.length}</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
              Orders waarvoor Vinted een verzendlabel klaar heeft staan
            </div>
          </div>
          {!ordersLoading && (
            <button className="btn btn-ghost btn-sm" onClick={fetchOrders}>
              ↻ Vernieuwen
            </button>
          )}
        </div>

        {ordersLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {!ordersLoading && ordersError && (
          <div style={{
            padding: '12px 14px', borderRadius: 10, fontSize: 13,
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)',
            color: 'var(--red)', lineHeight: 1.6,
          }}>
            {ordersError}
          </div>
        )}

        {!ordersLoading && !ordersError && orders.length === 0 && (
          <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 13, color: 'var(--text-3)' }}>
            Geen labels beschikbaar. Gebruik de Chrome-extensie op Vinted om labels naar de app te sturen.
          </div>
        )}

        {!ordersLoading && !ordersError && orders.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {orders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onDownload={() => downloadLabel(order)}
                isDownloading={downloading.has(order.id)}
                isDone={downloaded.has(order.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Handmatig toegevoegde labels ───────────────────────────────────── */}
      {manualItems.length > 0 && (
        <div className="glass-card" style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>
            Handmatig toegevoegd ({manualItems.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {manualItems.map((item) => (
              <div
                key={item.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: 'var(--bg-2)', border: '1px solid var(--border)',
                  borderRadius: 'var(--r-lg)', padding: '10px 14px',
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 'var(--r-sm, 6px)',
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  flexShrink: 0, overflow: 'hidden',
                }}>
                  <embed
                    src={`${item.previewUrl}#toolbar=0&navpanes=0&scrollbar=0`}
                    type="application/pdf"
                    style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.name}
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => removeManualItem(item.id)}
                  style={{ padding: '3px 8px', flexShrink: 0, fontSize: 14 }}
                >×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Print alle labels ──────────────────────────────────────────────── */}
      {totalCount > 0 && (
        <button
          className="btn btn-primary"
          onClick={printAll}
          disabled={printing}
          style={{ width: '100%' }}
        >
          {printing ? 'Bezig met printen…' : `🖨️ Print alle labels (${totalCount})`}
        </button>
      )}

      {modalOpen && (
        <ManualLabelModal onClose={() => setModalOpen(false)} onAdd={addManualItem} />
      )}
    </div>
  )
}
