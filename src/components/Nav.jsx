const LINKS = [
  { id: 'home', label: 'Home' },
  { id: 'inventory', label: 'Voorraad' },
  { id: 'new', label: '+ Nieuw' },
  { id: 'stats', label: 'Stats' },
  { id: 'labels', label: 'Labels' },
  { id: 'settings', label: 'Instellingen' },
]

export default function Nav({ currentPage, onNavigate }) {
  return (
    <nav className="nav">
      <div className="nav-inner">
        <span className="nav-brand">VAULT</span>
        <div className="nav-links">
          {LINKS.map((l) => (
            <button
              key={l.id}
              className={`nav-link${currentPage === l.id ? ' active' : ''}`}
              onClick={() => onNavigate(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
    </nav>
  )
}
