import { useState, useEffect, useCallback } from 'react'
import Nav from './components/Nav'
import Home from './pages/Home'
import Inventory from './pages/Inventory'
import NewSKU from './pages/NewSKU'
import Stats from './pages/Stats'
import Settings from './pages/Settings'
import Labels from './pages/Labels'
import Verkopen from './pages/Verkopen'
import AndereVerkopen from './pages/AndereVerkopen'
import Aankopen from './pages/Aankopen'
import Kosten from './pages/Kosten'
import Auth from './pages/Auth'
import Onboarding from './pages/Onboarding'
import Upgrade from './pages/Upgrade'
import AdminUsers from './pages/AdminUsers'
import ResetPassword from './pages/ResetPassword'
import AuthLinkError from './pages/AuthLinkError'
import { loadCloudData, saveCloudData } from './utils/cloudStorage'
import { SEED_DATA } from './data/seedData'
import { getRemainingQty } from './utils/skuUtils'
import { useVintedOrdersSync } from './hooks/useVintedOrdersSync'
import { supabase, getCachedSupabaseUser } from './utils/supabase'
import { readWhopCache, writeWhopCache, fetchWhopStatus } from './utils/whopAccess'

// De extensie ververst de sessiecookie bij elk Vinted-bezoek + elke ~4 min
// zolang een tab openstaat (zie uploadVintedCookie() in content.js) — een
// cookie die langer dan een dag niet vernieuwd is wijst dus vrijwel zeker op
// een extensie die niet (meer) draait. Losse, pure functie i.p.v. Date.now()
// rechtstreeks in de render-body aanroepen (React's purity-regel voor
// componenten) — enkel aangeroepen vanuit de fetch-callbacks hieronder.
function isVintedCookieStale(updatedAt) {
  if (!updatedAt) return true
  return Date.now() - new Date(updatedAt).getTime() > 24 * 60 * 60 * 1000
}

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

// Leest en strip de auth-hash (#error=...&error_code=... of
// #access_token=...&type=recovery) op MODULE-niveau — dus vóórdat React
// ook maar iets rendert, laat staan een effect draait. Een useEffect draait
// pas ná de eerste commit/paint; in dat venster bleef de hash nog even
// zichtbaar in de adresbalk, en een refresh daarbinnen triggerde 'm gewoon
// opnieuw (geen sessie/server die de hash consumeert, dus niks "verbruikt"
// 'm vanzelf). Dit bestand wordt door main.jsx geïmporteerd vóór de eerste
// render-call — module-level code hier loopt dus gegarandeerd eerder.
// window.location.hash is hierna leeg, dus het resultaat wordt hier meteen
// bewaard voor de component (die kan de hash zelf niet meer aflezen).
function parseAndStripAuthHash() {
  const hash = window.location.hash
  if (!hash) return null

  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const hashError = params.get('error')
  const isRecovery = hash.includes('type=recovery')
  if (!hashError && !isRecovery) return null

  window.history.replaceState(null, '', window.location.pathname)

  if (hashError) {
    return {
      kind: 'error',
      error: hashError,
      errorCode: params.get('error_code'),
      errorDescription: params.get('error_description'),
    }
  }
  return { kind: 'recovery' }
}

const INITIAL_AUTH_HASH = parseAndStripAuthHash()

export default function App() {
  const [page, setPage] = useState(() => localStorage.getItem('vault-page') || 'home')
  const [data, setData] = useState(null)
  const [activeUserId, setActiveUserIdState] = useState(null)
  const [theme, setTheme] = useState('light')
  const [ready, setReady] = useState(false)
  const [vintedCookie, setVintedCookie] = useState(() => localStorage.getItem('vault-vinted-cookie') || null)
  // Tijdstip van de laatste automatische cookie-refresh door de extensie
  // (zie api/save-vinted-cookie.js) — bepaalt of Instellingen.jsx "✓
  // Automatisch gekoppeld" of "⚠ Extensie niet actief" toont.
  const [vintedCookieUpdatedAt, setVintedCookieUpdatedAt] = useState(null)
  const [vintedCookieStale, setVintedCookieStale] = useState(true)
  // Optimistisch geïnitialiseerd uit de door supabase-js zelf gepersisteerde
  // sessie (localStorage, synchroon leesbaar) i.p.v. van null/false — zonder
  // dit ziet een teruggekeerde, al ingelogde gebruiker bij ELKE F5 eerst het
  // "Laden…"-scherm, puur omdat supabase.auth.getSession() zelf altijd
  // asynchroon is óók als de sessie al lokaal gecached is. De effect
  // hieronder blijft deze gok gewoon bevestigen/corrigeren op de achtergrond.
  const [supabaseUser, setSupabaseUser] = useState(() => getCachedSupabaseUser())
  const [authChecked, setAuthChecked] = useState(true)
  const [pendingDayFilter, setPendingDayFilter] = useState(null)
  // null = nog niet geladen (toont laadscherm), daarna { purchaseMethod,
  // onboardingCompleted, autoSyncSales, autoSyncPurchases } — bepaalt of de
  // onboarding-flow getoond wordt en welke Nav-onderdelen zichtbaar zijn.
  const [userSettings, setUserSettings] = useState(null)
  // Uit INITIAL_AUTH_HASH (module-level, zie boven — de hash zelf is dan al
  // gestript) i.p.v. opnieuw window.location.hash te lezen in een effect:
  // toont ResetPassword i.p.v. de normale app, ongeacht login/onboarding/
  // Whop-status. Het PASSWORD_RECOVERY-auth-event hieronder blijft een
  // aanvullend, timing-onafhankelijk pad (bv. cross-tab session-sync zonder
  // dat déze tab ooit de hash in zijn eigen URL had).
  const [passwordRecovery, setPasswordRecovery] = useState(() => INITIAL_AUTH_HASH?.kind === 'recovery')
  // Idem — { error, errorCode, errorDescription } of null.
  const [authLinkError, setAuthLinkError] = useState(() => INITIAL_AUTH_HASH?.kind === 'error' ? INITIAL_AUTH_HASH : null)

  // Uitbreiding van setPage: laat Home.jsx's "klik op een dag in de grafiek"
  // meteen een dag-filter meegeven aan de doelpagina (vooralsnog enkel
  // Verkopen.jsx), zonder de gewone setPage-navigatie (Nav.jsx, andere
  // onNavigate('pagina')-aanroepen zonder opts) te veranderen.
  const navigateTo = useCallback((targetPage, opts) => {
    if (opts?.day) setPendingDayFilter(opts.day)
    setPage(targetPage)
  }, [])

  // ── Sessie-bewaking: uitloggen bij verwijderde gebruiker ──────────────────
  const forceSignOut = useCallback(() => supabase.auth.signOut(), [])

  const isAuthError = (err) =>
    err?.status === 401 || err?.status === 403 ||
    /jwt|unauthorized|row.level security|not authenticated/i.test(err?.message || '')

  // ── Supabase Auth ─────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        const { error } = await supabase.auth.getUser()
        // Enkel bij een ECHTE auth-fout (token ongeldig/ingetrokken)
        // uitloggen — niet bij elke fout. getUser() faalt op mobiel vaak
        // door een kortstondige netwerkhapering (net wakker, wifi->4G-
        // overgang) vlak na het openen van de app; dat zonder onderscheid
        // als "uitgelogd" behandelen was de reden dat mobiele gebruikers
        // zich telkens opnieuw moesten aanmelden terwijl hun sessie prima
        // geldig was. isAuthError() maakt hier hetzelfde onderscheid als bij
        // de cloud-save-aanroepen verderop.
        if (error && isAuthError(error)) {
          await supabase.auth.signOut()
          setSupabaseUser(null)
          setAuthChecked(true)
          return
        }
      }
      setSupabaseUser(session?.user ?? null)
      setAuthChecked(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSupabaseUser(session?.user ?? null)
      // Aanvullend op parseAndStripAuthHash() hierboven (module-level, dus
      // die heeft de hash al verwerkt vóór dit effect ooit draait) — dit
      // event dekt scenario's waar déze tab de recovery-hash zelf nooit in
      // zijn URL had (bv. cross-tab session-sync via supabase-js's eigen
      // BroadcastChannel).
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Zelfde isAuthError-onderscheid als hierboven — een tijdelijke
  // netwerkfout bij deze periodieke/tabblad-terugkeer-check mag de
  // gebruiker niet uitloggen.
  const checkSession = useCallback(async () => {
    if (!supabaseUser) return
    const { error } = await supabase.auth.getUser()
    if (error && isAuthError(error)) {
      console.warn('[Vault] sessiecheck mislukt — uitloggen:', error.message)
      forceSignOut()
    } else if (error) {
      console.warn('[Vault] sessiecheck: tijdelijke fout genegeerd (geen echte auth-fout):', error.message)
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
  //
  // vinted_cookie_updated_at staat BEWUST NIET in deze select: het is een
  // nieuwe kolom (zie supabase-setup.sql) die pas bestaat ná een handmatige
  // migratie in Supabase. Eén query die een onbekende kolom opvraagt faalt
  // in zijn geheel (PostgREST 400) — dat brak hier ooit even (tijdens het
  // bouwen) de ONBOARDING-status van een al-onboarded account, want row werd
  // dan null en onboarding_completed viel terug op de default false. De
  // timestamp wordt daarom via de losse, geïsoleerde refreshVintedCookieStatus
  // hieronder gehaald: faalt die vóór de migratie, dan blijft enkel de
  // cookie-statusindicator "onbekend" i.p.v. de rest van de instellingen mee
  // te slepen.
  useEffect(() => {
    if (!activeUserId) return
    supabase
      .from('user_settings')
      .select('vinted_cookie, purchase_method, onboarding_completed, auto_sync_sales, auto_sync_purchases, auto_sync_labels')
      .eq('user_id', activeUserId)
      .maybeSingle()
      .then(({ data: row, error }) => {
        if (error) { console.warn('[Vault] user_settings ophalen mislukt:', error.message); return }
        if (row?.vinted_cookie) {
          setVintedCookie(row.vinted_cookie)
          localStorage.setItem('vault-vinted-cookie', row.vinted_cookie)
        }
        setUserSettings({
          purchaseMethod: row?.purchase_method || 'both',
          onboardingCompleted: !!row?.onboarding_completed,
          autoSyncSales: row?.auto_sync_sales ?? true,
          autoSyncPurchases: row?.auto_sync_purchases ?? false,
          autoSyncLabels: row?.auto_sync_labels ?? false,
        })
      })
  }, [activeUserId])

  // De extensie ververst de sessiecookie zelf op de achtergrond (elk
  // Vinted-bezoek + elke ~4 min, zie uploadVintedCookie() in content.js) —
  // buiten React om, rechtstreeks naar Supabase. Zonder deze poll zou de
  // webapp een net ververste cookie pas zien na een volledige herlaad, en
  // zou Instellingen.jsx's statusindicator nooit vanzelf van ⚠ naar ✓
  // omslaan. Lichte, aparte 2-kolom-fetch i.p.v. de volledige
  // user_settings-rij hierboven, om de rest van userSettings niet onnodig
  // elke ronde opnieuw te zetten (en om deze query onafhankelijk te laten
  // falen zolang de vinted_cookie_updated_at-migratie nog niet gedraaid is).
  const refreshVintedCookieStatus = useCallback(async () => {
    if (!activeUserId) return
    const { data: row, error } = await supabase
      .from('user_settings')
      .select('vinted_cookie, vinted_cookie_updated_at')
      .eq('user_id', activeUserId)
      .maybeSingle()
    if (error) {
      // Meest waarschijnlijke oorzaak: de vinted_cookie_updated_at-kolom
      // bestaat nog niet (migratie in supabase-setup.sql nog niet gedraaid).
      // Enkel de statusindicator blijft dan "onbekend" — geen impact op de
      // rest van de app, zie de losse fetch hierboven.
      console.warn('[Vault] vinted-cookie-status ophalen mislukt:', error.message)
      return
    }
    if (row?.vinted_cookie) {
      setVintedCookie(row.vinted_cookie)
      localStorage.setItem('vault-vinted-cookie', row.vinted_cookie)
    }
    setVintedCookieUpdatedAt(row?.vinted_cookie_updated_at || null)
    setVintedCookieStale(isVintedCookieStale(row?.vinted_cookie_updated_at))
  }, [activeUserId])

  useEffect(() => {
    if (!activeUserId) return
    refreshVintedCookieStatus()
    const id = setInterval(refreshVintedCookieStatus, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') refreshVintedCookieStatus() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [activeUserId, refreshVintedCookieStatus])

  // is_admin in een losse, geïsoleerde query opgehaald (zelfde reden als
  // vinted_cookie_updated_at hierboven): het is een nieuwe kolom die pas
  // bestaat ná de Whop-migratie in supabase-setup.sql — zou hij in de
  // gecombineerde user_settings-select hierboven staan, dan faalt die hele
  // query (en dus ook onboardingCompleted e.d.) op accounts waar de migratie
  // nog niet gedraaid is.
  //
  // Eigen state (niet in userSettings gemerged) — deze query en de
  // gecombineerde user_settings-query hierboven racen allebei meteen na het
  // zetten van activeUserId, en de lichtere single-column select hier wint
  // die race doorgaans. Een merge als `prev ? {...prev, isAdmin} : prev`
  // vond dan een nog-lege userSettings (prev===null) en gooide isAdmin stil
  // weg — permanent, want dit effect draait maar 1x per activeUserId. Losse
  // state omzeilt die afhankelijkheid volledig.
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    if (!activeUserId) return
    supabase
      .from('user_settings')
      .select('is_admin')
      .eq('user_id', activeUserId)
      .maybeSingle()
      .then(({ data: row, error }) => {
        if (error) { console.warn('[Vault] is_admin ophalen mislukt (migratie nog niet gedraaid?):', error.message); return }
        setIsAdmin(!!row?.is_admin)
      })
  }, [activeUserId])

  // ── Whop-abonnement-gate ───────────────────────────────────────────────
  // null = nog onbekend (toont laadscherm), daarna { hasAccess, status, ... }.
  // Admins slaan de Whop-check volledig over; iedereen anders krijgt eerst de
  // 24u-cache (localStorage) en anders een verse server-check (api/whop-
  // status.js), die op zijn beurt fail-open gaat zolang Whop niet
  // geconfigureerd is of een fout geeft — hier dus nooit zelf op fouten
  // hoeven te reageren, enkel op een expliciet "geen toegang"-antwoord.
  const [whopAccess, setWhopAccess] = useState(null)

  const recheckWhopAccess = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('geen actieve sessie')
    const result = await fetchWhopStatus(session.access_token, { forceRefresh: true })
    setWhopAccess(result)
    writeWhopCache(activeUserId, result)
    return result
  }, [activeUserId])

  useEffect(() => {
    if (!activeUserId || !userSettings) return
    if (isAdmin) { setWhopAccess({ hasAccess: true, status: 'admin' }); return }

    const cached = readWhopCache(activeUserId)
    if (cached) { setWhopAccess(cached); return }

    let cancelled = false
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.access_token) return
      try {
        const result = await fetchWhopStatus(session.access_token)
        if (!cancelled) { setWhopAccess(result); writeWhopCache(activeUserId, result) }
      } catch (e) {
        console.warn('[Vault] whop-status ophalen mislukt:', e.message)
        // Fail-open op infrastructuurfouten aan onze kant (netwerk, functie
        // gecrasht) — enkel een expliciet antwoord van api/whop-status.js
        // mag de Upgrade-gate tonen.
        if (!cancelled) setWhopAccess({ hasAccess: true, status: 'unknown' })
      }
    })
    return () => { cancelled = true }
    // !!userSettings (i.p.v. de volledige userSettings-object-referentie) is
    // bewust de dependency: enkel opnieuw draaien zodra userSettings van
    // null naar geladen overgaat, niet bij elke latere, ongerelateerde
    // userSettings-wijziging (bv. een auto-sync-toggle in Settings.jsx).
  }, [activeUserId, isAdmin, !!userSettings])

  const toggleTheme = useCallback(() => {
    const next = theme === 'light' ? 'dark' : 'light'
    document.body.classList.add('theme-transitioning')
    setTimeout(() => document.body.classList.remove('theme-transitioning'), 280)
    setTheme(next)
    localStorage.setItem('vault-theme', next)
    document.documentElement.setAttribute('data-theme', next)
  }, [theme])

  // Bug (bevestigd live, 2026-07-11): "let next; setData(prev => {next=...;
  // return next}); saveCloudData(next)" leest `next` AL op de regel na
  // setData() — maar React voert de updater-callback niet per se synchroon
  // uit vóór die volgende regel. Vanuit een browser-event (bv. een klik)
  // "voelt" dit meestal synchroon (React flusht discrete events eerder), maar
  // vanuit een useEffect (bv. de auto-registratie in useVintedOrdersSync) was
  // `next` op dat moment nog gewoon `undefined` — saveCloudData schreef dan
  // een payload zonder de nieuwe sales-entries weg (of PostgREST liet de
  // bestaande payload-kolom onaangeroerd bij een onvolledige upsert-body),
  // terwijl de LOKALE state wél al correct bijgewerkt leek. Hierdoor bleven
  // auto-geregistreerde verkopen soms alsnog onzichtbaar in de cloud, ook na
  // de zelfherstel-fix in useVintedOrdersSync. saveCloudData() nu binnen de
  // updater zelf aanroepen — React garandeert dat DIE functie de juiste,
  // actuele prev/next krijgt, ongeacht de aanroep-context (event of effect).
  const updateData = useCallback((updates) => {
    setData((prev) => {
      const next = { ...prev, ...updates }
      saveCloudData(activeUserId, next).catch(err => { if (isAuthError(err)) forceSignOut() })
      return next
    })
  }, [activeUserId, forceSignOut])

  const handleUpdateSale = useCallback((updatedSale) => {
    setData((prev) => {
      if (!prev) return prev
      const next = { ...prev, sales: prev.sales.map((s) => s.id === updatedSale.id ? updatedSale : s) }
      saveCloudData(activeUserId, next).catch(err => { if (isAuthError(err)) forceSignOut() })
      return next
    })
  }, [activeUserId, forceSignOut])

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
      saveCloudData(activeUserId, next).catch(err => { if (isAuthError(err)) forceSignOut() })
      return next
    })
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

  // App-breed (i.p.v. gescopet aan de Verkopen-pagina) — zie hook-comment:
  // zonder dit bleef een verse Vinted-verkoop onzichtbaar op het Dashboard
  // totdat de gebruiker toevallig ook de Verkopen-pagina bezocht, want Home
  // leest uitsluitend data.sales, nooit vinted_orders rechtstreeks.
  const { vtOrders, setVtOrders, vtLoading, vtError } = useVintedOrdersSync(data, updateData)

  if (!authChecked) {
    return (
      <div className="loading">
        <span style={{ color: 'var(--green)' }}>●</span>
        Laden…
      </div>
    )
  }

  // Vóór alles anders, ook vóór passwordRecovery/!supabaseUser: een mislukte
  // link (verlopen/al gebruikt) authenticeert niemand, maar moet wel eerst
  // uitgelegd worden i.p.v. zomaar het normale inlogscherm te tonen.
  if (authLinkError) {
    return (
      <AuthLinkError
        error={authLinkError}
        onBack={() => { supabase.auth.signOut(); setAuthLinkError(null) }}
      />
    )
  }

  // Vóór alles anders — inclusief de !supabaseUser-check: een reset-link
  // authenticeert de gebruiker al via een tijdelijke recovery-sessie, dus
  // supabaseUser staat op dit punt al, maar ze moeten hun nieuw wachtwoord
  // zetten voor ze de normale app (of Auth-scherm) te zien krijgen.
  if (passwordRecovery) {
    return <ResetPassword onDone={() => setPasswordRecovery(false)} />
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
          setUserSettings((prev) => ({ ...prev, purchaseMethod, autoSyncSales, autoSyncPurchases, onboardingCompleted: true }))
        }
      />
    )
  }

  if (!isAdmin) {
    if (whopAccess === null) {
      return (
        <div className="loading">
          <span style={{ color: 'var(--green)' }}>●</span>
          Laden…
        </div>
      )
    }
    if (!whopAccess.hasAccess) {
      return (
        <Upgrade
          supabaseUser={supabaseUser}
          status={whopAccess.status}
          onSignOut={() => supabase.auth.signOut()}
          onRecheck={recheckWhopAccess}
        />
      )
    }
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
        isAdmin={isAdmin}
      />

      <div className="content-area">
        <main className="main-content" key={page}>
          {page === 'home'      && <Home {...props} theme={theme} activeUserId={activeUserId} />}
          {page === 'inventory' && <Inventory {...props} />}
          {page === 'new'       && <NewSKU {...props} />}
          {page === 'verkopen'  && <Verkopen data={data} updateData={updateData} vintedCookie={vintedCookie} vtOrders={vtOrders} setVtOrders={setVtOrders} vtLoading={vtLoading} vtError={vtError} />}
          {page === 'andere-verkopen' && <AndereVerkopen data={data} onDeleteSale={handleDeleteSale} onUpdateSale={handleUpdateSale} dayFilter={pendingDayFilter} onConsumeDayFilter={() => setPendingDayFilter(null)} />}
          {page === 'aankopen'  && <Aankopen data={data} updateData={updateData} purchaseMethod={userSettings.purchaseMethod} />}
          {page === 'kosten'    && <Kosten activeUserId={activeUserId} />}
          {page === 'stats'     && <Stats data={data} theme={theme} />}
          {page === 'settings'  && (
            <Settings
              {...props}
              onNavigate={setPage}
              onExport={handleExport}
              onClearData={handleClearData}
              activeUserId={activeUserId}
              vintedCookie={vintedCookie}
              onVintedCookieChange={setVintedCookie}
              vintedCookieUpdatedAt={vintedCookieUpdatedAt}
              vintedCookieStale={vintedCookieStale}
              onRefreshVintedCookieStatus={refreshVintedCookieStatus}
              supabaseUser={supabaseUser}
              onSignOut={() => supabase.auth.signOut()}
              purchaseMethod={userSettings.purchaseMethod}
              autoSyncSales={userSettings.autoSyncSales}
              autoSyncPurchases={userSettings.autoSyncPurchases}
              autoSyncLabels={userSettings.autoSyncLabels}
              onUserSettingsChange={(patch) => setUserSettings((prev) => ({ ...prev, ...patch }))}
            />
          )}
          {page === 'labels'    && <Labels data={data} vintedCookie={vintedCookie} />}
          {page === 'gebruikers' && isAdmin && <AdminUsers />}
        </main>
      </div>
    </div>
  )
}
