import { useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, Cell,
} from 'recharts'
import {
  formatCurrency, formatSkuRange, calcSaleProfit,
  getRemainingQty, getSupplierColor,
} from '../utils/skuUtils'

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '10px 16px',
      boxShadow: 'var(--shadow-md)',
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 5 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.fill || p.color || 'var(--green)', fontWeight: 700, fontSize: 14 }}>
          {formatCurrency(p.value)}
        </div>
      ))}
    </div>
  )
}

export default function Stats({ data, theme }) {
  const isDark = theme === 'dark'
  const tickColor = isDark ? '#636366' : '#9e9e9e'
  const gridStroke = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
  const cursorFill = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.04)'
  const { batches, sales, suppliers } = data
  const [tab, setTab] = useState('overview')

  const overview = useMemo(() => {
    const totalRevenue = sales.reduce((s, x) => s + (x.salePrice || 0) * (x.quantity || 1), 0)
    const totalFees = sales.reduce((s, x) => s + (x.fees || 0), 0)
    const totalSold = sales.reduce((s, x) => s + (x.quantity || 1), 0)
    const totalProfit = sales.reduce((s, sale) => {
      const b = batches.find((x) => x.id === sale.batchId)
      return b ? s + calcSaleProfit(sale, b).profit : s
    }, 0)
    const totalInvested = batches.reduce(
      (s, b) => s + ((b.costPrice || 0) + (b.importTax || 0)) * b.quantity, 0
    )
    const totalStock = batches.reduce((s, b) => s + getRemainingQty(b, sales), 0)
    const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
    const avgProfit = totalSold > 0 ? totalProfit / totalSold : 0
    return { totalRevenue, totalFees, totalSold, totalProfit, totalInvested, totalStock, margin, avgProfit }
  }, [batches, sales])

  const perSupplier = useMemo(() => {
    return suppliers
      .map((sup) => {
        const sBatches = batches.filter((b) => b.supplierPrefix === sup.prefix)
        const sSales = sales.filter((s) => sBatches.some((b) => b.id === s.batchId))
        const revenue = sSales.reduce((s, x) => s + (x.salePrice || 0) * (x.quantity || 1), 0)
        const profit = sSales.reduce((s, sale) => {
          const b = batches.find((x) => x.id === sale.batchId)
          return b ? s + calcSaleProfit(sale, b).profit : s
        }, 0)
        const sold = sSales.reduce((s, x) => s + (x.quantity || 1), 0)
        const stock = sBatches.reduce((s, b) => s + getRemainingQty(b, sales), 0)
        return { ...sup, revenue, profit, sold, stock }
      })
      .filter((s) => s.stock > 0 || s.sold > 0)
  }, [suppliers, batches, sales])

  const perBatch = useMemo(() => {
    return batches
      .map((b) => {
        const bSales = sales.filter((s) => s.batchId === b.id)
        const sold = bSales.reduce((s, x) => s + (x.quantity || 1), 0)
        const revenue = bSales.reduce((s, x) => s + (x.salePrice || 0) * (x.quantity || 1), 0)
        const profit = bSales.reduce((s, sale) => s + calcSaleProfit(sale, b).profit, 0)
        const remaining = getRemainingQty(b, sales)
        return { ...b, sold, revenue, profit, remaining, profitPerUnit: sold > 0 ? profit / sold : 0 }
      })
      .sort((a, b) => b.profit - a.profit)
  }, [batches, sales])

  const perPlatform = useMemo(() => {
    const map = {}
    sales.forEach((s) => {
      const p = s.platform || 'Onbekend'
      if (!map[p]) map[p] = { revenue: 0, count: 0, fees: 0 }
      map[p].revenue += (s.salePrice || 0) * (s.quantity || 1)
      map[p].count += s.quantity || 1
      map[p].fees += s.fees || 0
    })
    return Object.entries(map)
      .map(([platform, v]) => ({ platform, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [sales])

  const supplierChartData = perSupplier.map((s) => ({
    name: s.prefix,
    profit: Math.round(s.profit * 100) / 100,
    color: s.color,
  }))

  const TABS = [
    { id: 'overview', label: 'Overzicht' },
    { id: 'supplier', label: 'Per leverancier' },
    { id: 'batch', label: 'Per SKU' },
    { id: 'platform', label: 'Per platform' },
  ]

  const StatCard = ({ label, value, sub, green, accent }) => (
    <div className="stat-card">
      {accent && <div className="s-accent" style={{ background: accent }} />}
      <div className="s-label">{label}</div>
      <div className={`s-value${green ? ' green' : ''}`} style={{ fontSize: '1.3rem' }}>{value}</div>
      {sub && <div className="s-sub">{sub}</div>}
    </div>
  )

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Statistieken</h1>
          <div className="page-subtitle">{sales.length} verkopen geregistreerd</div>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard label="Totale omzet" value={formatCurrency(overview.totalRevenue)} sub={`${overview.totalSold} stuks verkocht`} accent="#ffd60a" />
        <StatCard label="Netto winst" value={formatCurrency(overview.totalProfit)} sub={`Marge ${overview.margin.toFixed(1)}%`} green={overview.totalProfit >= 0} accent="#00ff88" />
        <StatCard label="Geïnvesteerd" value={formatCurrency(overview.totalInvested)} sub={`${overview.totalStock} in voorraad`} accent="#888" />
        <StatCard label="Gem. winst/stuk" value={formatCurrency(overview.avgProfit)} sub={`Fees: ${formatCurrency(overview.totalFees)}`} green={overview.avgProfit >= 0} accent="#3ecfff" />
      </div>

      <div className="toggle-group" style={{ marginBottom: 24, maxWidth: 520 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`toggle-btn${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="glass-card">
          <div className="chart-section-label">Winst per leverancier</div>
          {supplierChartData.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px 0' }}>
              <div className="empty-icon">📊</div>
              <h3>Nog geen verkopen</h3>
              <p>Start met verkopen om statistieken te zien.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={supplierChartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                <XAxis
                  dataKey="name"
                  stroke="transparent"
                  tick={{ fill: tickColor, fontSize: 12, fontFamily: 'inherit' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  stroke="transparent"
                  tick={{ fill: tickColor, fontSize: 11, fontFamily: 'inherit' }}
                  tickFormatter={(v) => `€${v}`}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: cursorFill }} />
                <Bar dataKey="profit" radius={[6, 6, 0, 0]}>
                  {supplierChartData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {tab === 'supplier' && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Leverancier</th>
                <th>Verkocht</th>
                <th>Omzet</th>
                <th>Winst</th>
                <th>In stock</th>
              </tr>
            </thead>
            <tbody>
              {perSupplier.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>Geen data</td></tr>
              ) : (
                perSupplier.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <span className="sup-label">
                        <span className="sup-dot" style={{ background: s.color }} />
                        <span style={{ fontWeight: 600 }}>{s.prefix}</span>
                        <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>— {s.name}</span>
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-2)' }}>{s.sold}</td>
                    <td style={{ fontWeight: 600 }}>{formatCurrency(s.revenue)}</td>
                    <td>
                      <span style={{ color: s.profit >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                        {formatCurrency(s.profit)}
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

      {tab === 'batch' && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Naam / Merk</th>
                <th>Sup.</th>
                <th>Verkocht</th>
                <th>Omzet</th>
                <th>Winst</th>
                <th>Win/stuk</th>
                <th>Stock</th>
              </tr>
            </thead>
            <tbody>
              {perBatch.map((b) => {
                const color = getSupplierColor(suppliers, b.supplierPrefix)
                return (
                  <tr key={b.id}>
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
                    <td style={{ color: 'var(--text-2)' }}>{b.sold}</td>
                    <td style={{ fontWeight: 500 }}>{formatCurrency(b.revenue)}</td>
                    <td>
                      <span style={{ color: b.profit >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                        {formatCurrency(b.profit)}
                      </span>
                    </td>
                    <td style={{ color: b.profitPerUnit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {b.sold > 0 ? formatCurrency(b.profitPerUnit) : <span style={{ color: 'var(--text-3)' }}>—</span>}
                    </td>
                    <td style={{ color: 'var(--text-2)' }}>{b.remaining}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'platform' && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Platform</th>
                <th>Stuks</th>
                <th>Omzet</th>
                <th>Fees</th>
              </tr>
            </thead>
            <tbody>
              {perPlatform.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>Nog geen verkopen</td></tr>
              ) : (
                perPlatform.map((p) => (
                  <tr key={p.platform}>
                    <td style={{ fontWeight: 600 }}>{p.platform}</td>
                    <td style={{ color: 'var(--text-2)' }}>{p.count}</td>
                    <td style={{ fontWeight: 600 }}>{formatCurrency(p.revenue)}</td>
                    <td style={{ color: 'var(--red)' }}>-{formatCurrency(p.fees)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
