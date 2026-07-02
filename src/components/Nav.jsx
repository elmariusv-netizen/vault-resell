const NAV_LINKS = [
  { id: 'home',      label: 'Home',         icon: '⌂' },
  { id: 'inventory', label: 'Voorraad',     icon: '📦' },
  { id: 'new',       label: 'Nieuw',        icon: '+' },
  { id: 'verkopen',  label: 'Verkopen',     icon: '💰' },
  { id: 'aankopen',  label: 'Aankopen',     icon: '🛍' },
  { id: 'kosten',    label: 'Kosten',       icon: '💸' },
  { id: 'stats',     label: 'Stats',        icon: '📊' },
  { id: 'labels',    label: 'Labels',       icon: '🏷' },
  { id: 'settings',  label: 'Instellingen', icon: '⚙' },
]

const BOTTOM_TABS = ['home', 'new', 'verkopen', 'aankopen', 'settings']

export default function Nav({ currentPage, onNavigate, theme, onToggleTheme, userName }) {
  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <span className="brand-mark" />
            VAULT
          </div>
          {userName && <div className="sidebar-user">{userName}</div>}
        </div>

        <nav className="sidebar-nav">
          {NAV_LINKS.map((l) => (
            <button
              key={l.id}
              className={`sidebar-link${currentPage === l.id ? ' active' : ''}`}
              onClick={() => onNavigate(l.id)}
            >
              <span className="sidebar-link-icon">{l.icon}</span>
              {l.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="theme-toggle" onClick={onToggleTheme}>
            <span>{theme === 'light' ? '🌙' : '☀️'}</span>
            {theme === 'light' ? 'Dark mode' : 'Light mode'}
          </button>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="mobile-header">
        <div className="nav-brand">VAULT</div>
        {userName && <span className="mobile-user">{userName}</span>}
        <button className="theme-toggle-icon" onClick={onToggleTheme} title="Thema wisselen">
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
      </header>

      {/* Mobile Bottom Nav */}
      <nav className="bottom-nav">
        {NAV_LINKS.filter((l) => BOTTOM_TABS.includes(l.id)).map((l) => (
          <button
            key={l.id}
            className={`bottom-tab${currentPage === l.id ? ' active' : ''}`}
            onClick={() => onNavigate(l.id)}
          >
            <span className="bottom-tab-icon">{l.icon}</span>
            <span className="bottom-tab-label">{l.label}</span>
          </button>
        ))}
      </nav>
    </>
  )
}
