import { useState, useEffect, useCallback } from 'react'
import Nav from './components/Nav'
import Home from './pages/Home'
import Inventory from './pages/Inventory'
import NewSKU from './pages/NewSKU'
import Stats from './pages/Stats'
import Settings from './pages/Settings'
import Labels from './pages/Labels'
import Verkopen from './pages/Verkopen'
import Aankopen from './pages/Aankopen'
import Kosten from './pages/Kosten'
import Auth from './pages/Auth'
import Onboarding from './pages/Onboarding'
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
  const [ready, setReady] = useState(false)
  const [vintedCookie, setVintedCookie] = useState(() => localStorage.getItem('vault-vinted-cookie') || null)
  const [supabaseUser, setSupabaseUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [pendingDayFilter, setPendingDayFilter] = useState(null)
  // null = nog niet geladen (toont laadscherm), daarna { purchaseMethod,
  // onboardingCompleted, autoSyncSales, autoSyncPurchases } — bepaalt of de
  // onboarding-flow getoond wordt en welke Nav-onderdelen zichtbaar zijn.
  const [userSettings, setUserSettings] = useState(null)

  // Uitbreiding van setPage: laat Home.jsx's "klik op een dag in de grafiek"
  // meteen een dag-filter meegeven aan de doelpagina (vooralsnog enkel
  // Verkopen.jsx), zonder de gewone setPage-navigatie (Nav.jsx, andere
  // onNavigate('pagina')-aanroepen zonder opts) te veranderen.
  const navigateTo = useCallback((targetPage, opts) => {
    if (opts?.day) setPendingDayFilter(opts.day)
    setPage(targetPage)
  }, [])

  // ── Supabase Auth ─────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        const { error } = await supabase.auth.getUser()
        if (error) {
          await supabase.auth.signOut()
          setSupabaseUser(null)
          setAuthChecked(true)
          return
        }
      }
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

  // Theme (no localStorage user system anymore)
  useEffect(() => {
    const savedTheme = localStorage.getItem('vault-theme') || 'light'
    setTheme(savedTheme)
    document.documentElement.setAttribute('data-theme', savedTheme)
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

  // Vinted cookie + onboarding/purchase-method/auto-sync-instellingen uit
  // Supabase user_settings — 1 gecombineerde fetch. Ontbrekende rij (gloednieuw
  // account) of ontbrekende kolommen (bestaand account van vóór deze
  // migratie) vallen terug op dezelfde defaults als de kolom-DEFAULTs in
  // supabase-setup.sql, zodat de UI nooit op een onbepaalde tussentoestand
  // blijft hangen.
  useEffect(() => {
    if (!activeUserId) return
    supabase
      .from('user_settings')
      .select('vinted_cookie, purchase_method, onboarding_completed, auto_sync_sales, auto_sync_purchases')
      .eq('user_id', activeUserId)
      .maybeSingle()
      .then(({ data: row }) => {
        if (row?.vinted_cookie) {
          setVintedCookie(row.vinted_cookie)
          localStorage.setItem('vault-vinted-cookie', row.vinted_cookie)
        }
        setUserSettings({
          purchaseMethod: row?.purchase_method || 'both',
          onboardingCompleted: !!row?.onboarding_completed,
          autoSyncSales: row?.auto_sync_sales ?? true,
          autoSyncPurchases: row?.auto_sync_purchases ?? false,
        })
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
  }, [data])

  const handleClearData = useCallback(async () => {
    const fresh = structuredClone(SEED_DATA)
    await saveCloudData(activeUserId, fresh)
    setData(fresh)
  }, [activeUserId])

  if (!authChecked) {
    return (
      <div className="loading">
        <span style={{ color: 'var(--green)' }}>●</span>
        Laden…
      </div>
    )
  }

  if (!supabaseUser) return <Auth />

  if (!ready || !data || !userSettings) {
    return (
      <div className="loading">
        <span style={{ color: 'var(--green)' }}>●</span>
        Laden…
      </div>
    )
  }

  if (!userSettings.onboardingCompleted) {
    return (
      <Onboarding
        activeUserId={activeUserId}
        onComplete={({ purchaseMethod, autoSyncSales, autoSyncPurchases }) =>
          setUserSettings({ purchaseMethod, autoSyncSales, autoSyncPurchases, onboardingCompleted: true })
        }
      />
    )
  }

  const displayName = supabaseUser.email.split('@')[0]
  const props = { data, updateData, onNavigate: navigateTo, onDeleteSale: handleDeleteSale }

  return (
    <div className="app-shell">
      <Nav
        currentPage={page}
        onNavigate={setPage}
        theme={theme}
        onToggleTheme={toggleTheme}
        userName={displayName}
        purchaseMethod={userSettings.purchaseMethod}
      />

      <div className="content-area">
        <main className="main-content" key={page}>
          {page === 'home'      && <Home {...props} theme={theme} activeUserId={activeUserId} />}
          {page === 'inventory' && <Inventory {...props} />}
          {page === 'new'       && <NewSKU {...props} />}
          {page === 'verkopen'  && <Verkopen data={data} onDeleteSale={handleDeleteSale} onUpdateSale={handleUpdateSale} updateData={updateData} vintedCookie={vintedCookie} dayFilter={pendingDayFilter} onConsumeDayFilter={() => setPendingDayFilter(null)} />}
          {page === 'aankopen'  && <Aankopen data={data} updateData={updateData} purchaseMethod={userSettings.purchaseMethod} />}
          {page === 'kosten'    && <Kosten activeUserId={activeUserId} />}
          {page === 'stats'     && <Stats data={data} theme={theme} />}
          {page === 'settings'  && (
            <Settings
              {...props}
              onExport={handleExport}
              onClearData={handleClearData}
              activeUserId={activeUserId}
              vintedCookie={vintedCookie}
              onVintedCookieChange={setVintedCookie}
              supabaseUser={supabaseUser}
              onSignOut={() => supabase.auth.signOut()}
              purchaseMethod={userSettings.purchaseMethod}
              autoSyncSales={userSettings.autoSyncSales}
              autoSyncPurchases={userSettings.autoSyncPurchases}
              onUserSettingsChange={(patch) => setUserSettings((prev) => ({ ...prev, ...patch }))}
            />
          )}
          {page === 'labels'    && <Labels data={data} vintedCookie={vintedCookie} />}
        </main>
      </div>
    </div>
  )
}
