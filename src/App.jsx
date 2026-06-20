import { useState, useEffect, useCallback } from 'react'
import Nav from './components/Nav'
import Home from './pages/Home'
import Inventory from './pages/Inventory'
import NewSKU from './pages/NewSKU'
import Stats from './pages/Stats'
import Settings from './pages/Settings'
import Labels from './pages/Labels'
import { loadData, saveData } from './utils/storage'

export default function App() {
  const [page, setPage] = useState('home')
  const [data, setData] = useState(null)

  useEffect(() => {
    setData(loadData())
  }, [])

  const updateData = useCallback((updates) => {
    setData((prev) => {
      const next = { ...prev, ...updates }
      saveData(next)
      return next
    })
  }, [])

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
      {/* key triggers re-animation on page change */}
      <main className="main-content" key={page}>
        {page === 'home' && <Home {...props} />}
        {page === 'inventory' && <Inventory {...props} />}
        {page === 'new' && <NewSKU {...props} />}
        {page === 'stats' && <Stats data={data} />}
        {page === 'settings' && <Settings {...props} />}
        {page === 'labels' && <Labels data={data} />}
      </main>
    </div>
  )
}
