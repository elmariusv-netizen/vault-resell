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
import Onboarding from './pages/Onboarding'
import {
  loadData, saveData, getBackupMeta, saveBackupMeta,
  getUsers, saveUsers, getActiveUserId, setActiveUserId, hasLegacyData,
} from './utils/storage'
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
  const [users, setUsers] = useState([])
  const [activeUserId, setActiveUserIdState] = useState(null)
  const [theme, setTheme] = useState('light')
  const [backupMeta, setBackupMeta] = useState(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [ready, setReady] = useState(false)
  const [vintedCookie, setVintedCookie] = useState(() => localStorage.getItem('vault-vinted-cookie') || null)

  useEffect(() => { localStorage.setItem('vault-page', page) }, [page])

  useEffect(() => {
    const savedTheme = localStorage.getItem('vault-theme') || 'light'
    setTheme(savedTheme)
    document.documentElement.setAttribute('data-theme', savedTheme)

    const loadedUsers = getUsers()
    setUsers(loadedUsers)

    const storedId = getActiveUserId()
    if (storedId && loadedUsers.find((u) => u.id === storedId)) {
      setActiveUserIdState(storedId)
    }

    setBackupMeta(getBackupMeta())
    setReady(true)
  }, [])

  useEffect(() => {
    if (activeUserId) {
      const raw = loadData(activeUserId)
      const validated = validateData(raw)
      if (validated !== raw) saveData(validated, activeUserId)
      setData(validated)
    }
  }, [activeUserId])

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
    setData((prev) => {
      const next = { ...prev, ...updates }
      saveData(next, activeUserId)
      return next
    })
  }, [activeUserId])

  const handleUpdateSale = useCallback((updatedSale) => {
    setData((prev) => {
      if (!prev) return prev
      const next = { ...prev, sales: prev.sales.map((s) => s.id === updatedSale.id ? updatedSale : s) }
      saveData(next, activeUserId)
      return next
    })
  }, [activeUserId])

  const handleDeleteSale = useCallback((saleId) => {
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
      const next = { ...prev, sales: nextSales, batches: nextBatches }
      saveData(next, activeUserId)
      return next
    })
  }, [activeUserId])

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

  const handleOnboardingComplete = useCallback((user) => {
    const newUsers = [...users, user]
    saveUsers(newUsers)
    setUsers(newUsers)
    setActiveUserId(user.id)
    setActiveUserIdState(user.id)
  }, [users])

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

  if (!ready) {
    return (
      <div className="loading">
        <span style={{ color: 'var(--green)' }}>●</span>
        Laden…
      </div>
    )
  }

  if (!activeUserId || !users.find((u) => u.id === activeUserId)) {
    return <Onboarding onComplete={handleOnboardingComplete} hasLegacy={hasLegacyData()} />
  }

  if (!data) {
    return (
      <div className="loading">
        <span style={{ color: 'var(--green)' }}>●</span>
        Laden…
      </div>
    )
  }

  const activeUser = users.find((u) => u.id === activeUserId)
  const props = { data, updateData, onNavigate: setPage, onDeleteSale: handleDeleteSale }

  return (
    <div className="app-shell">
      <Nav
        currentPage={page}
        onNavigate={setPage}
        theme={theme}
        onToggleTheme={toggleTheme}
        userName={activeUser?.name}
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
          {page === 'settings'  && <Settings {...props} onExport={handleExport} activeUserId={activeUserId} vintedCookie={vintedCookie} onVintedCookieChange={setVintedCookie} />}
          {page === 'labels'    && <Labels data={data} vintedCookie={vintedCookie} />}
        </main>
      </div>
    </div>
  )
}
