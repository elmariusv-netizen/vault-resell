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
  if (status) return { label: status.length > 32 ? status.slice(0, 32) + '…' : status, color: '#6b7280', bg: 'rgba(107,114,128,0.08)' }
  return null
}

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

function VintedOrderRow({ order, isLast, onSave, onRegister, onDismiss }) {
  const badge = getStatusBadge(order.status, order.label_available)
  const flag  = COUNTRY_FLAGS[order.country] || ''
  const date  = order.sale_date || order.synced_at?.split('T')[0] || ''
  const fmtPrice = v => v > 0 ? `€${Number(v).toFixed(2).replace('.', ',')}` : '—'

  return (
    <div style={{ padding: '12px 16px', borderBottom: isLast ? 'none' : '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      {order.photo_url ? (
        <img src={order.photo_url} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <div style={{ width: 48, height: 48, borderRadius: 8, background: 'var(--bg-3,var(--bg))', border: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>📦</div>
      )}
      <div style={{ flex: 1, minWidth: 140 }}>
        <div style={{ fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>{order.title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {order.buyer && <span>@{order.buyer}</span>}
          {order.country && <span>{flag} {order.country}</span>}
          {date && <span>{date}</span>}
        </div>
        {badge && (
          <span style={{ display: 'inline-block', marginTop: 4, fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: badge.bg, color: badge.color }}>{badge.label}</span>
        )}
      </div>
      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--green)', flexShrink: 0 }}>{fmtPrice(order.price)}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        <InlineInput
          value={order.cost_price != null ? String(order.cost_price) : ''}
          onSave={v => onSave(order.id, 'cost_price', v ? parseFloat(v) : null)}
          placeholder="Inkoop €" prefix="€" width={76} type="number"
        />
        <InlineInput
          value={order.sku_ref || ''}
          onSave={v => onSave(order.id, 'sku_ref', v || null)}
          placeholder="SKU" width={80}
        />
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        {order.registered_in_vault ? (
          <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600, whiteSpace: 'nowrap' }}>✓ Geregistreerd</span>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={onRegister} style={{ fontSize: 11 }}>+ Registreer</button>
        )}
        <button className="btn btn-ghost btn-sm btn-icon" onClick={onDismiss} title="Verwijder uit lijst" style={{ fontSize: 14 }}>×</button>
      </div>
    </div>
  )
}

export default function Verkopen({ data, onDeleteSale, onUpdateSale, updateData }) {
  const { batches, sales, suppliers } = data

  const [search, setSearch] = useState('')
  const [filterPlatform, setFilterPlatform] = useState('all')
  const [filterMonth, setFilterMonth] = useState('all')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [editSale, setEditSale] = useState(null)

  // ── Vinted Orders state ────────────────────────────────────────────────
  const [vtOrders, setVtOrders] = useState([])
  const [vtLoading, setVtLoading] = useState(true)
  const [vtError, setVtError] = useState(null)
  const [saleModalPrefill, setSaleModalPrefill] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchAllVintedOrders()
      .then(rows => { if (!cancelled) { setVtOrders(rows); setVtLoading(false) } })
      .catch(e => { if (!cancelled) { setVtError(e.message); setVtLoading(false) } })
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
              {vtOrders.length}
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
          <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            {vtOrders.map((order, i) => (
              <VintedOrderRow
                key={order.id}
                order={order}
                isLast={i === vtOrders.length - 1}
                onSave={saveVtField}
                onRegister={() => openSaleModal(order)}
                onDismiss={() => dismissVintedOrder(order.id)}
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
