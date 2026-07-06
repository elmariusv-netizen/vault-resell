import { useMemo, useState, useEffect } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, Cell, LineChart, Line,
} from 'recharts'
import DateRangeFilter, { getDateBounds, filterByRange } from '../components/DateRangeFilter'
import {
  formatCurrency, formatSkuRange, calcSaleProfit,
  getRemainingQty, getSupplierColor, normalizePlatform,
  fetchBusinessCosts, sumCosts, getBatchUnitCost, detectTitleMeta,
} from '../utils/skuUtils'
import { supabase } from '../utils/supabase'

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
  const [businessCosts, setBusinessCosts] = useState([])
  // vintedOrderId -> title, enkel voor de beste-categorie/kleur/maat-analyse
  // hieronder — sales[] zelf heeft geen title-veld (dat leeft enkel op de
  // gekoppelde vinted_orders-rij), dus 1 lichte, aparte query i.p.v. de hele
  // rij per sale opnieuw op te vragen.
  const [orderTitles, setOrderTitles] = useState({})

  useEffect(() => { fetchBusinessCosts().then(setBusinessCosts) }, [])
  useEffect(() => {
    supabase.from('vinted_orders').select('id, title').then(({ data, error }) => {
      if (error) { console.warn('[Vault] order-titels ophalen mislukt:', error.message); return }
      const map = {}
      ;(data || []).forEach((row) => { map[row.id] = row.title })
      setOrderTitles(map)
    })
  }, [])

  const bounds = useMemo(() => getDateBounds(range, customFrom, customTo), [range, customFrom, customTo])
  const filteredSales = useMemo(() => filterByRange(sales, range, bounds), [sales, range, bounds])
  // business_costs gebruikt cost_date i.p.v. sales' date — filterByRange
  // verwacht een .date-veld, dus even mappen vóór het filteren.
  const filteredCosts = useMemo(
    () => filterByRange(businessCosts.map((c) => ({ ...c, date: c.cost_date })), range, bounds),
    [businessCosts, range, bounds]
  )

  const overview = useMemo(() => {
    const paid = filteredSales.filter((s) => !s.isFree)
    const totalRevenue = paid.reduce((s, x) => s + (x.salePrice || 0) * (x.quantity || 1), 0)
    const totalSold = filteredSales.reduce((s, x) => s + (x.quantity || 1), 0)
    const salesProfit = filteredSales.reduce((s, sale) => {
      const b = batches.find((x) => x.id === sale.batchId)
      return b ? s + calcSaleProfit(sale, b).profit : s
    }, 0)
    const totalCosts = sumCosts(filteredCosts)
    const totalProfit = salesProfit - totalCosts
    const totalInvested = batches.reduce((s, b) => s + getBatchUnitCost(b) * b.quantity, 0)
    const totalStock = batches.reduce((s, b) => s + getRemainingQty(b, sales), 0)
    const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
    const avgProfit = totalSold > 0 ? totalProfit / totalSold : 0
    const avgSale = paid.length > 0 ? totalRevenue / paid.length : 0
    return { totalRevenue, totalSold, totalProfit, totalCosts, totalInvested, totalStock, margin, avgProfit, avgSale, orders: paid.length }
  }, [filteredSales, filteredCosts, batches, sales])

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

  // Winst over tijd — per maand, gebaseerd op dezelfde calcSaleProfit() als
  // de rest van deze pagina, geen aparte winstdefinitie.
  const profitOverTime = useMemo(() => {
    const byMonth = {}
    filteredSales.forEach((s) => {
      if (!s.date) return
      const b = batches.find((x) => x.id === s.batchId)
      const profit = b ? calcSaleProfit(s, b).profit : 0
      const m = s.date.substring(0, 7)
      byMonth[m] = (byMonth[m] || 0) + profit
    })
    return Object.entries(byMonth).sort().map(([m, profit]) => ({
      label: new Date(m + '-01').toLocaleString('nl-BE', { month: 'short', year: '2-digit' }),
      profit: Math.round(profit * 100) / 100,
    }))
  }, [filteredSales, batches])

  // Omzet/winst per merk (batch.brand) — merkloze batches vallen onder
  // "Onbekend" i.p.v. stilzwijgend weg te vallen.
  const perBrand = useMemo(() => {
    const map = {}
    filteredSales.forEach((s) => {
      const b = batches.find((x) => x.id === s.batchId)
      const brand = b?.brand?.trim() || 'Onbekend'
      if (!map[brand]) map[brand] = { revenue: 0, profit: 0, sold: 0 }
      map[brand].revenue += (s.salePrice || 0) * (s.quantity || 1)
      map[brand].profit += b ? calcSaleProfit(s, b).profit : 0
      map[brand].sold += s.quantity || 1
    })
    return Object.entries(map)
      .map(([brand, v]) => ({ brand, ...v, margin: v.revenue > 0 ? (v.profit / v.revenue) * 100 : 0 }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [filteredSales, batches])

  // Beste categorie/kleur/maat — herleid uit de titel van de gekoppelde
  // Vinted-order (orderTitles hierboven) via detectTitleMeta() (skuUtils.js).
  // Categorie geeft voorrang aan de titel-keyword-match (specifieker, bv.
  // "T-shirts"/"Truien") en valt pas terug op de eigen batch.category (vaak
  // een grove, generieke waarde als "Kleding") als de titel geen keyword
  // opleverde. Sales zonder titel (handmatige verkoop, geen gekoppelde
  // Vinted-order) EN zonder batch.category vallen onder "Onbekend", dezelfde
  // aanpak als perBrand hierboven.
  const titleMetaStats = useMemo(() => {
    const byCategory = {}, byColor = {}, bySize = {}
    const bump = (map, key, sale) => {
      const k = key || 'Onbekend'
      if (!map[k]) map[k] = { revenue: 0, sold: 0 }
      map[k].revenue += (sale.salePrice || 0) * (sale.quantity || 1)
      map[k].sold += sale.quantity || 1
    }
    filteredSales.forEach((s) => {
      const b = batches.find((x) => x.id === s.batchId)
      const title = (s.vintedOrderId && orderTitles[s.vintedOrderId]) || ''
      const meta = detectTitleMeta(title)
      bump(byCategory, meta.category || b?.category?.trim(), s)
      bump(byColor, meta.color, s)
      bump(bySize, meta.size, s)
    })
    const topOf = (map) => Object.entries(map)
      .map(([name, v]) => ({ name, ...v }))
      .filter((e) => e.name !== 'Onbekend')
      .sort((a, b) => b.sold - a.sold)[0] || null
    return { topCategory: topOf(byCategory), topColor: topOf(byColor), topSize: topOf(bySize) }
  }, [filteredSales, batches, orderTitles])

  const TABS = [
    { id: 'overview', label: 'Overzicht' },
    { id: 'supplier', label: 'Leveranciers' },
    { id: 'brand', label: 'Merk' },
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
          { label: 'Netto winst', value: formatCurrency(overview.totalProfit), sub: overview.totalCosts > 0 ? `Marge ${overview.margin.toFixed(1)}% · -${formatCurrency(overview.totalCosts)} kosten` : `Marge ${overview.margin.toFixed(1)}%`, accent: '#22c55e', green: overview.totalProfit >= 0 },
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

      {/* Beste categorie/kleur/maat — herleid uit producttitels, zie titleMetaStats */}
      {(titleMetaStats.topCategory || titleMetaStats.topColor || titleMetaStats.topSize) && (
        <div className="stats-grid" style={{ marginBottom: 20 }}>
          {[
            { label: 'Beste categorie', top: titleMetaStats.topCategory, accent: '#a78bfa' },
            { label: 'Beste kleur', top: titleMetaStats.topColor, accent: '#f472b6' },
            { label: 'Beste maat', top: titleMetaStats.topSize, accent: '#60a5fa' },
          ].map((c) => (
            <div className="stat-card" key={c.label}>
              <div className="s-accent" style={{ background: c.accent }} />
              <div className="s-label">{c.label}</div>
              <div className="s-value" style={{ fontSize: '1.3rem' }}>{c.top ? c.top.name : '—'}</div>
              <div className="s-sub">{c.top ? `${c.top.sold} verkocht · ${formatCurrency(c.top.revenue)}` : 'Nog geen data'}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="toggle-group" style={{ marginBottom: 20, maxWidth: 600 }}>
        {TABS.map((t) => (
          <button key={t.id} className={`toggle-btn${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview: profit over time ── */}
      {tab === 'overview' && (
        <div className="glass-card" style={{ marginBottom: 20 }}>
          <div className="chart-section-label">Winst over tijd</div>
          {profitOverTime.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px 0' }}>
              <div className="empty-icon">📈</div>
              <h3>Nog geen verkopen</h3>
              <p>Start met verkopen om deze grafiek te vullen.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={profitOverTime} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                <XAxis dataKey="label" stroke="transparent" tick={{ fill: tickColor, fontSize: 12, fontFamily: 'inherit' }} axisLine={false} tickLine={false} />
                <YAxis stroke="transparent" tick={{ fill: tickColor, fontSize: 11, fontFamily: 'inherit' }} tickFormatter={(v) => `€${v}`} axisLine={false} tickLine={false} width={52} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: cursorFill }} />
                <Line type="monotone" dataKey="profit" stroke="#22c55e" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

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

      {/* ── Omzet/winst per merk ── */}
      {tab === 'brand' && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Merk</th>
                <th>Verkocht</th>
                <th>Omzet</th>
                <th>Winst</th>
                <th>Marge</th>
              </tr>
            </thead>
            <tbody>
              {perBrand.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>Nog geen verkopen</td></tr>
              ) : (
                perBrand.map((b) => (
                  <tr key={b.brand}>
                    <td style={{ fontWeight: 600 }}>{b.brand}</td>
                    <td style={{ color: 'var(--text-2)' }}>{b.sold}</td>
                    <td style={{ fontWeight: 600 }}>{formatCurrency(b.revenue)}</td>
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
