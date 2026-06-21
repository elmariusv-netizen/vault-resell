import { useMemo, useState } from 'react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  Tooltip, CartesianGrid, PieChart, Pie, Cell,
} from 'recharts'
import SaleModal from '../components/SaleModal'
import {
  formatCurrency, formatDate, formatSkuRange,
  getRemainingQty, calcSaleProfit, normalizePlatform,
} from '../utils/skuUtils'

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '10px 14px',
      boxShadow: 'var(--shadow-md)',
      minWidth: 120,
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6, fontWeight: 600 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ fontSize: 14, fontWeight: 700, color: p.color }}>
          {formatCurrency(p.value)}
        </div>
      ))}
    </div>
  )
}

function SalesHeatmap({ sales, isDark }) {
  const salesByDay = useMemo(() => {
    const byDay = {}
    sales.forEach((s) => {
      if (s.date) byDay[s.date] = (byDay[s.date] || 0) + (s.quantity || 1)
    })
    return byDay
  }, [sales])

  const numWeeks = 16
  const today = new Date()
  const start = new Date(today.getTime() - numWeeks * 7 * 86400000)
  const dow = start.getDay()
  start.setDate(start.getDate() + (dow === 0 ? -6 : 1 - dow))

  const weeks = []
  const monthLabels = []
  const cursor = new Date(start)
  let currentMonth = -1

  for (let w = 0; w <= numWeeks; w++) {
    const week = []
    for (let d = 0; d < 7; d++) {
      const dateStr = cursor.toISOString().split('T')[0]
      const month = cursor.getMonth()
      if (d === 0 && month !== currentMonth) {
        currentMonth = month
        monthLabels.push({
          weekIndex: w,
          label: cursor.toLocaleString('nl-BE', { month: 'short' }),
        })
      }
      week.push({ date: dateStr, count: salesByDay[dateStr] || 0 })
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(week)
  }

  const maxCount = Math.max(1, ...Object.values(salesByDay))

  const getColor = (count) => {
    if (count === 0) return isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)'
    const pct = count / maxCount
    if (pct < 0.25) return isDark ? 'rgba(10,132,255,0.28)' : 'rgba(37,99,235,0.22)'
    if (pct < 0.5)  return isDark ? 'rgba(10,132,255,0.52)' : 'rgba(37,99,235,0.48)'
    if (pct < 0.75) return isDark ? 'rgba(10,132,255,0.76)' : 'rgba(37,99,235,0.72)'
    return isDark ? '#0a84ff' : '#2563eb'
  }

  const dayLabels = ['Ma', '', 'Wo', '', 'Vr', '', 'Zo']
  const cellSize = 12
  const cellGap = 3

  const totalSales = Object.values(salesByDay).reduce((s, n) => s + n, 0)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div className="chart-section-label" style={{ margin: 0 }}>Verkoopactiviteit</div>
        {totalSales > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{totalSales} verkopen (16 weken)</span>
        )}
      </div>
      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <div style={{ display: 'inline-block', minWidth: 'max-content' }}>
          {/* Month labels */}
          <div style={{ display: 'flex', marginLeft: 26, marginBottom: 5 }}>
            {weeks.map((_, wi) => {
              const ml = monthLabels.find((m) => m.weekIndex === wi)
              return (
                <div key={wi} style={{ width: cellSize + cellGap, flexShrink: 0, fontSize: 9, color: 'var(--text-3)', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>
                  {ml?.label || ''}
                </div>
              )
            })}
          </div>
          {/* Grid */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: cellGap, marginRight: 6, width: 20 }}>
              {dayLabels.map((l, i) => (
                <div key={i} style={{ height: cellSize, lineHeight: `${cellSize}px`, fontSize: 9, color: 'var(--text-3)', textAlign: 'right', fontWeight: 500 }}>
                  {l}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: cellGap }}>
              {weeks.map((week, wi) => (
                <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: cellGap }}>
                  {week.map((day, di) => (
                    <div
                      key={di}
                      title={`${day.date}: ${day.count} ${day.count === 1 ? 'verkoop' : 'verkopen'}`}
                      style={{
                        width: cellSize,
                        height: cellSize,
                        borderRadius: 2,
                        background: getColor(day.count),
                        transition: 'opacity 0.1s',
                        cursor: day.count > 0 ? 'default' : 'default',
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          {/* Legend */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 9, color: 'var(--text-3)' }}>Minder</span>
            {[0, 0.3, 0.6, 1].map((pct, i) => (
              <div
                key={i}
                style={{
                  width: cellSize, height: cellSize, borderRadius: 2,
                  background: pct === 0
                    ? (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)')
                    : (isDark ? `rgba(10,132,255,${0.28 + pct * 0.72})` : `rgba(37,99,235,${0.22 + pct * 0.78})`),
                }}
              />
            ))}
            <span style={{ fontSize: 9, color: 'var(--text-3)' }}>Meer</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Home({ data, updateData, onNavigate, theme }) {
  const isDark = theme === 'dark'
  const tickColor = isDark ? '#636366' : '#9e9e9e'
  const gridStroke = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
  const lineColor = isDark ? '#30d158' : '#16a34a'
  const areaColor = isDark ? 'rgba(48,209,88,0.12)' : 'rgba(22,163,74,0.1)'

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
    { label: 'In voorraad', value: `${stats.totalItems} stuks`, color: '#3ecfff' },
    { label: 'Geïnvesteerd', value: formatCurrency(stats.totalInvested), color: '#888' },
    { label: 'Totale omzet', value: formatCurrency(stats.totalRevenue), color: '#ffd60a' },
    {
      label: 'Netto winst',
      value: formatCurrency(stats.totalProfit),
      color: stats.totalProfit >= 0 ? 'var(--green)' : 'var(--red)',
      sub: `Marge ${stats.margin.toFixed(1)}%`,
    },
  ]

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <div className="page-subtitle">
            {new Date().toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
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
            <div className="s-value" style={{ color: c.color, fontSize: '1.35rem' }}>{c.value}</div>
            {c.sub && <div className="s-sub">{c.sub}</div>}
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="charts-grid">
        {/* Premium area chart */}
        <div className="glass-card">
          <div className="chart-section-label">Cumulatieve winst</div>
          {profitChartData.length === 0 ? (
            <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center', color: 'var(--text-3)' }}>
                <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>📈</div>
                <div style={{ fontSize: 13 }}>Nog geen verkopen</div>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={profitChartData} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={lineColor} stopOpacity={0.2} />
                    <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="0" stroke={gridStroke} vertical={false} />
                <XAxis
                  dataKey="name"
                  stroke="transparent"
                  tick={{ fill: tickColor, fontSize: 10, fontFamily: 'inherit', fontWeight: 500 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  stroke="transparent"
                  tick={{ fill: tickColor, fontSize: 10, fontFamily: 'inherit' }}
                  tickFormatter={(v) => `€${v}`}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: gridStroke, strokeWidth: 1.5 }} />
                <Area
                  type="monotone"
                  dataKey="cumulative"
                  stroke={lineColor}
                  strokeWidth={2}
                  fill="url(#profitGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: lineColor, strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Inventory donut */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="chart-section-label">Voorraad per leverancier</div>
          {inventoryData.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13 }}>
              Geen voorraad
            </div>
          ) : (
            <>
              <div style={{ position: 'relative', height: 150 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={inventoryData}
                      cx="50%"
                      cy="50%"
                      innerRadius={44}
                      outerRadius={64}
                      paddingAngle={3}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      {inventoryData.map((e, i) => (
                        <Cell key={i} fill={e.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div style={{
                  position: 'absolute', top: '50%', left: '50%',
                  transform: 'translate(-50%,-50%)',
                  textAlign: 'center', pointerEvents: 'none',
                }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>{totalStock}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>stuks</div>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 }}>
                {inventoryData.map((d, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: d.color, display: 'inline-block' }} />
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

      {/* Sales heatmap */}
      <div className="glass-card">
        <SalesHeatmap sales={sales} isDark={isDark} />
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
          <div style={{ padding: '28px 0', textAlign: 'center' }}>
            <div style={{ color: 'var(--text-3)', fontSize: 13 }}>
              Nog geen verkopen.{' '}
              <button className="btn btn-ghost btn-sm" style={{ display: 'inline' }} onClick={() => setShowSale(true)}>
                Registreer je eerste verkoop →
              </button>
            </div>
          </div>
        ) : (
          recentSales.map((s) => {
            const b = batches.find((x) => x.id === s.batchId)
            const p = b ? calcSaleProfit(s, b) : null
            const sup = suppliers.find((x) => b && x.prefix === b.supplierPrefix)
            const platformDisplay = normalizePlatform(s.platform)
            const shortPlatform = platformDisplay === 'Medeverkoper/Groothandel' ? 'B2B' : platformDisplay === 'Privé persoon' ? 'Privé' : platformDisplay
            return (
              <div className="activity-item" key={s.id}>
                <div
                  style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: (sup?.color || '#333') + '18',
                    border: `1px solid ${(sup?.color || '#333')}30`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, fontSize: 14, overflow: 'hidden',
                  }}
                >
                  {s.photo
                    ? <img src={s.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : (s.platform === 'Vinted' ? '🏷' : (s.platform === 'B2B' || s.platform === 'Medeverkoper/Groothandel') ? '🤝' : '👤')}
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
                        padding: '2px 6px', borderRadius: 5, color: 'var(--text-3)',
                      }}
                    >
                      {shortPlatform}
                    </span>
                    {s.isFree && (
                      <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>GRATIS</span>
                    )}
                    {s.shipped && (
                      <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--blue)', fontWeight: 600 }}>VERZONDEN</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                    {formatDate(s.date)}{s.buyer ? ` · ${s.buyer}` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  {s.isFree ? (
                    <div style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600 }}>Gratis</div>
                  ) : (
                    <div style={{ fontSize: 14, fontWeight: 700 }}>
                      {formatCurrency((s.salePrice || 0) * (s.quantity || 1))}
                    </div>
                  )}
                  {p && !s.isFree && (
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
