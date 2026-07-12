import { useState, useRef } from 'react'
import { formatSku, formatSkuRange } from '../utils/skuUtils'

async function compressPhoto(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const maxDim = 360
        const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * ratio)
        canvas.height = Math.round(img.height * ratio)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.72))
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  })
}

export default function MediaModal({
  batch, supColor,
  skuPhotos, onUpdatePhoto, onRemovePhoto,
  batchVideos, onAddVideo, onRemoveVideo,
  onClose,
}) {
  const photoRef = useRef()
  const videoRef = useRef()
  const [pendingCode, setPendingCode] = useState(null)
  const [uploading, setUploading] = useState(false)

  const videos = batchVideos[batch.id] || []
  const sku = formatSkuRange(batch.supplierPrefix, batch.startNum, batch.endNum)
  const totalItems = batch.endNum - batch.startNum + 1
  const items = Array.from({ length: totalItems }, (_, i) => {
    const num = batch.startNum + i
    const code = formatSku(batch.supplierPrefix, num)
    return { num, code, photo: skuPhotos[code] || null }
  })
  const photoCount = items.filter((i) => i.photo).length

  const triggerPhoto = (code) => {
    setPendingCode(code)
    photoRef.current.value = ''
    photoRef.current.click()
  }

  const handlePhotoChange = async (e) => {
    const file = e.target.files[0]
    if (!file || !pendingCode) return
    setUploading(true)
    try {
      const dataUrl = await compressPhoto(file)
      onUpdatePhoto(pendingCode, dataUrl)
    } finally {
      setUploading(false)
      setPendingCode(null)
    }
  }

  const handleVideoChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    onAddVideo(batch.id, url, file.name)
    e.target.value = ''
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-lg" style={{ maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header" style={{ flexShrink: 0 }}>
          <div>
            <h2 style={{ marginBottom: 2 }}>Media — {sku}</h2>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
              {photoCount}/{totalItems} foto's · {videos.length} video{videos.length !== 1 ? "'s" : ''}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 2px' }}>
          {/* ── Videos ─────────────────────────── */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span className="form-section-label" style={{ margin: 0 }}>VIDEO'S</span>
              <span style={{ fontSize: 11, color: 'var(--yellow)', display: 'flex', alignItems: 'center', gap: 4 }}>
                ⚠ Sessie-only — niet opgeslagen na sluiten
              </span>
            </div>

            <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }}>
              {videos.map((v) => (
                <div key={v.id} style={{ position: 'relative', flexShrink: 0 }}>
                  <video
                    src={v.url}
                    style={{ width: 140, height: 100, objectFit: 'cover', borderRadius: 10, display: 'block', border: '1px solid var(--border)' }}
                    controls
                    muted
                    playsInline
                  />
                  <button
                    onClick={() => onRemoveVideo(batch.id, v.id)}
                    style={{
                      position: 'absolute', top: 5, right: 5,
                      background: 'rgba(0,0,0,0.65)', border: 'none',
                      color: '#fff', borderRadius: '50%',
                      width: 22, height: 22, cursor: 'pointer', fontSize: 13,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'inherit',
                    }}
                  >
                    ×
                  </button>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {v.name}
                  </div>
                </div>
              ))}

              <button
                className="btn btn-secondary"
                style={{ flexShrink: 0, height: 100, minWidth: 100, flexDirection: 'column', gap: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={() => videoRef.current.click()}
              >
                <span style={{ fontSize: 22 }}>📹</span>
                <span>Video uploaden</span>
              </button>
            </div>
            <input ref={videoRef} type="file" accept="video/*" onChange={handleVideoChange} style={{ display: 'none' }} />
          </div>

          {/* ── Photos per item ─────────────────── */}
          <div>
            <div className="form-section-label" style={{ marginBottom: 10 }}>FOTO'S PER ITEM</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {items.map((item, idx) => (
                <div
                  key={item.code}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 0',
                    borderBottom: idx < items.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  {/* Thumbnail */}
                  <div
                    onClick={() => !uploading && triggerPhoto(item.code)}
                    title="Klik om foto te uploaden"
                    style={{
                      width: 52, height: 52, borderRadius: 10, flexShrink: 0,
                      overflow: 'hidden', cursor: 'pointer',
                      border: `1px solid ${item.photo ? 'var(--border)' : (supColor + '30')}`,
                      background: item.photo ? 'transparent' : (supColor + '12'),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'opacity 0.15s',
                      opacity: uploading && pendingCode === item.code ? 0.5 : 1,
                    }}
                  >
                    {item.photo ? (
                      <img src={item.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 11, fontWeight: 800, fontFamily: 'monospace', color: supColor, lineHeight: 1 }}>
                          {item.code.slice(-3)}
                        </div>
                        <div style={{ fontSize: 16, marginTop: 2 }}>📷</div>
                      </div>
                    )}
                  </div>

                  {/* SKU tag */}
                  <span className="sku-tag" style={{ background: supColor + '14', color: supColor }}>
                    {item.code}
                  </span>

                  {/* Actions */}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 5, alignItems: 'center' }}>
                    {uploading && pendingCode === item.code && (
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Laden…</span>
                    )}
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => triggerPhoto(item.code)}
                      disabled={uploading}
                    >
                      {item.photo ? '🔄 Vervang' : '📷 Foto'}
                    </button>
                    {item.photo && (
                      <button className="btn btn-ghost btn-sm" onClick={() => onRemovePhoto(item.code)} disabled={uploading}>
                        ×
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <input ref={photoRef} type="file" accept="image/*" onChange={handlePhotoChange} style={{ display: 'none' }} />
          </div>
        </div>

        <div className="modal-footer" style={{ flexShrink: 0 }}>
          <button className="btn btn-primary" onClick={onClose}>Klaar</button>
        </div>
      </div>
    </div>
  )
}
