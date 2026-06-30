import { useState, useEffect, useCallback, useMemo } from 'react'
import Nav from './components/Nav'
import Home from './pages/Home'
import Inventory from './pages/Inventory'
import NewSKU from './pages/NewSKU'
import Stats from './pages/Stats'
import Settings from './pages/Settings'
import Labels from './pages/Labels'
import Verkopen from './pages/Verkopen'
import Aankopen from './pages/Aankopen'
import Auth from './pages/Auth'
import { getBackupMeta, saveBackupMeta } from './utils/storage'
import { loadCloudData, saveCloudData } from './utils/cloudStorage'
import { SEED_DATA } from './data/seedData'
import { getRemainingQty } from './utils/skuUtils'
import { supabase } from './utils/supabase'

function validateData(loaded) {
  if (!loaded?.batches || !loaded?.sales) return loaded
  let changed = false
  const batches = loaded.batches.map((b) => {
    const remaining = getRemainingQty(b, loaded.sales)
    if ((b.liveCount || 0) > remaining) {
      changed = true
      return { ...b, liveCount: remaining }
    }
    return b
  })
  return changed ? { ...loaded, batches } : loaded
}

export default function App() {
  const [page, setPage] = useState(() => localStorage.getItem('vault-page') || 'home')
  const [data, setData] = useState(null)
  const [activeUserId, setActiveUserIdState] = useState(null)
  const [theme, setTheme] = useState('light')
  const [backupMeta, setBackupMeta] = useState(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [ready, setReady] = useState(false)
  const [vintedCookie, setVintedCookie] = useState(() => localStorage.getItem('vault-vinted-cookie') || null)
  const [supabaseUser, setSupabaseUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)

  // ── Supabase Auth ─────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSupabaseUser(session?.user ?? null)
      setAuthChecked(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSupabaseUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  // ── Sessie-bewaking: uitloggen bij verwijderde gebruiker ──────────────────
  const forceSignOut = useCallback(() => supabase.auth.signOut(), [])

  const isAuthError = (err) =>
    err?.status === 401 || err?.status === 403 ||
    /jwt|unauthorized|row.level security|not authenticated/i.test(err?.message || '')

  const checkSession = useCallback(async () => {
    if (!supabaseUser) return
    const { error } = await supabase.auth.getUser()
    if (error) {
      console.warn('[Vault] sessiecheck mislukt — uitloggen:', error.message)
      forceSignOut()
    }
  }, [supabaseUser, forceSignOut])

  // Elke 30s controleren
  useEffect(() => {
    const id = setInterval(checkSession, 30_000)
    return () => clearInterval(id)
  }, [checkSession])

  // Bij terugkeer op tabblad
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') checkSession() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [checkSession])

  useEffect(() => { localStorage.setItem('vault-page', page) }, [page])

  // Theme + backup meta (no localStorage user system anymore)
  useEffect(() => {
    const savedTheme = localStorage.getItem('vault-theme') || 'light'
    setTheme(savedTheme)
    document.documentElement.setAttribute('data-theme', savedTheme)
    setBackupMeta(getBackupMeta())
  }, [])

  // Load cloud data when authenticated user is known
  useEffect(() => {
    if (!supabaseUser) return
    const uid = supabaseUser.id
    setActiveUserIdState(uid)
    setReady(false)
    loadCloudData(uid)
      .then(raw => {
        const validated = validateData(raw)
        setData(validated)
      })
      .catch(() => setData(structuredClone(SEED_DATA)))
      .finally(() => setReady(true))
  }, [supabaseUser?.id])

  // Vinted cookie from Supabase user_settings
  useEffect(() => {
    if (!activeUserId) return
    supabase
      .from('user_settings')
      .select('vinted_cookie')
      .eq('user_id', activeUserId)
      .maybeSingle()
      .then(({ data: row }) => {
        if (row?.vinted_cookie) {
          setVintedCookie(row.vinted_cookie)
          localStorage.setItem('vault-vinted-cookie', row.vinted_cookie)
        }
      })
  }, [activeUserId])

  const toggleTheme = useCallback(() => {
    const next = theme === 'light' ? 'dark' : 'light'
    document.body.classList.add('theme-transitioning')
    setTimeout(() => document.body.classList.remove('theme-transitioning'), 280)
    setTheme(next)
    localStorage.setItem('vault-theme', next)
    document.documentElement.setAttribute('data-theme', next)
  }, [theme])

  const updateData = useCallback((updates) => {
    let next
    setData((prev) => { next = { ...prev, ...updates }; return next })
    saveCloudData(activeUserId, next).catch(err => { if (isAuthError(err)) forceSignOut() })
  }, [activeUserId, forceSignOut])

  const handleUpdateSale = useCallback((updatedSale) => {
    let next
    setData((prev) => {
      if (!prev) return prev
      next = { ...prev, sales: prev.sales.map((s) => s.id === updatedSale.id ? updatedSale : s) }
      return next
    })
    if (next) saveCloudData(activeUserId, next).catch(err => { if (isAuthError(err)) forceSignOut() })
  }, [activeUserId, forceSignOut])

  const handleDeleteSale = useCallback((saleId) => {
    let next
    setData((prev) => {
      if (!prev) return prev
      const sale = prev.sales.find((s) => s.id === saleId)
      if (!sale) return prev
      const nextSales = prev.sales.filter((s) => s.id !== saleId)
      let nextBatches = prev.batches
      if (sale.fromLive) {
        nextBatches = prev.batches.map((b) =>
          b.id === sale.batchId
            ? { ...b, liveCount: Math.min((b.liveCount || 0) + (sale.quantity || 1), b.quantity) }
            : b
        )
      }
      next = { ...prev, sales: nextSales, batches: nextBatches }
      return next
    })
    if (next) saveCloudData(activeUserId, next).catch(err => { if (isAuthError(err)) forceSignOut() })
  }, [activeUserId, forceSignOut])

  const handleExport = useCallback(() => {
    if (!data) return
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `vault-resell-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
    const meta = { lastExportDate: new Date().toISOString(), salesCountAtExport: data.sales.length }
    saveBackupMeta(meta)
    setBackupMeta(meta)
    setBannerDismissed(true)
  }, [data])

  const handleClearData = useCallback(async () => {
    const fresh = structuredClone(SEED_DATA)
    await saveCloudData(activeUserId, fresh)
    setData(fresh)
  }, [activeUserId])

  const showBackupBanner = useMemo(() => {
    if (!data || !backupMeta || bannerDismissed) return false
    const { lastExportDate, salesCountAtExport } = backupMeta
    const newSales = data.sales.length - (salesCountAtExport || 0)
    if (newSales >= 10) return true
    if (!lastExportDate) return data.sales.length > 0
    const daysSince = (Date.now() - new Date(lastExportDate)) / (1000 * 60 * 60 * 24)
    return daysSince > 7
  }, [data, backupMeta, bannerDismissed])

  const backupDaysAgo = useMemo(() => {
    if (!backupMeta?.lastExportDate) return null
    return Math.floor((Date.now() - new Date(backupMeta.lastExportDate)) / (1000 * 60 * 60 * 24))
  }, [backupMeta])

  if (!authChecked) {
    return (
      <div className="loading">
        <span style={{ color: 'var(--green)' }}>●</span>
        Laden…
      </div>
    )
  }

  if (!supabaseUser) return <Auth />

  if (!ready || !data) {
    return (
      <div className="loading">
        <span style={{ color: 'var(--green)' }}>●</span>
        Laden…
      </div>
    )
  }

  const displayName = supabaseUser.email.split('@')[0]
  const props = { data, updateData, onNavigate: setPage, onDeleteSale: handleDeleteSale }

  return (
    <div className="app-shell">
      <Nav
        currentPage={page}
        onNavigate={setPage}
        theme={theme}
        onToggleTheme={toggleTheme}
        userName={displayName}
      />

      <div className="content-area">
        {showBackupBanner && (
          <div className="backup-banner">
            <span className="backup-banner-text">
              {backupDaysAgo !== null
                ? `Laatste backup ${backupDaysAgo} dag${backupDaysAgo !== 1 ? 'en' : ''} geleden`
                : 'Nog geen backup gemaakt'}
            </span>
            <button className="btn btn-sm backup-banner-btn" onClick={handleExport}>
              Exporteer nu
            </button>
            <button className="backup-banner-close" onClick={() => setBannerDismissed(true)}>×</button>
          </div>
        )}

        <main className="main-content" key={page}>
          {page === 'home'      && <Home {...props} theme={theme} />}
          {page === 'inventory' && <Inventory {...props} />}
          {page === 'new'       && <NewSKU {...props} />}
          {page === 'verkopen'  && <Verkopen data={data} onDeleteSale={handleDeleteSale} onUpdateSale={handleUpdateSale} updateData={updateData} vintedCookie={vintedCookie} activeUserId={activeUserId} />}
          {page === 'aankopen'  && <Aankopen />}
          {page === 'stats'     && <Stats data={data} theme={theme} />}
          {page === 'settings'  && <Settings {...props} onExport={handleExport} onClearData={handleClearData} activeUserId={activeUserId} vintedCookie={vintedCookie} onVintedCookieChange={setVintedCookie} supabaseUser={supabaseUser} onSignOut={() => supabase.auth.signOut()} />}
          {page === 'labels'    && <Labels data={data} vintedCookie={vintedCookie} />}
        </main>
      </div>
    </div>
  )
}
