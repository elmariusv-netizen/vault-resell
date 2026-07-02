import { useMemo, useState, useEffect } from 'react'
import {
  formatCurrency, formatDateLong, formatSkuRange, calcSaleProfit, normalizePlatform,
  genId, getNextSkuNum, formatSku,
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
  // Zoek SKU-prefix: alleen letters, geen nummer (gebruiker kiest zelf het nummer)
  const existing = combined.match(/\b([A-Z]{2,4})\d{3,6}\b/)
  if (existing) return existing[1]

  const t = combined.toLowerCase()
  for (const [name, code] of BRANDS_MAP) {
    if (t.includes(name)) return code
  }
  return ''
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
function OrderDetailModal({ order, onClose, vintedCookie, onPhotoClick, onSave }) {
  const [downloading, setDownloading] = useState(false)
  const [downloaded, setDownloaded]   = useState(false)
  const [skuEditing,  setSkuEditing]  = useState(false)
  const [skuVal,      setSkuVal]      = useState(order.sku_ref || '')
  const [cogsEditing, setCogsEditing] = useState(false)
  const [cogsVal,     setCogsVal]     = useState(String(order.cost_price ?? ''))

  useEffect(() => { setSkuVal(order.sku_ref || '') },       [order.sku_ref])
  useEffect(() => { setCogsVal(String(order.cost_price ?? '')) }, [order.cost_price])

  const flag    = COUNTRY_FLAGS[order.country] || ''
  const date    = order.sale_date || order.synced_at?.split('T')[0] || ''
  const price   = Number(order.price || 0)
  const cogs    = Number(order.cost_price || 0)
  const profit  = order.cost_price != null ? price - cogs : null
  const roi     = (profit != null && cogs > 0) ? (profit / cogs) * 100 : null
  const fmtE    = v => `€${Number(v).toFixed(2).replace('.', ',')}`

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
              onClick={() => onPhotoClick(allPhotos)}
              style={{ width: '100%', height: 300, cursor: 'zoom-in', background: 'var(--bg-2)', overflow: 'hidden' }}
            >
              <img src={mainPhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              {allPhotos.length > 1 && (
                <span style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, padding: '3px 10px', borderRadius: 20 }}>
                  {allPhotos.length} foto's
                </span>
              )}
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 55%, rgba(0,0,0,0.55))', pointerEvents: 'none' }} />
            </div>
          ) : (
            <div style={{ height: 80, background: 'var(--bg-2)' }} />
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
                onClick={() => onPhotoClick([...allPhotos.slice(i), ...allPhotos.slice(0, i)])}
                style={{
                  width: 56, height: 56, borderRadius: 8, objectFit: 'cover',
                  cursor: 'zoom-in', flexShrink: 0,
                  border: i === 0 ? '2px solid var(--green)' : '1px solid var(--border)',
                }}
              />
            ))}
          </div>
        )}

        {/* Scrollbare inhoud */}
        <div style={{ padding: '20px 24px 24px', overflowY: 'auto', flex: 1 }}>

          {/* Titel */}
          <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.35, marginBottom: 8, color: 'var(--text)' }}>{order.title}</div>

          {/* Status badge */}
          {(() => { const b = getStatusBadge(order.status, order.label_available); return b ? (
            <div style={{ marginBottom: 12 }}>
              <span style={{ fontSize: 11, color: b.color, background: b.bg, padding: '3px 10px', borderRadius: 6, fontWeight: 700, border: `1px solid ${b.color}30` }}>{b.label}</span>
            </div>
          ) : null })()}

          {/* Datum */}
          {date && (
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--text-3)' }}>🗓</span> {formatDateLong(date)}
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
                    {flag} {order.country}
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
          <div style={{ marginBottom: 16 }}>
            {skuEditing ? (
              <div style={{ display: 'flex', gap: 6 }}>
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

// ── Bulk SKU-koppel modal ───────────────────────────────────────────────────
// Koppelt meerdere geselecteerde Vinted-orders in één keer aan oplopende SKU's
// uit dezelfde leverancier-batch (bv. RIA047, RIA048, RIA049), met per order
// een handmatig overschrijfbaar SKU-veld.
function BulkSkuModal({ suppliers, batches, orders, onClose, onConfirm }) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '')
  const [overrides, setOverrides]   = useState({}) // orderId -> handmatig ingetypte SKU
  const [saving, setSaving]         = useState(false)

  const supplier = suppliers.find(s => s.id === supplierId)
  const startNum = supplier ? getNextSkuNum(batches, supplier.prefix) : 1

  useEffect(() => { setOverrides({}) }, [supplierId])

  useEffect(() => {
    const close = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  const rows = orders.map((order, i) => {
    const suggested = supplier ? formatSku(supplier.prefix, startNum + i) : ''
    const sku = overrides[order.id] ?? suggested
    return { order, sku }
  })

  // Zoek de batch die bij een getypte SKU hoort (prefix + nummer binnen het
  // start/eind-bereik). Valt terug op de meest recente batch van diezelfde
  // leverancier als het nummer buiten elk bestaand bereik valt (bv. een
  // volledig nieuwe SKU) — zodat COGS toch een redelijke waarde krijgt i.p.v.
  // helemaal niets.
  const resolveBatch = (sku) => {
    const m = /^([A-Za-z]+)(\d+)$/.exec(sku.trim())
    if (!m) return null
    const prefix = m[1].toUpperCase()
    const num = parseInt(m[2], 10)
    const supBatches = batches.filter(b => b.supplierPrefix === prefix)
    if (!supBatches.length) return null
    return supBatches.find(b => num >= b.startNum && num <= b.endNum)
      || [...supBatches].sort((a, b) => (b.endNum || 0) - (a.endNum || 0))[0]
  }

  const handleConfirm = async () => {
    if (!supplier || saving) return
    setSaving(true)
    const assignments = rows.map(({ order, sku }) => ({
      orderId: order.id,
      sku: sku.trim().toUpperCase(),
      batch: resolveBatch(sku),
    }))
    await onConfirm(assignments)
    setSaving(false)
    onClose()
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
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.6px', textTransform: 'uppercase', marginBottom: 5 }}>Leverancier</div>
            {suppliers.length ? (
              <select
                value={supplierId}
                onChange={e => setSupplierId(e.target.value)}
                style={{ width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-2)', color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }}
              >
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.prefix} — {s.name}</option>)}
              </select>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text-3)', fontStyle: 'italic' }}>Geen leveranciers gevonden — maak er eerst een aan.</div>
            )}
          </div>

          <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            {rows.map(({ order, sku }, i) => (
              <div
                key={order.id}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none' }}
              >
                <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--text)' }} title={order.title}>
                  {order.title}
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', flexShrink: 0 }}>
                  €{parseFloat(order.price || 0).toFixed(2).replace('.', ',')}
                </span>
                <input
                  value={sku}
                  onChange={e => setOverrides(prev => ({ ...prev, [order.id]: e.target.value.toUpperCase() }))}
                  style={{ width: 92, flexShrink: 0, fontFamily: 'monospace', fontSize: 12, fontWeight: 700, padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', textAlign: 'center', textTransform: 'uppercase', outline: 'none' }}
                />
              </div>
            ))}
          </div>

          <button
            className="btn btn-primary"
            disabled={!supplier || saving}
            onClick={handleConfirm}
            style={{ width: '100%', marginTop: 16 }}
          >
            {saving ? 'Bezig…' : `Bevestig koppeling (${orders.length})`}
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
function Checkbox({ checked, onChange, size = 20 }) {
  return (
    <label
      style={{ position: 'relative', display: 'inline-flex', width: size, height: size, flexShrink: 0, cursor: 'pointer' }}
      onClick={e => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={!!checked}
        onChange={e => onChange?.(e.target.checked)}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', margin: 0, opacity: 0, cursor: 'pointer' }}
      />
      <span
        style={{
          width: size, height: size, borderRadius: 6, boxSizing: 'border-box',
          border: checked ? '2px solid #818cf8' : '2px solid #64748b',
          background: checked ? '#818cf8' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.15s, border-color 0.15s',
          pointerEvents: 'none',
        }}
      >
        {checked && (
          <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 16 16" fill="none">
            <path d="M3 8.5L6.5 12L13 4.5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </label>
  )
}

// ── Order rij (Vinteer-stijl) ──────────────────────────────────────────────
function VintedOrderRow({ order, isLast, onSave, onDismiss, onPhotoClick, onRegister, onDetail, batches, checked, onCheck }) {
  const [skuPickerOpen,  setSkuPickerOpen]  = useState(false)
  const [hoverPos,       setHoverPos]       = useState(null)
  const [cogsEditing,    setCogsEditing]    = useState(false)
  const [cogsVal,        setCogsVal]        = useState(String(order.cost_price ?? ''))
  const [photoUploading, setPhotoUploading] = useState(false)

  useEffect(() => setCogsVal(String(order.cost_price ?? '')), [order.cost_price])

  const flag     = COUNTRY_FLAGS[order.country] || ''
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
      <div style={{ borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.06)', background: checked ? 'rgba(129,140,248,0.10)' : 'transparent', transition: 'background 0.15s' }}>

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
                <div style={{ width: 100, height: 124, borderRadius: 8, background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>
                  {photoUploading ? '⏳' : '📦'}
                </div>
                {!photoUploading && (
                  <label style={{ position: 'absolute', bottom: 6, right: 6, background: '#334155', border: '1px solid rgba(255,255,255,0.15)', color: '#94a3b8', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 16, lineHeight: 1, userSelect: 'none' }} title="Foto toevoegen">
                    +
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={async e => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        setPhotoUploading(true)
                        const ext  = file.name.split('.').pop()
                        const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
                        const { error } = await supabase.storage.from('order-photos').upload(path, file)
                        if (!error) {
                          const { data } = supabase.storage.from('order-photos').getPublicUrl(path)
                          onSave(order.id, 'photo_url', data.publicUrl)
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
                style={{ fontWeight: 700, fontSize: 14, color: '#4ade80', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3, flex: 1, minWidth: 0, cursor: onDetail ? 'pointer' : 'default' }}
                title={onDetail ? 'Klik voor details' : undefined}
              >
                {order.title}
              </span>
              <button
                onClick={onDismiss}
                title="Verwijder"
                style={{ flexShrink: 0, fontSize: 17, lineHeight: 1, background: 'none', border: 'none', color: '#334155', cursor: 'pointer', padding: '0 2px', fontWeight: 700, fontFamily: 'inherit' }}
                onMouseEnter={e => e.currentTarget.style.color = '#f87171'}
                onMouseLeave={e => e.currentTarget.style.color = '#334155'}
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
              <div style={{ fontSize: 11, color: '#475569', marginBottom: 5, textTransform: 'capitalize' }}>{meta}</div>
            )}

            {/* Rij 3: koper + land */}
            {(buyer || order.country) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
                <span style={{ fontSize: 12, color: '#475569', lineHeight: 1 }}>👤</span>
                {buyer && <span style={{ fontSize: 12, color: '#94a3b8' }}>{buyer}</span>}
                {order.country && (
                  <span style={{ fontSize: 10, background: '#1e293b', color: '#64748b', padding: '1px 7px', borderRadius: 4, fontWeight: 600, letterSpacing: '0.2px' }}>
                    {flag} {order.country}
                  </span>
                )}
              </div>
            )}

            {/* Rij 4: datum + acties */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {(() => { const b = getStatusBadge(order.status, order.label_available); return b ? (
                <span style={{ fontSize: 10, color: b.color, background: b.bg, padding: '2px 7px', borderRadius: 4, fontWeight: 700, border: `1px solid ${b.color}30` }}>{b.label}</span>
              ) : null })()}
              {date && (
                <span style={{ fontSize: 11, color: '#475569', display: 'flex', alignItems: 'center', gap: 3 }}>
                  🗓 {formatDateLong(date)}
                </span>
              )}
              {miniBtn(
                () => setSkuPickerOpen(true),
                order.sku_ref ? `🏷 ${order.sku_ref}` : 'Lier SKU',
                '#818cf8', 'rgba(129,140,248,0.08)', 'rgba(129,140,248,0.2)'
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
          background: '#1e293b',
          display: 'flex',
          borderTop: '1px solid rgba(255,255,255,0.04)',
        }}>
          {[
            {
              label: 'BRUT',
              node: <span style={{ fontSize: 14, fontWeight: 700, color: '#cbd5e1' }}>€{price.toFixed(2).replace('.', ',')}</span>,
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
                  style={{ width: 64, fontSize: 13, fontWeight: 700, background: 'transparent', border: 'none', borderBottom: '1px solid #4ade80', color: '#f1f5f9', outline: 'none', textAlign: 'center', fontFamily: 'inherit', padding: 0 }}
                />
              ) : (
                <span style={{ fontSize: 14, fontWeight: 700, color: '#64748b' }}>€{cogs.toFixed(2).replace('.', ',')}</span>
              ),
              onClick: () => !cogsEditing && setCogsEditing(true),
              title: 'Klik om te bewerken',
            },
            {
              label: 'PROFIT',
              node: profit != null
                ? <span style={{ fontSize: 14, fontWeight: 700, color: profit >= 0 ? '#4ade80' : '#f87171' }}>{profit >= 0 ? '+' : '-'}€{Math.abs(profit).toFixed(2).replace('.', ',')}</span>
                : <span style={{ fontSize: 14, fontWeight: 700, color: '#334155' }}>—</span>,
            },
            {
              label: 'ROI',
              node: roi != null
                ? <span style={{ fontSize: 14, fontWeight: 700, color: roi >= 0 ? '#4ade80' : '#f87171' }}>{roi >= 0 ? '+' : ''}{roi.toFixed(0)}%</span>
                : <span style={{ fontSize: 14, fontWeight: 700, color: '#334155' }}>—</span>,
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
                borderRight: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                cursor: col.onClick ? 'pointer' : 'default',
              }}
            >
              <div style={{ fontSize: 9, color: '#334155', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 2 }}>{col.label}</div>
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
            boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
            border: '2px solid rgba(255,255,255,0.1)',
          }}
        />
      )}

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

export default function Verkopen({ data, onDeleteSale, onUpdateSale, updateData, vintedCookie, activeUserId }) {
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
  const [addOrderOpen, setAddOrderOpen] = useState(false)
  const [syncing,   setSyncing]   = useState(false)
  const [syncToast, setSyncToast] = useState(null)  // null | string
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

  const deleteSelected = async () => {
    if (!window.confirm(`${selectedIds.size} order(s) definitief verwijderen?`)) return
    const ids = [...selectedIds]
    await supabase.from('vinted_orders').delete().in('id', ids)
    setVtOrders(prev => prev.filter(o => !selectedIds.has(o.id)))
    setSelectedIds(new Set())
  }

  // Slaat de bulk-SKU-koppeling op: sku_ref/cost_price/batch_id op het
  // vinted_orders-record zelf (voor directe COGS/winst/ROI-weergave), én een
  // bijhorende sales-entry (dezelfde vorm als SaleModal produceert) zodat de
  // koppeling ook meetelt in de Stats-pagina — die leest uitsluitend
  // data.sales, niet vinted_orders.
  const handleBulkSkuConfirm = async (assignments) => {
    const newSales = []
    const patches = {}
    for (const { orderId, sku, batch } of assignments) {
      if (!sku) continue
      const order = vtOrders.find(o => o.id === orderId)
      const cogs  = batch ? (batch.costPrice || 0) + (batch.importTax || 0) : null
      const patch = {
        sku_ref: sku,
        cost_price: cogs,
        batch_id: batch?.id || null,
        registered_in_vault: !!batch,
      }
      patches[orderId] = patch
      await supabase.from('vinted_orders').update(patch).eq('id', orderId)

      if (batch && order) {
        let photo = order.photo_url || null
        try { photo = JSON.parse(order.photo_urls || '[]')[0] || photo } catch {}
        newSales.push({
          id: genId(),
          batchId: batch.id,
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
          saleTime: null,
        })
      }
    }
    if (newSales.length) updateData({ sales: [...sales, ...newSales] })
    setVtOrders(prev => prev.map(o => patches[o.id] ? { ...o, ...patches[o.id] } : o))
    setSelectedIds(new Set())
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

  const handleSync = async () => {
    window.open('https://www.vinted.be/my_orders', '_blank')
    if (activeUserId) {
      try {
        await supabase.from('user_settings')
          .upsert({ user_id: activeUserId, vault_sync_requested: true }, { onConflict: 'user_id' })
      } catch (e) {
        console.warn('[Vault] sync flag mislukt:', e.message)
      }
    }
    setSyncing(true)
    const startCount = vtOrders.length
    const deadline   = Date.now() + 30000
    const pollId = setInterval(async () => {
      if (Date.now() > deadline) {
        clearInterval(pollId)
        setSyncing(false)
        setSyncToast('Geen nieuwe orders gevonden — selecteer orders in de extensie')
        setTimeout(() => setSyncToast(null), 4000)
        return
      }
      const fresh = await fetchAllVintedOrders()
      if (fresh.length > startCount) {
        clearInterval(pollId)
        const SKU_RE = /\b([A-Z]{2,4}\d{3,6})\b/
        setVtOrders(fresh.map(row => {
          if (!row.sku_ref && row.description) {
            const m = row.description.match(SKU_RE)
            if (m) return { ...row, sku_ref: m[1] }
          }
          return row
        }))
        setSyncing(false)
        const added = fresh.length - startCount
        setSyncToast(`✓ ${added} nieuwe order${added !== 1 ? 's' : ''} gesynchroniseerd`)
        setTimeout(() => setSyncToast(null), 4000)
      }
    }, 2000)
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

      {/* ── Vinted Orders ── */}
      {(() => {
        const visibleVtOrders = vtOrders.filter(o =>
          !/geannuleerd|cancel/i.test(o.status || '') &&
          (o.order_direction === 'sale' || !o.order_direction)
        )
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
                  className="btn btn-secondary"
                  style={{ fontSize: 12, padding: '4px 12px' }}
                  onClick={handleSync}
                  disabled={syncing}
                >{syncing ? '⏳ Synchroniseren…' : '⚡ Auto-sync'}</button>
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 12, padding: '4px 12px' }}
                  onClick={() => setAddOrderOpen(true)}
                >+ Toevoegen</button>
              </div>
            </div>

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
                {visibleVtOrders.map((order, i, arr) => (
                  <VintedOrderRow
                    key={order.id}
                    order={order}
                    isLast={i === arr.length - 1}
                    onSave={saveVtField}
                    onDismiss={() => dismissVintedOrder(order.id)}
                    onPhotoClick={setPhotoPopup}
                    onDetail={() => setOrderDetail(order)}
                    onRegister={() => openSaleModal(order)}
                    batches={batches}
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
          suppliers={suppliers}
          batches={batches}
          orders={vtOrders.filter(o => selectedIds.has(o.id))}
          onClose={() => setBulkSkuOpen(false)}
          onConfirm={handleBulkSkuConfirm}
        />
      )}

      {syncToast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#1e293b', color: '#f1f5f9', padding: '10px 20px', borderRadius: 10,
          fontSize: 13, fontWeight: 500, zIndex: 9999,
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
          maxWidth: 420, textAlign: 'center',
        }}>
          {syncToast}
        </div>
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
