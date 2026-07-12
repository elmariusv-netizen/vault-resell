import { useMemo, useState, useEffect } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, Cell, LineChart, Line, Legend,
} from 'recharts'
import DateRangeFilter, { getDateBounds, filterByRange } from '../components/DateRangeFilter'
import {
  formatCurrency, calcSaleProfit,
  getRemainingQty, normalizePlatform,
  fetchBusinessCosts, sumCosts, getBatchUnitCost, detectTitleMeta, orderKey,
} from '../utils/skuUtils'
import { supabase } from '../utils/supabase'

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', boxShadow: 'var(--shadow-md)' }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 5 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || p.fill || 'var(--green)', fontWeight: 700, fontSize: 14 }}>
          {p.name && payload.length > 1 && <span style={{ fontWeight: 500, marginRight: 6 }}>{p.name}:</span>}
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
  const [platformFilter, setPlatformFilter] = useState('all')
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
  // Alle platforms staan standaard samen in de cijfers — platformFilter is
  // optioneel en verfijnt enkel wanneer de gebruiker 'm expliciet instelt.
  const availablePlatforms = useMemo(
    () => [...new Set(sales.map((s) => normalizePlatform(s.platform)).filter(Boolean))].sort(),
    [sales]
  )
  const filteredSales = useMemo(() => {
    const byDate = filterByRange(sales, range, bounds)
    return platformFilter === 'all' ? byDate : byDate.filter((s) => normalizePlatform(s.platform) === platformFilter)
  }, [sales, range, bounds, platformFilter])
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
    // Aantal DISTINCTE bestellingen, niet aantal sales-regels — zelfde
    // orderKey()-groepering als Home.jsx's Dashboard, anders telt een
    // bundelverkoop (meerdere sales-regels, 1 Vinted-order) hier als
    // meerdere "bestellingen" i.p.v. 1.
    const orders = new Set(paid.map(orderKey)).size
    const avgSale = orders > 0 ? totalRevenue / orders : 0
    return { totalRevenue, totalSold, totalProfit, totalCosts, totalInvested, totalStock, margin, avgProfit, avgSale, orders }
  }, [filteredSales, filteredCosts, batches, sales])

  // Trend-vergelijking — vergelijkt de huidige periode met de onmiddellijk
  // voorafgaande periode van dezelfde lengte (bv. "deze week" vs de week
  // ervoor). Enkel zinvol bij een begrensde periode, dus niet bij "Alle tijd"
  // (geen eenduidige "vorige periode" mogelijk over de volledige historiek).
  const trend = useMemo(() => {
    if (range === 'all') return null
    const periodMs = bounds.to - bounds.from
    if (periodMs <= 0) return null
    const prevFrom = new Date(bounds.from.getTime() - periodMs)
    const prevTo = new Date(bounds.from.getTime() - 1)
    const prevSales = sales.filter((s) => {
      if (!s.date) return false
      const d = new Date(s.date)
      if (d < prevFrom || d > prevTo) return false
      return platformFilter === 'all' || normalizePlatform(s.platform) === platformFilter
    })
    const paid = prevSales.filter((s) => !s.isFree)
    const revenue = paid.reduce((s, x) => s + (x.salePrice || 0) * (x.quantity || 1), 0)
    const profit = prevSales.reduce((s, sale) => {
      const b = batches.find((x) => x.id === sale.batchId)
      return b ? s + calcSaleProfit(sale, b).profit : s
    }, 0)
    const pctChange = (curr, prev) => {
      if (prev === 0) return curr === 0 ? 0 : 100
      return ((curr - prev) / Math.abs(prev)) * 100
    }
    return {
      revenue, profit,
      revenueChange: pctChange(overview.totalRevenue, revenue),
      profitChange: pctChange(overview.totalProfit, profit),
    }
  }, [range, bounds, sales, platformFilter, batches, overview.totalRevenue, overview.totalProfit])

  // Verkooptijd — dagen tussen batch.purchaseDate (inkoopdatum) en sale.date
  // (verkoopdatum), enkel voor sales waar beide data bekend zijn. Negatieve
  // waarden (bv. foutieve/ontbrekende datums) worden genegeerd i.p.v. het
  // gemiddelde te verstoren.
  const sellTimeStats = useMemo(() => {
    let totalDays = 0, count = 0
    const perSupplierDays = {}
    filteredSales.forEach((s) => {
      const b = batches.find((x) => x.id === s.batchId)
      if (!b?.purchaseDate || !s.date) return
      const days = (new Date(s.date) - new Date(b.purchaseDate)) / 86400000
      if (days < 0) return
      const qty = s.quantity || 1
      totalDays += days * qty
      count += qty
      if (!perSupplierDays[b.supplierPrefix]) perSupplierDays[b.supplierPrefix] = { totalDays: 0, count: 0 }
      perSupplierDays[b.supplierPrefix].totalDays += days * qty
      perSupplierDays[b.supplierPrefix].count += qty
    })
    const bySupplier = {}
    Object.entries(perSupplierDays).forEach(([prefix, v]) => {
      bySupplier[prefix] = v.count > 0 ? v.totalDays / v.count : null
    })
    return { avgDays: count > 0 ? totalDays / count : null, bySupplier }
  }, [filteredSales, batches])

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
        const avgSellDays = sellTimeStats.bySupplier[sup.prefix] ?? null
        return { ...sup, revenue, profit, sold, stock, margin, avgSellDays }
      })
      .filter((s) => s.stock > 0 || s.sold > 0)
      .sort((a, b) => b.revenue - a.revenue)
  }, [suppliers, batches, filteredSales, sales, sellTimeStats])

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

  // Omzet/winst per merk — herleid uit de titel van de gekoppelde
  // Vinted-order (orderTitles hierboven, zelfde aanpak als de categorie/
  // kleur-detectie via detectTitleMeta()) i.p.v. batch.brand: dat is een
  // vrij, handmatig tekstveld dat lang niet elke batch heeft, waardoor dit
  // tabblad voorheen grotendeels onder "Onbekend" viel. Valt terug op
  // batch.brand als de titel geen herkenbaar merk oplevert (bv. handmatige
  // verkoop zonder gekoppelde Vinted-order), en pas dan op "Onbekend".
  const perBrand = useMemo(() => {
    const map = {}
    filteredSales.forEach((s) => {
      const b = batches.find((x) => x.id === s.batchId)
      const title = (s.vintedOrderId && orderTitles[s.vintedOrderId]) || ''
      const brand = detectTitleMeta(title).brand || b?.brand?.trim() || 'Onbekend'
      if (!map[brand]) map[brand] = { revenue: 0, profit: 0, sold: 0 }
      map[brand].revenue += (s.salePrice || 0) * (s.quantity || 1)
      map[brand].profit += b ? calcSaleProfit(s, b).profit : 0
      map[brand].sold += s.quantity || 1
    })
    return Object.entries(map)
      .map(([brand, v]) => ({ brand, ...v, margin: v.revenue > 0 ? (v.profit / v.revenue) * 100 : 0 }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [filteredSales, batches, orderTitles])

  // Beste categorie — herleid uit de titel van de gekoppelde Vinted-order
  // (orderTitles hierboven) via detectTitleMeta() (skuUtils.js), gerankt op
  // GEMIDDELDE WINST PER STUK (niet totale categorie-winst of aantal
  // verkocht) — zo kan een categorie met 2 dure, hoge-marge items winnen
  // van een categorie met 20 goedkope items en een lage marge per stuk.
  // Categorie geeft voorrang aan de titel-keyword-match (specifieker, bv.
  // "T-shirts"/"Truien") en valt pas terug op de eigen batch.category (vaak
  // een grove, generieke waarde als "Kleding") als de titel geen keyword
  // opleverde. Sales zonder titel (handmatige verkoop, geen gekoppelde
  // Vinted-order) EN zonder batch.category vallen onder "Onbekend".
  const titleMetaStats = useMemo(() => {
    const byCategory = {}
    filteredSales.forEach((s) => {
      const b = batches.find((x) => x.id === s.batchId)
      const title = (s.vintedOrderId && orderTitles[s.vintedOrderId]) || ''
      const meta = detectTitleMeta(title)
      const key = meta.category || b?.category?.trim() || 'Onbekend'
      if (!byCategory[key]) byCategory[key] = { revenue: 0, profit: 0, sold: 0 }
      byCategory[key].revenue += (s.salePrice || 0) * (s.quantity || 1)
      byCategory[key].profit += b ? calcSaleProfit(s, b).profit : 0
      byCategory[key].sold += s.quantity || 1
    })
    const topCategory = Object.entries(byCategory)
      .map(([name, v]) => ({ name, ...v, avgProfitPerItem: v.sold > 0 ? v.profit / v.sold : 0 }))
      .filter((e) => e.name !== 'Onbekend')
      .sort((a, b) => b.avgProfitPerItem - a.avgProfitPerItem)[0] || null
    return { topCategory }
  }, [filteredSales, batches, orderTitles])

  const TABS = [
    { id: 'overview', label: 'Overzicht' },
    { id: 'supplier', label: 'Leveranciers' },
    { id: 'brand', label: 'Merk' },
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
      <div style={{ marginBottom: 12 }}>
        <DateRangeFilter
          value={range} onChange={setRange}
          customFrom={customFrom} customTo={customTo}
          onCustom={(k, v) => k === 'from' ? setCustomFrom(v) : setCustomTo(v)}
        />
      </div>

      {/* Platform filter — standaard alle platforms samen */}
      {availablePlatforms.length > 1 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
          <button
            onClick={() => setPlatformFilter('all')}
            className={`filter-chip${platformFilter === 'all' ? ' active' : ''}`}
          >
            Alle platforms
          </button>
          {availablePlatforms.map((p) => (
            <button
              key={p}
              onClick={() => setPlatformFilter(p)}
              className={`filter-chip${platformFilter === p ? ' active' : ''}`}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Overview stat cards */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        {[
          { label: 'Totale omzet', value: formatCurrency(overview.totalRevenue), sub: `${overview.orders} bestellingen`, accent: '#ffd60a', trendPct: trend?.revenueChange },
          { label: 'Netto winst', value: formatCurrency(overview.totalProfit), sub: overview.totalCosts > 0 ? `Marge ${overview.margin.toFixed(1)}% · -${formatCurrency(overview.totalCosts)} kosten` : `Marge ${overview.margin.toFixed(1)}%`, accent: '#22c55e', green: overview.totalProfit >= 0, trendPct: trend?.profitChange },
          { label: 'Geïnvesteerd', value: formatCurrency(overview.totalInvested), sub: `${overview.totalStock} in voorraad`, accent: '#888' },
          { label: 'Gem. winst/stuk', value: formatCurrency(overview.avgProfit), sub: `${overview.totalSold} stuks verkocht`, accent: '#3ecfff', green: overview.avgProfit >= 0 },
        ].map((c) => (
          <div className="stat-card" key={c.label}>
            <div className="s-accent" style={{ background: c.accent }} />
            <div className="s-label">{c.label}</div>
            <div className={`s-value${c.green ? ' green' : ''}`} style={{ fontSize: '1.3rem' }}>{c.value}</div>
            <div className="s-sub">
              {c.sub}
              {c.trendPct != null && (
                <span style={{ marginLeft: 6, color: c.trendPct >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                  {c.trendPct >= 0 ? '▲' : '▼'} {Math.abs(c.trendPct).toFixed(0)}% vs vorige periode
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Beste categorie — herleid uit producttitels, gerankt op gemiddelde
          winst per stuk, zie titleMetaStats */}
      {titleMetaStats.topCategory && (
        <div className="stats-grid" style={{ marginBottom: 20 }}>
          <div className="stat-card">
            <div className="s-accent" style={{ background: '#a78bfa' }} />
            <div className="s-label">Beste categorie</div>
            <div className="s-value" style={{ fontSize: '1.3rem' }}>{titleMetaStats.topCategory.name}</div>
            <div className="s-sub">
              {formatCurrency(titleMetaStats.topCategory.avgProfitPerItem)} gem. winst/stuk · {titleMetaStats.topCategory.sold} verkocht
            </div>
          </div>
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

      {/* ── Overview: revenue & profit per supplier chart ── */}
      {tab === 'overview' && (
        <div className="glass-card">
          <div className="chart-section-label">Omzet & winst per leverancier</div>
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
                <Legend wrapperStyle={{ fontSize: 12, color: tickColor }} />
                <Bar dataKey="revenue" name="Omzet" fill="#9ca3af" radius={[6, 6, 0, 0]}>
                  {supplierChartData.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Bar>
                <Bar dataKey="profit" name="Winst" fill="#22c55e" radius={[6, 6, 0, 0]} opacity={0.55} />
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
                <th>Gem. verkooptijd</th>
                <th>In stock</th>
              </tr>
            </thead>
            <tbody>
              {perSupplier.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>Geen data</td></tr>
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
                    <td style={{ color: 'var(--text-2)' }}>{s.avgSellDays != null ? `${s.avgSellDays.toFixed(0)}d` : '—'}</td>
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
