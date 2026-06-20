import { useState, useRef } from 'react'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorkerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { formatSkuRange } from '../utils/skuUtils'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerSrc

// 4×6 inch thermal label in PDF points (72 pt/inch)
const OUT_W = 288   // 4"
const OUT_H = 432   // 6"
const SKU_H = 40    // pts at bottom for SKU text

let _n = 0
const uid = () => `lbl-${++_n}`

// ── PDF processing helpers ──────────────────────────────────────────

// Render one PDFPageProxy and return cropped preview + full-quality data URLs.
// Takes a page object (already loaded) — caller owns the pdf lifetime.
async function renderAndCropPage(page) {
  const SCALE = 3
  const viewport = page.getViewport({ scale: SCALE })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport }).promise

  const bounds = detectContentBounds(ctx, canvas.width, canvas.height)

  const dst = document.createElement('canvas')
  dst.width = bounds.w
  dst.height = bounds.h
  const dc = dst.getContext('2d')
  dc.fillStyle = '#ffffff'
  dc.fillRect(0, 0, dst.width, dst.height)
  dc.drawImage(canvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, dst.width, dst.height)

  const preview = dst.toDataURL('image/jpeg', 0.65)
  const full = dst.toDataURL('image/jpeg', 0.96)

  // Free canvas memory
  canvas.width = 1; canvas.height = 1
  dst.width = 1; dst.height = 1

  return { preview, full }
}

function detectContentBounds(ctx, W, H) {
  const data = ctx.getImageData(0, 0, W, H).data
  let top = H, bottom = -1, left = W, right = -1

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const a = data[i + 3]
      if (a < 30) continue                                          // transparent → skip
      if (data[i] > 238 && data[i + 1] > 238 && data[i + 2] > 238) continue // white → skip
      if (y < top) top = y
      if (y > bottom) bottom = y
      if (x < left) left = x
      if (x > right) right = x
    }
  }

  if (bottom < 0) return { x: 0, y: 0, w: W, h: H }   // no content; use full page

  const padX = Math.max(8, Math.round(W * 0.012))
  const padY = Math.max(8, Math.round(H * 0.012))
  const x = Math.max(0, left - padX)
  const y = Math.max(0, top - padY)
  const x2 = Math.min(W, right + padX)
  const y2 = Math.min(H, bottom + padY)
  return { x, y, w: x2 - x, h: y2 - y }
}

function dataUrlToBytes(dataUrl) {
  const raw = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

// ── Component ───────────────────────────────────────────────────────

export default function Labels({ data }) {
  const { batches = [] } = data || {}

  const [items, setItems] = useState([])
  const [processing, setProcessing] = useState(false)
  const [processingInfo, setProcessingInfo] = useState('')
  const [generating, setGenerating] = useState(false)
  const [outputUrl, setOutputUrl] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef()

  const skuSuggestions = batches.map(b =>
    formatSkuRange(b.supplierPrefix, b.startNum, b.endNum)
  )

  const handleFiles = async (fileList) => {
    const pdfs = Array.from(fileList).filter(
      f => f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf'
    )
    if (!pdfs.length) return

    setProcessing(true)
    setOutputUrl(null)
    const added = []

    for (const file of pdfs) {
      setProcessingInfo(`${file.name} — laden…`)
      let pdf = null
      try {
        // Load PDF once — pdfjs transfers the ArrayBuffer to its worker on first load,
        // so we must not call getDocument() again with the same buffer.
        const buffer = await file.arrayBuffer()
        pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise
        const numPages = pdf.numPages

        for (let pi = 0; pi < numPages; pi++) {
          const label = numPages > 1 ? `${file.name} (p${pi + 1})` : file.name
          setProcessingInfo(label)
          try {
            const page = await pdf.getPage(pi + 1)
            const { preview, full } = await renderAndCropPage(page)
            added.push({ id: uid(), name: label, preview, full, sku: '' })
          } catch (err) {
            added.push({ id: uid(), name: label, preview: null, full: null, sku: '', error: err.message })
          }
        }
      } catch (err) {
        alert(`Kon "${file.name}" niet openen:\n${err.message}`)
      } finally {
        pdf?.destroy()
      }
    }

    setItems(prev => [...prev, ...added])
    setProcessing(false)
    setProcessingInfo('')
  }

  const updateSku = (id, sku) =>
    setItems(prev => prev.map(x => x.id === id ? { ...x, sku } : x))

  const removeItem = (id) => {
    setItems(prev => prev.filter(x => x.id !== id))
    setOutputUrl(null)
  }

  const moveItem = (i, dir) => setItems(prev => {
    const arr = [...prev]
    const j = i + dir
    if (j < 0 || j >= arr.length) return prev
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
    return arr
  })

  const generate = async () => {
    const valid = items.filter(x => x.full && !x.error)
    if (!valid.length) return
    setGenerating(true)

    try {
      const doc = await PDFDocument.create()
      const font = await doc.embedFont(StandardFonts.HelveticaBold)

      for (const item of valid) {
        const img = await doc.embedJpg(dataUrlToBytes(item.full))
        const page = doc.addPage([OUT_W, OUT_H])

        // Fit label image into the area above SKU zone (if SKU present)
        const zoneH = item.sku ? OUT_H - SKU_H : OUT_H
        const { width: iw, height: ih } = img
        const s = Math.min(OUT_W / iw, zoneH / ih)
        const dw = iw * s
        const dh = ih * s

        // pdf-lib: y=0 is BOTTOM of page
        page.drawImage(img, {
          x: (OUT_W - dw) / 2,
          y: item.sku ? SKU_H + (zoneH - dh) / 2 : (OUT_H - dh) / 2,
          width: dw,
          height: dh,
        })

        if (item.sku) {
          // Separator line
          page.drawLine({
            start: { x: 14, y: SKU_H - 1 },
            end: { x: OUT_W - 14, y: SKU_H - 1 },
            thickness: 0.5,
            color: rgb(0.72, 0.72, 0.72),
          })
          // SKU text centered
          const text = item.sku.toUpperCase()
          const sz = 13
          page.drawText(text, {
            x: (OUT_W - font.widthOfTextAtSize(text, sz)) / 2,
            y: 10,
            size: sz,
            font,
            color: rgb(0.06, 0.06, 0.06),
          })
        }
      }

      const bytes = await doc.save()
      if (outputUrl) URL.revokeObjectURL(outputUrl)
      setOutputUrl(URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })))
    } catch (err) {
      alert('Fout bij PDF genereren:\n' + err.message)
    }

    setGenerating(false)
  }

  const download = () => {
    const a = document.createElement('a')
    a.href = outputUrl
    a.download = `labels-4x6-thermal-${new Date().toISOString().slice(0, 10)}.pdf`
    a.click()
  }

  const validItems = items.filter(x => !x.error && x.full)

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Labels</h1>
          <div className="page-subtitle">
            Auto-detect labelgebied · Thermal 4×6" (101.6×152.4mm) · 1 label per pagina
          </div>
        </div>
        {items.length > 0 && !processing && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setItems([]); setOutputUrl(null) }}>
            Wis alles
          </button>
        )}
      </div>

      <div style={{ maxWidth: 840 }}>

        {/* Drop zone / Processing indicator */}
        {processing ? (
          <div style={{
            background: 'linear-gradient(145deg,#0f0f0f,#161616)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-xl)',
            padding: '48px 28px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 30, marginBottom: 14 }}>⚙️</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
              Labelgebied detecteren…
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', maxWidth: 380, margin: '0 auto 20px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {processingInfo}
            </div>
            <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, maxWidth: 260, margin: '0 auto', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: '35%', background: 'var(--green)', borderRadius: 2, animation: 'scan-bar 1.2s ease-in-out infinite' }} />
            </div>
          </div>
        ) : (
          <div
            className={`drop-zone${dragOver ? ' drag-over' : ''}`}
            onClick={() => fileRef.current.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
          >
            <div className="drop-icon">📦</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
              Sleep Vinted PDF labels hierheen
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
              Meerdere bestanden tegelijk · Labelgebied wordt automatisch gedetecteerd &amp; bijgesneden
            </div>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          style={{ display: 'none' }}
          onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
        />

        {/* Item list */}
        {!processing && items.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>
                  {validItems.length} label{validItems.length !== 1 ? 's' : ''}
                </span>
                {items.some(x => x.error) && (
                  <span style={{ fontSize: 12, color: 'var(--red)' }}>
                    · {items.filter(x => x.error).length} mislukt
                  </span>
                )}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current.click()}>
                + Meer toevoegen
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map((item, idx) => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    background: 'linear-gradient(145deg,#0f0f0f,#161616)',
                    border: `1px solid ${item.error ? 'rgba(255,59,59,0.25)' : 'var(--border)'}`,
                    borderRadius: 'var(--r-lg)',
                    padding: '10px 14px',
                    transition: 'border-color 0.15s',
                  }}
                >
                  {/* Thumbnail preview of detected label */}
                  <div style={{
                    width: 44,
                    height: 58,
                    flexShrink: 0,
                    borderRadius: 6,
                    overflow: 'hidden',
                    background: '#fff',
                    border: '1px solid rgba(0,0,0,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    {item.preview
                      ? <img src={item.preview} alt="label" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      : <span style={{ fontSize: 18 }}>{item.error ? '⚠️' : '📄'}</span>
                    }
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 11,
                      color: item.error ? 'var(--red)' : 'var(--text-3)',
                      marginBottom: item.error ? 0 : 6,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {item.error ? `⚠ ${item.error}` : item.name}
                    </div>
                    {!item.error && (
                      <>
                        <input
                          list={`sku-list-${item.id}`}
                          value={item.sku}
                          onChange={e => updateSku(item.id, e.target.value)}
                          placeholder="SKU code (optioneel, bv. RIA001-048)"
                          style={{
                            width: '100%',
                            fontSize: 12,
                            padding: '5px 10px',
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: 8,
                            color: item.sku ? 'var(--green)' : 'var(--text-3)',
                            fontFamily: item.sku ? 'monospace' : 'inherit',
                            fontWeight: item.sku ? 700 : 400,
                          }}
                        />
                        <datalist id={`sku-list-${item.id}`}>
                          {skuSuggestions.map(s => <option key={s} value={s} />)}
                        </datalist>
                      </>
                    )}
                  </div>

                  <span style={{
                    fontSize: 10,
                    color: 'var(--text-3)',
                    background: 'rgba(255,255,255,0.04)',
                    padding: '2px 7px',
                    borderRadius: 5,
                    flexShrink: 0,
                  }}>
                    #{idx + 1}
                  </span>

                  <div style={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                    <button className="btn btn-ghost btn-sm btn-icon" onClick={() => moveItem(idx, -1)} disabled={idx === 0}>↑</button>
                    <button className="btn btn-ghost btn-sm btn-icon" onClick={() => moveItem(idx, 1)} disabled={idx === items.length - 1}>↓</button>
                  </div>

                  <button
                    className="btn btn-danger btn-sm btn-icon"
                    onClick={() => removeItem(item.id)}
                    style={{ flexShrink: 0 }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            {/* Generate row */}
            {validItems.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    className="btn btn-primary"
                    onClick={generate}
                    disabled={generating}
                  >
                    {generating
                      ? 'PDF genereren…'
                      : `Genereer ${validItems.length} thermal label${validItems.length !== 1 ? 's' : ''} (4×6")`
                    }
                  </button>
                  {outputUrl && (
                    <>
                      <button className="btn btn-secondary" onClick={download}>↓ Download PDF</button>
                      <a href={outputUrl} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ textDecoration: 'none' }}>
                        Bekijk PDF →
                      </a>
                    </>
                  )}
                </div>

                {outputUrl && (
                  <div style={{
                    marginTop: 12,
                    padding: '12px 18px',
                    background: 'var(--green-dim)',
                    border: '1px solid var(--green-border)',
                    borderRadius: 'var(--r-lg)',
                    fontSize: 13,
                    color: 'var(--green)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}>
                    <span>✓</span>
                    <span>
                      {validItems.length} label{validItems.length !== 1 ? 's' : ''} op 4×6" (101.6×152.4mm)
                      {items.some(x => x.sku) ? ' · met SKU codes' : ''} — klaar voor thermal printer
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* How-to (shown when no labels loaded) */}
        {!items.length && !processing && (
          <div style={{
            marginTop: 24,
            background: 'linear-gradient(145deg,#0f0f0f,#161616)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-xl)',
            padding: '22px 26px',
          }}>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 16, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
              Hoe het werkt
            </div>
            {[
              ['Upload', 'Sleep Vinted PDF labels hierboven. Meerdere bestanden of multi-page PDFs zijn OK.'],
              ['Detectie', 'Elke pagina wordt gerenderd, het labelgebied gedetecteerd en automatisch bijgesneden. Controleer de thumbnail.'],
              ['SKU', 'Voeg optioneel een SKU code toe — wordt afgedrukt onder het label in de output PDF.'],
              ['Afdrukken', 'Genereer → 1 label per 4×6" pagina (101.6×152.4mm), direct afdrukbaar op Munbyn, Zebra, DYMO, …'],
            ].map(([title, desc]) => (
              <div key={title} style={{ display: 'flex', gap: 14, marginBottom: 14, alignItems: 'flex-start' }}>
                <div style={{
                  flexShrink: 0,
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--green)',
                  marginTop: 6,
                }} />
                <div>
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{title} — </span>
                  <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{desc}</span>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}
