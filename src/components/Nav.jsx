const NAV_LINKS = [
  { id: 'home',      label: 'Home',         icon: '⌂' },
  { id: 'inventory', label: 'Voorraad',     icon: '📦' },
  { id: 'new',       label: 'Nieuw',        icon: '+' },
  { id: 'verkopen',  label: 'Verkopen',     icon: '💰' },
  { id: 'aankopen',  label: 'Aankopen',     icon: '🛍' },
  { id: 'kosten',    label: 'Kosten',       icon: '💸' },
  { id: 'stats',     label: 'Stats',        icon: '📊' },
  { id: 'labels',    label: 'Labels',       icon: '🏷' },
  { id: 'gebruikers', label: 'Gebruikers',  icon: '🛡' },
  { id: 'settings',  label: 'Instellingen', icon: '⚙' },
]

// Mobiele bottom-nav is bewust beperkt tot de dagelijkse hoofdacties — "Nieuw"
// (leverancier-batch) en "Instellingen" horen hier niet meer bij (Instellingen
// blijft bereikbaar via het kleine tandwiel-icoontje in de mobiele header
// hieronder), en overige pagina's (Voorraad/Aankopen/Kosten/Stats) blijven
// enkel via de desktop-sidebar bereikbaar.
const BOTTOM_TABS = ['home', 'verkopen', 'labels']

// Voorraad ("inventory") en Nieuw ("new", een nieuwe leverancier-batch
// aanmaken) zijn allebei enkel relevant voor het SKU/batch-systeem — niet
// voor iemand die uitsluitend op Vinted inkoopt. Zie onboarding STAP 1
// (Onboarding.jsx) / Instellingen.
const SUPPLIER_ONLY_PAGES = new Set(['inventory', 'new'])

// Aankopen toont enkel automatisch gesynchroniseerde Vinted-aankopen — niet
// relevant voor wie uitsluitend bij leveranciers inkoopt (die gebruiken
// Voorraad/Nieuw in plaats daarvan). Zie onboarding STAP 1 / Instellingen.
const VINTED_ONLY_PAGES = new Set(['aankopen'])

export default function Nav({ currentPage, onNavigate, theme, onToggleTheme, userName, purchaseMethod, isAdmin }) {
  const links = NAV_LINKS.filter((l) =>
    (purchaseMethod !== 'vinted' || !SUPPLIER_ONLY_PAGES.has(l.id)) &&
    (purchaseMethod !== 'suppliers' || !VINTED_ONLY_PAGES.has(l.id)) &&
    (l.id !== 'gebruikers' || isAdmin)
  )
  const bottomLinks = links.filter((l) => BOTTOM_TABS.includes(l.id))

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
          {links.map((l) => (
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
        <div className="mobile-header-right">
          {userName && <span className="mobile-user">{userName}</span>}
          {/* Instellingen is bewust geen volwaardige bottom-nav-knop meer op
              mobiel (zie BOTTOM_TABS hierboven) — enkel dit kleine
              tandwiel-icoontje houdt de pagina bereikbaar, minder prominent
              dan de dagelijkse hoofdacties. */}
          <button className="theme-toggle-icon" onClick={() => onNavigate('settings')} title="Instellingen">
            ⚙
          </button>
          <button className="theme-toggle-icon" onClick={onToggleTheme} title="Thema wisselen">
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
        </div>
      </header>

      {/* Mobile Bottom Nav */}
      <nav className="bottom-nav">
        {bottomLinks.map((l) => (
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
