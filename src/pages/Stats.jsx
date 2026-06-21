import { useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, Cell,
} from 'recharts'
import DateRangeFilter, { getDateBounds, filterByRange } from '../components/DateRangeFilter'
import {
  formatCurrency, formatSkuRange, calcSaleProfit,
  getRemainingQty, getSupplierColor, normalizePlatform,
} from '../utils/skuUtils'

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', boxShadow: 'var(--shadow-md)' }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 5 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.fill || p.color || 'var(--green)', fontWeight: 700, fontSize: 14 }}>
          {typeof p.value === 'number' ? formatCurrency(p.value) : p.value}
        </div>
      ))}
    </div>
  )
}

export default function Stats({ data, theme }) {
  const isDark = theme === 'dark'
  const tickColor = isDark ? '#636366' : '#9e9e9e'
  const gridStroke = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
  const cursorFill = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)'
  const { batches, sales, suppliers } = data

  const [range, setRange] = useState('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [tab, setTab] = useState('overview')

  const bounds = useMemo(() => getDateBounds(range, customFrom, customTo), [range, customFrom, customTo])
  const filteredSales = useMemo(() => filterByRange(sales, range, bounds), [sales, range, bounds])

  const overview = useMemo(() => {
    const paid = filteredSales.filter((s) => !s.isFree)
    const totalRevenue = paid.reduce((s, x) => s + (x.salePrice || 0) * (x.quantity || 1), 0)
    const totalSold = filteredSales.reduce((s, x) => s + (x.quantity || 1), 0)
    const totalProfit = filteredSales.reduce((s, sale) => {
      const b = batches.find((x) => x.id === sale.batchId)
      return b ? s + calcSaleProfit(sale, b).profit : s
    }, 0)
    const totalInvested = batches.reduce((s, b) => s + ((b.costPrice || 0) + (b.importTax || 0)) * b.quantity, 0)
    const totalStock = batches.reduce((s, b) => s + getRemainingQty(b, sales), 0)
    const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
    const avgProfit = totalSold > 0 ? totalProfit / totalSold : 0
    const avgSale = paid.length > 0 ? totalRevenue / paid.length : 0
    return { totalRevenue, totalSold, totalProfit, totalInvested, totalStock, margin, avgProfit, avgSale, orders: paid.length }
  }, [filteredSales, batches, sales])

  const perSupplier = useMemo(() => {
    return suppliers
      .map((sup) => {
        const sBatches = batches.filter((b) => b.supplierPrefix === sup.prefix)
        const sSales = filteredSales.filter((s) => sBatches.some((b) => b.id === s.batchId))
        const revenue = sSales.reduce((s, x) => s + (x.salePrice || 0) * (x.quantity || 1), 0)
        const profit = sSales.reduce((s, sale) => {
          const b = batches.find((x) => x.id === sale.batchId)
          return b ? s + calcSaleProfit(sale, b).profit : s
        }, 0)
        const sold = sSales.reduce((s, x) => s + (x.quantity || 1), 0)
        const stock = sBatches.reduce((s, b) => s + getRemainingQty(b, sales), 0)
        const margin = revenue > 0 ? (profit / revenue) * 100 : 0
        return { ...sup, revenue, profit, sold, stock, margin }
      })
      .filter((s) => s.stock > 0 || s.sold > 0)
      .sort((a, b) => b.revenue - a.revenue)
  }, [suppliers, batches, filteredSales, sales])

  const perBatch = useMemo(() => {
    return batches
      .map((b) => {
        const bSales = filteredSales.filter((s) => s.batchId === b.id)
        const sold = bSales.reduce((s, x) => s + (x.quantity || 1), 0)
        const revenue = bSales.reduce((s, x) => s + (x.salePrice || 0) * (x.quantity || 1), 0)
        const profit = bSales.reduce((s, sale) => s + calcSaleProfit(sale, b).profit, 0)
        const remaining = getRemainingQty(b, sales)
        const margin = revenue > 0 ? (profit / revenue) * 100 : 0
        return { ...b, sold, revenue, profit, remaining, profitPerUnit: sold > 0 ? profit / sold : 0, margin }
      })
      .sort((a, b) => b.sold - a.sold)
  }, [batches, filteredSales, sales])

  const perPlatform = useMemo(() => {
    const map = {}
    filteredSales.forEach((s) => {
      const p = normalizePlatform(s.platform) || 'Onbekend'
      if (!map[p]) map[p] = { revenue: 0, count: 0 }
      map[p].revenue += (s.salePrice || 0) * (s.quantity || 1)
      map[p].count += s.quantity || 1
    })
    return Object.entries(map)
      .map(([platform, v]) => ({ platform, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [filteredSales])

  const supplierChartData = perSupplier.map((s) => ({
    name: s.prefix,
    revenue: Math.round(s.revenue * 100) / 100,
    profit: Math.round(s.profit * 100) / 100,
    color: s.color,
  }))

  const TABS = [
    { id: 'overview', label: 'Overzicht' },
    { id: 'supplier', label: 'Leveranciers' },
    { id: 'sku', label: 'Best verkopende SKU\'s' },
    { id: 'platform', label: 'Platform' },
  ]

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Statistieken</h1>
          <div className="page-subtitle">{filteredSales.length} van {sales.length} verkopen</div>
        </div>
      </div>

      {/* Date filter */}
      <div style={{ marginBottom: 20 }}>
        <DateRangeFilter
          value={range} onChange={setRange}
          customFrom={customFrom} customTo={customTo}
          onCustom={(k, v) => k === 'from' ? setCustomFrom(v) : setCustomTo(v)}
        />
      </div>

      {/* Overview stat cards */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {[
          { label: 'Totale omzet', value: formatCurrency(overview.totalRevenue), sub: `${overview.orders} bestellingen`, accent: '#ffd60a' },
          { label: 'Netto winst', value: formatCurrency(overview.totalProfit), sub: `Marge ${overview.margin.toFixed(1)}%`, accent: '#22c55e', green: overview.totalProfit >= 0 },
          { label: 'Geïnvesteerd', value: formatCurrency(overview.totalInvested), sub: `${overview.totalStock} in voorraad`, accent: '#888' },
          { label: 'Gem. winst/stuk', value: formatCurrency(overview.avgProfit), sub: `${overview.totalSold} stuks verkocht`, accent: '#3ecfff', green: overview.avgProfit >= 0 },
        ].map((c) => (
          <div className="stat-card" key={c.label}>
            <div className="s-accent" style={{ background: c.accent }} />
            <div className="s-label">{c.label}</div>
            <div className={`s-value${c.green ? ' green' : ''}`} style={{ fontSize: '1.3rem' }}>{c.value}</div>
            <div className="s-sub">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="toggle-group" style={{ marginBottom: 20, maxWidth: 600 }}>
        {TABS.map((t) => (
          <button key={t.id} className={`toggle-btn${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview: revenue per supplier chart ── */}
      {tab === 'overview' && (
        <div className="glass-card">
          <div className="chart-section-label">Omzet per leverancier</div>
          {supplierChartData.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px 0' }}>
              <div className="empty-icon">📊</div>
              <h3>Nog geen verkopen</h3>
              <p>Start met verkopen om statistieken te zien.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={supplierChartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                <XAxis dataKey="name" stroke="transparent" tick={{ fill: tickColor, fontSize: 12, fontFamily: 'inherit' }} axisLine={false} tickLine={false} />
                <YAxis stroke="transparent" tick={{ fill: tickColor, fontSize: 11, fontFamily: 'inherit' }} tickFormatter={(v) => `€${v}`} axisLine={false} tickLine={false} width={52} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: cursorFill }} />
                <Bar dataKey="revenue" radius={[6, 6, 0, 0]}>
                  {supplierChartData.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}

          {perSupplier.length > 0 && (
            <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {perSupplier.map((s) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, minWidth: 60 }}>{s.prefix}</span>
                  <span style={{ color: 'var(--text-3)', flex: 1 }}>{s.name}</span>
                  <span style={{ fontWeight: 600 }}>{formatCurrency(s.revenue)}</span>
                  <span style={{ color: s.profit >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700, minWidth: 80, textAlign: 'right' }}>
                    {s.profit >= 0 ? '+' : ''}{formatCurrency(s.profit)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)', minWidth: 50, textAlign: 'right' }}>
                    {s.margin.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Best selling SKUs ── */}
      {tab === 'sku' && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>SKU</th>
                <th>Naam / Merk</th>
                <th>Sup.</th>
                <th>Verkocht</th>
                <th>Omzet</th>
                <th>Winst</th>
                <th>Marge</th>
                <th>Stock</th>
              </tr>
            </thead>
            <tbody>
              {perBatch.filter((b) => b.sold > 0).length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>Geen verkopen in deze periode</td></tr>
              ) : (
                perBatch.filter((b) => b.sold > 0).map((b, rank) => {
                  const color = getSupplierColor(suppliers, b.supplierPrefix)
                  return (
                    <tr key={b.id}>
                      <td style={{ color: 'var(--text-3)', fontWeight: 700, width: 32 }}>
                        {rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : rank + 1}
                      </td>
                      <td>
                        <span className="sku-tag" style={{ background: color + '18', color }}>
                          {formatSkuRange(b.supplierPrefix, b.startNum, b.endNum)}
                        </span>
                      </td>
                      <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {b.brand || b.name || <span style={{ color: 'var(--text-3)' }}>—</span>}
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
                          <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{b.supplierPrefix}</span>
                        </span>
                      </td>
                      <td style={{ fontWeight: 700 }}>{b.sold}</td>
                      <td style={{ fontWeight: 500 }}>{formatCurrency(b.revenue)}</td>
                      <td>
                        <span style={{ color: b.profit >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                          {formatCurrency(b.profit)}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: 12, color: b.margin >= 20 ? 'var(--green)' : b.margin >= 0 ? 'var(--text-2)' : 'var(--red)', fontWeight: 600 }}>
                          {b.sold > 0 ? `${b.margin.toFixed(1)}%` : '—'}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-2)' }}>{b.remaining}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Profit margin per batch (all batches, sorted by margin) ── */}
      {tab === 'supplier' && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Leverancier</th>
                <th>Verkocht</th>
                <th>Omzet</th>
                <th>Winst</th>
                <th>Marge</th>
                <th>In stock</th>
              </tr>
            </thead>
            <tbody>
              {perSupplier.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>Geen data</td></tr>
              ) : (
                perSupplier.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                        <span style={{ fontWeight: 600 }}>{s.prefix}</span>
                        <span style={{ color: 'var(--text-3)' }}>— {s.name}</span>
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-2)' }}>{s.sold}</td>
                    <td style={{ fontWeight: 600 }}>{formatCurrency(s.revenue)}</td>
                    <td>
                      <span style={{ color: s.profit >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                        {formatCurrency(s.profit)}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: s.margin >= 20 ? 'var(--green)' : s.margin >= 0 ? 'var(--text-2)' : 'var(--red)', fontWeight: 600 }}>
                        {s.sold > 0 ? `${s.margin.toFixed(1)}%` : '—'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-2)' }}>{s.stock}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Platform breakdown ── */}
      {tab === 'platform' && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Platform</th>
                <th>Stuks</th>
                <th>Omzet</th>
                <th>Aandeel</th>
              </tr>
            </thead>
            <tbody>
              {perPlatform.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>Nog geen verkopen</td></tr>
              ) : (
                perPlatform.map((p) => {
                  const pct = overview.totalRevenue > 0 ? (p.revenue / overview.totalRevenue) * 100 : 0
                  return (
                    <tr key={p.platform}>
                      <td style={{ fontWeight: 600 }}>{p.platform}</td>
                      <td style={{ color: 'var(--text-2)' }}>{p.count}</td>
                      <td style={{ fontWeight: 600 }}>{formatCurrency(p.revenue)}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 4, background: 'var(--bg-2)', borderRadius: 2, maxWidth: 80 }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--blue)', borderRadius: 2 }} />
                          </div>
                          <span style={{ fontSize: 12, color: 'var(--text-2)', minWidth: 36 }}>{pct.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
