import { useState } from 'react'

const LINKS = [
  { id: 'home', label: 'Home' },
  { id: 'inventory', label: 'Voorraad' },
  { id: 'new', label: '+ Nieuw' },
  { id: 'stats', label: 'Stats' },
  { id: 'labels', label: 'Labels' },
  { id: 'berichten', label: 'Berichten' },
  { id: 'settings', label: 'Instellingen' },
]

export default function Nav({ currentPage, onNavigate }) {
  const [menuOpen, setMenuOpen] = useState(false)

  const handleNav = (id) => {
    onNavigate(id)
    setMenuOpen(false)
  }

  return (
    <nav className="nav">
      <div className="nav-inner">
        <span className="nav-brand">VAULT</span>
        <div className={`nav-links${menuOpen ? ' open' : ''}`}>
          {LINKS.map((l) => (
            <button
              key={l.id}
              className={`nav-link${currentPage === l.id ? ' active' : ''}`}
              onClick={() => handleNav(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
        <button
          className="nav-hamburger"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Menu"
          aria-expanded={menuOpen}
        >
          <span className={`hamburger-icon${menuOpen ? ' open' : ''}`}>
            <span />
            <span />
            <span />
          </span>
        </button>
      </div>
    </nav>
  )
}
