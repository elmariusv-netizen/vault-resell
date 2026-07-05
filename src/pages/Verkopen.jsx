import { useMemo, useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  formatCurrency, formatDateLong, formatDateTimeLong, formatSkuRange, calcSaleProfit, normalizePlatform,
  genId, formatSku, isLabelReady, getStatusBadge, getUsedSkus, getFreeSkusForBatch,
  getBatchUnitCost, assignSlotSkus, skuOptionsForSlot, MANUAL_STATUSES, getManualStatus, getEffectiveStatusBadge,
  classifyOrderStage,
  findBatchForSku,
} from '../utils/skuUtils'
import SaleModal from '../components/SaleModal'
import EditSaleModal from '../components/EditSaleModal'
import SkuPickerModal from '../components/SkuPickerModal'
import Checkbox from '../components/Checkbox'
import { supabase } from '../utils/supabase'

const SHORT = { 'Medeverkoper/Groothandel': 'B2B', 'Privé persoon': 'Privé' }
const short = (p) => SHORT[p] || p

const MONTHS_NL = { jan:1, feb:2, mrt:3, apr:4, mei:5, jun:6, jul:7, aug:8, sep:9, okt:10, nov:11, dec:12 }

function parseVintedDate(str) {
  if (!str) return new Date().toISOString().split('T')[0]
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/)
  if (dmy) {
    const y = dmy[3].length === 2 ? '20' + dmy[3] : dmy[3]
    return `${y}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`
  }
  const nl = str.match(/^(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s*(\d{4})?/i)
  if (nl) {
    const m = MONTHS_NL[nl[2].toLowerCase().slice(0, 3)]
    if (m) {
      const y = nl[3] || new Date().getFullYear()
      return `${y}-${String(m).padStart(2,'0')}-${nl[1].padStart(2,'0')}`
    }
  }
  return new Date().toISOString().split('T')[0]
}

function rowToOrder(row) {
  return {
    id:            row.id,
    transactionId: row.transaction_id || row.id,
    title:         row.title || 'Onbekend item',
    price:         row.price || 0,
    date:          row.synced_at?.split('T')[0] || new Date().toISOString().split('T')[0],
    buyer:         row.buyer || '',
    country:       row.country || '',
    url:           row.item_url || '',
    labelUrl:      row.label_url || '',
    syncedAt:      row.synced_at,
  }
}

async function fetchAllVintedOrders() {
  const { data, error } = await supabase
    .from('vinted_orders')
    .select('*')
  if (error) { console.warn('[Vault] Supabase fetch error:', error); return [] }
  // Sorteer op sale_date (val terug op synced_at als die ontbreekt), nieuwste eerst.
  return (data || []).sort((a, b) => {
    const da = a.sale_date || a.synced_at || ''
    const db = b.sale_date || b.synced_at || ''
    return db.localeCompare(da)
  })
}

async function markRegisteredInSupabase(orderId) {
  await supabase
    .from('vinted_orders')
    .update({ registered_in_vault: true })
    .eq('id', orderId)
}

// ── SKU auto-detectie ──────────────────────────────────────────────────────
const BRANDS_MAP = [
  ['ralph lauren','RL'],['nike','NK'],['adidas','AD'],['zara','ZR'],['h&m','HM'],
  ['puma','PU'],['gucci','GC'],['tommy hilfiger','TH'],['calvin klein','CK'],
  ["levi's",'LV'],['levis','LV'],['guess','GS'],['under armour','UA'],
  ['new balance','NB'],['lacoste','LC'],['diesel','DS'],['versace','VS'],
  ['armani','AR'],['gap','GP'],['mango','MG'],['primark','PK'],['only','ON'],
  ['vero moda','VM'],['jack & jones','JJ'],['scotch & soda','SS'],['cos','CO'],
  ['weekday','WD'],['bershka','BK'],['pull & bear','PB'],['massimo dutti','MD'],
]
const COLORS_MAP = [
  ['zwart','BLK'],['black','BLK'],['wit','WHT'],['white','WHT'],
  ['blauw','BLU'],['blue','BLU'],['navy','NVY'],['marineblauw','NVY'],
  ['rood','RED'],['red','RED'],['roze','PNK'],['pink','PNK'],['fuchsia','PNK'],
  ['groen','GRN'],['green','GRN'],['kaki','KHK'],['khaki','KHK'],['olijf','OLV'],
  ['geel','YLW'],['yellow','YLW'],['paars','PRP'],['purple','PRP'],['violet','PRP'],
  ['oranje','ORG'],['orange','ORG'],['grijs','GRY'],['grey','GRY'],['gray','GRY'],
  ['beige','BGE'],['creme','CRM'],['cream','CRM'],['ecru','CRM'],
  ['bruin','BRN'],['brown','BRN'],['camel','CML'],['cognac','CGN'],
  ['bordeaux','BRD'],['wijnrood','BRD'],['lila','LIL'],['mintgroen','MNT'],
]
const SIZES = ['xxxl','xxl','xl','xs','xxs','3xl','2xl','one size',
               '50','48','46','44','42','40','38','36','34','32','30',
               '27','28','29','31','33','s','m','l']

function suggestSku(title, description) {
  const combined = `${title || ''} ${description || ''}`
  if (!combined.trim()) return ''
  // Zoek SKU-prefix: alleen letters, geen nummer (gebruiker kiest zelf het nummer)
  const existing = combined.match(/\b([A-Z]{2,4})\d{3,6}\b/)
  if (existing) return existing[1]

  const t = combined.toLowerCase()
  for (const [name, code] of BRANDS_MAP) {
    if (t.includes(name)) return code
  }
  return ''
}


// ── Inline bewerkbaar veld ─────────────────────────────────────────────────
function InlineInput({ value, onSave, placeholder, prefix = '', width = 90, type = 'text' }) {
  const [val, setVal] = useState(value ?? '')
  useEffect(() => setVal(value ?? ''), [value])
  const save = () => { if (String(val) !== String(value ?? '')) onSave(val) }
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      {prefix && (
        <span style={{ position: 'absolute', left: 7, fontSize: 11, color: 'var(--text-3)', pointerEvents: 'none', userSelect: 'none' }}>
          {prefix}
        </span>
      )}
      <input
        type={type} value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={e => e.key === 'Enter' && e.target.blur()}
        placeholder={placeholder}
        style={{ width, fontSize: 12, padding: `4px 8px 4px ${prefix ? 18 : 8}px`, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }}
      />
    </div>
  )
}

// ── Foto popup met meerdere foto's + navigatie ─────────────────────────────
function PhotoPopup({ urls, onClose }) {
  const list = Array.isArray(urls) ? urls.filter(Boolean) : [urls].filter(Boolean)
  const [idx, setIdx] = useState(0)
  const prev = () => setIdx(i => Math.max(0, i - 1))
  const next = () => setIdx(i => Math.min(list.length - 1, i + 1))

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape')     onClose()
      if (e.key === 'ArrowLeft')  prev()
      if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, list.length])

  if (!list.length) return null
  const cur = list[Math.min(idx, list.length - 1)]

  const navBtn = (label, onClick, disabled) => (
    <button
      onClick={e => { e.stopPropagation(); onClick() }}
      disabled={disabled}
      style={{
        position: 'absolute', top: '50%', transform: 'translateY(-50%)',
        background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff',
        borderRadius: '50%', width: 44, height: 44, fontSize: 26, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: disabled ? 0.2 : 1, transition: 'opacity 0.15s',
        [label === '‹' ? 'left' : 'right']: 16,
      }}
    >{label}</button>
  )

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'zoom-out',
      }}
    >
      <img
        src={cur} alt=""
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 'min(520px,90vw)', maxHeight: '82vh', borderRadius: 16, objectFit: 'contain', boxShadow: '0 32px 80px rgba(0,0,0,0.6)', cursor: 'default' }}
      />
      {list.length > 1 && navBtn('‹', prev, idx === 0)}
      {list.length > 1 && navBtn('›', next, idx === list.length - 1)}
      {list.length > 1 && (
        <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', color: '#fff', fontSize: 12, background: 'rgba(0,0,0,0.5)', padding: '3px 12px', borderRadius: 20, pointerEvents: 'none' }}>
          {idx + 1} / {list.length}
        </div>
      )}
    </div>
  )
}

// ── Order detail popup ─────────────────────────────────────────────────────
function OrderDetailModal({ order, onClose, vintedCookie, onPhotoClick, onSave, onSaveFields, onUnlinkSku }) {
  const [downloading, setDownloading] = useState(false)
  const [downloaded, setDownloaded]   = useState(false)
  const [skuEditing,  setSkuEditing]  = useState(false)
  const [skuVal,      setSkuVal]      = useState(order.sku_ref || '')
  const [cogsEditing, setCogsEditing] = useState(false)
  const [cogsVal,     setCogsVal]     = useState(String(order.cost_price ?? ''))
  const [photoUploading, setPhotoUploading] = useState(false)
  // order (prop) is een snapshot uit vtOrders op het moment dat de modal
  // openging — een upload via onSaveFields werkt dat vtOrders-record wél bij,
  // maar ververst deze snapshot niet automatisch. Lokale optimistic state
  // (zelfde patroon als skuVal/cogsVal hierboven) geeft meteen visuele
  // feedback na uploaden, zonder op een parent-refresh te moeten wachten.
  const [uploadedPhotos, setUploadedPhotos] = useState(null)

  useEffect(() => { setSkuVal(order.sku_ref || '') },       [order.sku_ref])
  useEffect(() => { setCogsVal(String(order.cost_price ?? '')) }, [order.cost_price])

  const date    = order.sale_date || order.synced_at?.split('T')[0] || ''
  const price   = Number(order.price || 0)
  const cogs    = Number(order.cost_price || 0)
  const profit  = order.cost_price != null ? price - cogs : null
  const roi     = (profit != null && cogs > 0) ? (profit / cogs) * 100 : null
  const fmtE    = v => `€${Number(v).toFixed(2).replace('.', ',')}`
  const hasSkuLink = !!(order.sku_ref || order.cost_price != null || order.batch_id)

  const photoUrls = (() => { try { return JSON.parse(order.photo_urls || '[]') } catch { return [] } })()
  const allPhotos = uploadedPhotos || (photoUrls.length ? photoUrls : (order.photo_url ? [order.photo_url] : []))
  const [photoIdx, setPhotoIdx] = useState(0)
  useEffect(() => { setPhotoIdx(0) }, [order.id])
  const mainPhoto = allPhotos[photoIdx] || null
  const prevPhoto = () => setPhotoIdx(i => (i - 1 + allPhotos.length) % allPhotos.length)
  const nextPhoto = () => setPhotoIdx(i => (i + 1) % allPhotos.length)
  const [photoHover, setPhotoHover] = useState(false)

  const uploadPhotos = async (files) => {
    if (!files.length) return
    setPhotoUploading(true)
    const urls = []
    for (const file of files) {
      const ext  = file.name.split('.').pop()
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await supabase.storage.from('order-photos').upload(path, file)
      if (!error) {
        const { data } = supabase.storage.from('order-photos').getPublicUrl(path)
        urls.push(data.publicUrl)
      }
    }
    if (urls.length) {
      setUploadedPhotos(urls)
      onSaveFields?.(order.id, { photo_url: urls[0], photo_urls: JSON.stringify(urls) })
    }
    setPhotoUploading(false)
  }

  const downloadLabel = async () => {
    if (!vintedCookie) { alert('Geen Vinted cookie — koppel je account in Instellingen.'); return }
    setDownloading(true)
    try {
      const params = order.label_url
        ? new URLSearchParams({ label_url: order.label_url })
        : new URLSearchParams({ transaction_id: order.transaction_id })
      const res = await fetch(`/api/label?${params}`, { headers: { 'x-vinted-cookie': vintedCookie } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = `label-${order.transaction_id || order.id}.pdf`; a.click()
      URL.revokeObjectURL(url)
      setDownloaded(true)
    } catch (e) {
      alert(`Label download mislukt: ${e.message}`)
    } finally {
      setDownloading(false)
    }
  }

  const saveCogs = () => {
    const v = cogsVal.trim()
    onSave?.(order.id, 'cost_price', v !== '' ? parseFloat(v) : null)
    setCogsEditing(false)
  }
  const saveSku = () => {
    onSave?.(order.id, 'sku_ref', skuVal.trim() || null)
    setSkuEditing(false)
  }

  useEffect(() => {
    const close = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  const divider = <div style={{ height: 1, background: 'var(--border)', margin: '14px 0' }} />

  const fieldLabel = (txt) => (
    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.6px', textTransform: 'uppercase', marginBottom: 3 }}>{txt}</div>
  )

  return (
    <div
      className="modal-overlay"
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <div className="modal" style={{ maxWidth: 520, padding: 0, overflow: 'hidden', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>

        {/* Foto header */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          {mainPhoto ? (
            <div
              onClick={() => onPhotoClick([...allPhotos.slice(photoIdx), ...allPhotos.slice(0, photoIdx)])}
              onMouseEnter={() => setPhotoHover(true)}
              onMouseLeave={() => setPhotoHover(false)}
              style={{ width: '100%', height: 300, cursor: 'zoom-in', background: 'var(--bg-2)', overflow: 'hidden' }}
            >
              <img src={mainPhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              {allPhotos.length > 1 && (
                <>
                  <button
                    onClick={e => { e.stopPropagation(); prevPhoto() }}
                    style={{ position: 'absolute', top: '50%', left: 12, transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', borderRadius: '50%', width: 32, height: 32, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1, opacity: photoHover ? 1 : 0, transition: 'opacity 0.15s' }}
                  >‹</button>
                  <button
                    onClick={e => { e.stopPropagation(); nextPhoto() }}
                    style={{ position: 'absolute', top: '50%', right: 12, transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', borderRadius: '50%', width: 32, height: 32, fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1, opacity: photoHover ? 1 : 0, transition: 'opacity 0.15s' }}
                  >›</button>
                  <span style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, padding: '3px 10px', borderRadius: 20 }}>
                    {photoIdx + 1}/{allPhotos.length}
                  </span>
                </>
              )}
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 55%, rgba(0,0,0,0.55))', pointerEvents: 'none' }} />
            </div>
          ) : (
            <div style={{ height: 120, background: 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: photoUploading ? 'default' : 'pointer', color: 'var(--text-3)' }}>
                <span style={{ fontSize: 24 }}>{photoUploading ? '⏳' : '📷'}</span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{photoUploading ? 'Uploaden…' : "Foto's toevoegen"}</span>
                {!photoUploading && (
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: 'none' }}
                    onChange={e => uploadPhotos(Array.from(e.target.files || []))}
                  />
                )}
              </label>
            </div>
          )}
          <button
            onClick={onClose}
            style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}
          >×</button>
        </div>

        {/* Foto-galerij (max 4) — enkel als er meerdere foto's zijn */}
        {allPhotos.length > 1 && (
          <div style={{ display: 'flex', gap: 6, padding: '10px 24px 0', flexShrink: 0 }}>
            {allPhotos.slice(0, 4).map((url, i) => (
              <img
                key={i}
                src={url}
                alt=""
                onClick={() => setPhotoIdx(i)}
                style={{
                  width: 56, height: 56, borderRadius: 8, objectFit: 'cover',
                  cursor: 'pointer', flexShrink: 0,
                  border: i === photoIdx ? '2px solid var(--green)' : '1px solid var(--border)',
                }}
              />
            ))}
          </div>
        )}

        {/* Scrollbare inhoud */}
        <div style={{ padding: '20px 24px 24px', overflowY: 'auto', flex: 1 }}>

          {/* Titel */}
          <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.35, marginBottom: 8, color: 'var(--text)' }}>{order.title}</div>

          {/* Status badge — handmatige status heeft voorrang op de automatische */}
          {(() => { const b = getEffectiveStatusBadge(order); return b ? (
            <div style={{ marginBottom: 12 }}>
              <span style={{ fontSize: 11, color: b.color, background: b.bg, padding: '3px 10px', borderRadius: 999, fontWeight: 700, border: `1px solid ${b.color}30` }}>
                {b.icon ? `${b.icon} ` : (/voltooid|geleverd/i.test(b.label) ? '✓ ' : '')}{b.label}
              </span>
            </div>
          ) : null })()}

          {/* Datum */}
          {date && (
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: order.payout_date ? 4 : 14, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--text-3)' }}>🗓</span> {order.sold_at ? formatDateTimeLong(order.sold_at) : formatDateLong(date)}
            </div>
          )}
          {order.payout_date && (
            <div style={{ fontSize: 12, color: 'var(--blue)', fontWeight: 600, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>💶</span> Uitbetaald op {formatDateLong(order.payout_date)}
            </div>
          )}

          {/* Koper — altijd tonen */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <span style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1 }}>👤</span>
            {(order.buyer_name || order.buyer || order.country) ? (
              <>
                {order.buyer_name && (
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{order.buyer_name}</span>
                )}
                {order.buyer && (
                  <span style={{ fontSize: 13, color: 'var(--text-3)' }}>@{order.buyer}</span>
                )}
                {order.country && (
                  <span style={{ fontSize: 11, background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text-2)', padding: '2px 8px', borderRadius: 5, fontWeight: 700, letterSpacing: '0.3px' }}>
                    {order.country}
                  </span>
                )}
              </>
            ) : (
              <span style={{ fontSize: 13, color: 'var(--text-3)', fontStyle: 'italic' }}>Koper onbekend</span>
            )}
          </div>

          {divider}

          {/* Financiën */}
          {fieldLabel('Financiën')}
          <div style={{ display: 'flex', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 14 }}>
            {[
              {
                label: 'BRUT',
                node: <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{fmtE(price)}</span>,
              },
              {
                label: 'COGS',
                node: cogsEditing ? (
                  <input
                    autoFocus
                    type="number"
                    value={cogsVal}
                    onChange={e => setCogsVal(e.target.value)}
                    onBlur={saveCogs}
                    onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                    onClick={e => e.stopPropagation()}
                    style={{ width: 60, fontSize: 13, fontWeight: 700, background: 'transparent', border: 'none', borderBottom: '1px solid var(--green)', color: 'var(--text)', outline: 'none', textAlign: 'center', fontFamily: 'inherit', padding: 0 }}
                  />
                ) : (
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-3)', cursor: 'pointer' }} title="Klik om te bewerken" onClick={() => setCogsEditing(true)}>
                    {fmtE(cogs)}
                  </span>
                ),
                clickable: true,
              },
              {
                label: 'WINST',
                node: profit != null
                  ? <span style={{ fontSize: 15, fontWeight: 700, color: profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{profit >= 0 ? '+' : '-'}{fmtE(Math.abs(profit))}</span>
                  : <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-3)' }}>—</span>,
              },
              {
                label: 'ROI',
                node: roi != null
                  ? <span style={{ fontSize: 15, fontWeight: 700, color: roi >= 0 ? 'var(--green)' : 'var(--red)' }}>{roi >= 0 ? '+' : ''}{roi.toFixed(0)}%</span>
                  : <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-3)' }}>—</span>,
              },
            ].map((col, i, arr) => (
              <div
                key={col.label}
                onClick={col.clickable && !cogsEditing ? () => setCogsEditing(true) : undefined}
                style={{
                  flex: 1, textAlign: 'center', padding: '10px 8px',
                  borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                  cursor: col.clickable ? 'pointer' : 'default',
                }}
              >
                <div style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 700, letterSpacing: '0.7px', textTransform: 'uppercase', marginBottom: 4 }}>{col.label}</div>
                {col.node}
              </div>
            ))}
          </div>

          {/* Verzending */}
          {(order.shipping_method || order.tracking_code) && (
            <>
              {divider}
              {fieldLabel('Verzending')}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                {order.shipping_method && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-3)' }}>📦</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{order.shipping_method}</span>
                  </div>
                )}
                {order.tracking_code && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-3)' }}>🔍</span>
                    <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600, color: 'var(--blue)', wordBreak: 'break-all' }}>{order.tracking_code}</span>
                  </div>
                )}
              </div>
            </>
          )}

          {divider}

          {/* SKU */}
          {fieldLabel('SKU')}
          <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            {skuEditing ? (
              <div style={{ display: 'flex', gap: 6, flex: 1 }}>
                <input
                  autoFocus
                  value={skuVal}
                  onChange={e => setSkuVal(e.target.value.toUpperCase())}
                  onBlur={saveSku}
                  onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setSkuEditing(false); setSkuVal(order.sku_ref || '') } }}
                  placeholder="bv. IND042"
                  style={{ flex: 1, fontFamily: 'monospace', fontSize: 13, padding: '5px 9px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', outline: 'none' }}
                />
                <button
                  onMouseDown={e => { e.preventDefault(); saveSku() }}
                  style={{ padding: '5px 12px', borderRadius: 6, background: 'var(--green)', color: '#000', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}
                >✓</button>
              </div>
            ) : (
              <div
                onClick={() => setSkuEditing(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '5px 10px', borderRadius: 6, background: 'var(--bg-2)', border: '1px solid var(--border)', minWidth: 100 }}
                title="Klik om SKU te bewerken"
              >
                <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: skuVal ? 'var(--text)' : 'var(--text-3)' }}>
                  {skuVal || 'Geen SKU'}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-3)' }}>✏️</span>
              </div>
            )}
            {hasSkuLink && onUnlinkSku && !skuEditing && (
              <button
                onClick={() => onUnlinkSku(order.id)}
                style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, cursor: 'pointer', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', color: 'var(--red)', fontFamily: 'inherit', fontWeight: 600 }}
              >Ontkoppel</button>
            )}
          </div>

          {/* Acties */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {order.conversation_id && (
              <a
                href={`https://www.vinted.be/inbox/${order.conversation_id}`}
                target="_blank" rel="noreferrer"
                className="btn btn-secondary"
                style={{ flex: 1, textAlign: 'center', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                💬 Open gesprek op Vinted
              </a>
            )}
            {isLabelReady(order) && (
              <button
                className={`btn ${downloaded ? 'btn-secondary' : 'btn-primary'}`}
                onClick={downloadLabel}
                disabled={downloading}
                style={{ flex: 1 }}
              >
                {downloading ? '⏳ Ophalen…' : downloaded ? '✓ Label gedownload' : '⬇ Download label 4×6'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Aantal items in een bundel-order: gebaseerd op item_titles (meest accuraat,
// afkomstig van een geslaagde per-item foto/titel-ophaling), anders het aantal
// foto's in photo_urls, anders het aantal uit de titel zelf ("Bundel: 2
// artikelen"), anders een generieke 2 als de titel wél "bundel" bevat maar er
// geen enkel aantal af te leiden valt (bv. items al verwijderd na verkoop).
function getBundleItemCount(order) {
  const itemTitles = (() => { try { return JSON.parse(order.item_titles || '[]') } catch { return [] } })()
  if (itemTitles.length > 1) return itemTitles.length
  const photoUrls = (() => { try { return JSON.parse(order.photo_urls || '[]') } catch { return [] } })()
  if (photoUrls.length > 1) return photoUrls.length
  const m = /bundel[:\s]*?(\d+)/i.exec(order.title || '')
  if (m) return parseInt(m[1], 10)
  return /bundel/i.test(order.title || '') ? 2 : 1
}

// ── Bulk SKU-koppel modal ───────────────────────────────────────────────────
// Koppelt meerdere geselecteerde Vinted-orders in één keer aan oplopende SKU's
// uit dezelfde leverancier-batch (bv. RIA047, RIA048, RIA049). Bundel-orders
// (meerdere artikelen in 1 verkoop) krijgen per artikel een eigen SKU-veld
// i.p.v. te worden behandeld als 1 los item met de volledige bundelprijs.
function BulkSkuModal({ batches, allOrders, orders, onClose, onConfirm }) {
  const [selectedBatch, setSelectedBatch] = useState(null) // batch waaruit deze bulk-koppeling SKU's trekt
  const [overrides, setOverrides]   = useState({}) // slotKey -> handmatig gekozen SKU (uit de dropdown)
  const [manualCounts, setManualCounts] = useState({}) // orderId -> handmatig aantal artikelen (niet-bundle orders)
  const [saving, setSaving]         = useState(false)

  // Welke SKU's zijn al gekoppeld aan een ANDERE order (niet de orders die nu
  // in deze bulk-actie zitten — die mogen hun eigen, eventueel al bestaande
  // koppeling gewoon herzien). Gedeelde logica met SkuPickerModal.
  const usedSkus = getUsedSkus(allOrders, orders.map(o => o.id))
  const freeSkus = selectedBatch ? getFreeSkusForBatch(selectedBatch, usedSkus) : []

  useEffect(() => { setOverrides({}) }, [selectedBatch])

  useEffect(() => {
    const close = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  // Officieel Vinted-bundle (title/item_titles/photo_urls-detectie).
  const isAutoBundle = (order) => getBundleItemCount(order) > 1

  // Aantal SKU-slots voor een order: bij een echte bundle altijd het
  // gedetecteerde aantal; anders het handmatig ingestelde aantal (via "Dit is
  // eigenlijk meerdere artikelen"), of 1 als daar niets voor ingesteld is.
  // manualCounts[order.id] blijft tijdens het typen een RUWE string (zie het
  // invoerveld verderop) zodat elke toets niet meteen wordt teruggeklemd —
  // hier wordt hij enkel gelezen, niet gecorrigeerd.
  const effectiveCount = (order) => {
    if (isAutoBundle(order)) return getBundleItemCount(order)
    const raw = manualCounts[order.id]
    if (raw === undefined) return 1
    const n = parseInt(raw, 10)
    return Number.isFinite(n) && n >= 1 ? n : 1
  }

  // Eén "slot" per SKU-veld — normale orders krijgen 1 slot, bundel-orders
  // (echt of handmatig aangeduid) krijgen er N (1 per artikel).
  const slots = []
  {
    let seq = 0
    for (const order of orders) {
      const itemTitles = (() => { try { return JSON.parse(order.item_titles || '[]') } catch { return [] } })()
      const count = effectiveCount(order)
      for (let i = 0; i < count; i++) {
        slots.push({
          slotKey: `${order.id}:${i}`,
          order,
          itemIndex: i,
          itemLabel: count > 1 ? (itemTitles[i] || `Item ${i + 1}`) : null,
          isBundleItem: count > 1,
          seq: seq++,
        })
      }
    }
  }

  // Slot → SKU-toewijzing en dropdown-opties: gedeelde logica met
  // SkuPickerModal se "meerdere artikelen"-modus (zie assignSlotSkus/
  // skuOptionsForSlot in skuUtils.js).
  const slotSkus = assignSlotSkus(slots.map(s => s.slotKey), freeSkus, overrides)
  const optionsFor = (slot) => skuOptionsForSlot(slot.slotKey, slotSkus, freeSkus)

  const handleConfirm = async () => {
    if (!selectedBatch || saving) return
    setSaving(true)
    const assignments = orders.map(order => {
      const orderSlots = slots.filter(s => s.order.id === order.id)
      const items = orderSlots.map(slot => {
        const sku = slotSkus[slot.slotKey]
        return { sku, batch: sku ? selectedBatch : null }
      })
      return { orderId: order.id, items }
    })
    await onConfirm(assignments)
    setSaving(false)
    onClose()
  }

  const selectStyle = { width: 96, flexShrink: 0, fontFamily: 'monospace', fontSize: 12, fontWeight: 700, padding: '5px 4px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', textAlign: 'center', outline: 'none' }

  const skuSelect = (slot) => (
    <select
      value={slotSkus[slot.slotKey] || ''}
      onChange={e => setOverrides(prev => ({ ...prev, [slot.slotKey]: e.target.value }))}
      disabled={!freeSkus.length}
      style={selectStyle}
    >
      {!slotSkus[slot.slotKey] && <option value="">Geen vrije SKU</option>}
      {optionsFor(slot).map(sku => <option key={sku} value={sku}>{sku}</option>)}
    </select>
  )

  // Stap 1: batch kiezen — hergebruikt exact SkuPickerModal se batch-lijst
  // (SKU-range + merk-badge + categorie + beschikbaar-aantal, zie dab28d5)
  // in plaats van een aparte leverancier-dropdown die geen batch-info toonde.
  // onPick geeft (sku, batch) door — hier is enkel de batch relevant, de
  // eerste-vrije-sku die SkuPickerModal zelf al berekende wordt genegeerd,
  // want de N SKU-dropdowns hieronder bepalen de daadwerkelijke toewijzing.
  //
  // closeOnPick={false}: zonder dit riep SkuPickerModal na een geslaagde
  // onPick meteen de doorgegeven onClose() aan — en dat IS hier de echte
  // onClose van de hele bulk-modal, die 'm dus meteen unmountte vóórdat de
  // vervolgstap (N SKU-dropdowns hieronder) ooit te zien was. × / Escape /
  // buiten-klikken in de batch-lijst blijven wél gewoon de hele bulk-modal
  // sluiten via die echte onClose — dat is correct, er is op dat punt nog
  // niks anders om naar terug te keren.
  if (!selectedBatch) {
    return (
      <SkuPickerModal
        batches={batches}
        allOrders={allOrders}
        excludeOrderIds={orders.map(o => o.id)}
        onPick={(_sku, batch) => setSelectedBatch(batch)}
        onClose={onClose}
        closeOnPick={false}
      />
    )
  }

  return (
    <div className="modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 480, padding: 0, overflow: 'hidden' }}>
        <div className="modal-header" style={{ padding: '16px 20px 0' }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>SKU koppelen ({orders.length} geselecteerd)</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ padding: '16px 20px 20px' }}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <button
                onClick={() => setSelectedBatch(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-3)', fontSize: 12, cursor: 'pointer', padding: 0 }}
              >← Andere batch</button>
              <span style={{ fontWeight: 700, fontSize: 13, color: '#818cf8', fontFamily: 'monospace' }}>
                {formatSkuRange(selectedBatch.supplierPrefix, selectedBatch.startNum, selectedBatch.endNum)}
              </span>
              {selectedBatch.brand && (
                <span style={{ fontSize: 10, fontWeight: 700, color: '#c4b5fd', background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', padding: '2px 8px', borderRadius: 20 }}>
                  {selectedBatch.brand}
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: slots.length > freeSkus.length ? '#f87171' : 'var(--text-3)', fontWeight: slots.length > freeSkus.length ? 700 : 400 }}>
              {slots.length > freeSkus.length ? '⚠ ' : ''}
              {freeSkus.length} vrije SKU{freeSkus.length === 1 ? '' : "'s"} in deze batch
              {slots.length > freeSkus.length && ` — je vraagt er ${slots.length}, kies eventueel een andere batch voor de rest`}
            </div>
          </div>

          <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            {orders.map((order, oi) => {
              const orderSlots = slots.filter(s => s.order.id === order.id)
              const isBundle = orderSlots.length > 1
              const perItemPrice = parseFloat(order.price || 0) / orderSlots.length
              return (
                <div key={order.id} style={{ borderBottom: oi < orders.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: isBundle ? 'rgba(129,140,248,0.06)' : 'transparent' }}>
                    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontWeight: isBundle ? 700 : 400, color: 'var(--text)' }} title={order.title}>
                      {isBundle && '📦 '}{order.title}
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', flexShrink: 0 }}>
                      €{parseFloat(order.price || 0).toFixed(2).replace('.', ',')}
                      {isBundle && <span style={{ fontWeight: 400, color: 'var(--text-3)' }}> ({orderSlots.length}×)</span>}
                    </span>
                    {!isBundle && skuSelect(orderSlots[0])}
                  </div>
                  {isBundle && orderSlots.map(slot => (
                    <div key={slot.slotKey} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 6px 26px' }}>
                      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, color: 'var(--text-2)' }} title={slot.itemLabel}>
                        {slot.itemLabel}
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>
                        €{perItemPrice.toFixed(2).replace('.', ',')}
                      </span>
                      {skuSelect(slot)}
                    </div>
                  ))}
                  {/* Handmatige "meerdere artikelen"-optie — enkel voor orders die geen
                      officiële Vinted-bundle zijn (bv. losse verkoop van meerdere
                      stuks aan één koper, buiten het bundle-systeem om). */}
                  {!isAutoBundle(order) && (
                    <div style={{ padding: '4px 10px 8px 10px' }}>
                      {manualCounts[order.id] === undefined ? (
                        <span
                          onClick={() => setManualCounts(prev => ({ ...prev, [order.id]: 2 }))}
                          style={{ fontSize: 11, color: 'var(--text-3)', cursor: 'pointer', userSelect: 'none' }}
                        >
                          + Dit is eigenlijk meerdere artikelen
                        </span>
                      ) : (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Aantal artikelen:</span>
                            <input
                              type="number"
                              min={2}
                              max={freeSkus.length || undefined}
                              value={manualCounts[order.id]}
                              // Tijdens het typen NIET meteen terugklemmen naar het minimum/
                              // maximum (dat maakte het veld eerder feitelijk onbewerkbaar,
                              // want elke toets werd meteen overschreven) — enkel opslaan wat
                              // getypt wordt, pas bij onBlur normaliseren.
                              onChange={e => setManualCounts(prev => ({ ...prev, [order.id]: e.target.value }))}
                              onBlur={() => setManualCounts(prev => {
                                let n = parseInt(prev[order.id], 10)
                                if (!Number.isFinite(n) || n < 2) n = 2
                                if (freeSkus.length && n > freeSkus.length) n = freeSkus.length
                                return { ...prev, [order.id]: n }
                              })}
                              style={{ width: 48, fontSize: 12, fontWeight: 700, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', textAlign: 'center', outline: 'none' }}
                            />
                            <span
                              onClick={() => setManualCounts(prev => { const next = { ...prev }; delete next[order.id]; return next })}
                              style={{ fontSize: 11, color: '#f87171', cursor: 'pointer', userSelect: 'none' }}
                            >✕ annuleer</span>
                          </div>
                          {freeSkus.length > 0 && effectiveCount(order) > freeSkus.length && (
                            <div style={{ fontSize: 10, color: '#f87171', fontWeight: 600, marginTop: 3 }}>
                              ⚠ Nog maar {freeSkus.length} SKU{freeSkus.length === 1 ? '' : "'s"} beschikbaar in deze batch
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <button
            className="btn btn-primary"
            disabled={!selectedBatch || saving}
            onClick={handleConfirm}
            style={{ width: '100%', marginTop: 16 }}
          >
            {saving ? 'Bezig…' : `Bevestig koppeling (${slots.length} SKU${slots.length === 1 ? '' : "'s"})`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Custom checkbox ─────────────────────────────────────────────────────────
// Native accent-color checkboxes renderen inconsistent (soms nauwelijks meer
// dan een dun randje) — deze versie geeft een duidelijk gevuld vlak + wit
// vinkje bij aangevinkt, en een subtiele lege outline bij niet-aangevinkt.
// ── Klikbare status-badge — toont manual_status indien gezet, anders de
// automatische Vinted-status (getStatusBadge), en laat via een dropdown een
// handmatige override kiezen voor eigen administratie/overzicht. De
// automatische classificatie (order.status) wordt hierbij nooit aangepast —
// enkel manual_status wijzigt, dus de Home-dashboard-tellingen (die op
// order.status draaien) blijven ongemoeid.
function ManualStatusBadge({ order, onSave }) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState(null)
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  // Menu rendert via een portal in document.body met position:fixed (i.p.v.
  // relatief binnen de kaart) — anders knipt de eigen kaart (overflow:hidden)
  // of de volgende kaart in de lijst het menu af zodra het lager op de
  // pagina staat. Positie wordt bij het openen berekend uit de knop zelf,
  // en het menu sluit bij scrollen zodat de positie nooit stale kan raken.
  useEffect(() => {
    if (!open) return
    const onDocClick = e => {
      if (btnRef.current?.contains(e.target)) return
      if (menuRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onScroll = () => setOpen(false)
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  const manual = getManualStatus(order.manual_status)
  const auto = getStatusBadge(order.status, isLabelReady(order))
  const current = manual || auto
  const icon = manual ? manual.icon : (auto && /voltooid|geleverd/i.test(auto.label) ? '✓' : null)

  const choose = (value) => { onSave(order.id, 'manual_status', value); setOpen(false) }

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const menuWidth = 180
      const left = Math.min(r.left, window.innerWidth - menuWidth - 8)
      setMenuPos({ top: r.bottom + 4, left: Math.max(8, left) })
    }
    setOpen(o => !o)
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, flexShrink: 0,
          color: current?.color || 'var(--text-3)', background: current?.bg || 'var(--bg-2)',
          padding: '2px 8px', borderRadius: 999, border: `1px solid ${current ? current.color + '30' : 'var(--border)'}`,
          cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.5,
        }}
      >
        {icon && <span>{icon} </span>}{current?.label || 'Status'}
        <span style={{ fontSize: 8, opacity: 0.7 }}>▾</span>
      </button>

      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 1000,
            background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10,
            boxShadow: '0 12px 32px rgba(0,0,0,0.18)', overflow: 'hidden', minWidth: 180,
          }}
        >
          {MANUAL_STATUSES.map(s => (
            <div
              key={s.value}
              onClick={() => choose(s.value)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', fontSize: 12, fontWeight: 600,
                color: 'var(--text)', cursor: 'pointer', whiteSpace: 'nowrap',
                background: order.manual_status === s.value ? s.bg : 'transparent',
              }}
              onMouseEnter={e => e.currentTarget.style.background = s.bg}
              onMouseLeave={e => e.currentTarget.style.background = order.manual_status === s.value ? s.bg : 'transparent'}
            >
              <span style={{ color: s.color }}>{s.icon}</span>{s.label}
            </div>
          ))}
          {order.manual_status && (
            <div
              onClick={() => choose(null)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', fontSize: 11, fontWeight: 600,
                color: 'var(--text-3)', cursor: 'pointer', whiteSpace: 'nowrap',
                borderTop: '1px solid var(--border)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span>↺</span>Automatisch (Vinted-status)
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  )
}

// ── Order rij (Vinteer-stijl) ──────────────────────────────────────────────
function VintedOrderRow({ order, onSave, onSaveFields, onBulkConfirm, onDismiss, onPhotoClick, onRegister, onDetail, onUnlinkSku, batches, allOrders, checked, onCheck }) {
  const [skuPickerOpen,  setSkuPickerOpen]  = useState(false)
  const [hoverPos,       setHoverPos]       = useState(null)
  const [cogsEditing,    setCogsEditing]    = useState(false)
  const [cogsVal,        setCogsVal]        = useState(String(order.cost_price ?? ''))
  const [photoUploading, setPhotoUploading] = useState(false)

  useEffect(() => setCogsVal(String(order.cost_price ?? '')), [order.cost_price])

  const date     = order.sale_date || order.synced_at?.split('T')[0] || ''
  const price    = parseFloat(order.price || 0)
  const cogs     = parseFloat(order.cost_price || 0)
  const profit   = order.cost_price != null ? price - cogs : null
  const roi      = (profit != null && cogs > 0) ? (profit / cogs) * 100 : null
  const buyer    = order.buyer_name || order.buyer || ''
  const itemUrl  = order.conversation_id
    ? `https://www.vinted.be/inbox/${order.conversation_id}`
    : order.item_url || null
  const suggested = !order.sku_ref ? suggestSku(order.title, order.description) : ''
  const hasSkuLink = !!(order.sku_ref || order.cost_price != null || order.batch_id)
  // sku_ref staat er (bv. automatisch gedetecteerd door de extensie bij
  // sync), maar kon niet herleid worden naar een bestaande batch (typo, of de
  // batch bestaat niet) — duidelijk zichtbaar maken i.p.v. dit stil te laten
  // verdwijnen, zodat de gebruiker het via dezelfde "SKU koppelen"-knop kan
  // corrigeren.
  const skuUnresolved = !!(order.sku_ref && !order.sku_ref.includes(',') && !order.batch_id)

  const photoUrls = (() => { try { return JSON.parse(order.photo_urls || '[]') } catch { return [] } })()
  const allPhotos = photoUrls.length ? photoUrls : (order.photo_url ? [order.photo_url] : [])

  // Bundel-fallback: als losse item-foto's niet opgehaald konden worden (item al
  // verwijderd na verkoop), is er maar 1 foto — toon dan een tekst-label zodat
  // duidelijk blijft dat het om een bundel gaat. Zodra photo_urls wél meerdere
  // URLs bevat, is de "+N"-badge op de foto zelf al voldoende (geen dubbel label).
  const itemTitles  = (() => { try { return JSON.parse(order.item_titles || '[]') } catch { return [] } })()
  const bundleMatch = /bundel[:\s]*?(\d+)/i.exec(order.title || '')
  const bundleCount = itemTitles.length || (bundleMatch ? parseInt(bundleMatch[1], 10) : 0)
  const isBundleFallback = allPhotos.length <= 1 && (itemTitles.length > 0 || /bundel/i.test(order.title || ''))

  const meta = (() => {
    const t = (order.title || '').toLowerCase()
    let brand = '', color = '', size = ''
    for (const [name] of BRANDS_MAP) if (t.includes(name)) { brand = name; break }
    for (const [name] of COLORS_MAP) if (t.includes(name)) { color = name; break }
    for (const s of SIZES) {
      if (new RegExp(`(?:^|\\s|maat\\s*)${s}(?:\\s|$|/)`, 'i').test(t)) { size = s; break }
    }
    return [brand, size, color].filter(Boolean).join(' · ')
  })()

  const saveCogs = () => {
    const v = cogsVal.trim()
    onSave(order.id, 'cost_price', v !== '' ? parseFloat(v) : null)
    setCogsEditing(false)
  }

  const miniBtn = (onClick, label, color, bg, border) => (
    <button
      onClick={onClick}
      style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, cursor: 'pointer', fontWeight: 600, border: `1px solid ${border}`, background: bg, color, fontFamily: 'inherit', lineHeight: 1.5, whiteSpace: 'nowrap' }}
    >{label}</button>
  )

  return (
    <>
      <div
        className="glass-card"
        style={{
          padding: 0,
          overflow: 'hidden',
          marginBottom: 14,
          background: checked ? 'rgba(129,140,248,0.10)' : undefined,
          transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
        }}
      >

        {/* Hoofdinhoud: foto + info */}
        <div style={{ padding: '14px 16px 10px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>

          {/* Checkbox */}
          <div style={{ flexShrink: 0, paddingTop: 4 }}>
            <Checkbox checked={checked} onChange={on => onCheck?.(on)} />
          </div>

          {/* Foto */}
          <div style={{ flexShrink: 0, position: 'relative' }}>
            {allPhotos.length ? (
              <>
                <img
                  src={allPhotos[0]} alt=""
                  style={{ width: 100, height: 124, borderRadius: 8, objectFit: 'cover', display: 'block', cursor: 'zoom-in' }}
                  onMouseEnter={e => {
                    const r = e.currentTarget.getBoundingClientRect()
                    setHoverPos({ x: r.right + 12, y: Math.max(8, r.top - 40) })
                  }}
                  onMouseLeave={() => setHoverPos(null)}
                  onClick={() => onPhotoClick(allPhotos)}
                />
                {allPhotos.length > 1 && (
                  <span style={{
                    position: 'absolute', bottom: 6, right: 6,
                    background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 10, fontWeight: 700,
                    padding: '2px 6px', borderRadius: 20, pointerEvents: 'none',
                  }}>
                    +{allPhotos.length - 1}
                  </span>
                )}
              </>
            ) : (
              <div style={{ position: 'relative', width: 100, height: 124, flexShrink: 0 }}>
                <div style={{ width: 100, height: 124, borderRadius: 8, background: 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>
                  {photoUploading ? '⏳' : '📦'}
                </div>
                {!photoUploading && (
                  <label style={{ position: 'absolute', bottom: 6, right: 6, background: 'var(--bg-2)', border: '1px solid var(--border-strong)', color: 'var(--text-2)', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16, lineHeight: 1, userSelect: 'none' }} title="Foto's toevoegen">
                    +
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      style={{ display: 'none' }}
                      onChange={async e => {
                        const files = Array.from(e.target.files || [])
                        if (!files.length) return
                        setPhotoUploading(true)
                        const urls = []
                        for (const file of files) {
                          const ext  = file.name.split('.').pop()
                          const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
                          const { error } = await supabase.storage.from('order-photos').upload(path, file)
                          if (!error) {
                            const { data } = supabase.storage.from('order-photos').getPublicUrl(path)
                            urls.push(data.publicUrl)
                          }
                        }
                        if (urls.length) {
                          onSaveFields(order.id, { photo_url: urls[0], photo_urls: JSON.stringify(urls) })
                        }
                        setPhotoUploading(false)
                      }}
                    />
                  </label>
                )}
              </div>
            )}
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>

            {/* Rij 1: Titel + × */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
              <span
                onClick={onDetail}
                style={{ fontWeight: 700, fontSize: 14, color: 'var(--green)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3, flex: 1, minWidth: 0, cursor: onDetail ? 'pointer' : 'default' }}
                title={onDetail ? 'Klik voor details' : undefined}
              >
                {order.title}
              </span>
              <ManualStatusBadge order={order} onSave={onSave} />
              <button
                onClick={onDismiss}
                title="Verwijder"
                style={{ flexShrink: 0, fontSize: 17, lineHeight: 1, background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: '0 2px', fontWeight: 700, fontFamily: 'inherit' }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}
              >×</button>
            </div>

            {/* Bundel-fallback label — enkel als losse foto's niet beschikbaar zijn */}
            {isBundleFallback && (
              <div style={{ marginBottom: 5 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#c084fc', background: 'rgba(192,132,252,0.12)', border: '1px solid rgba(192,132,252,0.25)', padding: '2px 8px', borderRadius: 20 }}>
                  📦 Bundel van {bundleCount || '2+'} artikelen
                </span>
              </div>
            )}

            {/* Rij 2: Merk · Maat · Kleur */}
            {meta && (
              <div style={{ fontSize: 11, color: 'var(--text-2)', marginBottom: 5, textTransform: 'capitalize' }}>{meta}</div>
            )}

            {/* Rij 3: koper + land */}
            {(buyer || order.country) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
                <span style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1 }}>👤</span>
                {buyer && <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{buyer}</span>}
                {order.country && (
                  <span style={{ fontSize: 10, background: 'var(--bg-2)', color: 'var(--text-3)', padding: '1px 7px', borderRadius: 4, fontWeight: 600, letterSpacing: '0.2px' }}>
                    {order.country}
                  </span>
                )}
              </div>
            )}

            {/* Rij 4: datum + acties */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {date && (
                <span style={{ fontSize: 11, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 3 }}>
                  🗓 {order.sold_at ? formatDateTimeLong(order.sold_at) : formatDateLong(date)}
                </span>
              )}
              {order.payout_date && (
                <span style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
                  💶 Uitbetaald op {formatDateLong(order.payout_date)}
                </span>
              )}
              {skuUnresolved
                ? miniBtn(
                    () => setSkuPickerOpen(true),
                    `⚠ ${order.sku_ref} niet gevonden`,
                    '#f59e0b', 'rgba(245,158,11,0.1)', 'rgba(245,158,11,0.25)'
                  )
                : miniBtn(
                    () => setSkuPickerOpen(true),
                    order.sku_ref ? `🏷 ${order.sku_ref}` : 'SKU koppelen',
                    '#818cf8', 'rgba(129,140,248,0.08)', 'rgba(129,140,248,0.2)'
                  )}
              {hasSkuLink && onUnlinkSku && (
                <button
                  onClick={() => onUnlinkSku(order.id)}
                  title="SKU ontkoppelen"
                  style={{ fontSize: 12, lineHeight: 1, padding: '2px 5px', borderRadius: 5, cursor: 'pointer', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', color: '#f87171', fontFamily: 'inherit', fontWeight: 700 }}
                >×</button>
              )}
              {suggested && !order.sku_ref && (
                <span
                  onClick={() => onSave(order.id, 'sku_ref', suggested)}
                  style={{ fontSize: 10, color: '#818cf8', cursor: 'pointer', userSelect: 'none' }}
                  title={`Auto: ${suggested}`}
                >✦ {suggested}</span>
              )}
              {order.registered_in_vault
                ? <span style={{ fontSize: 11, color: '#4ade80', fontWeight: 600 }}>✓ Empl.</span>
                : onRegister && miniBtn(onRegister, '+ Empl.', '#4ade80', 'rgba(74,222,128,0.08)', 'rgba(74,222,128,0.2)')
              }
            </div>
          </div>
        </div>

        {/* Onderbalk: BRUT | COGS | PROFIT */}
        <div style={{
          background: 'var(--bg-2)',
          display: 'flex',
          borderTop: '1px solid var(--border)',
        }}>
          {[
            {
              label: 'BRUT',
              node: <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>€{price.toFixed(2).replace('.', ',')}</span>,
            },
            {
              label: 'COGS',
              node: cogsEditing ? (
                <input
                  autoFocus
                  type="number"
                  value={cogsVal}
                  onChange={e => setCogsVal(e.target.value)}
                  onBlur={saveCogs}
                  onKeyDown={e => e.key === 'Enter' && e.target.blur()}
                  onClick={e => e.stopPropagation()}
                  style={{ width: 64, fontSize: 13, fontWeight: 700, background: 'transparent', border: 'none', borderBottom: '1px solid #4ade80', color: 'var(--text)', outline: 'none', textAlign: 'center', fontFamily: 'inherit', padding: 0 }}
                />
              ) : (
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-3)' }}>€{cogs.toFixed(2).replace('.', ',')}</span>
              ),
              onClick: () => !cogsEditing && setCogsEditing(true),
              title: 'Klik om te bewerken',
            },
            {
              label: 'PROFIT',
              node: profit != null
                ? <span style={{ fontSize: 14, fontWeight: 700, color: profit >= 0 ? '#4ade80' : '#f87171' }}>{profit >= 0 ? '+' : '-'}€{Math.abs(profit).toFixed(2).replace('.', ',')}</span>
                : <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-3)' }}>—</span>,
            },
            {
              label: 'ROI',
              node: roi != null
                ? <span style={{ fontSize: 14, fontWeight: 700, color: roi >= 0 ? '#4ade80' : '#f87171' }}>{roi >= 0 ? '+' : ''}{roi.toFixed(0)}%</span>
                : <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-3)' }}>—</span>,
            },
          ].map((col, i, arr) => (
            <div
              key={col.label}
              onClick={col.onClick}
              title={col.title}
              style={{
                flex: 1,
                textAlign: 'center',
                padding: '7px 8px',
                borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                cursor: col.onClick ? 'pointer' : 'default',
              }}
            >
              <div style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 2 }}>{col.label}</div>
              {col.node}
            </div>
          ))}
        </div>
      </div>

      {hoverPos && allPhotos.length > 0 && (
        <img
          src={allPhotos[0]} alt=""
          style={{
            position: 'fixed',
            left: hoverPos.x,
            top: hoverPos.y,
            width: 260,
            height: 320,
            borderRadius: 12,
            objectFit: 'cover',
            zIndex: 9999,
            pointerEvents: 'none',
            boxShadow: 'var(--shadow-lg)',
            border: '2px solid var(--border-strong)',
          }}
        />
      )}

      {skuPickerOpen && (
        <SkuPickerModal
          batches={batches}
          allOrders={allOrders}
          excludeOrderId={order.id}
          onPick={(sku, batch) => onSaveFields(order.id, {
            sku_ref: sku,
            cost_price: getBatchUnitCost(batch),
            batch_id: batch.id,
          })}
          onPickMultiple={items => onBulkConfirm([{ orderId: order.id, items }])}
          onClose={() => setSkuPickerOpen(false)}
        />
      )}
    </>
  )
}

// ── Handmatige order toevoegen ─────────────────────────────────────────────
const PLATFORM_OPTIONS = ['Vinted', 'eBay', 'Vide Dressing', 'Depop', 'Facebook Marketplace', 'Andere']

function AddOrderModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    title: '', price: '', buyerName: '', country: '',
    date: new Date().toISOString().split('T')[0],
    platform: 'Vinted', sku: '',
  })
  const [files,     setFiles]     = useState([])
  const [previews,  setPreviews]  = useState([])
  const [uploading, setUploading] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleFiles = (e) => {
    const picked = Array.from(e.target.files)
    setFiles(picked)
    setPreviews(picked.map(f => ({
      url:     URL.createObjectURL(f),
      isVideo: f.type.startsWith('video/'),
      name:    f.name,
    })))
  }

  const handleSave = async () => {
    if (!form.title.trim()) return
    setUploading(true)
    const photoUrls = []
    for (const file of files) {
      const ext  = file.name.split('.').pop()
      const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await supabase.storage.from('order-photos').upload(path, file)
      if (!error) {
        const { data } = supabase.storage.from('order-photos').getPublicUrl(path)
        photoUrls.push(data.publicUrl)
      } else {
        photoUrls.push(URL.createObjectURL(file))
      }
    }
    setUploading(false)
    await onSave({
      title:      form.title.trim(),
      price:      parseFloat(form.price) || 0,
      buyer_name: form.buyerName.trim() || null,
      country:    form.country.trim().toUpperCase().slice(0, 2) || '',
      sale_date:  form.date || null,
      photo_url:  photoUrls[0] || null,
      photo_urls: photoUrls.length ? JSON.stringify(photoUrls) : null,
      sku_ref:    form.sku.trim().toUpperCase() || null,
      status:     `Handmatig · ${form.platform}`,
      synced_at:  new Date().toISOString(),
    })
    onClose()
  }

  useEffect(() => {
    const close = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  const lbl = (txt) => (
    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.6px', textTransform: 'uppercase', marginBottom: 4 }}>{txt}</div>
  )
  const inputStyle = { width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }

  return (
    <div className="modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 460, padding: '24px' }}>
        <div className="modal-header">
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Order toevoegen</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 14 }}>
            {lbl('Titel')}
            <input autoFocus value={form.title} onChange={e => set('title', e.target.value)} placeholder="bv. Nike Air Max maat 42" style={inputStyle} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              {lbl('Verkoopprijs (€)')}
              <input type="number" value={form.price} onChange={e => set('price', e.target.value)} placeholder="0.00" min={0} step={0.01} style={inputStyle} />
            </div>
            <div>
              {lbl('Datum')}
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)} style={inputStyle} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              {lbl('Koper naam')}
              <input value={form.buyerName} onChange={e => set('buyerName', e.target.value)} placeholder="bv. Jan Janssen" style={inputStyle} />
            </div>
            <div>
              {lbl('Land (ISO)')}
              <input value={form.country} onChange={e => set('country', e.target.value)} placeholder="bv. NL" maxLength={2} style={inputStyle} />
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            {lbl('Platform')}
            <select value={form.platform} onChange={e => set('platform', e.target.value)} style={inputStyle}>
              {PLATFORM_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 14 }}>
            {lbl("Foto's / Video's")}
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={handleFiles}
              style={{ ...inputStyle, padding: '5px 10px', cursor: 'pointer' }}
            />
            {previews.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {previews.map((p, i) => (
                  p.isVideo
                    ? <video key={i} src={p.url} muted style={{ width: 64, height: 64, borderRadius: 6, objectFit: 'cover', border: '1px solid var(--border)' }} />
                    : <img   key={i} src={p.url} alt="" style={{ width: 64, height: 64, borderRadius: 6, objectFit: 'cover', border: '1px solid var(--border)' }} />
                ))}
              </div>
            )}
          </div>
          <div style={{ marginBottom: 4 }}>
            {lbl('SKU')}
            <input value={form.sku} onChange={e => set('sku', e.target.value.toUpperCase())} placeholder="bv. IND042" style={inputStyle} />
          </div>
        </div>
        <div className="modal-footer" style={{ marginTop: 20 }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={uploading}>Annuleer</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!form.title.trim() || uploading}>
            {uploading ? '⏳ Uploaden…' : 'Toevoegen'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Verkopen({ data, onDeleteSale, onUpdateSale, updateData, vintedCookie, dayFilter, onConsumeDayFilter }) {
  const { batches, sales, suppliers } = data

  const [search, setSearch] = useState('')
  const [filterPlatform, setFilterPlatform] = useState('all')
  const [filterMonth, setFilterMonth] = useState('all')
  const [stageFilter, setStageFilter] = useState('all')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [editSale, setEditSale] = useState(null)
  // Dag-filter vanuit Home.jsx's "Aantal verkopen per dag"-grafiek (klik op
  // een staaf) — apart van filterMonth, want die dropdown kent enkel
  // maand-opties en zou een exacte dag niet als geselecteerd kunnen tonen.
  const [dayFilterActive, setDayFilterActive] = useState(null)
  useEffect(() => {
    if (!dayFilter) return
    setDayFilterActive(dayFilter)
    onConsumeDayFilter?.()
  }, [dayFilter, onConsumeDayFilter])

  // ── Vinted Orders state ────────────────────────────────────────────────
  const [vtOrders, setVtOrders]   = useState([])
  const [vtLoading, setVtLoading] = useState(true)
  const [vtError, setVtError]     = useState(null)
  const [saleModalPrefill, setSaleModalPrefill] = useState(null)
  const [photoPopup, setPhotoPopup]   = useState(null)   // string[] | null
  const [orderDetail, setOrderDetail] = useState(null)   // row | null
  const [addOrderOpen, setAddOrderOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkSkuOpen, setBulkSkuOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchAllVintedOrders().then(rows => {
      if (cancelled) return
      const SKU_RE = /\b([A-Z]{2,4}\d{3,6})\b/
      const enriched = rows.map(row => {
        if (!row.sku_ref && row.description) {
          const m = row.description.match(SKU_RE)
          if (m) {
            supabase.from('vinted_orders').update({ sku_ref: m[1] }).eq('id', row.id)
            return { ...row, sku_ref: m[1] }
          }
        }
        return row
      })
      setVtOrders(enriched)
      setVtLoading(false)
    }).catch(e => { if (!cancelled) { setVtError(e.message); setVtLoading(false) } })
    return () => { cancelled = true }
  }, [])

  // Auto-registratie: zonder dit bleef een verse Vinted-verkoop onzichtbaar
  // voor het Dashboard (Home.jsx leest uitsluitend data.sales, nooit
  // vinted_orders rechtstreeks) totdat iemand handmatig op "+ Empl." klikte.
  // Elke niet-geannuleerde verkooporder krijgt hier meteen een data.sales-
  // entry met de echte sale_date/sold_at, óók zonder gekoppelde SKU/batch
  // (batchId dan null → €0 kostprijs, zie getBatchUnitCost). COGS kan later
  // alsnog via "SKU koppelen" aangevuld worden; dat vervangt deze entry (zie
  // handleBulkSkuConfirm) zodat er nooit dubbel geteld wordt.
  //
  // autoRegisterSeenRef: React 18 StrictMode (dev) voert effects 2x uit met
  // dezelfde stale sales/vtOrders-closure — zonder deze ref-guard zou de 2e
  // uitvoering dezelfde orders nog een keer proberen te registreren vóórdat
  // de eerste update is doorgerenderd. Refs overleven StrictMode's dubbele
  // invocatie (in tegenstelling tot de closure-waarden), dus dit sluit de
  // race definitief.
  const autoRegisterSeenRef = useRef(new Set())
  useEffect(() => {
    const registeredOrderIds = new Set(sales.map(s => s.vintedOrderId).filter(Boolean))
    const eligible = (o) =>
      !autoRegisterSeenRef.current.has(o.id) &&
      !/geannuleerd|cancel/i.test(o.status || '') &&
      (o.order_direction === 'sale' || !o.order_direction)

    const toRegister = vtOrders.filter(o =>
      !o.registered_in_vault && !registeredOrderIds.has(o.id) && eligible(o)
    )
    // Zelfherstel: order heeft al een data.sales-entry (bv. via "+ Empl.",
    // of een eerdere auto-registratie waarvan de Supabase-update werd
    // onderbroken) maar registered_in_vault staat nog op false — enkel de
    // vlag bijwerken, geen nieuwe (dubbele) sales-entry aanmaken.
    const toReconcile = vtOrders.filter(o =>
      !o.registered_in_vault && registeredOrderIds.has(o.id) && eligible(o)
    )
    if (!toRegister.length && !toReconcile.length) return

    toRegister.forEach(o => autoRegisterSeenRef.current.add(o.id))
    toReconcile.forEach(o => autoRegisterSeenRef.current.add(o.id))

    // Als de order al een batch_id heeft (handmatig gekoppeld, of al eerder
    // gedetecteerd) gebruiken we die. Anders proberen we sku_ref (bv. door de
    // extensie gedetecteerd bij sync, zie content.js) te herleiden naar een
    // bestaande batch via findBatchForSku — dezelfde matching-logica als
    // elders in de app, geen aparte implementatie. Bundel-sku_ref's (met een
    // komma) slaan we hier over: die lopen via BulkSkuModal/handleBulkSkuConfirm.
    const vtOrderPatches = {}
    const resolveBatch = (order) => {
      if (order.batch_id && !order.batch_id.includes(',')) {
        return { batchId: order.batch_id, costPrice: order.cost_price ?? null }
      }
      if (order.sku_ref && !order.sku_ref.includes(',')) {
        const batch = findBatchForSku(batches, order.sku_ref)
        if (batch) {
          const costPrice = getBatchUnitCost(batch)
          vtOrderPatches[order.id] = { batch_id: batch.id, cost_price: costPrice }
          return { batchId: batch.id, costPrice }
        }
      }
      return { batchId: null, costPrice: null }
    }

    const newSales = toRegister.map(order => {
      let photo = order.photo_url || null
      try { photo = JSON.parse(order.photo_urls || '[]')[0] || photo } catch {}
      const { batchId } = resolveBatch(order)
      return {
        id: genId(),
        vintedOrderId: order.id,
        batchId,
        type: 'individual',
        quantity: 1,
        salePrice: parseFloat(order.price || 0),
        platform: 'Vinted',
        buyer: order.buyer_name || order.buyer || '',
        fees: 0,
        shippingCost: 0,
        notes: order.transaction_id ? `Vinted #${order.transaction_id}` : '',
        date: order.sale_date || order.synced_at?.split('T')[0] || new Date().toISOString().split('T')[0],
        fromLive: false,
        photo,
        links: [],
        shipped: false,
        shippedDate: null,
        isFree: false,
        saleTime: order.sold_at ? order.sold_at.split('T')[1]?.slice(0, 5) : null,
      }
    })
    // toReconcile-orders hebben al een data.sales-entry maar kunnen ook nog
    // een niet-herleide sku_ref hebben (bv. handmatig "+ Empl." geklikt vóór
    // de batch gekoppeld was) — ook daarvoor proberen we de batch te vinden,
    // en de bestaande sales-entry bijwerken zodat COGS/profit meteen kloppen.
    toReconcile.forEach(resolveBatch)

    const idsToFlag = [...toRegister, ...toReconcile].map(o => o.id)
    const updates = {}
    if (newSales.length || Object.keys(vtOrderPatches).length) {
      const patchedSales = sales.map(s =>
        s.vintedOrderId && vtOrderPatches[s.vintedOrderId] && !s.batchId
          ? { ...s, batchId: vtOrderPatches[s.vintedOrderId].batch_id }
          : s
      )
      updates.sales = newSales.length ? [...patchedSales, ...newSales] : patchedSales
    }
    if (Object.keys(updates).length) updateData(updates)

    supabase.from('vinted_orders').update({ registered_in_vault: true }).in('id', idsToFlag)
    Object.entries(vtOrderPatches).forEach(([orderId, patch]) => {
      supabase.from('vinted_orders').update(patch).eq('id', orderId)
    })
    setVtOrders(prev => prev.map(o => {
      if (!idsToFlag.includes(o.id) && !vtOrderPatches[o.id]) return o
      return { ...o, ...(idsToFlag.includes(o.id) ? { registered_in_vault: true } : {}), ...(vtOrderPatches[o.id] || {}) }
    }))
  }, [vtOrders, sales, batches, updateData])

  const saveVtField = async (id, field, value) => {
    await supabase.from('vinted_orders').update({ [field]: value }).eq('id', id)
    setVtOrders(prev => prev.map(o => o.id === id ? { ...o, [field]: value } : o))
  }

  // Meerdere velden in 1 update — gebruikt bij het koppelen van een batch aan
  // een order (sku_ref + cost_price + batch_id horen samen weggeschreven te
  // worden, anders blijft cost_price op 0 staan terwijl sku_ref al wel klopt).
  const saveVtFields = async (id, patch) => {
    await supabase.from('vinted_orders').update(patch).eq('id', id)
    setVtOrders(prev => prev.map(o => o.id === id ? { ...o, ...patch } : o))
  }

  const openSaleModal = (row) => {
    setSaleModalPrefill({
      buyer:    row.buyer && row.buyer !== 'Onbekende koper' ? row.buyer : '',
      price:    row.price || '',
      date:     parseVintedDate(row.sale_date || row.synced_at?.split('T')[0] || ''),
      url:      row.item_url || '',
      notes:    row.transaction_id ? `Vinted #${row.transaction_id}` : '',
      _orderId: row.id,
    })
  }

  const handleSaleModalSave = async (sale) => {
    const updates = { sales: [...sales, sale] }
    if (sale.fromLive) {
      updates.batches = batches.map((b) =>
        b.id === sale.batchId ? { ...b, liveCount: Math.max(0, (b.liveCount || 0) - (sale.quantity || 1)) } : b
      )
    }
    updateData(updates)
    if (saleModalPrefill?._orderId) {
      await markRegisteredInSupabase(saleModalPrefill._orderId)
      setVtOrders(prev => prev.map(o => o.id === saleModalPrefill._orderId ? { ...o, registered_in_vault: true } : o))
    }
    setSaleModalPrefill(null)
  }

  const dismissVintedOrder = async (orderId) => {
    await markRegisteredInSupabase(orderId)
    setVtOrders(prev => prev.filter(o => o.id !== orderId))
  }

  // Registreert de verwijderde orders in ignored_orders VOORDAT de rij zelf
  // verdwijnt — anders zou een sync die toevallig net dan draait de order nog
  // vinden en opnieuw aanmaken (api/sync-order.js checkt deze tabel vóór elke
  // upsert, voor alle sync-paden).
  const deleteSelected = async () => {
    if (!window.confirm(`${selectedIds.size} order(s) definitief verwijderen?`)) return
    const ids = [...selectedIds]
    const toIgnore = vtOrders
      .filter(o => selectedIds.has(o.id) && o.owner_id && o.transaction_id)
      .map(o => ({ owner_id: o.owner_id, transaction_id: o.transaction_id }))
    if (toIgnore.length) await supabase.from('ignored_orders').upsert(toIgnore, { onConflict: 'owner_id,transaction_id' })
    await supabase.from('vinted_orders').delete().in('id', ids)
    setVtOrders(prev => prev.filter(o => !selectedIds.has(o.id)))
    setSelectedIds(new Set())
  }

  // Slaat de bulk-SKU-koppeling op. `assignments` is nu per order een array
  // van items (1 voor een los item, N voor een bundel — zie BulkSkuModal):
  // - sku_ref op het order-record wordt de kommagescheiden lijst van alle
  //   item-SKU's (bv. "RIA047, RIA048").
  // - cost_price = SOM van de COGS van elk gekoppeld item — geeft direct het
  //   juiste bundel-totaal in de bestaande BRUT/COGS/PROFIT/ROI-weergave
  //   (die gewoon price - cost_price blijft doen, geen wijziging daar nodig).
  // - batch_id wordt de kommagescheiden lijst van betrokken batch-id's
  //   (informatief; bij een bundel kunnen items uit verschillende batches
  //   komen, dus geen enkel ID kan hier "het" batch-id zijn).
  // - Voor Stats-integratie (die uitsluitend data.sales leest) wordt er per
  //   ITEM een aparte sales-entry aangemaakt, elk met batchId=dat item se
  //   eigen batch en salePrice = bundelprijs / aantal items — zo blijft het
  //   bestaande 1-sale-is-1-batch-item model kloppen en telt de som van de
  //   deelverkopen automatisch op tot het correcte bundel-totaal.
  const handleBulkSkuConfirm = async (assignments) => {
    const newSales = []
    const patches = {}
    for (const { orderId, items } of assignments) {
      const validItems = (items || []).filter(it => it.sku)
      if (!validItems.length) continue
      const order = vtOrders.find(o => o.id === orderId)
      const isBundle = validItems.length > 1

      const totalCogs = validItems.reduce((sum, it) => sum + (it.batch ? getBatchUnitCost(it.batch) : 0), 0)
      const anyBatch = validItems.some(it => it.batch)
      const batchIds = [...new Set(validItems.map(it => it.batch?.id).filter(Boolean))]

      const patch = {
        sku_ref: validItems.map(it => it.sku).join(', '),
        cost_price: anyBatch ? totalCogs : null,
        batch_id: batchIds.join(',') || null,
        registered_in_vault: anyBatch,
      }
      patches[orderId] = patch
      await supabase.from('vinted_orders').update(patch).eq('id', orderId)

      if (anyBatch && order) {
        let photo = order.photo_url || null
        try { photo = JSON.parse(order.photo_urls || '[]')[0] || photo } catch {}
        const perItemPrice = parseFloat(order.price || 0) / validItems.length
        for (const it of validItems) {
          if (!it.batch) continue
          newSales.push({
            id: genId(),
            vintedOrderId: order.id,
            batchId: it.batch.id,
            sku: it.sku,
            type: 'individual',
            quantity: 1,
            salePrice: perItemPrice,
            platform: 'Vinted',
            buyer: order.buyer_name || order.buyer || '',
            fees: 0,
            shippingCost: 0,
            notes: (order.transaction_id ? `Vinted #${order.transaction_id}` : '') + (isBundle ? ' (bundel-item)' : ''),
            date: order.sale_date || order.synced_at?.split('T')[0] || new Date().toISOString().split('T')[0],
            fromLive: false,
            photo,
            links: [],
            shipped: false,
            shippedDate: null,
            isFree: false,
            saleTime: null,
          })
        }
      }
    }
    if (newSales.length) {
      // Verwijder eventuele auto-registratie-entry (zie de vtOrders-effect
      // hierboven) voor deze orders vóórdat de nieuw-gesplitste bundel/SKU-
      // entries erbij komen — anders telt dezelfde order dubbel mee.
      const touchedOrderIds = new Set(Object.keys(patches))
      const remaining = sales.filter(s => !touchedOrderIds.has(s.vintedOrderId))
      updateData({ sales: [...remaining, ...newSales] })
    }
    setVtOrders(prev => prev.map(o => patches[o.id] ? { ...o, ...patches[o.id] } : o))
    setSelectedIds(new Set())
  }

  // Ontkoppelt de SKU-koppeling van 1 of meer orders: wist sku_ref/cost_price/
  // batch_id op het order-record (waardoor "SKU koppelen" weer verschijnt
  // i.p.v. de SKU-badge) en verwijdert de bijhorende sales-entries uit data.sales
  // zodat Stats niet dubbel telt. Sales-entries aangemaakt via de bulk-modal
  // dragen een vintedOrderId; oudere entries (voor die koppeling bestond) zijn
  // enkel te herkennen via de "Vinted #<id>"-notitie — beide paden worden
  // meegenomen.
  const unlinkSku = async (orderIds) => {
    const ids = Array.isArray(orderIds) ? orderIds : [orderIds]
    const patch = { sku_ref: null, cost_price: null, batch_id: null, registered_in_vault: false }
    await supabase.from('vinted_orders').update(patch).in('id', ids)
    setVtOrders(prev => prev.map(o => ids.includes(o.id) ? { ...o, ...patch } : o))

    const isLinkedToOrder = (sale) => ids.some(id =>
      sale.vintedOrderId === id || (sale.notes && sale.notes.startsWith(`Vinted #${id}`))
    )
    const remainingSales = sales.filter(s => !isLinkedToOrder(s))
    if (remainingSales.length !== sales.length) updateData({ sales: remainingSales })

    setSelectedIds(prev => {
      const next = new Set(prev)
      ids.forEach(id => next.delete(id))
      return next
    })
  }

  const addVintedOrder = async (row) => {
    const payload = {
      title:      row.title,
      price:      row.price,
      buyer_name: row.buyer_name || null,
      country:    row.country   || '',
      sale_date:  row.sale_date || null,
      photo_url:  row.photo_url || null,
      sku_ref:    row.sku_ref   || null,
      status:     row.status    || 'Handmatig',
      synced_at:  row.synced_at,
    }
    const { data: inserted, error } = await supabase
      .from('vinted_orders').insert([payload]).select().single()
    const newRow = error ? { ...payload, id: `manual-${Date.now()}` } : inserted
    setVtOrders(prev => [newRow, ...prev])
  }

  const platforms = useMemo(() => {
    const set = new Set(sales.map((s) => normalizePlatform(s.platform)).filter(Boolean))
    try {
      const custom = JSON.parse(localStorage.getItem('vault-platforms') || '[]')
      custom.forEach(p => p.name && set.add(p.name))
    } catch {}
    return [...set].sort()
  }, [sales])

  const months = useMemo(() => {
    const set = new Set(sales.map((s) => s.date?.substring(0, 7)).filter(Boolean))
    return [...set].sort().reverse()
  }, [sales])

  const enriched = useMemo(() => {
    return [...sales]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map((sale) => {
        const batch = batches.find((b) => b.id === sale.batchId)
        const sup = suppliers.find((s) => batch && s.prefix === batch.supplierPrefix)
        const profit = batch ? calcSaleProfit(sale, batch) : null
        // Concrete SKU van deze verkoop tonen (bv. "RIA049"), niet de volledige
        // batch-range ("RIA049-149") — die range is puur de nummering van de
        // hele inkoop-batch en komt toevallig overeen voor élke verkoop uit
        // diezelfde batch, wat een bundel (5 items, 5 losse sales-regels) laat
        // lijken op 5x dezelfde SKU. sale.sku (nieuwe verkopen, zie
        // handleBulkSkuConfirm) is de precieze bron; voor oudere sales zonder
        // dat veld valt dit terug op de sku_ref van de gekoppelde Vinted-order
        // (die wél de echte, specifieke SKU('s) bevat), en pas als laatste
        // terugval op de batch-range (bv. volledig handmatige verkopen).
        const vtOrder = sale.vintedOrderId ? vtOrders.find(o => o.id === sale.vintedOrderId) : null
        const sku = sale.sku || vtOrder?.sku_ref
          || (batch ? formatSkuRange(batch.supplierPrefix, batch.startNum, batch.endNum) : '?')
        const photo = sale.photo || batch?.photos?.[0] || batch?.photo || null
        const platformDisplay = normalizePlatform(sale.platform)
        return { ...sale, batch, sup, profit, sku, photo, platformDisplay }
      })
  }, [sales, batches, suppliers, vtOrders])

  const filtered = useMemo(() => {
    return enriched.filter((s) => {
      if (filterPlatform !== 'all' && s.platformDisplay !== filterPlatform) return false
      if (filterMonth !== 'all' && !s.date?.startsWith(filterMonth)) return false
      if (dayFilterActive && s.date !== dayFilterActive) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          s.sku.toLowerCase().includes(q) ||
          (s.buyer || '').toLowerCase().includes(q) ||
          (s.notes || '').toLowerCase().includes(q) ||
          s.platformDisplay.toLowerCase().includes(q) ||
          (s.batch?.name || '').toLowerCase().includes(q) ||
          (s.batch?.brand || '').toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [enriched, filterPlatform, filterMonth, dayFilterActive, search])

  const totals = useMemo(() => filtered.reduce((acc, s) => ({
    revenue: acc.revenue + (s.isFree ? 0 : (s.salePrice || 0) * (s.quantity || 1)),
    profit: acc.profit + (s.profit?.profit || 0),
    count: acc.count + (s.quantity || 1),
  }), { revenue: 0, profit: 0, count: 0 }), [filtered])

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Verkopen</h1>
          <div className="page-subtitle">{sales.length} verkopen geregistreerd</div>
        </div>
      </div>

      <div className="filters">
        <input
          className="search-input"
          placeholder="Zoek SKU, koper, product…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="filter-select" value={filterPlatform} onChange={(e) => setFilterPlatform(e.target.value)}>
          <option value="all">Alle platforms</option>
          {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="filter-select" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}>
          <option value="all">Alle maanden</option>
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        {dayFilterActive && (
          <span className="filter-chip active" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'default' }}>
            📅 {formatDateLong(dayFilterActive)}
            <button
              onClick={() => setDayFilterActive(null)}
              title="Dag-filter wissen"
              style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontWeight: 700, fontSize: 13, lineHeight: 1, fontFamily: 'inherit' }}
            >×</button>
          </span>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-3)', padding: '0 4px' }}>
          {filtered.length} verkopen
        </span>
      </div>

      {/* ── Vinted Orders ── */}
      {(() => {
        const allVisibleVtOrders = vtOrders.filter(o =>
          !/geannuleerd|cancel/i.test(o.status || '') &&
          (o.order_direction === 'sale' || !o.order_direction)
        )
        // Statustabs: laten in 1 oogopslag zien welke actie nog nodig is per
        // order. Gebruikt dezelfde classifyOrderStage() als de Home-dashboard-
        // statuskaarten (Te verzenden/Onderweg/Bij afhaalpunt), zodat de
        // tellingen hier nooit kunnen afwijken van die kaarten.
        const STAGE_TABS = [
          { value: 'all',            label: 'Alle' },
          { value: 'to_ship',        label: 'Te verzenden' },
          { value: 'in_transit',     label: 'Onderweg' },
          { value: 'at_pickup_point',label: 'Bij afhaalpunt' },
          { value: 'finished',       label: 'Geleverd' },
        ]
        const stageCounts = allVisibleVtOrders.reduce((acc, o) => {
          const stage = classifyOrderStage(o)
          acc[stage] = (acc[stage] || 0) + 1
          return acc
        }, {})
        const visibleVtOrders = stageFilter === 'all'
          ? allVisibleVtOrders
          : allVisibleVtOrders.filter(o => classifyOrderStage(o) === stageFilter)
        const toggleId = (id, on) => setSelectedIds(prev => {
          const next = new Set(prev)
          on ? next.add(id) : next.delete(id)
          return next
        })
        return (
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Vinted Orders</h2>
              {!vtLoading && (
                <span style={{ fontSize: 12, color: 'var(--text-3)', background: 'var(--bg-2)', padding: '1px 8px', borderRadius: 20 }}>
                  {visibleVtOrders.length}
                </span>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 12, padding: '4px 12px' }}
                  onClick={() => window.open('https://www.vinted.be/my_orders', '_blank')}
                >🔗 Open Vinted</button>
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 12, padding: '4px 12px' }}
                  onClick={() => setAddOrderOpen(true)}
                >+ Toevoegen</button>
              </div>
            </div>

            {!vtLoading && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                {STAGE_TABS.map(tab => {
                  const count = tab.value === 'all' ? allVisibleVtOrders.length : (stageCounts[tab.value] || 0)
                  const active = stageFilter === tab.value
                  return (
                    <button
                      key={tab.value}
                      onClick={() => setStageFilter(tab.value)}
                      style={{
                        fontSize: 12, padding: '5px 12px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                        border: `1px solid ${active ? 'var(--green)' : 'var(--border)'}`,
                        background: active ? 'rgba(0,230,118,0.12)' : 'var(--bg-2)',
                        color: active ? 'var(--green)' : 'var(--text-2)',
                      }}
                    >{tab.label} ({count})</button>
                  )
                })}
              </div>
            )}

            {/* Bulk controls */}
            {!vtLoading && !vtError && visibleVtOrders.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <button
                  onClick={() => setSelectedIds(new Set(visibleVtOrders.map(o => o.id)))}
                  style={{ fontSize: 11, padding: '2px 10px', borderRadius: 5, cursor: 'pointer', background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text-2)', fontFamily: 'inherit' }}
                >☑ Alles</button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  style={{ fontSize: 11, padding: '2px 10px', borderRadius: 5, cursor: 'pointer', background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text-2)', fontFamily: 'inherit' }}
                >☐ Geen</button>
                {selectedIds.size > 0 && (
                  <button
                    onClick={() => setBulkSkuOpen(true)}
                    style={{ fontSize: 11, padding: '2px 10px', borderRadius: 5, cursor: 'pointer', background: 'rgba(129,140,248,0.12)', border: '1px solid rgba(129,140,248,0.3)', color: '#818cf8', fontFamily: 'inherit', fontWeight: 600 }}
                  >🏷 SKU koppelen ({selectedIds.size})</button>
                )}
                {(() => {
                  const selectedLinked = visibleVtOrders.filter(o =>
                    selectedIds.has(o.id) && (o.sku_ref || o.cost_price != null || o.batch_id)
                  )
                  return selectedLinked.length > 0 && (
                    <button
                      onClick={() => unlinkSku(selectedLinked.map(o => o.id))}
                      style={{ fontSize: 11, padding: '2px 10px', borderRadius: 5, cursor: 'pointer', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171', fontFamily: 'inherit', fontWeight: 600 }}
                    >✕ Ontkoppel geselecteerde ({selectedLinked.length})</button>
                  )
                })()}
                {selectedIds.size > 0 && (
                  <button
                    onClick={deleteSelected}
                    style={{ fontSize: 11, padding: '2px 10px', borderRadius: 5, cursor: 'pointer', background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', fontFamily: 'inherit', fontWeight: 600 }}
                  >🗑 Verwijder geselecteerde ({selectedIds.size})</button>
                )}
              </div>
            )}

            {vtLoading ? (
              <div style={{ padding: 20, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
                Laden…
              </div>
            ) : vtError ? (
              <div style={{ padding: 16, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--red)', fontSize: 13 }}>
                Fout: {vtError}
              </div>
            ) : visibleVtOrders.length === 0 ? (
              <div style={{ padding: 24, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
                {allVisibleVtOrders.length === 0
                  ? 'Nog geen orders gesynchroniseerd via de Chrome extensie.'
                  : 'Geen orders in deze status.'}
              </div>
            ) : (
              <div>
                {visibleVtOrders.map((order) => (
                  <VintedOrderRow
                    key={order.id}
                    order={order}
                    onSave={saveVtField}
                    onSaveFields={saveVtFields}
                    onBulkConfirm={handleBulkSkuConfirm}
                    onDismiss={() => dismissVintedOrder(order.id)}
                    onPhotoClick={setPhotoPopup}
                    onDetail={() => setOrderDetail(order)}
                    onRegister={() => openSaleModal(order)}
                    onUnlinkSku={unlinkSku}
                    batches={batches}
                    allOrders={vtOrders}
                    checked={selectedIds.has(order.id)}
                    onCheck={on => toggleId(order.id, on)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })()}

      {filtered.length > 0 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            { label: 'Omzet', value: formatCurrency(totals.revenue), color: 'var(--text)' },
            { label: 'Winst', value: formatCurrency(totals.profit), color: totals.profit >= 0 ? 'var(--green)' : 'var(--red)' },
            { label: 'Items verkocht', value: totals.count, color: 'var(--blue)' },
          ].map((s) => (
            <div key={s.label} className="card-sm" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{s.label}</span>
              <span style={{ fontWeight: 700, color: s.color }}>{s.value}</span>
            </div>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">💰</div>
          <h3>Geen verkopen gevonden</h3>
          <p>Pas de filters aan of registreer een verkoop via het dashboard.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="sales-table-wrap table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>SKU / Product</th>
                  <th>Platform</th>
                  <th>Prijs</th>
                  <th>Winst</th>
                  <th>Verzonden</th>
                  <th style={{ width: 80 }} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} style={{ cursor: 'pointer' }} onClick={() => setEditSale(s)}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12, color: 'var(--text-2)' }}>
                      {formatDateLong(s.date)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {s.photo && (
                          <img
                            src={s.photo} alt=""
                            style={{ width: 30, height: 30, borderRadius: 6, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border)' }}
                          />
                        )}
                        <div>
                          <span
                            className="sku-tag"
                            style={{ background: (s.sup?.color || '#666') + '14', color: s.sup?.color || '#666' }}
                          >
                            {s.sku}
                          </span>
                          {s.quantity > 1 && (
                            <span style={{ marginLeft: 4, fontSize: 11, color: 'var(--text-3)' }}>×{s.quantity}</span>
                          )}
                          {s.isFree && (
                            <span style={{ marginLeft: 5, fontSize: 10, color: 'var(--green)', fontWeight: 700 }}>GRATIS</span>
                          )}
                          {(s.batch?.name || s.batch?.brand) && (
                            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                              {s.batch.brand || s.batch.name}
                            </div>
                          )}
                          {s.buyer && (
                            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{s.buyer}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{short(s.platformDisplay)}</span>
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {s.isFree
                        ? <span style={{ color: 'var(--text-3)', fontSize: 12 }}>Gratis</span>
                        : formatCurrency((s.salePrice || 0) * (s.quantity || 1))}
                    </td>
                    <td>
                      {s.profit ? (
                        <span style={{ fontWeight: 600, color: s.profit.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {s.profit.profit >= 0 ? '+' : ''}{formatCurrency(s.profit.profit)}
                        </span>
                      ) : '—'}
                    </td>
                    <td>
                      {s.shipped
                        ? <span style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 600 }}>✓ {s.shippedDate ? formatDateLong(s.shippedDate) : 'ja'}</span>
                        : <span style={{ fontSize: 11, color: 'var(--text-3)' }}>—</span>}
                    </td>
                    <td style={{ padding: '6px 10px' }} onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn btn-ghost btn-sm btn-icon"
                          onClick={() => setEditSale(s)}
                          title="Bewerk verkoop"
                          style={{ fontSize: 13 }}
                        >
                          ✏️
                        </button>
                        <button
                          className="btn btn-danger btn-sm btn-icon"
                          onClick={() => setConfirmDeleteId(s.id)}
                          title="Verwijder verkoop"
                          style={{ fontSize: 13 }}
                        >
                          🗑
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sales-cards-mobile">
            {filtered.map((s) => (
              <div key={s.id} className="sale-card-mobile" style={{ cursor: 'pointer' }} onClick={() => setEditSale(s)}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  {s.photo ? (
                    <img src={s.photo} alt="" style={{ width: 42, height: 42, borderRadius: 8, objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border)' }} />
                  ) : (
                    <div style={{ width: 42, height: 42, borderRadius: 8, background: (s.sup?.color || '#666') + '14', border: `1px solid ${(s.sup?.color || '#666')}25`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 16 }}>
                      🏷
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span className="sku-tag" style={{ background: (s.sup?.color || '#666') + '14', color: s.sup?.color || '#666' }}>
                        {s.sku}
                      </span>
                      {s.quantity > 1 && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>×{s.quantity}</span>}
                      <span style={{ fontSize: 11, background: 'var(--bg-2)', padding: '2px 6px', borderRadius: 5, color: 'var(--text-2)' }}>
                        {short(s.platformDisplay)}
                      </span>
                      {s.isFree && <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 700 }}>GRATIS</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>
                      {formatDateLong(s.date)}
                      {s.buyer && ` · ${s.buyer}`}
                      {s.shipped && <span style={{ color: 'var(--blue)', marginLeft: 6 }}>✓ verzonden</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    {s.isFree ? (
                      <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Gratis</div>
                    ) : (
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{formatCurrency((s.salePrice || 0) * (s.quantity || 1))}</div>
                    )}
                    {s.profit && (
                      <div style={{ fontSize: 11, color: s.profit.profit >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                        {s.profit.profit >= 0 ? '+' : ''}{formatCurrency(s.profit.profit)}
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setEditSale(s)}
                    style={{ fontSize: 11 }}
                  >
                    ✏️ Bewerk
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => setConfirmDeleteId(s.id)}
                    style={{ fontSize: 11 }}
                  >
                    🗑 Verwijder
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {addOrderOpen && (
        <AddOrderModal onClose={() => setAddOrderOpen(false)} onSave={addVintedOrder} />
      )}

      {bulkSkuOpen && (
        <BulkSkuModal
          batches={batches}
          allOrders={vtOrders}
          orders={vtOrders.filter(o => selectedIds.has(o.id))}
          onClose={() => setBulkSkuOpen(false)}
          onConfirm={handleBulkSkuConfirm}
        />
      )}

      {photoPopup && (
        <PhotoPopup urls={photoPopup} onClose={() => setPhotoPopup(null)} />
      )}

      {orderDetail && (
        <OrderDetailModal
          order={orderDetail}
          onClose={() => setOrderDetail(null)}
          vintedCookie={vintedCookie}
          onPhotoClick={(urls) => { setOrderDetail(null); setPhotoPopup(urls) }}
          onSave={saveVtField}
          onSaveFields={saveVtFields}
          onUnlinkSku={id => { unlinkSku(id); setOrderDetail(null) }}
        />
      )}

      {editSale && (
        <EditSaleModal
          data={data}
          sale={editSale}
          onClose={() => setEditSale(null)}
          onSave={(updated) => { onUpdateSale(updated); setEditSale(null) }}
        />
      )}

      {saleModalPrefill && (
        <SaleModal
          data={data}
          prefill={saleModalPrefill}
          onClose={() => setSaleModalPrefill(null)}
          onSave={handleSaleModalSave}
        />
      )}

      {confirmDeleteId && (
        <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && setConfirmDeleteId(null)}>
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h2>Verkoop verwijderen?</h2>
              <button className="modal-close" onClick={() => setConfirmDeleteId(null)}>×</button>
            </div>
            <p style={{ color: 'var(--text-2)', fontSize: 14, lineHeight: 1.7 }}>
              De verkoop wordt permanent verwijderd en het item gaat terug naar voorraad.
            </p>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmDeleteId(null)}>Annuleer</button>
              <button
                className="btn btn-danger"
                onClick={() => { onDeleteSale(confirmDeleteId); setConfirmDeleteId(null) }}
              >
                Definitief verwijderen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
