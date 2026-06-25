import { useState, useRef, useEffect, useCallback } from 'react'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { genId } from '../utils/skuUtils'

const OUT_W = 288
const OUT_H = 432
const SKU_H = 28

// ── PDF helpers (bestaand) ────────────────────────────────────────────────────
function drawSkuStrip(page, font, sku) {
  page.drawRectangle({ x: 0, y: 0, width: OUT_W, height: SKU_H, color: rgb(0.12, 0.12, 0.12) })
  const size = 11
  const textW = font.widthOfTextAtSize(sku, size)
  page.drawText(sku, { x: (OUT_W - textW) / 2, y: (SKU_H - size) / 2 + 2, size, font, color: rgb(0.9, 0.9, 0.9) })
}

function formatBytes(n) {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatTs(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}

// ── Vinted order helpers ──────────────────────────────────────────────────────
function formatPrice(price, currency = 'EUR') {
  try { return new Intl.NumberFormat('nl-BE', { style: 'currency', currency }).format(price) }
  catch { return `€${Number(price).toFixed(2)}` }
}

function formatOrderDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('nl-BE', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return iso }
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
          {order.buyer && <span>· {order.buyer}</span>}
          {order.date && <span>· {formatOrderDate(order.date)}</span>}
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

// ── Hoofdcomponent ────────────────────────────────────────────────────────────
export default function Labels({ vintedCookie }) {
  // Bestaande staat: handmatige upload
  const [items, setItems]           = useState([])
  const [generating, setGenerating] = useState(false)
  const [dragOver, setDragOver]     = useState(false)
  const fileInputRef                = useRef(null)

  // Bestaande staat: onderschepte labels (Chrome extensie)
  const [intercepted, setIntercepted] = useState([])
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [merging, setMerging]         = useState(false)

  // Nieuw: Vinted orders staat
  const [orders, setOrders]           = useState([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [ordersError, setOrdersError] = useState(null)
  const [downloading, setDownloading] = useState(new Set())
  const [downloaded, setDownloaded]   = useState(new Set())

  // ── Bestaand: onderschepte labels laden uit localStorage ────────────────
  const loadIntercepted = useCallback(() => {
    try {
      const raw = localStorage.getItem('vault-vinted-labels')
      setIntercepted(raw ? JSON.parse(raw) : [])
    } catch { setIntercepted([]) }
  }, [])

  useEffect(() => {
    loadIntercepted()
    const onStorage = (e) => { if (e.key === 'vault-vinted-labels') loadIntercepted() }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [loadIntercepted])

  // ── Nieuw: Vinted orders ophalen ─────────────────────────────────────────
  const fetchOrders = useCallback(() => {
    if (!vintedCookie) return
    setOrdersLoading(true)
    setOrdersError(null)
    fetch('/api/vinted-orders', {
      headers: { 'x-vinted-cookie': vintedCookie },
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, status: r.status, data: d })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || `HTTP ${data.status}`)
        setOrders(data.orders || [])
        setOrdersLoading(false)
      })
      .catch((e) => {
        setOrdersError(e.message)
        setOrdersLoading(false)
      })
  }, [vintedCookie])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  // ── Nieuw: label downloaden ───────────────────────────────────────────────
  const downloadLabel = useCallback(async (order) => {
    setDownloading((prev) => new Set([...prev, order.id]))
    try {
      const params = new URLSearchParams(
        order.label_url
          ? { label_url: order.label_url }
          : { transaction_id: order.transaction_id }
      )
      const res = await fetch(`/api/label?${params}`, {
        headers: { 'x-vinted-cookie': vintedCookie },
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `label-${order.transaction_id}-4x6.pdf`
      a.click()
      URL.revokeObjectURL(url)
      setDownloaded((prev) => new Set([...prev, order.id]))
    } catch (e) {
      alert(`Download mislukt: ${e.message}`)
    }
    setDownloading((prev) => { const n = new Set(prev); n.delete(order.id); return n })
  }, [vintedCookie])

  // ── Bestaand: onderschepte labels ────────────────────────────────────────
  const toggleSelect = (id) =>
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const removeIntercepted = (id) => {
    setIntercepted((prev) => prev.filter((l) => l.id !== id))
    setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n })
    localStorage.removeItem(`vault-vinted-label-${id}`)
    try {
      const m = JSON.parse(localStorage.getItem('vault-vinted-labels') || '[]')
      localStorage.setItem('vault-vinted-labels', JSON.stringify(m.filter((l) => l.id !== id)))
    } catch {}
  }

  const mergeIntercepted = async () => {
    if (!selectedIds.size) return
    setMerging(true)
    try {
      const outPdf = await PDFDocument.create()
      for (const id of selectedIds) {
        const dataUrl = localStorage.getItem(`vault-vinted-label-${id}`) || ''
        if (!dataUrl) continue
        try {
          const b64    = dataUrl.split(',')[1]
          const binary = atob(b64)
          const bytes  = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
          const srcPdf   = await PDFDocument.load(bytes, { ignoreEncryption: true })
          const embedded = await outPdf.embedPdf(srcPdf, srcPdf.getPageIndices())
          for (const ep of embedded) {
            const { width: ew, height: eh } = ep
            const scale = Math.min(OUT_W / ew, OUT_H / eh)
            const page  = outPdf.addPage([OUT_W, OUT_H])
            page.drawPage(ep, {
              x: (OUT_W - ew * scale) / 2, y: (OUT_H - eh * scale) / 2,
              width: ew * scale, height: eh * scale,
            })
          }
        } catch (e) { console.error('[Vault] label merge error:', id, e) }
      }
      const pdfBytes = await outPdf.save()
      const url = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `vinted-labels-${new Date().toISOString().split('T')[0]}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Fout bij samenvoegen: ' + err.message)
    }
    setMerging(false)
  }

  // ── Bestaand: handmatige upload ──────────────────────────────────────────
  const processFiles = async (fileList) => {
    const files = Array.from(fileList).filter(
      (f) => f.type === 'application/pdf' || f.type.startsWith('image/')
    )
    if (!files.length) return
    const newItems = await Promise.all(
      files.map(async (file) => {
        const id = genId()
        if (file.type.startsWith('image/')) {
          return { id, name: file.name, type: 'image', file, previewUrl: URL.createObjectURL(file), sku: '', pageCount: 1 }
        }
        let pageCount = 1
        try {
          const bytes = await file.arrayBuffer()
          const pdf = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true })
          pageCount = pdf.getPageCount()
        } catch {}
        return { id, name: file.name, type: 'pdf', file, previewUrl: null, sku: '', pageCount }
      })
    )
    setItems((prev) => [...prev, ...newItems])
  }

  const handleFiles = (e) => { processFiles(e.target.files); e.target.value = '' }
  const handleDrop  = (e) => { e.preventDefault(); setDragOver(false); processFiles(e.dataTransfer.files) }
  const removeItem  = (id) => {
    setItems((prev) => { const item = prev.find((i) => i.id === id); if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl); return prev.filter((i) => i.id !== id) })
  }
  const updateSku = (id, sku) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, sku } : i)))

  const generate = async () => {
    if (!items.length) return
    setGenerating(true)
    try {
      const outPdf = await PDFDocument.create()
      const font   = await outPdf.embedFont(StandardFonts.HelveticaBold)
      for (const item of items) {
        if (item.type === 'pdf') {
          const bytes    = await item.file.arrayBuffer()
          const srcPdf   = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true })
          const embedded = await outPdf.embedPdf(srcPdf, srcPdf.getPageIndices())
          for (const ep of embedded) {
            const hasSku = !!item.sku.trim()
            const contentH = hasSku ? OUT_H - SKU_H : OUT_H
            const { width: ew, height: eh } = ep
            const scale = Math.min(OUT_W / ew, contentH / eh)
            const dw = ew * scale, dh = eh * scale
            const page = outPdf.addPage([OUT_W, OUT_H])
            page.drawPage(ep, { x: (OUT_W - dw) / 2, y: (hasSku ? SKU_H : 0) + (contentH - dh) / 2, width: dw, height: dh })
            if (hasSku) drawSkuStrip(page, font, item.sku.trim())
          }
        } else {
          const imgBytes = await item.file.arrayBuffer()
          const img = item.file.type === 'image/png'
            ? await outPdf.embedPng(new Uint8Array(imgBytes))
            : await outPdf.embedJpg(new Uint8Array(imgBytes))
          const hasSku = !!item.sku.trim()
          const contentH = hasSku ? OUT_H - SKU_H : OUT_H
          const { width: iw, height: ih } = img
          const scale = Math.min(OUT_W / iw, contentH / ih)
          const page = outPdf.addPage([OUT_W, OUT_H])
          page.drawImage(img, { x: (OUT_W - iw * scale) / 2, y: (hasSku ? SKU_H : 0) + (contentH - ih * scale) / 2, width: iw * scale, height: ih * scale })
          if (hasSku) drawSkuStrip(page, font, item.sku.trim())
        }
      }
      const pdfBytes = await outPdf.save()
      const url = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `vault-labels-${new Date().toISOString().split('T')[0]}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) { alert('Fout bij genereren: ' + err.message) }
    setGenerating(false)
  }

  const totalPages = items.reduce((s, i) => s + (i.pageCount || 1), 0)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Labels</h1>
          <div className="page-subtitle">Openstaande Vinted orders en handmatige labels</div>
        </div>
        {items.length > 0 && (
          <button className="btn btn-primary" onClick={generate} disabled={generating}>
            {generating ? 'Genereren…' : `Genereer PDF (${totalPages} pagina${totalPages !== 1 ? "'s" : ''})`}
          </button>
        )}
      </div>

      {/* ── Vinted openstaande orders ───────────────────────────────────── */}
      <div className="glass-card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Openstaande Vinted labels</span>
              {!ordersLoading && orders.length > 0 && (
                <span style={{
                  fontSize: 11, fontWeight: 700, color: '#818cf8',
                  background: 'rgba(79,70,229,0.1)', padding: '2px 8px', borderRadius: 100,
                }}>{orders.length}</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
              {vintedCookie
                ? 'Betaalde orders die wachten op verzending'
                : 'Koppel je Vinted account in Instellingen om orders te zien'}
            </div>
          </div>
          {vintedCookie && !ordersLoading && (
            <button className="btn btn-ghost btn-sm" onClick={fetchOrders}>
              ↻ Vernieuwen
            </button>
          )}
        </div>

        {/* Geen cookie */}
        {!vintedCookie && (
          <div style={{
            padding: '20px 0', textAlign: 'center', fontSize: 13, color: 'var(--text-3)',
          }}>
            Ga naar <strong>Instellingen → Koppel Vinted account</strong> om je sessie-cookie op te slaan.
          </div>
        )}

        {/* Laad skeleton */}
        {vintedCookie && ordersLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* Fout */}
        {vintedCookie && !ordersLoading && ordersError && (
          <div style={{
            padding: '12px 14px', borderRadius: 10, fontSize: 13,
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)',
            color: 'var(--red)', lineHeight: 1.6,
          }}>
            {ordersError}
          </div>
        )}

        {/* Lege staat */}
        {vintedCookie && !ordersLoading && !ordersError && orders.length === 0 && (
          <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 13, color: 'var(--text-3)' }}>
            Geen openstaande labels — alles is verzonden!
          </div>
        )}

        {/* Orders lijst */}
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

      {/* ── Onderschepte labels (Chrome extensie) ─────────────────────────── */}
      {intercepted.length > 0 && (
        <div className="glass-card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
                Onderschepte labels ({intercepted.length})
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                Automatisch onderschept via de Chrome extensie
              </div>
            </div>
            {selectedIds.size > 0 && (
              <button
                className="btn btn-primary btn-sm"
                onClick={mergeIntercepted}
                disabled={merging}
                style={{ whiteSpace: 'nowrap' }}
              >
                {merging ? 'Samenvoegen…' : `Merge & Print 4×6 (${selectedIds.size})`}
              </button>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {intercepted.map((label) => {
              const checked = selectedIds.has(label.id)
              return (
                <div
                  key={label.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    background: checked ? 'var(--indigo-soft, rgba(79,70,229,0.08))' : 'var(--bg-2)',
                    border: `1px solid ${checked ? 'var(--indigo, #4f46e5)' : 'var(--border)'}`,
                    borderRadius: 'var(--r-lg)', padding: '10px 14px',
                    cursor: 'pointer', transition: 'all .15s',
                  }}
                  onClick={() => toggleSelect(label.id)}
                >
                  <input
                    type="checkbox" checked={checked}
                    onChange={() => toggleSelect(label.id)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ width: 15, height: 15, accentColor: '#4f46e5', flexShrink: 0 }}
                  />
                  <span style={{ fontSize: 20, flexShrink: 0 }}>📄</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {label.filename}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>
                      {formatTs(label.capturedAt)}
                      {label.orderId ? ` · bestelling #${label.orderId}` : ''}
                      {label.size ? ` · ${formatBytes(label.size)}` : ''}
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={(e) => { e.stopPropagation(); removeIntercepted(label.id) }}
                    style={{ padding: '3px 8px', flexShrink: 0, fontSize: 14 }}
                  >×</button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Handmatige upload ─────────────────────────────────────────────── */}
      <div
        className={`drop-zone${dragOver ? ' drag-over' : ''}`}
        style={{ marginBottom: 20 }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="drop-icon">📤</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>
          Sleep PDF of afbeelding hier
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
          of klik om te bladeren · PDF, JPG, PNG
        </div>
        <input
          ref={fileInputRef} type="file" accept=".pdf,image/jpeg,image/png" multiple
          onChange={handleFiles} style={{ display: 'none' }}
        />
      </div>

      {/* ── Geüploade bestanden ───────────────────────────────────────────── */}
      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-xl)', padding: '14px 18px',
                display: 'flex', alignItems: 'center', gap: 14,
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <div style={{
                width: 52, height: 52, borderRadius: 'var(--r-md)',
                background: 'var(--bg-2)', border: '1px solid var(--border)',
                flexShrink: 0, overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {item.previewUrl
                  ? <img src={item.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 22 }}>📄</span>}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                  {item.type === 'pdf' ? `PDF · ${item.pageCount} pagina${item.pageCount !== 1 ? "'s" : ''}` : 'Afbeelding'}
                </div>
              </div>

              <div style={{ flexShrink: 0, width: 150 }}>
                <input
                  value={item.sku}
                  onChange={(e) => updateSku(item.id, e.target.value)}
                  placeholder="SKU (optioneel)"
                  style={{ fontSize: 12, padding: '6px 10px' }}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>

              <button className="btn btn-ghost btn-sm" onClick={() => removeItem(item.id)} style={{ padding: '4px 10px' }}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Lege staat (alles leeg) */}
      {items.length === 0 && intercepted.length === 0 && !vintedCookie && (
        <div className="glass-card" style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 600, color: 'var(--text-2)', marginBottom: 10 }}>Hoe werkt het?</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>
            <div>1. Koppel je Vinted account in Instellingen → openstaande orders verschijnen automatisch</div>
            <div>2. Of upload een verzendbewijs (PDF) of labelafbeelding (JPG/PNG) handmatig</div>
            <div>3. Klik "⬇ Download 4×6 label" om een thermisch-printklaar PDF te downloaden</div>
          </div>
        </div>
      )}
    </div>
  )
}
