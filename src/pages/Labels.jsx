import { useState, useRef, useEffect, useCallback } from 'react'
import { PDFDocument } from 'pdf-lib'
import { supabase } from '../utils/supabase'
import { genId, isLabelReady, classifyOrderStage, SHIPPED_STAGES } from '../utils/skuUtils'

const OUT_W = 288
const OUT_H = 432

// ── Ondersteunde carriers ─────────────────────────────────────────────────────
// Echte logo-SVG's (public/carriers/) i.p.v. zelfgetekende tekst-pills — via
// Wikimedia Commons opgehaald (PD-textlogo/geometrisch, dus copyright-vrij;
// het merkrecht zelf blijft uiteraard bij elke vervoerder — dit is enkel een
// "wij ondersteunen dit label" interoperabiliteitsvermelding, geen eigen
// gebruik van het merk). Mondial Relay's enige beschikbare bestand staat
// lokaal bij de Franse Wikipedia (fair-use, geen vrije licentie zoals de
// andere 4) — vervang dit bestand gerust door het officiële perskit-logo als
// je dat liever gebruikt.
const CARRIERS = [
  { name: 'PostNL',        src: '/carriers/postnl.svg',        width: 90, height: 28 },
  { name: 'Mondial Relay', src: '/carriers/mondial-relay.svg', width: 90, height: 28 },
  { name: 'Vinted Go',     src: '/carriers/vinted.svg',        width: 90, height: 28 },
  { name: 'bpost',         src: '/carriers/bpost.svg',         width: 90, height: 28 },
  { name: 'DPD',           src: '/carriers/dpd.svg',           width: 90, height: 28 },
]

function CarrierBadges() {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-3)', marginBottom: 8 }}>
        Compatible met alle grote verzendpartners
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {CARRIERS.map((c) => (
          // Vaste witte ondergrond (i.p.v. de kaartkleur van het thema): deze
          // logo's zijn getekend voor een lichte achtergrond — donkere
          // wordmarks (PostNL-navy, bpost/DPD-grijs) zouden anders
          // onleesbaar wegvallen in dark mode. Vaste maat, gecentreerd, geen
          // per-logo kleurcorrectie nodig.
          <div
            key={c.name}
            title={c.name}
            style={{
              width: c.width, height: 36, borderRadius: 8, background: '#fff',
              border: '1px solid rgba(0,0,0,0.08)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              padding: '0 8px', boxSizing: 'border-box',
            }}
          >
            <img
              src={c.src} alt={c.name}
              style={{ maxWidth: '100%', maxHeight: c.height, objectFit: 'contain' }}
            />
          </div>
        ))}
      </div>
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

// Vinted Go "digitaal label" orders hebben geen PDF — enkel een QR-code-
// afbeelding (zie label-prefetch.js). Herkenbaar aan de bestandsextensie van
// label_pdf_url, geen aparte DB-kolom nodig.
function isQrLabel(order) {
  return /\.(png|jpe?g)(\?|$)/i.test(order.label_pdf_url || '')
}

// ── Vinted order kaart ────────────────────────────────────────────────────────
function OrderCard({ order, onDownload, isDownloading, isDone, printed, onTogglePrinted }) {
  const badge = getStatusBadge(order.status)
  const buyer = order.buyer_name || order.buyer || ''
  const isQr = isQrLabel(order)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      background: isDone ? 'rgba(0,255,136,0.04)' : 'var(--surface)',
      border: `1px solid ${isDone ? 'rgba(0,255,136,0.25)' : 'var(--border)'}`,
      borderRadius: 'var(--r-xl)', padding: '14px 18px',
      transition: 'border-color .2s, background .2s, opacity .2s',
      opacity: printed ? 0.5 : 1,
    }}>
      {/* Geprint-vinkje */}
      <label
        title="Geprint — uitgesloten van 'Print alle labels'"
        style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, cursor: 'pointer' }}
      >
        <input
          type="checkbox"
          checked={!!printed}
          onChange={(e) => onTogglePrinted(e.target.checked)}
          style={{ width: 16, height: 16, cursor: 'pointer' }}
        />
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>Geprint</span>
      </label>

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
          {isDownloading ? '…' : isQr ? '🔲 QR-code tonen' : '⬇ Download 4×6 label'}
        </button>
      </div>
    </div>
  )
}

// ── Handmatig label toevoegen (modal) ──────────────────────────────────────────
function ManualLabelModal({ onClose, onAdd }) {
  const [dragOver, setDragOver] = useState(false)
  const [phase, setPhase]       = useState('idle') // idle | uploading | batch | preview | error
  const [error, setError]       = useState(null)
  const [preview, setPreview]   = useState(null)   // { name, blob, previewUrl }
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 })
  const fileInputRef = useRef(null)

  useEffect(() => {
    return () => { if (preview?.previewUrl) URL.revokeObjectURL(preview.previewUrl) }
  }, [preview])

  const cropViaApi = async (file) => {
    const res = await fetch('/api/label', {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: file,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    return { name: file.name, blob: await res.blob() }
  }

  const cropSingle = async (file) => {
    setPhase('uploading')
    setError(null)
    try {
      const { name, blob } = await cropViaApi(file)
      const previewUrl = URL.createObjectURL(blob)
      setPreview({ name, blob, previewUrl })
      setPhase('preview')
    } catch (e) {
      setError(`Croppen mislukt: ${e.message}`)
      setPhase('error')
    }
  }

  // Meerdere bestanden: elk apart croppen via de API, voortgang tonen, en
  // succesvolle labels meteen aan de lijst toevoegen (geen individuele
  // preview/bevestiging per bestand — dat zou omslachtig zijn bij een batch).
  const cropBatch = async (files) => {
    setPhase('batch')
    setError(null)
    setBatchProgress({ done: 0, total: files.length })
    let failCount = 0
    for (let i = 0; i < files.length; i++) {
      try {
        onAdd(await cropViaApi(files[i]))
      } catch (e) {
        failCount++
        console.warn('[Vault] batch crop mislukt:', files[i].name, e.message)
      }
      setBatchProgress({ done: i + 1, total: files.length })
    }
    if (failCount === files.length) {
      setError(`Geen van de ${files.length} bestanden kon worden gecropt.`)
      setPhase('error')
    } else {
      onClose()
    }
  }

  const handleFiles = (fileList) => {
    const files = Array.from(fileList).filter((f) => f.type === 'application/pdf')
    if (!files.length) { setError('Kies één of meer PDF-bestanden.'); setPhase('error'); return }
    if (files.length === 1) cropSingle(files[0])
    else cropBatch(files)
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
              Sleep één of meer PDF-labels hier
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>of klik om te bladeren</div>
            <input
              ref={fileInputRef} type="file" accept=".pdf,application/pdf" multiple
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

        {phase === 'batch' && (
          <div style={{ marginTop: 16, padding: '40px 0', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>⏳</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>
              Bezig met verwerken: {batchProgress.done}/{batchProgress.total} labels…
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
  const [manualPrinted, setManualPrinted] = useState(new Set())
  const [modalOpen, setModalOpen]     = useState(false)
  const [printing, setPrinting]       = useState(false)

  // ── Vinted orders met beschikbaar label ophalen ─────────────────────────
  // label_pdf_url IS NOT NULL naast label_available=true: dezelfde
  // isLabelReady()-definitie als Verkopen.jsx's kaart-badge (skuUtils),
  // zodat beide pagina's nooit meer uit elkaar kunnen lopen. Enkel
  // api/label-prefetch.js zet beide velden samen, na een geslaagde
  // PDF-verificatie.
  //
  // Zodra een order 'in_transit'/'at_pickup_point'/'finished' bereikt (zie
  // classifyOrderStage, dezelfde taalonafhankelijke transaction_status/
  // shipment_status-classificatie als Verkopen.jsx) is het pakket al
  // verzonden — het label heeft dan zijn nut al gehad en hoeft niet langer
  // in "Beschikbare labels" te staan. 'to_ship'/'paused' blijven wél zichtbaar
  // (nog te verzenden, resp. een probleemgeval dat aandacht verdient).
  const fetchOrders = useCallback(() => {
    setOrdersLoading(true)
    setOrdersError(null)
    supabase
      .from('vinted_orders')
      .select('*')
      .eq('label_available', true)
      .not('label_pdf_url', 'is', null)
      .order('synced_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) { setOrdersError(error.message); setOrdersLoading(false); return }
        setOrders((data || []).filter(isLabelReady).filter((o) => !SHIPPED_STAGES.has(classifyOrderStage(o))))
        setOrdersLoading(false)
      })
  }, [])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  // ── "Geprint"-vinkje — optimistisch lokaal gezet, daarna naar Supabase
  // geschreven zodat de status ook na een refresh en op andere apparaten
  // klopt. Bij een schrijffout (bv. de label_printed-migratie nog niet
  // gedraaid) wordt de lokale state teruggedraaid i.p.v. een status te tonen
  // die niet écht opgeslagen is.
  //
  // Aanvinken zet meteen ook manual_status op 'prepared' ("Préparée"/klaar
  // voor verzending, zie MANUAL_STATUSES in skuUtils.js) — een geprint label
  // betekent voor de gebruiker dat het pakket klaarligt om verzonden te
  // worden, dus die statusbadge (Verkopen.jsx) moet meteen meebewegen i.p.v.
  // achteraf nog apart aangepast te moeten worden. Uitvinken laat de status
  // bewust ongemoeid (kan intussen al verder gezet zijn, bv. naar 'shipped').
  const togglePrinted = useCallback(async (order, printed) => {
    const patch = printed ? { label_printed: true, manual_status: 'prepared' } : { label_printed: false }
    setOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, ...patch } : o))
    const { error } = await supabase.from('vinted_orders').update(patch).eq('id', order.id)
    if (error) {
      console.warn('[Vault] label_printed opslaan mislukt:', error.message)
      setOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, label_printed: !printed } : o))
    }
  }, [])

  const toggleManualPrinted = useCallback((id, printed) => {
    setManualPrinted((prev) => {
      const next = new Set(prev)
      if (printed) next.add(id); else next.delete(id)
      return next
    })
  }, [])

  const labelParams = (order) => new URLSearchParams(
    order.label_url
      ? { label_url: order.label_url }
      : { transaction_id: order.transaction_id || order.id }
  )

  const labelHeaders = () => (vintedCookie ? { 'x-vinted-cookie': vintedCookie } : {})

  // Haalt het label op als blob — geeft voorrang aan het al vooraf gecropte
  // exemplaar in Supabase Storage (label_pdf_url, gezet door de extensie's
  // automatische scan via api/label-prefetch) zodat er meestal geen
  // fetch+crop meer nodig is op het moment van downloaden/printen. Valt
  // terug op de oude on-demand /api/label-flow als dat er nog niet is (bv.
  // labels die al beschikbaar waren vóór deze functionaliteit).
  const fetchOrderLabelBlob = async (order) => {
    if (order.label_pdf_url) {
      const res = await fetch(order.label_pdf_url)
      if (res.ok) return res.blob()
      console.warn('[Vault] label_pdf_url ophalen mislukt, val terug op /api/label:', res.status)
    }
    const res = await fetch(`/api/label?${labelParams(order)}`, { headers: labelHeaders() })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `HTTP ${res.status}`)
    }
    return res.blob()
  }

  // ── Label downloaden (of, voor een QR-code-label, gewoon tonen) ───────────
  const downloadLabel = useCallback(async (order) => {
    // QR-code-labels (Vinted Go "digitaal", geen printer nodig) hebben geen
    // PDF om te downloaden — enkel een afbeelding om te scannen. Gewoon
    // openen i.p.v. forceren als bestandsdownload.
    if (isQrLabel(order)) {
      window.open(order.label_pdf_url, '_blank')
      setDownloaded((prev) => new Set([...prev, order.id]))
      togglePrinted(order, true)
      return
    }
    setDownloading((prev) => new Set([...prev, order.id]))
    try {
      const blob = await fetchOrderLabelBlob(order)
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `label-${order.transaction_id || order.id}-4x6.pdf`
      a.click()
      URL.revokeObjectURL(url)
      setDownloaded((prev) => new Set([...prev, order.id]))
      togglePrinted(order, true)
    } catch (e) {
      alert(`Download mislukt: ${e.message}`)
    }
    setDownloading((prev) => { const n = new Set(prev); n.delete(order.id); return n })
  }, [vintedCookie, togglePrinted])

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
  // Al als "Geprint" gemarkeerde labels (handmatig, of automatisch na
  // download) tellen niet mee — zie het vinkje per label hierboven.
  // QR-code-labels horen hier niet bij: het zijn afbeeldingen, geen PDF's,
  // en kunnen niet in de samengevoegde print-PDF ingebed worden.
  const printableOrders = orders.filter((o) => !o.label_printed && !isQrLabel(o))
  const printableManualItems = manualItems.filter((i) => !manualPrinted.has(i.id))

  const printAll = async () => {
    if (!printableOrders.length && !printableManualItems.length) return
    setPrinting(true)
    try {
      const outPdf = await PDFDocument.create()

      for (const order of printableOrders) {
        try {
          const blob    = await fetchOrderLabelBlob(order)
          const bytes   = new Uint8Array(await blob.arrayBuffer())
          const srcPdf  = await PDFDocument.load(bytes, { ignoreEncryption: true })
          const [embedded] = await outPdf.embedPdf(srcPdf, [0])
          const page = outPdf.addPage([OUT_W, OUT_H])
          page.drawPage(embedded, { x: 0, y: 0, width: OUT_W, height: OUT_H })
        } catch (e) { console.warn('[Vault] printAll order mislukt:', order.id, e.message) }
      }

      for (const item of printableManualItems) {
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

  const totalCount = printableOrders.length + printableManualItems.length

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
        Alle verzendlabels worden automatisch herkend en uitgeknipt op 4×6 voor je labelprinter.
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
                printed={order.label_printed}
                onTogglePrinted={(checked) => togglePrinted(order, checked)}
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
            {manualItems.map((item) => {
              const printed = manualPrinted.has(item.id)
              return (
                <div
                  key={item.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    background: 'var(--bg-2)', border: '1px solid var(--border)',
                    borderRadius: 'var(--r-lg)', padding: '10px 14px',
                    opacity: printed ? 0.5 : 1, transition: 'opacity .2s',
                  }}
                >
                  <label
                    title="Geprint — uitgesloten van 'Print alle labels'"
                    style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, cursor: 'pointer' }}
                  >
                    <input
                      type="checkbox"
                      checked={printed}
                      onChange={(e) => toggleManualPrinted(item.id, e.target.checked)}
                      style={{ width: 16, height: 16, cursor: 'pointer' }}
                    />
                  </label>
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
              )
            })}
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
