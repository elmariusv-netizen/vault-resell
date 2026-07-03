import { useState, useEffect } from 'react'
import { supabase } from '../utils/supabase'
import { formatDateLong, COUNTRY_FLAGS, getStatusBadge } from '../utils/skuUtils'
import AankoopSkuModal from '../components/AankoopSkuModal'
import Checkbox from '../components/Checkbox'

const BRANDS_MAP = [
  ['ralph lauren','RL'],['nike','NK'],['adidas','AD'],['zara','ZR'],['h&m','HM'],
  ['puma','PU'],['gucci','GC'],['tommy hilfiger','TH'],['calvin klein','CK'],
  ["levi's",'LV'],['levis','LV'],['guess','GS'],['under armour','UA'],
  ['new balance','NB'],['lacoste','LC'],['diesel','DS'],['versace','VS'],
  ['armani','AR'],['gap','GP'],['mango','MG'],['primark','PK'],
]

function suggestSku(title) {
  const t = (title || '').toLowerCase()
  for (const [name, code] of BRANDS_MAP) {
    if (t.includes(name)) return code
  }
  return ''
}

// Zelfde criterium als Verkopen.jsx gebruikt voor zijn Vinted-orders-lijst.
function isCancelled(order) {
  return /geannuleerd|cancel/i.test(order.status || '')
}

async function fetchAllAankopen() {
  const { data, error } = await supabase
    .from('vinted_orders')
    .select('*')
    .eq('order_direction', 'purchase')
  if (error) { console.warn('[Vault] Aankopen fetch error:', error); return [] }
  // Sorteer op sale_date (val terug op synced_at als die ontbreekt), nieuwste eerst.
  return (data || []).sort((a, b) => {
    const da = a.sale_date || a.synced_at || ''
    const db = b.sale_date || b.synced_at || ''
    return db.localeCompare(da)
  })
}

function AankoopRow({ order, onLinkSku, onDelete, checked, onCheck }) {
  const suggested = !order.sku_ref ? suggestSku(order.title) : ''
  const photoUrls = (() => { try { return JSON.parse(order.photo_urls || '[]') } catch { return [] } })()
  const mainPhoto = photoUrls[0] || order.photo_url || null
  const flag = COUNTRY_FLAGS[order.country] || ''
  const badge = getStatusBadge(order.status, false)
  const cancelled = isCancelled(order)

  return (
    <div style={{
      display: 'flex', gap: 12, padding: '14px 16px',
      borderBottom: '1px solid var(--border)', alignItems: 'flex-start',
      opacity: cancelled ? 0.6 : 1,
      background: checked ? 'rgba(129,140,248,0.10)' : 'transparent',
      transition: 'background 0.15s',
    }}>
      {/* Checkbox */}
      <div style={{ flexShrink: 0, paddingTop: 4 }}>
        <Checkbox checked={checked} onChange={on => onCheck?.(on)} />
      </div>

      {/* Foto */}
      <div style={{ flexShrink: 0 }}>
        {mainPhoto ? (
          <img src={mainPhoto} alt="" style={{ width: 80, height: 100, borderRadius: 8, objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ width: 80, height: 100, borderRadius: 8, background: 'var(--bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>🛍</div>
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{order.title}</span>
          <button
            onClick={() => onDelete(order)}
            title="Verwijder"
            style={{ flexShrink: 0, fontSize: 17, lineHeight: 1, background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: '0 2px', fontWeight: 700, fontFamily: 'inherit' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-3)'}
          >×</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {order.seller_name && (
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>👤 @{order.seller_name}</span>
          )}
          {order.country && (
            <span style={{ fontSize: 11, background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text-2)', padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>
              {flag} {order.country}
            </span>
          )}
          {badge && (
            <span style={{ fontSize: 10, color: badge.color, background: badge.bg, padding: '2px 7px', borderRadius: 4, fontWeight: 700, border: `1px solid ${badge.color}30` }}>
              {badge.label}
            </span>
          )}
          {order.sale_date && (
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>🗓 {formatDateLong(order.sale_date)}</span>
          )}
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginLeft: 'auto' }}>
            €{parseFloat(order.price || 0).toFixed(2).replace('.', ',')}
          </span>
        </div>

        {/* SKU koppelen — vervangt de vorige "Voor mezelf"/"Voor de handel"-toggle.
            Geen koppeling nodig? Dan blijft het gewoon een persoonlijke aankoop,
            geen verdere actie vereist. */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => onLinkSku(order)}
            style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 5, cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit',
              background: order.sku_ref ? 'rgba(129,140,248,0.12)' : 'var(--bg-2)',
              color: order.sku_ref ? '#818cf8' : 'var(--text-2)',
              border: order.sku_ref ? '1px solid rgba(129,140,248,0.3)' : '1px solid var(--border)',
            }}
          >
            {order.sku_ref ? `🏷 ${order.sku_ref}` : '🏷 SKU koppelen'}
          </button>
          {suggested && !order.sku_ref && (
            <span style={{ fontSize: 10, color: 'var(--text-3)' }} title="Merk gedetecteerd in titel">
              suggestie: {suggested}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Aankopen({ data, updateData }) {
  const { batches = [], suppliers = [] } = data || {}
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showCancelled, setShowCancelled] = useState(false)
  const [linkingOrder, setLinkingOrder] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())

  useEffect(() => {
    fetchAllAankopen()
      .then(rows => { setOrders(rows); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  const visibleOrders = orders.filter(o => showCancelled || !isCancelled(o))
  const cancelledCount = orders.filter(isCancelled).length

  // { sku, batchId, costPrice, newBatch? } — zie AankoopSkuModal.
  const handleSkuConfirm = async ({ sku, batchId, costPrice, newBatch }) => {
    if (newBatch) updateData({ batches: [...batches, newBatch] })
    const patch = { sku_ref: sku, batch_id: batchId, cost_price: costPrice }
    await supabase.from('vinted_orders').update(patch).eq('id', linkingOrder.id)
    setOrders(prev => prev.map(o => o.id === linkingOrder.id ? { ...o, ...patch } : o))
  }

  // Definitieve verwijdering uit vinted_orders — zelfde directe delete als
  // Verkopen.jsx's bulk "🗑 Verwijder geselecteerde" (niet de losse ✕ daar,
  // die enkel registered_in_vault zet en de order lokaal verbergt).
  // Registreert de order eerst in ignored_orders zodat een sync die toevallig
  // net dan draait 'm niet opnieuw aanmaakt (api/sync-order.js checkt deze
  // tabel vóór elke upsert, voor alle sync-paden).
  const handleDelete = async (order) => {
    if (!window.confirm(`"${order.title}" definitief verwijderen?`)) return
    if (order.owner_id && order.transaction_id) {
      await supabase.from('ignored_orders')
        .upsert({ owner_id: order.owner_id, transaction_id: order.transaction_id }, { onConflict: 'owner_id,transaction_id' })
    }
    await supabase.from('vinted_orders').delete().eq('id', order.id)
    setOrders(prev => prev.filter(o => o.id !== order.id))
  }

  const toggleId = (id, on) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      on ? next.add(id) : next.delete(id)
      return next
    })
  }

  const deleteSelected = async () => {
    if (!window.confirm(`${selectedIds.size} order(s) definitief verwijderen?`)) return
    const ids = [...selectedIds]
    const toIgnore = orders
      .filter(o => selectedIds.has(o.id) && o.owner_id && o.transaction_id)
      .map(o => ({ owner_id: o.owner_id, transaction_id: o.transaction_id }))
    if (toIgnore.length) await supabase.from('ignored_orders').upsert(toIgnore, { onConflict: 'owner_id,transaction_id' })
    await supabase.from('vinted_orders').delete().in('id', ids)
    setOrders(prev => prev.filter(o => !selectedIds.has(o.id)))
    setSelectedIds(new Set())
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Aankopen</h1>
          <div className="page-subtitle">{loading ? '…' : `${visibleOrders.length} aankopen gesynchroniseerd`}</div>
        </div>
        {!loading && cancelledCount > 0 && (
          <button
            onClick={() => setShowCancelled(v => !v)}
            className="btn btn-secondary btn-sm"
          >
            {showCancelled ? '👁 Verberg geannuleerde' : `👁 Toon geannuleerde (${cancelledCount})`}
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>Laden…</div>
      ) : error ? (
        <div style={{ padding: 16, color: 'var(--red)', fontSize: 13 }}>Fout: {error}</div>
      ) : visibleOrders.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🛍</div>
          <h3>Geen aankopen gevonden</h3>
          <p>Synchroniseer aankopen via de extensie onder het 🛍 Aankopen tabblad.</p>
        </div>
      ) : (
        <>
          {/* Bulk controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <button
              onClick={() => setSelectedIds(new Set(visibleOrders.map(o => o.id)))}
              style={{ fontSize: 11, padding: '2px 10px', borderRadius: 5, cursor: 'pointer', background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text-2)', fontFamily: 'inherit' }}
            >☑ Alles</button>
            <button
              onClick={() => setSelectedIds(new Set())}
              style={{ fontSize: 11, padding: '2px 10px', borderRadius: 5, cursor: 'pointer', background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text-2)', fontFamily: 'inherit' }}
            >☐ Geen</button>
            {selectedIds.size > 0 && (
              <button
                onClick={deleteSelected}
                style={{ fontSize: 11, padding: '2px 10px', borderRadius: 5, cursor: 'pointer', background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', fontFamily: 'inherit', fontWeight: 600 }}
              >🗑 Verwijder geselecteerde ({selectedIds.size})</button>
            )}
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {visibleOrders.map(order => (
              <AankoopRow
                key={order.id}
                order={order}
                onLinkSku={setLinkingOrder}
                onDelete={handleDelete}
                checked={selectedIds.has(order.id)}
                onCheck={on => toggleId(order.id, on)}
              />
            ))}
          </div>
        </>
      )}

      {linkingOrder && (
        <AankoopSkuModal
          order={linkingOrder}
          suppliers={suppliers}
          batches={batches}
          allOrders={orders}
          onClose={() => setLinkingOrder(null)}
          onConfirm={handleSkuConfirm}
        />
      )}
    </div>
  )
}
