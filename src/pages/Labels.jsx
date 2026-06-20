import { useState, useRef } from 'react'
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

export default function Labels() {
  const [items, setItems] = useState([])
  const [generating, setGenerating] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)

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

      {/* Items */}
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

      {items.length === 0 && (
        <div className="glass-card" style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 600, color: 'var(--text-2)', marginBottom: 10 }}>Hoe werkt het?</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>
            <div>1. Upload een Vinted verzendbewijs (PDF) of een labelafbeelding (JPG/PNG)</div>
            <div>2. Voeg optioneel een SKU code toe — deze verschijnt als strip onderaan het label</div>
            <div>3. Klik "Genereer PDF" om een printklaar 4×6 inch bestand te downloaden</div>
          </div>
          <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-3)' }}>
            PDF pagina's worden vector-kwaliteit gekopieerd via pdf-lib — geen kwaliteitsverlies.
          </div>
        </div>
      )}
    </div>
  )
}
