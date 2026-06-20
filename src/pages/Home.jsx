import { useMemo, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  Tooltip, CartesianGrid, PieChart, Pie, Cell,
} from 'recharts'
import SaleModal from '../components/SaleModal'
import {
  formatCurrency, formatDate, formatSkuRange,
  getRemainingQty, calcSaleProfit,
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
        <div key={i} style={{ color: p.color, fontWeight: 700, fontSize: 15 }}>
          {formatCurrency(p.value)}
        </div>
      ))}
    </div>
  )
}

const DonutTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '8px 14px',
      boxShadow: 'var(--shadow-md)',
    }}>
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 2 }}>{payload[0].name}</div>
      <div style={{ color: payload[0].payload.color, fontWeight: 700 }}>
        {payload[0].value} stuks
      </div>
    </div>
  )
}

export default function Home({ data, updateData, onNavigate, theme }) {
  const isDark = theme === 'dark'
  const tickColor = isDark ? '#636366' : '#9e9e9e'
  const gridStroke = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
  const lineColor = isDark ? '#30d158' : '#16a34a'
  const { batches, sales, suppliers } = data
  const [showSale, setShowSale] = useState(false)

  const stats = useMemo(() => {
    const totalItems = batches.reduce((s, b) => s + getRemainingQty(b, sales), 0)
    const totalInvested = batches.reduce(
      (s, b) => s + ((b.costPrice || 0) + (b.importTax || 0)) * b.quantity, 0
    )
    const totalRevenue = sales.reduce((s, x) => s + (x.salePrice || 0) * (x.quantity || 1), 0)
    const totalProfit = sales.reduce((s, sale) => {
      const b = batches.find((x) => x.id === sale.batchId)
      return b ? s + calcSaleProfit(sale, b).profit : s
    }, 0)
    const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
    return { totalItems, totalInvested, totalRevenue, totalProfit, margin }
  }, [batches, sales])

  const profitChartData = useMemo(() => {
    const byMonth = {}
    const sorted = [...sales].sort((a, b) => new Date(a.date) - new Date(b.date))
    sorted.forEach((sale) => {
      if (!sale.date) return
      const month = sale.date.substring(0, 7)
      const batch = batches.find((b) => b.id === sale.batchId)
      if (!batch) return
      byMonth[month] = (byMonth[month] || 0) + calcSaleProfit(sale, batch).profit
    })
    let cumulative = 0
    return Object.entries(byMonth)
      .sort()
      .map(([month, profit]) => {
        cumulative += profit
        const [y, m] = month.split('-')
        const label = new Date(parseInt(y), parseInt(m) - 1).toLocaleString('nl-BE', {
          month: 'short', year: '2-digit',
        })
        return {
          name: label,
          profit: Math.round(profit * 100) / 100,
          cumulative: Math.round(cumulative * 100) / 100,
        }
      })
  }, [sales, batches])

  const inventoryData = useMemo(
    () =>
      suppliers
        .map((s) => ({
          name: s.prefix,
          fullName: s.name,
          value: batches
            .filter((b) => b.supplierPrefix === s.prefix)
            .reduce((sum, b) => sum + getRemainingQty(b, sales), 0),
          color: s.color,
        }))
        .filter((d) => d.value > 0),
    [suppliers, batches, sales]
  )

  const totalStock = inventoryData.reduce((s, d) => s + d.value, 0)

  const recentSales = useMemo(
    () => [...sales].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6),
    [sales]
  )

  const handleSaveSale = (sale) => {
    const updates = { sales: [...sales, sale] }
    if (sale.fromLive) {
      updates.batches = batches.map((b) =>
        b.id === sale.batchId
          ? { ...b, liveCount: Math.max(0, (b.liveCount || 0) - (sale.quantity || 1)) }
          : b
      )
    }
    updateData(updates)
  }

  const STAT_CARDS = [
    { label: 'In voorraad', value: stats.totalItems, suffix: ' stuks', color: '#3ecfff' },
    { label: 'Geïnvesteerd', value: formatCurrency(stats.totalInvested), color: '#888', isCurrency: true },
    { label: 'Totale omzet', value: formatCurrency(stats.totalRevenue), color: '#ffd60a', isCurrency: true },
    { label: 'Netto winst', value: formatCurrency(stats.totalProfit), color: '#00ff88', isCurrency: true, isGreen: stats.totalProfit >= 0 },
  ]

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <div className="page-subtitle">Welkom terug · {new Date().toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowSale(true)}>
          + Verkoop registreren
        </button>
      </div>

      {/* Stat cards */}
      <div className="stats-grid">
        {STAT_CARDS.map((c, i) => (
          <div className="stat-card" key={i}>
            <div className="s-accent" style={{ background: c.color }} />
            <div className="s-label">{c.label}</div>
            <div className={`s-value${c.isGreen ? ' green' : ''}`} style={{ fontSize: '1.4rem' }}>
              {c.isCurrency ? c.value : c.value + (c.suffix || '')}
            </div>
            {i === 3 && (
              <div className="s-sub">Marge: {stats.margin.toFixed(1)}%</div>
            )}
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="charts-grid">
        {/* Line chart */}
        <div className="glass-card">
          <div className="chart-section-label">Cumulatieve winst</div>
          {profitChartData.length === 0 ? (
            <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center', color: 'var(--text-3)' }}>
                <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.4 }}>📈</div>
                <div style={{ fontSize: 13 }}>Nog geen verkopen om te tonen</div>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={profitChartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="greenGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={lineColor} stopOpacity={0.14} />
                    <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                <XAxis
                  dataKey="name"
                  stroke="transparent"
                  tick={{ fill: tickColor, fontSize: 11, fontFamily: 'inherit' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  stroke="transparent"
                  tick={{ fill: tickColor, fontSize: 11, fontFamily: 'inherit' }}
                  tickFormatter={(v) => `€${v}`}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: gridStroke, strokeWidth: 1 }} />
                <Line
                  type="monotone"
                  dataKey="cumulative"
                  stroke={lineColor}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 5, fill: lineColor, strokeWidth: 0 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Donut chart */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="chart-section-label">Voorraad per leverancier</div>
          {inventoryData.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13 }}>
              Geen voorraad
            </div>
          ) : (
            <>
              <div style={{ position: 'relative', height: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={inventoryData}
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={76}
                      paddingAngle={3}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      {inventoryData.map((e, i) => (
                        <Cell key={i} fill={e.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<DonutTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{
                  position: 'absolute', top: '50%', left: '50%',
                  transform: 'translate(-50%,-50%)',
                  textAlign: 'center', pointerEvents: 'none',
                }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>{totalStock}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>stuks</div>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                {inventoryData.map((d, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, display: 'inline-block' }} />
                      <span style={{ color: 'var(--text-2)' }}>{d.name}</span>
                    </div>
                    <span style={{ color: d.color, fontWeight: 600 }}>{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Recent sales */}
      <div className="glass-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div className="chart-section-label" style={{ margin: 0 }}>Recente verkopen</div>
          {sales.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('stats')}>
              Bekijk alles →
            </button>
          )}
        </div>

        {recentSales.length === 0 ? (
          <div style={{ padding: '32px 0', textAlign: 'center' }}>
            <div style={{ color: 'var(--text-3)', fontSize: 13 }}>
              Nog geen verkopen. <button className="btn btn-ghost btn-sm" style={{ display: 'inline' }} onClick={() => setShowSale(true)}>Registreer je eerste verkoop →</button>
            </div>
          </div>
        ) : (
          recentSales.map((s) => {
            const b = batches.find((x) => x.id === s.batchId)
            const p = b ? calcSaleProfit(s, b) : null
            const sup = suppliers.find((x) => b && x.prefix === b.supplierPrefix)
            return (
              <div className="activity-item" key={s.id}>
                <div
                  style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: (sup?.color || '#333') + '18',
                    border: `1px solid ${(sup?.color || '#333')}30`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, fontSize: 14,
                  }}
                >
                  {s.platform === 'Vinted' ? '🏷' : s.platform === 'B2B' ? '🤝' : '👤'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                    {b ? formatSkuRange(b.supplierPrefix, b.startNum, b.endNum) : '?'}
                    {s.quantity > 1 && (
                      <span style={{ color: 'var(--text-3)', fontWeight: 400 }}> ×{s.quantity}</span>
                    )}
                    <span
                      style={{
                        marginLeft: 8, fontSize: 10, fontWeight: 600,
                        background: 'var(--bg-2)',
                        padding: '2px 7px', borderRadius: 6, color: 'var(--text-3)',
                      }}
                    >
                      {s.platform}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                    {formatDate(s.date)}{s.buyer ? ` · ${s.buyer}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>
                    {formatCurrency((s.salePrice || 0) * (s.quantity || 1))}
                  </div>
                  {p && (
                    <div style={{ fontSize: 11, color: p.profit >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600, marginTop: 1 }}>
                      {p.profit >= 0 ? '+' : ''}{formatCurrency(p.profit)}
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Quick nav */}
      <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
        {[
          { label: 'Bekijk voorraad', page: 'inventory' },
          { label: 'Statistieken', page: 'stats' },
          { label: 'Nieuwe aankoop', page: 'new' },
        ].map((l) => (
          <button key={l.page} className="btn btn-secondary" onClick={() => onNavigate(l.page)}>
            {l.label} →
          </button>
        ))}
      </div>

      {showSale && (
        <SaleModal data={data} onClose={() => setShowSale(false)} onSave={handleSaveSale} />
      )}
    </div>
  )
}
