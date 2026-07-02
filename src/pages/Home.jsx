import { useMemo, useState, useEffect, useRef } from 'react'
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line,
} from 'recharts'
import SaleModal from '../components/SaleModal'
import DateRangeFilter, { getDateBounds, filterByRange } from '../components/DateRangeFilter'
import {
  formatCurrency, formatDate, formatSkuRange,
  getRemainingQty, calcSaleProfit, normalizePlatform,
} from '../utils/skuUtils'
import { supabase } from '../utils/supabase'

// Always-dark palette for the dashboard
const D = {
  bg:      '#0f1117',
  card:    '#161b2e',
  card2:   '#1e2437',
  border:  'rgba(255,255,255,0.07)',
  text:    '#f0f2f8',
  text2:   'rgba(240,242,248,0.55)',
  text3:   'rgba(240,242,248,0.28)',
  blue:    '#3b82f6',
  blueDim: 'rgba(59,130,246,0.15)',
  green:   '#22c55e',
  red:     '#ef4444',
  yellow:  '#f59e0b',
  purple:  '#8b5cf6',
  grid:    'rgba(255,255,255,0.04)',
}

// ── Chart data builders ───────────────────────
function buildChartData(sales, range, bounds) {
  if (range === 'all') {
    const byMonth = {}
    sales.forEach((s) => {
      if (!s.date) return
      const m = s.date.substring(0, 7)
      if (!byMonth[m]) byMonth[m] = { revenue: 0, count: 0 }
      byMonth[m].revenue += (s.salePrice || 0) * (s.quantity || 1)
      byMonth[m].count += s.quantity || 1
    })
    return Object.entries(byMonth).sort().map(([m, d]) => ({
      label: new Date(m + '-01').toLocaleString('nl-BE', { month: 'short', year: '2-digit' }),
      revenue: Math.round(d.revenue * 100) / 100,
      count: d.count,
    }))
  }

  const byDay = {}
  sales.forEach((s) => {
    if (!s.date) return
    if (!byDay[s.date]) byDay[s.date] = { revenue: 0, count: 0 }
    byDay[s.date].revenue += (s.salePrice || 0) * (s.quantity || 1)
    byDay[s.date].count += s.quantity || 1
  })

  const result = []
  const cursor = new Date(bounds.from); cursor.setHours(0, 0, 0, 0)
  const end = new Date(bounds.to); end.setHours(23, 59, 59, 0)
  while (cursor <= end) {
    const ds = cursor.toISOString().split('T')[0]
    result.push({
      label: cursor.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' }),
      revenue: Math.round((byDay[ds]?.revenue || 0) * 100) / 100,
      count: byDay[ds]?.count || 0,
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return result
}

function buildHeatmapData(sales) {
  const DAY_NAMES = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0))
  sales.forEach((s) => {
    if (!s.date || !s.saleTime) return
    const dow = (new Date(s.date).getDay() + 6) % 7
    const hour = parseInt(s.saleTime.split(':')[0])
    if (!isNaN(hour) && hour >= 0 && hour < 24) grid[dow][hour] += s.quantity || 1
  })
  return { grid, dayNames: DAY_NAMES }
}

// ── Sub-components ────────────────────────────
const DashTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: D.card2, border: `1px solid ${D.border}`, borderRadius: 10, padding: '10px 14px', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
      <div style={{ fontSize: 11, color: D.text2, marginBottom: 5 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || D.blue, fontWeight: 700, fontSize: 13 }}>
          {p.dataKey === 'revenue' ? formatCurrency(p.value) : `${p.value} verkopen`}
        </div>
      ))}
    </div>
  )
}

function DashCard({ label, value, sub, accent, small }) {
  return (
    <div style={{
      background: D.card, border: `1px solid ${D.border}`,
      borderRadius: 14, padding: small ? '14px 16px' : '18px 20px',
      position: 'relative', overflow: 'hidden',
    }}>
      {accent && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: accent }} />}
      <div style={{ fontSize: 10, color: D.text3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 9 }}>
        {label}
      </div>
      <div style={{ fontSize: small ? '1.5rem' : '1.7rem', fontWeight: 800, color: D.text, letterSpacing: '-0.03em', lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: D.text3, marginTop: 6 }}>{sub}</div>}
    </div>
  )
}

function HeatmapGrid({ sales }) {
  const { grid, dayNames } = useMemo(() => buildHeatmapData(sales), [sales])
  const maxVal = Math.max(1, ...grid.flat())
  const hasData = sales.some((s) => s.saleTime)

  const getColor = (val) => {
    if (val === 0) return 'rgba(255,255,255,0.05)'
    const a = 0.2 + (val / maxVal) * 0.8
    return `rgba(59,130,246,${a.toFixed(2)})`
  }

  return (
    <div>
      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <div style={{ minWidth: 640, display: 'inline-block' }}>
          <div style={{ display: 'flex', marginLeft: 36, marginBottom: 4, gap: 2 }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} style={{ width: 24, textAlign: 'center', fontSize: 9, color: D.text3 }}>
                {h % 6 === 0 ? h : ''}
              </div>
            ))}
          </div>
          {grid.map((row, di) => (
            <div key={di} style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
              <div style={{ width: 30, fontSize: 10, color: D.text2, textAlign: 'right', paddingRight: 6, flexShrink: 0 }}>
                {dayNames[di]}
              </div>
              <div style={{ display: 'flex', gap: 2 }}>
                {row.map((val, h) => (
                  <div
                    key={h}
                    title={`${dayNames[di]} ${h}:00 — ${val} verkopen`}
                    style={{ width: 24, height: 16, borderRadius: 3, background: getColor(val) }}
                  />
                ))}
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 9, color: D.text3 }}>Minder</span>
            {[0, 0.3, 0.6, 1].map((p, i) => (
              <div key={i} style={{ width: 12, height: 12, borderRadius: 2, background: p === 0 ? 'rgba(255,255,255,0.05)' : `rgba(59,130,246,${(0.2 + p * 0.8).toFixed(2)})` }} />
            ))}
            <span style={{ fontSize: 9, color: D.text3 }}>Meer</span>
          </div>
        </div>
      </div>
      {!hasData && (
        <div style={{ fontSize: 12, color: D.text3, textAlign: 'center', marginTop: 6 }}>
          Voeg een tijdstip toe bij verkopen om dit heatmap te vullen
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────
export default function Home({ data, updateData, onNavigate, onDeleteSale, activeUserId }) {
  const { batches, sales, suppliers } = data

  const [range, setRange] = useState('week')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [showSale, setShowSale] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [syncState, setSyncState] = useState(null) // null | { status, done, total, newFoundCount, updatedCount }

  // ── "Alles synchroniseren": zet de vault_sync_requested-vlag + opent/
  // activeert een Vinted-tab (de extensie kan geen tabs opzoeken vanuit een
  // gewone webpagina — dat vereist chrome.tabs, enkel de extensie zelf heeft
  // dat), en pollt daarna user_settings.vault_sync_progress (bijgewerkt door
  // de extensie tijdens het synchroniseren) voor live voortgang.
  const syncPollRef = useRef({ interval: null, timeout: null })

  useEffect(() => () => {
    if (syncPollRef.current.interval) clearInterval(syncPollRef.current.interval)
    if (syncPollRef.current.timeout) clearTimeout(syncPollRef.current.timeout)
  }, [])

  const stopSyncPolling = () => {
    if (syncPollRef.current.interval) { clearInterval(syncPollRef.current.interval); syncPollRef.current.interval = null }
    if (syncPollRef.current.timeout) { clearTimeout(syncPollRef.current.timeout); syncPollRef.current.timeout = null }
  }

  const handleSyncAll = async () => {
    if (!activeUserId || syncState?.status === 'running') return

    const initial = { status: 'running', done: 0, total: 0, newFoundCount: 0, updatedCount: 0 }
    setSyncState(initial)

    try {
      await supabase.from('user_settings').upsert(
        { user_id: activeUserId, vault_sync_requested: true, vault_sync_progress: initial },
        { onConflict: 'user_id' }
      )
    } catch (e) {
      setSyncState({ status: 'error', error: e.message })
      return
    }

    // Opent een Vinted-tab, of activeert 'm als deze knop hem al eerder zelf
    // opende (zelfde named target) — een tab die de gebruiker zelf al open
    // had staan wordt binnen 5s opgepikt door de achtergrond-poll in
    // background.js, ook zonder dat hier een nieuwe tab bij komt.
    window.open('https://www.vinted.be/', 'vault-sync-tab')

    stopSyncPolling()
    syncPollRef.current.interval = setInterval(async () => {
      const { data: row, error } = await supabase
        .from('user_settings')
        .select('vault_sync_progress')
        .eq('user_id', activeUserId)
        .single()
      if (error) return
      const progress = row?.vault_sync_progress
      if (!progress) return
      setSyncState(progress)
      if (progress.status === 'done' || progress.status === 'no_tab' || progress.status === 'error') {
        stopSyncPolling()
      }
    }, 1500)

    // Veiligheidsklep: als er na 2 minuten nog niets is teruggekomen, stop
    // met pollen en toon een hint i.p.v. eindeloos te blijven draaien.
    syncPollRef.current.timeout = setTimeout(() => {
      setSyncState((prev) => (prev?.status === 'running' ? { ...prev, status: 'timeout' } : prev))
      stopSyncPolling()
    }, 120000)
  }

  const syncStatusText = useMemo(() => {
    if (!syncState) return null
    if (syncState.status === 'running') {
      return syncState.total > 0
        ? `Orders bijwerken: ${syncState.done}/${syncState.total}…`
        : 'Vinted-tabblad zoeken en synchronisatie starten…'
    }
    if (syncState.status === 'done') {
      const updatedText = `${syncState.updatedCount || 0} order${syncState.updatedCount === 1 ? '' : 's'} bijgewerkt`
      const newFound = syncState.newFoundCount || 0
      const newText = newFound > 0
        ? ` — ${newFound} nieuwe order${newFound === 1 ? '' : 's'} wachten (koppel ze handmatig via de extensie)`
        : ''
      return `✓ Klaar — ${updatedText}${newText}`
    }
    if (syncState.status === 'no_tab') {
      return '⚠ Geen Vinted-tabblad gevonden — controleer of het net geopende tabblad is ingelogd en probeer opnieuw.'
    }
    if (syncState.status === 'timeout') {
      return '⚠ Geen reactie van de extensie na 2 minuten — is de Vault-extensie actief op vinted.be?'
    }
    if (syncState.status === 'error') {
      return `✗ Fout: ${syncState.error || 'onbekend'}`
    }
    return null
  }, [syncState])

  useEffect(() => {
    const el = document.querySelector('.content-area')
    if (el) { el.style.background = D.bg; return () => { el.style.background = '' } }
  }, [])

  const bounds = useMemo(() => getDateBounds(range, customFrom, customTo), [range, customFrom, customTo])
  const filteredSales = useMemo(() => filterByRange(sales, range, bounds), [sales, range, bounds])

  const todayStr = new Date().toISOString().split('T')[0]
  const todayProfit = useMemo(() =>
    sales.filter((s) => s.date === todayStr).reduce((sum, s) => {
      const b = batches.find((x) => x.id === s.batchId)
      return sum + (b ? calcSaleProfit(s, b).profit : 0)
    }, 0)
  , [sales, batches, todayStr])

  const stats = useMemo(() => {
    const paid = filteredSales.filter((s) => !s.isFree)
    const totalRevenue = paid.reduce((s, x) => s + (x.salePrice || 0) * (x.quantity || 1), 0)
    const totalOrders = paid.length
    const avgOrder = totalOrders > 0 ? totalRevenue / totalOrders : 0
    const toShip = sales.filter((s) => !s.shipped && !s.isFree).length
    const onTheWay = filteredSales.filter((s) => s.shipped).length
    const totalItems = batches.reduce((s, b) => s + getRemainingQty(b, sales), 0)
    return { totalRevenue, totalOrders, avgOrder, toShip, onTheWay, totalItems }
  }, [filteredSales, sales, batches])

  const chartData = useMemo(() => buildChartData(filteredSales, range, bounds), [filteredSales, range, bounds])

  const recentSales = useMemo(
    () => [...sales].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6),
    [sales]
  )

  const sparkData = useMemo(() => {
    const today = new Date()
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today); d.setDate(d.getDate() - (6 - i))
      const ds = d.toISOString().split('T')[0]
      const rev = sales.filter((s) => s.date === ds).reduce((sum, s) => sum + (s.salePrice || 0) * (s.quantity || 1), 0)
      return { i, rev }
    })
  }, [sales])

  const handleSaveSale = (sale) => {
    const updates = { sales: [...sales, sale] }
    if (sale.fromLive) {
      updates.batches = batches.map((b) =>
        b.id === sale.batchId ? { ...b, liveCount: Math.max(0, (b.liveCount || 0) - (sale.quantity || 1)) } : b
      )
    }
    updateData(updates)
  }

  const rangeLabel = { today: 'Vandaag', week: 'Afgelopen 7 dagen', month: 'Afgelopen 30 dagen', all: 'Alle tijd', custom: 'Periode' }

  const cardStyle = { background: D.card, border: `1px solid ${D.border}`, borderRadius: 16, padding: '20px 22px' }
  const labelStyle = { fontSize: 10, color: D.text3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 12 }

  return (
    <div style={{ background: D.bg, minHeight: '100vh' }}>

      {/* ════════ DESKTOP ════════ */}
      <div className="dash-desktop" style={{ padding: '28px 32px', maxWidth: 1380, margin: '0 auto' }}>

        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: D.text, letterSpacing: '-0.03em', margin: 0 }}>Dashboard</h1>
            <div style={{ fontSize: 12, color: D.text3, marginTop: 3 }}>
              {new Date().toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <DateRangeFilter
              value={range} onChange={setRange}
              customFrom={customFrom} customTo={customTo}
              onCustom={(k, v) => k === 'from' ? setCustomFrom(v) : setCustomTo(v)}
              dark
            />
            <button
              onClick={handleSyncAll}
              disabled={syncState?.status === 'running' || !activeUserId}
              title={!activeUserId ? 'Nog aan het laden…' : 'Enkel status-updates van bestaande orders — nieuwe orders koppel je handmatig via de extensie'}
              style={{
                background: syncState?.status === 'running' ? D.card2 : D.purple, color: '#fff', border: 'none', borderRadius: 8,
                padding: '7px 14px', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', flexShrink: 0,
                cursor: syncState?.status === 'running' || !activeUserId ? 'default' : 'pointer',
                opacity: syncState?.status === 'running' || !activeUserId ? 0.7 : 1,
              }}
            >
              {syncState?.status === 'running' ? '⏳ Bezig…' : '🔄 Synchroniseren'}
            </button>
            <button
              onClick={() => setShowSale(true)}
              style={{ background: D.blue, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
            >
              + Verkoop
            </button>
          </div>
        </div>

        {syncStatusText && (
          <div style={{
            marginTop: -12, marginBottom: 24, padding: '9px 14px', borderRadius: 8,
            background: D.card2, border: `1px solid ${D.border}`, fontSize: 12, color: D.text2,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          }}>
            <span>{syncStatusText}</span>
            {syncState?.status !== 'running' && (
              <button
                onClick={() => setSyncState(null)}
                style={{ background: 'none', border: 'none', color: D.text3, cursor: 'pointer', fontSize: 14, lineHeight: 1, fontFamily: 'inherit' }}
              >×</button>
            )}
          </div>
        )}

        {/* Stat row 1 — 3 cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
          <DashCard
            label="Totale omzet"
            value={formatCurrency(stats.totalRevenue)}
            sub={rangeLabel[range] || 'Periode'}
            accent={D.yellow}
          />
          <DashCard
            label="Bestellingen"
            value={stats.totalOrders}
            sub={`Gem. ${formatCurrency(stats.avgOrder)}/bestelling`}
            accent={D.blue}
          />
          <DashCard
            label="Gemiddelde bestelling"
            value={formatCurrency(stats.avgOrder)}
            sub={stats.totalOrders > 0 ? `${stats.totalOrders} bestellingen` : 'Geen bestellingen'}
            accent={D.purple}
          />
        </div>

        {/* Stat row 2 — 2 cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          <DashCard
            label="Te verzenden"
            value={stats.toShip}
            sub="Wachten op verzending"
            accent={D.red}
          />
          <DashCard
            label="Onderweg"
            value={stats.onTheWay}
            sub={`${rangeLabel[range] || 'Periode'} verzonden`}
            accent={D.green}
          />
        </div>

        {/* Charts row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          {/* Revenue area chart */}
          <div style={cardStyle}>
            <div style={labelStyle}>Omzet over tijd</div>
            {chartData.length === 0 ? (
              <div style={{ height: 190, display: 'flex', alignItems: 'center', justifyContent: 'center', color: D.text3, fontSize: 13 }}>
                Geen data voor deze periode
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={190}>
                <AreaChart data={chartData} margin={{ top: 4, right: 2, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={D.blue} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={D.blue} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="0" stroke={D.grid} vertical={false} />
                  <XAxis
                    dataKey="label" stroke="transparent"
                    tick={{ fill: D.text3, fontSize: 10, fontFamily: 'inherit' }}
                    axisLine={false} tickLine={false} interval="preserveStartEnd"
                  />
                  <YAxis
                    stroke="transparent"
                    tick={{ fill: D.text3, fontSize: 10, fontFamily: 'inherit' }}
                    tickFormatter={(v) => `€${v}`}
                    axisLine={false} tickLine={false} width={44}
                  />
                  <Tooltip content={<DashTooltip />} cursor={{ stroke: D.border, strokeWidth: 1 }} />
                  <Area
                    type="monotone" dataKey="revenue"
                    stroke={D.blue} strokeWidth={2.5}
                    fill="url(#revGrad)" dot={false}
                    activeDot={{ r: 4, fill: D.blue, strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Sales count bar chart */}
          <div style={cardStyle}>
            <div style={labelStyle}>Aantal verkopen per dag</div>
            {chartData.length === 0 ? (
              <div style={{ height: 190, display: 'flex', alignItems: 'center', justifyContent: 'center', color: D.text3, fontSize: 13 }}>
                Geen data voor deze periode
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={chartData} margin={{ top: 4, right: 2, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="0" stroke={D.grid} vertical={false} />
                  <XAxis
                    dataKey="label" stroke="transparent"
                    tick={{ fill: D.text3, fontSize: 10, fontFamily: 'inherit' }}
                    axisLine={false} tickLine={false} interval="preserveStartEnd"
                  />
                  <YAxis
                    stroke="transparent"
                    tick={{ fill: D.text3, fontSize: 10, fontFamily: 'inherit' }}
                    axisLine={false} tickLine={false} width={28} allowDecimals={false}
                  />
                  <Tooltip content={<DashTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                  <Bar dataKey="count" fill={D.blue} radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Heatmap */}
        <div style={{ ...cardStyle, marginBottom: 12 }}>
          <div style={labelStyle}>Beste verkoopuren</div>
          <HeatmapGrid sales={sales} />
        </div>

        {/* Recent sales */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <div style={labelStyle}>Recente verkopen</div>
            {sales.length > 0 && (
              <button onClick={() => onNavigate('verkopen')} style={{ background: 'transparent', border: 'none', color: D.blue, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                Bekijk alles →
              </button>
            )}
          </div>

          {recentSales.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '28px 0', color: D.text3, fontSize: 13 }}>
              Nog geen verkopen.{' '}
              <button onClick={() => setShowSale(true)} style={{ background: 'none', border: 'none', color: D.blue, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>
                Registreer je eerste →
              </button>
            </div>
          ) : (
            <div>
              {recentSales.map((s) => {
                const b = batches.find((x) => x.id === s.batchId)
                const p = b ? calcSaleProfit(s, b) : null
                const sup = suppliers.find((x) => b && x.prefix === b.supplierPrefix)
                const pd = normalizePlatform(s.platform)
                const sp = pd === 'Medeverkoper/Groothandel' ? 'B2B' : pd === 'Privé persoon' ? 'Privé' : pd
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: `1px solid ${D.border}` }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 9,
                      background: (sup?.color || D.blue) + '22',
                      border: `1px solid ${(sup?.color || D.blue)}33`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, overflow: 'hidden', fontSize: 14,
                    }}>
                      {s.photo ? <img src={s.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🏷'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: D.text }}>
                        {b ? formatSkuRange(b.supplierPrefix, b.startNum, b.endNum) : '?'}
                        {s.quantity > 1 && <span style={{ color: D.text3 }}> ×{s.quantity}</span>}
                        <span style={{ marginLeft: 7, fontSize: 10, fontWeight: 600, background: 'rgba(255,255,255,0.07)', padding: '2px 6px', borderRadius: 4, color: D.text2 }}>
                          {sp}
                        </span>
                        {s.isFree && <span style={{ marginLeft: 4, fontSize: 10, color: D.green, fontWeight: 700 }}>GRATIS</span>}
                        {s.shipped && <span style={{ marginLeft: 4, fontSize: 10, color: D.blue, fontWeight: 700 }}>VERZONDEN</span>}
                      </div>
                      <div style={{ fontSize: 11, color: D.text3, marginTop: 2 }}>
                        {formatDate(s.date)}{s.buyer ? ` · ${s.buyer}` : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div>
                        {s.isFree
                          ? <div style={{ fontSize: 12, color: D.text3 }}>Gratis</div>
                          : <div style={{ fontSize: 14, fontWeight: 700, color: D.text }}>{formatCurrency((s.salePrice || 0) * (s.quantity || 1))}</div>}
                        {p && !s.isFree && (
                          <div style={{ fontSize: 11, fontWeight: 600, color: p.profit >= 0 ? D.green : D.red, marginTop: 1 }}>
                            {p.profit >= 0 ? '+' : ''}{formatCurrency(p.profit)}
                          </div>
                        )}
                      </div>
                      {onDeleteSale && (
                        <button
                          onClick={() => setConfirmDeleteId(s.id)}
                          style={{ background: 'none', border: 'none', color: D.text3, cursor: 'pointer', fontSize: 14, padding: 4, lineHeight: 1, opacity: 0.6 }}
                          title="Verwijder verkoop"
                        >
                          🗑
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ════════ MOBILE ════════ */}
      <div className="dash-mobile" style={{ paddingBottom: 80 }}>
        {/* Hero */}
        <div style={{ background: 'linear-gradient(180deg, #1a1f38 0%, #0f1117 100%)', padding: '28px 20px 24px' }}>
          <div style={{ fontSize: 10, color: D.text3, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 10 }}>
            Vandaag verdiend
          </div>
          <div style={{ fontSize: '3rem', fontWeight: 800, color: D.green, letterSpacing: '-0.04em', lineHeight: 1 }}>
            {formatCurrency(todayProfit)}
          </div>
          <div style={{ fontSize: 12, color: D.text3, marginTop: 8 }}>
            {new Date().toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          <button
            onClick={handleSyncAll}
            disabled={syncState?.status === 'running' || !activeUserId}
            title={!activeUserId ? 'Nog aan het laden…' : 'Enkel status-updates van bestaande orders — nieuwe orders koppel je handmatig via de extensie'}
            style={{
              marginTop: 14, width: '100%', background: syncState?.status === 'running' ? D.card2 : D.purple, color: '#fff',
              border: 'none', borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
              cursor: syncState?.status === 'running' || !activeUserId ? 'default' : 'pointer',
              opacity: syncState?.status === 'running' || !activeUserId ? 0.7 : 1,
            }}
          >
            {syncState?.status === 'running' ? '⏳ Bezig…' : '🔄 Synchroniseren'}
          </button>
          <div style={{ marginTop: 6, fontSize: 11, color: D.text3, textAlign: 'center' }}>
            Enkel status-updates — nieuwe orders via de extensie
          </div>
          {syncStatusText && (
            <div style={{ marginTop: 8, fontSize: 11, color: D.text2, textAlign: 'center' }}>
              {syncStatusText}
            </div>
          )}
        </div>

        {/* Stat pills */}
        <div style={{ padding: '14px 20px', display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none' }}>
          {[
            { label: 'Bestellingen', value: stats.totalOrders, color: D.blue },
            { label: 'Te verzenden', value: stats.toShip, color: D.yellow },
            { label: 'Onderweg', value: stats.onTheWay, color: D.text2 },
            { label: 'In voorraad', value: stats.totalItems, color: D.text3 },
          ].map((p) => (
            <div key={p.label} style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 12, padding: '10px 14px', flexShrink: 0 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: p.color }}>{p.value}</div>
              <div style={{ fontSize: 10, color: D.text3, marginTop: 2, whiteSpace: 'nowrap' }}>{p.label}</div>
            </div>
          ))}
        </div>

        {/* Sparkline */}
        <div style={{ padding: '0 20px 4px' }}>
          <div style={{ fontSize: 10, color: D.text3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 6 }}>
            Afgelopen 7 dagen
          </div>
          <div style={{ height: 56 }}>
            <ResponsiveContainer width="100%" height={56}>
              <LineChart data={sparkData}>
                <Line type="monotone" dataKey="rev" stroke={D.blue} strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Quick action */}
        <div style={{ padding: '12px 20px 16px' }}>
          <button
            onClick={() => setShowSale(true)}
            style={{ width: '100%', background: D.blue, color: '#fff', border: 'none', borderRadius: 12, padding: '13px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            + Verkoop registreren
          </button>
        </div>

        {/* Recent sales */}
        <div style={{ padding: '0 20px' }}>
          <div style={{ fontSize: 10, color: D.text3, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 10 }}>
            Recente verkopen
          </div>
          {recentSales.length === 0 ? (
            <div style={{ color: D.text3, fontSize: 13, textAlign: 'center', padding: '20px 0' }}>Nog geen verkopen</div>
          ) : (
            recentSales.map((s) => {
              const b = batches.find((x) => x.id === s.batchId)
              const p = b ? calcSaleProfit(s, b) : null
              const sup = suppliers.find((x) => b && x.prefix === b.supplierPrefix)
              return (
                <div key={s.id} style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 14, padding: '13px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 9, background: (sup?.color || D.blue) + '20', border: `1px solid ${(sup?.color || D.blue)}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden', fontSize: 14 }}>
                    {s.photo ? <img src={s.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }} /> : '🏷'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: D.text }}>
                      {b ? formatSkuRange(b.supplierPrefix, b.startNum, b.endNum) : '?'}
                    </div>
                    <div style={{ fontSize: 11, color: D.text3 }}>
                      {normalizePlatform(s.platform)} · {formatDate(s.date)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: D.text }}>
                      {s.isFree ? 'Gratis' : formatCurrency((s.salePrice || 0) * (s.quantity || 1))}
                    </div>
                    {p && !s.isFree && (
                      <div style={{ fontSize: 11, color: p.profit >= 0 ? D.green : D.red, fontWeight: 600 }}>
                        {p.profit >= 0 ? '+' : ''}{formatCurrency(p.profit)}
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* ── SaleModal ── */}
      {showSale && <SaleModal data={data} onClose={() => setShowSale(false)} onSave={handleSaveSale} />}

      {/* ── Confirm delete ── */}
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
              <button className="btn btn-danger" onClick={() => { onDeleteSale(confirmDeleteId); setConfirmDeleteId(null) }}>
                Definitief verwijderen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
