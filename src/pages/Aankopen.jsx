import { useState, useEffect } from 'react'
import { supabase } from '../utils/supabase'

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

async function fetchAllAankopen() {
  const { data, error } = await supabase
    .from('vinted_orders')
    .select('*')
    .eq('order_direction', 'purchase')
    .order('synced_at', { ascending: false })
  if (error) { console.warn('[Vault] Aankopen fetch error:', error); return [] }
  return data || []
}

function AankoopRow({ order, onToggleResale, onSaveSku }) {
  const [skuVal, setSkuVal] = useState(order.sku_ref || '')
  const [skuEditing, setSkuEditing] = useState(false)

  useEffect(() => setSkuVal(order.sku_ref || ''), [order.sku_ref])

  const suggested = !order.sku_ref ? suggestSku(order.title) : ''
  const photoUrls = (() => { try { return JSON.parse(order.photo_urls || '[]') } catch { return [] } })()
  const mainPhoto = photoUrls[0] || order.photo_url || null

  const saveSku = () => {
    onSaveSku(order.id, skuVal.trim().toUpperCase() || null)
    setSkuEditing(false)
  }

  return (
    <div style={{
      display: 'flex', gap: 12, padding: '14px 16px',
      borderBottom: '1px solid var(--border)', alignItems: 'flex-start',
    }}>
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
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.title}</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {order.seller_name && (
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>👤 {order.seller_name}</span>
          )}
          {order.country && (
            <span style={{ fontSize: 11, background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text-2)', padding: '1px 7px', borderRadius: 4, fontWeight: 600 }}>
              {order.country}
            </span>
          )}
          {order.sale_date && (
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>🗓 {order.sale_date}</span>
          )}
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginLeft: 'auto' }}>
            €{parseFloat(order.price || 0).toFixed(2).replace('.', ',')}
          </span>
        </div>

        {/* Toggle: Voor mezelf / Voor de handel */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => onToggleResale(order.id, false)}
            style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 5, cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit',
              background: order.for_resale === false ? 'var(--blue)' : 'var(--bg-2)',
              color: order.for_resale === false ? '#fff' : 'var(--text-2)',
              border: order.for_resale === false ? '1px solid var(--blue)' : '1px solid var(--border)',
            }}
          >Voor mezelf</button>
          <button
            onClick={() => onToggleResale(order.id, true)}
            style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 5, cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit',
              background: order.for_resale === true ? 'var(--green)' : 'var(--bg-2)',
              color: order.for_resale === true ? '#000' : 'var(--text-2)',
              border: order.for_resale === true ? '1px solid var(--green)' : '1px solid var(--border)',
            }}
          >Voor de handel</button>

          {/* SKU veld — toon alleen als for_resale = true */}
          {order.for_resale === true && (
            skuEditing ? (
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  autoFocus
                  value={skuVal}
                  onChange={e => setSkuVal(e.target.value.toUpperCase())}
                  onBlur={saveSku}
                  onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setSkuEditing(false); setSkuVal(order.sku_ref || '') } }}
                  placeholder="bv. NK042"
                  style={{ width: 80, fontFamily: 'monospace', fontSize: 12, padding: '3px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', outline: 'none' }}
                />
                <button onMouseDown={e => { e.preventDefault(); saveSku() }} style={{ padding: '3px 8px', borderRadius: 5, background: 'var(--green)', color: '#000', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>✓</button>
              </div>
            ) : (
              <div
                onClick={() => setSkuEditing(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', padding: '3px 8px', borderRadius: 5, background: 'var(--bg-2)', border: '1px solid var(--border)' }}
                title="Klik om SKU te koppelen"
              >
                <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: skuVal ? 'var(--text)' : 'var(--text-3)' }}>
                  {skuVal || 'Koppel SKU'}
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-3)' }}>✏️</span>
              </div>
            )
          )}
          {order.for_resale === true && suggested && !order.sku_ref && (
            <span
              onClick={() => onSaveSku(order.id, suggested)}
              style={{ fontSize: 10, color: 'var(--blue)', cursor: 'pointer', userSelect: 'none' }}
              title={`Auto: ${suggested}`}
            >✦ {suggested}</span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Aankopen() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchAllAankopen()
      .then(rows => { setOrders(rows); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  const toggleResale = async (id, value) => {
    await supabase.from('vinted_orders').update({ for_resale: value }).eq('id', id)
    setOrders(prev => prev.map(o => o.id === id ? { ...o, for_resale: value } : o))
  }

  const saveSku = async (id, sku) => {
    await supabase.from('vinted_orders').update({ sku_ref: sku || null }).eq('id', id)
    setOrders(prev => prev.map(o => o.id === id ? { ...o, sku_ref: sku || null } : o))
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Aankopen</h1>
          <div className="page-subtitle">{loading ? '…' : `${orders.length} aankopen gesynchroniseerd`}</div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>Laden…</div>
      ) : error ? (
        <div style={{ padding: 16, color: 'var(--red)', fontSize: 13 }}>Fout: {error}</div>
      ) : orders.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🛍</div>
          <h3>Geen aankopen gevonden</h3>
          <p>Synchroniseer aankopen via de extensie onder het 🛍 Aankopen tabblad.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {orders.map(order => (
            <AankoopRow
              key={order.id}
              order={order}
              onToggleResale={toggleResale}
              onSaveSku={saveSku}
            />
          ))}
        </div>
      )}
    </div>
  )
}
