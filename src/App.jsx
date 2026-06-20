import { useState, useEffect, useCallback, useMemo } from 'react'
import Nav from './components/Nav'
import Home from './pages/Home'
import Inventory from './pages/Inventory'
import NewSKU from './pages/NewSKU'
import Stats from './pages/Stats'
import Settings from './pages/Settings'
import Labels from './pages/Labels'
import Berichten from './pages/Berichten'
import { loadData, saveData, getBackupMeta, saveBackupMeta } from './utils/storage'

export default function App() {
  const [page, setPage] = useState('home')
  const [data, setData] = useState(null)
  const [backupMeta, setBackupMeta] = useState(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  useEffect(() => {
    setData(loadData())
    setBackupMeta(getBackupMeta())
  }, [])

  const updateData = useCallback((updates) => {
    setData((prev) => {
      const next = { ...prev, ...updates }
      saveData(next)
      return next
    })
  }, [])

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

  if (!data) {
    return (
      <div className="loading">
        <span style={{ color: 'var(--green)', opacity: 0.6 }}>●</span>
        Laden…
      </div>
    )
  }

  const props = { data, updateData, onNavigate: setPage }

  return (
    <div className="app">
      <Nav currentPage={page} onNavigate={setPage} />

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
        {page === 'home' && <Home {...props} />}
        {page === 'inventory' && <Inventory {...props} />}
        {page === 'new' && <NewSKU {...props} />}
        {page === 'stats' && <Stats data={data} />}
        {page === 'settings' && <Settings {...props} onExport={handleExport} />}
        {page === 'labels' && <Labels data={data} />}
        {page === 'berichten' && <Berichten {...props} />}
      </main>
    </div>
  )
}
