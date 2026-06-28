import { useMemo, useState, useEffect } from 'react'
import {
  formatCurrency, formatDate, formatSkuRange, calcSaleProfit, normalizePlatform,
} from '../utils/skuUtils'
import SaleModal from '../components/SaleModal'
import EditSaleModal from '../components/EditSaleModal'
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
    .order('synced_at', { ascending: false })
  if (error) { console.warn('[Vault] Supabase fetch error:', error); return [] }
  return data || []
}

async function markRegisteredInSupabase(orderId) {
  await supabase
    .from('vinted_orders')
    .update({ registered_in_vault: true })
    .eq('id', orderId)
}

const COUNTRY_FLAGS = { BE:'🇧🇪',NL:'🇳🇱',FR:'🇫🇷',DE:'🇩🇪',ES:'🇪🇸',IT:'🇮🇹',PL:'🇵🇱',CZ:'🇨🇿',PT:'🇵🇹',SE:'🇸🇪',FI:'🇫🇮',LT:'🇱🇹',LV:'🇱🇻',EE:'🇪🇪' }

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
  // Bestaand SKU-patroon: 2-4 hoofdletters + 3-6 cijfers — zoek ook in beschrijving
  const existing = combined.match(/\b([A-Z]{2,4}\d{3,6})\b/)
  if (existing) return existing[1]

  const t = combined.toLowerCase()
  let brand = '', color = '', size = ''

  for (const [name, code] of BRANDS_MAP) {
    if (t.includes(name)) { brand = code; break }
  }
  for (const [name, code] of COLORS_MAP) {
    if (t.includes(name)) { color = code; break }
  }
  for (const s of SIZES) {
    const re = new RegExp(`(?:^|\\s|maat\\s*)${s}(?:\\s|$|/)`, 'i')
    if (re.test(t)) { size = s.toUpperCase().replace(' ', ''); break }
  }

  const parts = [brand, color, size].filter(Boolean)
  return parts.length >= 2 ? parts.join('-') : parts[0] || ''
}

// ── Status badge ───────────────────────────────────────────────────────────
function getStatusBadge(status, labelAvailable) {
  const s = (status || '').toLowerCase()
  if (labelAvailable || s.includes('verzendlabel'))
    return { label: 'Label gereed', color: '#d97706', bg: 'rgba(245,158,11,0.12)' }
  if (s.includes('geleverd') || s.includes('delivered') || s.includes('ontvangen'))
    return { label: 'Geleverd', color: '#16a34a', bg: 'rgba(22,163,74,0.1)' }
  if (s.includes('verzond') || s.includes('shipped') || s.includes('transit') || s.includes('onderweg'))
    return { label: 'Onderweg', color: '#2563eb', bg: 'rgba(37,99,235,0.1)' }
  if (s.includes('complet') || s.includes('voltooid') || s.includes('closed') || s.includes('afgerond'))
    return { label: 'Voltooid', color: '#16a34a', bg: 'rgba(22,163,74,0.1)' }
  if (s.includes('cancel') || s.includes('geannul'))
    return { label: 'Geannuleerd', color: '#dc2626', bg: 'rgba(220,38,38,0.1)' }
  if (status) return { label: status.length > 36 ? status.slice(0, 36) + '…' : status, color: '#6b7280', bg: 'rgba(107,114,128,0.08)' }
  return null
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
function OrderDetailModal({ order, onClose, vintedCookie, onPhotoClick }) {
  const [downloading, setDownloading] = useState(false)
  const [downloaded, setDownloaded]   = useState(false)

  const badge     = getStatusBadge(order.status, order.label_available)
  const flag      = COUNTRY_FLAGS[order.country] || ''
  const date      = order.sale_date || order.synced_at?.split('T')[0] || ''
  const profit    = order.cost_price != null ? (Number(order.price) - Number(order.cost_price)) : null
  const fmtE      = v => `€${Number(v).toFixed(2).replace('.', ',')}`

  const photoUrls = (() => { try { return JSON.parse(order.photo_urls || '[]') } catch { return [] } })()
  const allPhotos = photoUrls.length ? photoUrls : (order.photo_url ? [order.photo_url] : [])
  const mainPhoto = allPhotos[0] || null

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

  useEffect(() => {
    const close = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  return (
    <div
      className="modal-overlay"
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <div className="modal" style={{ maxWidth: 500, padding: 0, overflow: 'hidden' }}>
        {/* Foto header */}
        {mainPhoto && (
          <div
            onClick={() => onPhotoClick(allPhotos)}
            style={{ position: 'relative', width: '100%', height: 220, cursor: 'zoom-in', background: 'var(--bg-2)', overflow: 'hidden' }}
          >
            <img
              src={mainPhoto} alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            {allPhotos.length > 1 && (
              <span style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 11, padding: '3px 10px', borderRadius: 20 }}>
                {allPhotos.length} foto's
              </span>
            )}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 60%, rgba(0,0,0,0.5))', pointerEvents: 'none' }} />
            <button
              onClick={e => { e.stopPropagation(); onClose() }}
              style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}
            >×</button>
          </div>
        )}

        <div style={{ padding: 24 }}>
          {/* Header close als geen foto */}
          {!mainPhoto && (
            <div className="modal-header" style={{ marginBottom: 16 }}>
              <h2 style={{ fontSize: 16 }}>Order details</h2>
              <button className="modal-close" onClick={onClose}>×</button>
            </div>
          )}

          {/* Titel */}
          <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3, marginBottom: 14 }}>{order.title}</div>

          {/* Meta grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', marginBottom: 16 }}>
            {[
              ['Koper', order.buyer_name
                ? `${order.buyer_name}${order.buyer ? ` (@${order.buyer})` : ''}`
                : order.buyer ? `@${order.buyer}` : '—'],
              ['Land', order.country ? `${flag} ${order.country}` : '—'],
              ['Datum', date || '—'],
              ['Verkoopprijs', order.price > 0 ? fmtE(order.price) : '—'],
              ['Inkoopprijs', order.cost_price != null ? fmtE(order.cost_price) : '—'],
              profit != null ? ['Winst', fmtE(profit)] : null,
              order.sku_ref ? ['SKU', order.sku_ref] : null,
              order.shipping_method ? ['Verzendmethode', order.shipping_method] : null,
              order.tracking_code ? ['Tracking', order.tracking_code] : null,
            ].filter(Boolean).map(([label, val]) => (
              <div key={label}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }}>{label}</div>
                <div style={{
                  fontSize: 13, fontWeight: 600,
                  color: label === 'Winst' ? (profit >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text)',
                  fontFamily: label === 'Tracking' ? 'monospace' : 'inherit',
                  wordBreak: 'break-all',
                }}>{val}</div>
              </div>
            ))}
          </div>

          {/* Beschrijving */}
          {order.description && (
            <div style={{ marginBottom: 16, padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>Beschrijving</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6, maxHeight: 100, overflowY: 'auto', whiteSpace: 'pre-line' }}>{order.description}</div>
            </div>
          )}

          {/* Status badge */}
          {badge && (
            <div style={{ marginBottom: 16 }}>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 10, background: badge.bg, color: badge.color }}>
                {badge.label}
              </span>
            </div>
          )}

          {/* Acties */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(order.label_url || order.transaction_id) && (
              <button
                className={`btn ${downloaded ? 'btn-secondary' : 'btn-primary'}`}
                onClick={downloadLabel}
                disabled={downloading}
                style={{ flex: 1 }}
              >
                {downloading ? '⏳ Ophalen…' : downloaded ? '✓ Label gedownload' : '⬇ Download label 4×6'}
              </button>
            )}
            {order.item_url && (
              <a
                href={order.item_url} target="_blank" rel="noreferrer"
                className="btn btn-secondary"
                style={{ flex: 1, textAlign: 'center', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                Bekijk op Vinted ↗
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── SKU koppel modal ───────────────────────────────────────────────────────
function SkuPickerModal({ batches, onPick, onClose }) {
  const [q, setQ] = useState('')

  const items = useMemo(() => {
    const lower = q.toLowerCase()
    return batches
      .filter(b => {
        if (!lower) return true
        const sku = formatSkuRange(b.supplierPrefix, b.startNum, b.endNum)
        return (
          sku.toLowerCase().includes(lower) ||
          (b.name || '').toLowerCase().includes(lower) ||
          (b.brand || '').toLowerCase().includes(lower)
        )
      })
      .sort((a, b) => (b.liveCount || 0) - (a.liveCount || 0))
  }, [batches, q])

  useEffect(() => {
    const close = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  return (
    <div className="modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 420, padding: 0, overflow: 'hidden', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>Koppel SKU</h2>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Zoek SKU, naam, merk…"
            style={{ width: '100%', padding: '8px 12px', background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#f1f5f9', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {items.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>Geen batches gevonden</div>
          ) : items.map(b => {
            const sku = formatSkuRange(b.supplierPrefix, b.startNum, b.endNum)
            const available = b.liveCount ?? b.quantity ?? 0
            return (
              <div
                key={b.id}
                onClick={() => { onPick(sku); onClose() }}
                style={{ padding: '10px 20px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                onMouseEnter={e => e.currentTarget.style.background = '#1e293b'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div>
                  <span style={{ fontWeight: 700, fontSize: 13, color: '#818cf8', fontFamily: 'monospace' }}>{sku}</span>
                  {(b.name || b.brand) && (
                    <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 10 }}>{b.brand || b.name}</span>
                  )}
                </div>
                <span style={{ fontSize: 11, color: available > 0 ? '#4ade80' : '#64748b', fontWeight: 600 }}>
                  {available > 0 ? `${available} beschikbaar` : 'uitverkocht'}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Order rij (Vinteer-stijl) ──────────────────────────────────────────────
function VintedOrderRow({ order, isLast, onSave, onRegister, onDismiss, onPhotoClick, onDetail, vintedCookie, batches }) {
  const [downloading,   setDownloading]   = useState(false)
  const [downloaded,    setDownloaded]    = useState(false)
  const [skuPickerOpen, setSkuPickerOpen] = useState(false)

  const badge     = getStatusBadge(order.status, order.label_available)
  const flag      = COUNTRY_FLAGS[order.country] || ''
  const date      = order.sale_date || order.synced_at?.split('T')[0] || ''
  const suggested = !order.sku_ref ? suggestSku(order.title, order.description) : ''
  const price     = parseFloat(order.price) || 0
  const profit    = order.cost_price != null ? price - parseFloat(order.cost_price) : null
  const fmtP      = v => Number(v) > 0 ? `€${Number(v).toFixed(2).replace('.', ',')}` : '—'
  const buyer     = order.buyer_name || order.buyer || ''
  const itemUrl   = order.item_url || (order.transaction_id ? `https://www.vinted.be/items/${order.transaction_id}` : null)

  const photoUrls = (() => { try { return JSON.parse(order.photo_urls || '[]') } catch { return [] } })()
  const allPhotos = photoUrls.length ? photoUrls : (order.photo_url ? [order.photo_url] : [])

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

  const downloadLabel = async (e) => {
    e.stopPropagation()
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
    } catch (err) {
      alert(`Label download mislukt: ${err.message}`)
    } finally {
      setDownloading(false)
    }
  }

  const aBtn = (extra) => ({
    fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, border: 'none', ...extra,
  })

  return (
    <>
      <div style={{
        padding: '16px',
        borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.06)',
        display: 'grid',
        gridTemplateColumns: '72px 1fr auto',
        gap: 14,
        alignItems: 'start',
      }}>

        {/* Foto */}
        <div
          onClick={() => allPhotos.length && onPhotoClick(allPhotos)}
          style={{ cursor: allPhotos.length ? 'zoom-in' : 'default' }}
        >
          {allPhotos.length ? (
            <div style={{ position: 'relative' }}>
              <img
                src={allPhotos[0]} alt=""
                style={{ width: 72, height: 72, borderRadius: 8, objectFit: 'cover', display: 'block' }}
              />
              {allPhotos.length > 1 && (
                <span style={{ position: 'absolute', bottom: 3, right: 3, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 9, borderRadius: 4, padding: '1px 5px', lineHeight: 1.5 }}>
                  {allPhotos.length}
                </span>
              )}
            </div>
          ) : (
            <div style={{ width: 72, height: 72, borderRadius: 8, background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>📦</div>
          )}
        </div>

        {/* Midden: info + acties */}
        <div style={{ minWidth: 0 }}>
          {itemUrl ? (
            <a
              href={itemUrl} target="_blank" rel="noreferrer"
              style={{ fontWeight: 700, fontSize: 14, color: '#4ade80', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: meta ? 3 : 6, lineHeight: 1.3, textDecoration: 'none' }}
            >
              {order.title}
            </a>
          ) : (
            <div style={{ fontWeight: 700, fontSize: 14, color: '#4ade80', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: meta ? 3 : 6, lineHeight: 1.3 }}>
              {order.title}
            </div>
          )}
          {meta && (
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 5, textTransform: 'capitalize' }}>{meta}</div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 3 }}>
            {buyer && <span style={{ fontSize: 12, color: '#cbd5e1' }}>@{buyer}</span>}
            {order.country && (
              <span style={{ fontSize: 10, background: '#1e293b', color: '#94a3b8', padding: '2px 7px', borderRadius: 5, fontWeight: 600, letterSpacing: '0.3px' }}>
                {flag} {order.country}
              </span>
            )}
          </div>
          {date && <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>{date}</div>}

          {/* Actie knoppen */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
            {(order.label_url || order.transaction_id) && (
              <button
                onClick={downloadLabel}
                disabled={downloading}
                style={aBtn({ background: downloaded ? 'rgba(74,222,128,0.1)' : 'rgba(251,191,36,0.12)', color: downloaded ? '#4ade80' : '#fbbf24', outline: '1px solid ' + (downloaded ? 'rgba(74,222,128,0.3)' : 'rgba(251,191,36,0.3)') })}
              >
                {downloading ? '⏳' : downloaded ? '✓ Label' : '↓ Label'}
              </button>
            )}
            {order.registered_in_vault ? (
              <span style={{ fontSize: 11, color: '#4ade80', fontWeight: 600 }}>✓ Geregistreerd</span>
            ) : (
              <button onClick={onRegister} style={aBtn({ background: 'rgba(74,222,128,0.1)', color: '#4ade80', outline: '1px solid rgba(74,222,128,0.25)' })}>
                + Registreer
              </button>
            )}
            <button
              onClick={() => setSkuPickerOpen(true)}
              style={aBtn({ background: 'rgba(129,140,248,0.1)', color: '#818cf8', outline: '1px solid rgba(129,140,248,0.25)' })}
            >
              Koppel SKU
            </button>
            <button
              onClick={onDetail}
              title="Details"
              style={aBtn({ background: 'rgba(148,163,184,0.08)', color: '#64748b', outline: '1px solid rgba(148,163,184,0.15)', padding: '4px 7px' })}
            >
              ⓘ
            </button>
            <button
              onClick={onDismiss}
              title="Verwijder uit lijst"
              style={{ fontSize: 14, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(248,113,113,0.08)', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Rechter kolom: status + prijs + financieel */}
        <div style={{ textAlign: 'right', minWidth: 112 }}>
          {badge && (
            <div style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: badge.bg, color: badge.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {badge.label}
              </span>
            </div>
          )}
          <div style={{ fontSize: 20, fontWeight: 800, color: '#f1f5f9', marginBottom: 8, lineHeight: 1 }}>
            {fmtP(price)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
            <InlineInput
              value={order.cost_price != null ? String(order.cost_price) : ''}
              onSave={v => onSave(order.id, 'cost_price', v ? parseFloat(v) : null)}
              placeholder="Inkoop €" prefix="€" width={78} type="number"
            />
          </div>
          {profit != null && (
            <div style={{ fontSize: 12, fontWeight: 700, color: profit >= 0 ? '#4ade80' : '#f87171', marginBottom: 6 }}>
              Winst {profit >= 0 ? '+' : ''}{fmtP(Math.abs(profit))}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, marginTop: 2 }}>
            <InlineInput
              value={order.sku_ref || ''}
              onSave={v => onSave(order.id, 'sku_ref', v || null)}
              placeholder="SKU" width={86}
            />
            {suggested && (
              <button
                onClick={() => onSave(order.id, 'sku_ref', suggested)}
                style={{ fontSize: 10, color: '#818cf8', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', textAlign: 'right', fontFamily: 'inherit' }}
                title={`Stel in als SKU: ${suggested}`}
              >
                ✦ {suggested}
              </button>
            )}
          </div>
        </div>
      </div>

      {skuPickerOpen && (
        <SkuPickerModal
          batches={batches}
          onPick={sku => onSave(order.id, 'sku_ref', sku)}
          onClose={() => setSkuPickerOpen(false)}
        />
      )}
    </>
  )
}

export default function Verkopen({ data, onDeleteSale, onUpdateSale, updateData, vintedCookie }) {
  const { batches, sales, suppliers } = data

  const [search, setSearch] = useState('')
  const [filterPlatform, setFilterPlatform] = useState('all')
  const [filterMonth, setFilterMonth] = useState('all')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [editSale, setEditSale] = useState(null)

  // ── Vinted Orders state ────────────────────────────────────────────────
  const [vtOrders, setVtOrders]   = useState([])
  const [vtLoading, setVtLoading] = useState(true)
  const [vtError, setVtError]     = useState(null)
  const [saleModalPrefill, setSaleModalPrefill] = useState(null)
  const [photoPopup, setPhotoPopup]   = useState(null)   // string[] | null
  const [orderDetail, setOrderDetail] = useState(null)   // row | null

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

  const saveVtField = async (id, field, value) => {
    await supabase.from('vinted_orders').update({ [field]: value }).eq('id', id)
    setVtOrders(prev => prev.map(o => o.id === id ? { ...o, [field]: value } : o))
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

  const platforms = useMemo(() => {
    const set = new Set(sales.map((s) => normalizePlatform(s.platform)).filter(Boolean))
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
        const sku = batch ? formatSkuRange(batch.supplierPrefix, batch.startNum, batch.endNum) : '?'
        const photo = sale.photo || batch?.photos?.[0] || batch?.photo || null
        const platformDisplay = normalizePlatform(sale.platform)
        return { ...sale, batch, sup, profit, sku, photo, platformDisplay }
      })
  }, [sales, batches, suppliers])

  const filtered = useMemo(() => {
    return enriched.filter((s) => {
      if (filterPlatform !== 'all' && s.platformDisplay !== filterPlatform) return false
      if (filterMonth !== 'all' && !s.date?.startsWith(filterMonth)) return false
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
  }, [enriched, filterPlatform, filterMonth, search])

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

      {/* ── Vinted Orders ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Vinted Orders</h2>
          {!vtLoading && (
            <span style={{ fontSize: 12, color: 'var(--text-3)', background: 'var(--bg-2)', padding: '1px 8px', borderRadius: 20 }}>
              {vtOrders.filter(o => !/geannuleerd|cancel/i.test(o.status || '')).length}
            </span>
          )}
        </div>
        {vtLoading ? (
          <div style={{ padding: 20, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
            Laden…
          </div>
        ) : vtError ? (
          <div style={{ padding: 16, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--red)', fontSize: 13 }}>
            Fout: {vtError}
          </div>
        ) : vtOrders.length === 0 ? (
          <div style={{ padding: 24, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
            Nog geen orders gesynchroniseerd via de Chrome extensie.
          </div>
        ) : (
          <div style={{
            background: '#0f172a',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12,
            overflow: 'hidden',
            '--bg': '#1e293b',
            '--bg-2': '#0f172a',
            '--bg-3': '#1e293b',
            '--border': 'rgba(255,255,255,0.1)',
            '--text': '#f1f5f9',
            '--text-2': '#cbd5e1',
            '--text-3': '#94a3b8',
          }}>
            {vtOrders.filter(o => !/geannuleerd|cancel/i.test(o.status || '')).map((order, i, arr) => (
              <VintedOrderRow
                key={order.id}
                order={order}
                isLast={i === arr.length - 1}
                onSave={saveVtField}
                onRegister={() => openSaleModal(order)}
                onDismiss={() => dismissVintedOrder(order.id)}
                onPhotoClick={setPhotoPopup}
                onDetail={() => setOrderDetail(order)}
                vintedCookie={vintedCookie}
                batches={batches}
              />
            ))}
          </div>
        )}
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
        <span style={{ fontSize: 12, color: 'var(--text-3)', padding: '0 4px' }}>
          {filtered.length} verkopen
        </span>
      </div>

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
                      {formatDate(s.date)}
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
                        ? <span style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 600 }}>✓ {s.shippedDate ? formatDate(s.shippedDate) : 'ja'}</span>
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
                      {formatDate(s.date)}
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

      {photoPopup && (
        <PhotoPopup urls={photoPopup} onClose={() => setPhotoPopup(null)} />
      )}

      {orderDetail && (
        <OrderDetailModal
          order={orderDetail}
          onClose={() => setOrderDetail(null)}
          vintedCookie={vintedCookie}
          onPhotoClick={(urls) => { setOrderDetail(null); setPhotoPopup(urls) }}
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
