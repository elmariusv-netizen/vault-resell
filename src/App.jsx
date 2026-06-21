import { useState, useEffect, useCallback, useMemo } from 'react'
import Nav from './components/Nav'
import Home from './pages/Home'
import Inventory from './pages/Inventory'
import NewSKU from './pages/NewSKU'
import Stats from './pages/Stats'
import Settings from './pages/Settings'
import Labels from './pages/Labels'
import Onboarding from './pages/Onboarding'
import {
  loadData, saveData, getBackupMeta, saveBackupMeta,
  getUsers, saveUsers, getActiveUserId, setActiveUserId, hasLegacyData,
} from './utils/storage'

export default function App() {
  const [page, setPage] = useState('home')
  const [data, setData] = useState(null)
  const [users, setUsers] = useState([])
  const [activeUserId, setActiveUserIdState] = useState(null)
  const [theme, setTheme] = useState('light')
  const [backupMeta, setBackupMeta] = useState(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [ready, setReady] = useState(false)

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
      setData(loadData(activeUserId))
    }
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
  const props = { data, updateData, onNavigate: setPage }

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
          {page === 'stats'     && <Stats data={data} theme={theme} />}
          {page === 'settings'  && <Settings {...props} onExport={handleExport} activeUserId={activeUserId} />}
          {page === 'labels'    && <Labels data={data} />}
        </main>
      </div>
    </div>
  )
}
