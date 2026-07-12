import { useMemo, useState, useEffect } from 'react'
import {
  formatCurrency, formatDateLong, formatSkuRange, calcSaleProfit, normalizePlatform, findBatchForSku,
} from '../utils/skuUtils'
import EditSaleModal from '../components/EditSaleModal'
import SaleModal from '../components/SaleModal'
import DateRangeFilter, { getDateBounds, filterByRange } from '../components/DateRangeFilter'
import { supabase } from '../utils/supabase'

// Zelfde publieke 'invoices'-bucket als Kosten.jsx se factuur-archief —
// sale.attachmentPath (gezet via EditSaleModal) is een pad in de
// 'sales/'-submap daarvan.
const attachmentUrl = (path) => supabase.storage.from('invoices').getPublicUrl(path).data.publicUrl

const SHORT = { 'Medeverkoper/Groothandel': 'B2B', 'Privé persoon': 'Privé' }
const short = (p) => SHORT[p] || p

// Losstaande pagina voor niet-Vinted (handmatige) verkopen — voorheen een
// blokje bovenaan de Verkopen-pagina, maar dat dupliceerde dezelfde data als
// de "Vinted Orders"-kaartenlijst daar (voor Vinted-verkopen) en stond er
// bovendien altijd bovenop. Nu een eigen pagina, exclusief voor platforms
// buiten Vinted, met dezelfde rijen-lijststijl.
export default function AndereVerkopen({ data, updateData, onDeleteSale, onUpdateSale, dayFilter, onConsumeDayFilter }) {
  const { batches, sales, suppliers } = data

  const [search, setSearch] = useState('')
  const [filterPlatform, setFilterPlatform] = useState('all')
  // Zelfde periode-filter als Home.jsx (Vandaag/Deze week/Deze maand/Alle
  // tijd/Aangepast) i.p.v. de vorige "Alle maanden"-dropdown — consistente
  // UX tussen de 2 pagina's, en de totalen hieronder bewegen automatisch mee.
  const [range, setRange] = useState('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [editSale, setEditSale] = useState(null)
  const [showSale, setShowSale] = useState(false)
  const [dayFilterActive, setDayFilterActive] = useState(null)
  useEffect(() => {
    if (!dayFilter) return
    setDayFilterActive(dayFilter)
    onConsumeDayFilter?.()
  }, [dayFilter, onConsumeDayFilter])

  // newSales is een array (1 item voor een gewone verkoop, meerdere voor een
  // bundel met meerdere batches/leveranciers — zie SaleModal.jsx). Zelfde
  // patroon als Home.jsx/Verkopen.jsx se eigen SaleModal-afhandeling.
  const handleSaveSale = (newSales) => {
    const updates = { sales: [...sales, ...newSales] }
    const liveSales = newSales.filter((s) => s.fromLive)
    if (liveSales.length) {
      updates.batches = batches.map((b) => {
        const dec = liveSales.filter((s) => s.batchId === b.id).reduce((sum, s) => sum + (s.quantity || 1), 0)
        return dec ? { ...b, liveCount: Math.max(0, (b.liveCount || 0) - dec) } : b
      })
    }
    updateData(updates)
  }

  const otherSales = useMemo(
    () => sales.filter((s) => normalizePlatform(s.platform) !== 'Vinted'),
    [sales]
  )

  const platforms = useMemo(() => {
    const set = new Set(otherSales.map((s) => normalizePlatform(s.platform)).filter(Boolean))
    try {
      const custom = JSON.parse(localStorage.getItem('vault-platforms') || '[]')
      custom.forEach(p => p.name && p.name !== 'Vinted' && set.add(p.name))
    } catch {}
    return [...set].sort()
  }, [otherSales])

  const bounds = useMemo(() => getDateBounds(range, customFrom, customTo), [range, customFrom, customTo])

  const enriched = useMemo(() => {
    return [...otherSales]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map((sale) => {
        const batch = batches.find((b) => b.id === sale.batchId)
        const sup = suppliers.find((s) => batch && s.prefix === batch.supplierPrefix)
        const profit = batch ? calcSaleProfit(sale, batch) : null
        const sku = sale.sku || (batch ? formatSkuRange(batch.supplierPrefix, batch.startNum, batch.endNum) : '?')
        const skuBadges = sku.split(',').map((sk) => sk.trim()).filter(Boolean).map((sk) => {
          const skBatch = findBatchForSku(batches, sk)
          const skSup = skBatch ? suppliers.find((s) => s.prefix === skBatch.supplierPrefix) : null
          return { sku: sk, color: skSup?.color || sup?.color || '#666' }
        })
        const photo = sale.photo || batch?.photos?.[0] || batch?.photo || null
        const platformDisplay = normalizePlatform(sale.platform)
        return { ...sale, batch, profit, sku, skuBadges, photo, platformDisplay }
      })
  }, [otherSales, batches, suppliers])

  const filtered = useMemo(() => {
    const byRange = filterByRange(enriched, range, bounds)
    return byRange.filter((s) => {
      if (filterPlatform !== 'all' && s.platformDisplay !== filterPlatform) return false
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
  }, [enriched, filterPlatform, range, bounds, dayFilterActive, search])

  const totals = useMemo(() => filtered.reduce((acc, s) => ({
    revenue: acc.revenue + (s.isFree ? 0 : (s.salePrice || 0) * (s.quantity || 1)),
    profit: acc.profit + (s.profit?.profit || 0),
    count: acc.count + (s.quantity || 1),
  }), { revenue: 0, profit: 0, count: 0 }), [filtered])

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Andere verkopen</h1>
          <div className="page-subtitle">{otherSales.length} niet-Vinted verkopen geregistreerd</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowSale(true)}>+ Verkoop registreren</button>
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
        <DateRangeFilter
          value={range} onChange={setRange}
          customFrom={customFrom} customTo={customTo}
          onCustom={(k, v) => k === 'from' ? setCustomFrom(v) : setCustomTo(v)}
        />
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

      {otherSales.length === 0 ? (
        <div style={{ padding: 24, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
          Nog geen niet-Vinted verkopen geregistreerd. Gebruik "+ Verkoop registreren" op het dashboard en kies een ander platform.
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">💰</div>
          <h3>Geen verkopen gevonden</h3>
          <p>Pas de filters aan.</p>
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
                          {s.skuBadges.map(({ sku: sk, color }) => (
                            <span
                              key={sk}
                              className="sku-tag"
                              style={{ background: color + '14', color, marginRight: 4 }}
                            >
                              {sk}
                            </span>
                          ))}
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
                        {s.attachmentPath && (
                          <a
                            href={attachmentUrl(s.attachmentPath)}
                            target="_blank" rel="noopener noreferrer"
                            className="btn btn-ghost btn-sm btn-icon"
                            title="Bekijk bewijsstuk"
                            style={{ fontSize: 13 }}
                          >
                            📎
                          </a>
                        )}
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
                    <div style={{ width: 42, height: 42, borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 16 }}>
                      🏷
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {s.skuBadges.map(({ sku: sk, color }) => (
                        <span key={sk} className="sku-tag" style={{ background: color + '14', color }}>
                          {sk}
                        </span>
                      ))}
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
                  {s.attachmentPath && (
                    <a
                      href={attachmentUrl(s.attachmentPath)}
                      target="_blank" rel="noopener noreferrer"
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 11 }}
                    >
                      📎 Bewijsstuk
                    </a>
                  )}
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

      {showSale && (
        <SaleModal data={data} onClose={() => setShowSale(false)} onSave={handleSaveSale} />
      )}

      {editSale && (
        <EditSaleModal
          data={data}
          sale={editSale}
          onClose={() => setEditSale(null)}
          onSave={(updated) => { onUpdateSale(updated); setEditSale(null) }}
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
