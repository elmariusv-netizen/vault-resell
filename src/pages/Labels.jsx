import { useState, useRef, useEffect, useCallback } from 'react'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { genId } from '../utils/skuUtils'

const OUT_W = 288  // 4 inches × 72 dpi
const OUT_H = 432  // 6 inches × 72 dpi
const SKU_H = 28

function drawSkuStrip(page, font, sku) {
  page.drawRectangle({
    x: 0, y: 0,
    width: OUT_W, height: SKU_H,
    color: rgb(0.12, 0.12, 0.12),
  })
  const size = 11
  const textW = font.widthOfTextAtSize(sku, size)
  page.drawText(sku, {
    x: (OUT_W - textW) / 2,
    y: (SKU_H - size) / 2 + 2,
    size,
    font,
    color: rgb(0.9, 0.9, 0.9),
  })
}

function formatBytes(n) {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatTs(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

export default function Labels() {
  const [items, setItems]           = useState([])
  const [generating, setGenerating] = useState(false)
  const [dragOver, setDragOver]     = useState(false)
  const fileInputRef                = useRef(null)

  // Vinted intercepted labels state
  const [intercepted, setIntercepted]       = useState([])   // manifest entries
  const [selectedIds, setSelectedIds]       = useState(new Set())
  const [merging, setMerging]               = useState(false)

  // Read intercepted labels from localStorage (written by bridge.js)
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

  const toggleSelect = (id) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const removeIntercepted = (id) => {
    setIntercepted((prev) => prev.filter((l) => l.id !== id))
    setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n })
    localStorage.removeItem(`vault-vinted-label-${id}`)
    // Also purge from bridge manifest
    try {
      const manifest = JSON.parse(localStorage.getItem('vault-vinted-labels') || '[]')
      localStorage.setItem('vault-vinted-labels', JSON.stringify(manifest.filter((l) => l.id !== id)))
    } catch {}
  }

  const mergeIntercepted = async () => {
    if (!selectedIds.size) return
    setMerging(true)
    try {
      const outPdf = await PDFDocument.create()
      for (const id of selectedIds) {
        const dataUrl = localStorage.getItem(`vault-vinted-label-${id}`) || ''
        if (!dataUrl) { console.warn('[Vault] no dataUrl for', id); continue }
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
              x: (OUT_W - ew * scale) / 2,
              y: (OUT_H - eh * scale) / 2,
              width: ew * scale,
              height: eh * scale,
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

  // ── Manual upload handlers ──────────────────────────────────────────────
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

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    processFiles(e.dataTransfer.files)
  }

  const removeItem = (id) => {
    setItems((prev) => {
      const item = prev.find((i) => i.id === id)
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
      return prev.filter((i) => i.id !== id)
    })
  }

  const updateSku = (id, sku) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, sku } : i)))

  const generate = async () => {
    if (!items.length) return
    setGenerating(true)
    try {
      const outPdf = await PDFDocument.create()
      const font = await outPdf.embedFont(StandardFonts.HelveticaBold)

      for (const item of items) {
        if (item.type === 'pdf') {
          const bytes = await item.file.arrayBuffer()
          const srcPdf = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true })
          const embedded = await outPdf.embedPdf(srcPdf, srcPdf.getPageIndices())

          for (const ep of embedded) {
            const hasSku = !!item.sku.trim()
            const contentH = hasSku ? OUT_H - SKU_H : OUT_H
            const { width: ew, height: eh } = ep
            const scale = Math.min(OUT_W / ew, contentH / eh)
            const dw = ew * scale
            const dh = eh * scale
            const page = outPdf.addPage([OUT_W, OUT_H])
            page.drawPage(ep, {
              x: (OUT_W - dw) / 2,
              y: (hasSku ? SKU_H : 0) + (contentH - dh) / 2,
              width: dw,
              height: dh,
            })
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
          page.drawImage(img, {
            x: (OUT_W - iw * scale) / 2,
            y: (hasSku ? SKU_H : 0) + (contentH - ih * scale) / 2,
            width: iw * scale,
            height: ih * scale,
          })
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
    } catch (err) {
      alert('Fout bij genereren: ' + err.message)
    }
    setGenerating(false)
  }

  const totalPages = items.reduce((s, i) => s + (i.pageCount || 1), 0)

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Labels</h1>
          <div className="page-subtitle">Genereer 4×6 inch thermische labels (PDF of afbeelding)</div>
        </div>
        {items.length > 0 && (
          <button className="btn btn-primary" onClick={generate} disabled={generating}>
            {generating
              ? 'Genereren…'
              : `Genereer PDF (${totalPages} pagina${totalPages !== 1 ? "'s" : ''})`}
          </button>
        )}
      </div>

      {/* Vinted intercepted labels */}
      {intercepted.length > 0 && (
        <div className="glass-card" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
                🏷 Vinted labels ({intercepted.length})
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
                    borderRadius: 'var(--r-lg)',
                    padding: '10px 14px',
                    cursor: 'pointer',
                    transition: 'all .15s',
                  }}
                  onClick={() => toggleSelect(label.id)}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSelect(label.id)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ width: 15, height: 15, accentColor: '#4f46e5', flexShrink: 0 }}
                  />
                  <span style={{ fontSize: 20, flexShrink: 0 }}>📄</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 600,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
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
                    title="Verwijder"
                  >
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Drop zone */}
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
          ref={fileInputRef}
          type="file"
          accept=".pdf,image/jpeg,image/png"
          multiple
          onChange={handleFiles}
          style={{ display: 'none' }}
        />
      </div>

      {/* Manually uploaded items */}
      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-xl)',
                padding: '14px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              {/* Thumbnail */}
              <div
                style={{
                  width: 52, height: 52,
                  borderRadius: 'var(--r-md)',
                  background: 'var(--bg-2)',
                  border: '1px solid var(--border)',
                  flexShrink: 0,
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {item.previewUrl
                  ? <img src={item.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 22 }}>📄</span>}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                  {item.type === 'pdf'
                    ? `PDF · ${item.pageCount} pagina${item.pageCount !== 1 ? "'s" : ''}`
                    : 'Afbeelding'}
                </div>
              </div>

              {/* SKU */}
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

      {items.length === 0 && intercepted.length === 0 && (
        <div className="glass-card" style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 600, color: 'var(--text-2)', marginBottom: 10 }}>Hoe werkt het?</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>
            <div>1. Download een label op Vinted — de Chrome extensie onderschept het automatisch</div>
            <div>2. Of upload een verzendbewijs (PDF) of labelafbeelding (JPG/PNG) handmatig</div>
            <div>3. Selecteer labels en klik "Merge & Print 4×6" voor een printklaar bestand</div>
          </div>
          <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-3)' }}>
            PDF pagina's worden vector-kwaliteit gekopieerd via pdf-lib — geen kwaliteitsverlies.
          </div>
        </div>
      )}
    </div>
  )
}
