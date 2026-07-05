import { useState, useEffect, useRef } from 'react'
import { genId, getNextSkuLabel, formatSku, formatDate } from '../utils/skuUtils'
import { supabase } from '../utils/supabase'
import { PurchaseMethodPicker, AutoSyncToggleRow } from './Onboarding'

const COLORS = ['#00ff88', '#4fc3f7', '#ce93d8', '#ffb74d', '#80cbc4', '#ff7043', '#f06292', '#aed581', '#ffd60a', '#3ecfff']

function Kbd({ children }) {
  return (
    <kbd style={{
      fontFamily: 'monospace', fontSize: 11, padding: '1px 7px', borderRadius: 4,
      background: 'var(--bg-3, rgba(0,0,0,0.07))', border: '1px solid var(--border)',
      color: 'var(--text-2)', display: 'inline-block',
    }}>{children}</kbd>
  )
}

function Mono({ children }) {
  return (
    <code style={{
      fontFamily: 'monospace', fontSize: 12, padding: '1px 6px', borderRadius: 4,
      background: 'rgba(79,70,229,0.1)', color: '#818cf8',
    }}>{children}</code>
  )
}

function VintedKoppeling({ vintedCookie, onSave, activeUserId }) {
  const [open, setOpen]           = useState(false)
  const [cookieInput, setCookieInput] = useState('')
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  const isConnected = !!vintedCookie
  const masked = vintedCookie
    ? vintedCookie.slice(0, 8) + '••••••••••••' + vintedCookie.slice(-4)
    : ''

  const close = () => { setOpen(false); setCookieInput(''); setError('') }

  const handleSave = async () => {
    const val = cookieInput.trim()
    if (!val) return
    setSaving(true)
    setError('')
    try {
      const { error: e } = await supabase
        .from('user_settings')
        .upsert({ user_id: activeUserId, vinted_cookie: val }, { onConflict: 'user_id' })
      if (e) throw e
      localStorage.setItem('vault-vinted-cookie', val)
      onSave(val)
      close()
    } catch (e) {
      setError(e.message || 'Opslaan mislukt. Bestaat de user_settings tabel al in Supabase?')
    }
    setSaving(false)
  }

  const handleDisconnect = async () => {
    try {
      await supabase
        .from('user_settings')
        .upsert({ user_id: activeUserId, vinted_cookie: null }, { onConflict: 'user_id' })
    } catch {}
    localStorage.removeItem('vault-vinted-cookie')
    onSave(null)
    close()
  }

  const STEPS = [
    <span>Ga naar <strong>vinted.be</strong> en log in op je account</span>,
    <span>Druk op <Kbd>F12</Kbd> om DevTools te openen</span>,
    <span>Klik op het tabblad <strong>Console</strong></span>,
    <span>
      Plak dit commando en druk op <Kbd>Enter</Kbd> — het kopieert alle cookies naar je klembord:
      <br />
      <code style={{
        display: 'block', marginTop: 6, padding: '7px 10px',
        background: 'var(--bg-3, rgba(0,0,0,0.08))', borderRadius: 6,
        fontFamily: 'monospace', fontSize: 13, color: 'var(--text)',
        userSelect: 'all', cursor: 'text',
      }}>copy(document.cookie)</code>
    </span>,
    <span>Plak het resultaat hieronder — dit bevat automatisch de XSRF-TOKEN en alle andere vereiste cookies</span>,
  ]

  return (
    <div className="glass-card">
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 12, flexShrink: 0,
          background: isConnected ? 'rgba(0,255,136,0.1)' : 'var(--bg-2)',
          border: `1px solid ${isConnected ? 'rgba(0,255,136,0.3)' : 'var(--border)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
        }}>
          🛒
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Verzendlabels (Vinted-sessie)</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2, fontFamily: isConnected ? 'monospace' : 'inherit' }}>
            {isConnected ? masked : 'Niet gekoppeld — voeg je sessie-cookie toe om listings en labels te activeren'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>Nodig om verzendlabels op te halen.</div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
          {isConnected && !open && (
            <span style={{
              fontSize: 11, fontWeight: 700, color: 'var(--green)',
              background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.25)',
              padding: '3px 10px', borderRadius: 100,
            }}>✓ Actief</span>
          )}
          {isConnected ? (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => open ? close() : setOpen(true)}>
                {open ? 'Sluiten' : 'Vervang'}
              </button>
              <button className="btn btn-danger btn-sm" onClick={handleDisconnect}>Ontkoppel</button>
            </>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)} disabled={open}>
              Koppel Vinted account
            </button>
          )}
        </div>
      </div>

      {/* Expandable form */}
      {open && (
        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Step-by-step instructions */}
          <div style={{
            background: 'var(--bg-2)', border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)', padding: '14px 16px',
          }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10, color: 'var(--text)' }}>
              Hoe je de sessie-cookie kopieert:
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {STEPS.map((step, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
                  <span style={{
                    width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                    background: 'rgba(79,70,229,0.12)', color: '#818cf8',
                    fontSize: 11, fontWeight: 800,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>{i + 1}</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Textarea */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }}>
              Plak hier de volledige cookie string (resultaat van copy(document.cookie))
            </label>
            <textarea
              value={cookieInput}
              onChange={(e) => { setCookieInput(e.target.value); setError('') }}
              placeholder="_vinted_fr_session=eyJ...; XSRF-TOKEN=abc123; ..."
              rows={4}
              spellCheck={false}
              autoComplete="off"
              style={{
                width: '100%', fontFamily: 'monospace', fontSize: 12, resize: 'vertical',
                padding: '10px 12px', boxSizing: 'border-box', lineHeight: 1.5,
              }}
            />
          </div>

          {error && (
            <div style={{
              fontSize: 12, color: 'var(--red)', lineHeight: 1.6,
              background: 'rgba(239,68,68,0.08)', padding: '8px 12px', borderRadius: 8,
              border: '1px solid rgba(239,68,68,0.15)',
            }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={close}>Annuleer</button>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSave}
              disabled={!cookieInput.trim() || saving}
            >
              {saving ? 'Opslaan…' : 'Opslaan'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SupplierModal({ supplier, onClose, onSave }) {
  const [prefix, setPrefix] = useState(supplier?.prefix || '')
  const [name, setName] = useState(supplier?.name || '')
  const [color, setColor] = useState(supplier?.color || COLORS[0])

  const handleSave = () => {
    if (!prefix.trim() || !name.trim()) return
    onSave({ prefix: prefix.toUpperCase().trim().slice(0, 4), name: name.trim(), color })
    onClose()
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h2>{supplier ? 'Leverancier bewerken' : 'Leverancier toevoegen'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="form">
          <div className="form-group">
            <label>Prefix (max 4 tekens)</label>
            <input
              value={prefix}
              onChange={(e) => setPrefix(e.target.value.slice(0, 4).toUpperCase())}
              placeholder="bv. ABC"
            />
            {supplier && (
              <div style={{ fontSize: 11, color: 'var(--yellow)', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span>⚠</span> Wijzigen updatet alle SKU codes van deze leverancier
              </div>
            )}
          </div>
          <div className="form-group">
            <label>Naam</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="bv. Mijn leverancier" />
          </div>
          <div className="form-group">
            <label>Kleur</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`color-dot${color === c ? ' selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Annuleer</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!prefix || !name}>Opslaan</button>
        </div>
      </div>
    </div>
  )
}

function ConfirmModal({ title, message, onCancel, onConfirm, danger }) {
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onCancel}>×</button>
        </div>
        <p style={{ color: 'var(--text-2)', fontSize: 14, lineHeight: 1.7 }}>{message}</p>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel}>Annuleer</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>
            Bevestig
          </button>
        </div>
      </div>
    </div>
  )
}

const EXT_INSTALLED_KEY = 'vault-ext-installed'

function ExtensionInstall({ onConfirm }) {
  const [confirmed, setConfirmed] = useState(() => !!localStorage.getItem(EXT_INSTALLED_KEY))
  const [expanded, setExpanded]   = useState(!confirmed)

  const confirm = () => {
    localStorage.setItem(EXT_INSTALLED_KEY, '1')
    setConfirmed(true)
    setExpanded(false)
    onConfirm?.()
  }

  const step = (n, text) => (
    <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start' }}>
      <span style={{
        flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
        background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
        color: '#a5b4fc', fontSize: 12, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{n}</span>
      <span style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.55, paddingTop: 2 }}>{text}</span>
    </div>
  )

  return (
    <div className="glass-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 12, flexShrink: 0,
          background: confirmed ? 'rgba(0,255,136,0.1)' : 'rgba(99,102,241,0.1)',
          border: `1px solid ${confirmed ? 'rgba(0,255,136,0.3)' : 'rgba(99,102,241,0.3)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 800, fontSize: 15, color: confirmed ? 'var(--green)' : '#a5b4fc',
        }}>{confirmed ? '✓' : 'V'}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Stap 1 — Installeer de extensie</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
            {confirmed ? 'Extensie geïnstalleerd' : 'Vereist voor sync met Vinted'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <a
            href="/vault-extension.zip"
            download
            className="btn btn-primary btn-sm"
            style={{ textDecoration: 'none' }}
          >
            ⬇ Download
          </a>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setExpanded(v => !v)}
            style={{ fontSize: 12 }}
          >
            {expanded ? 'Verberg' : confirmed ? 'Toon uitleg' : 'Uitleg'}
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 14 }}>
            {step(1, <span>Klik <strong>⬇ Download</strong> hierboven en open het gedownloade <code style={{ fontFamily: 'monospace', fontSize: 12 }}>vault-extension.zip</code> bestand</span>)}
            {step(2, <span>Rechtsklik op het zip-bestand → <strong>Alles uitpakken</strong> → kies een map en klik Uitpakken</span>)}
            {step(3,
              <span>
                Ga naar{' '}
                <code
                  onClick={() => navigator.clipboard.writeText('chrome://extensions')}
                  title="Klik om te kopiëren"
                  style={{
                    fontFamily: 'monospace', fontSize: 12, padding: '1px 7px', borderRadius: 4,
                    background: 'rgba(79,70,229,0.1)', color: '#818cf8',
                    cursor: 'pointer', userSelect: 'all',
                  }}
                >chrome://extensions</code>
                {' '}in een nieuw tabblad <span style={{ fontSize: 11, color: 'var(--text-3)' }}>(klik om te kopiëren)</span>
              </span>
            )}
            {step(4, <span>Zet <strong>Ontwikkelaarsmodus</strong> rechtsboven aan (schuifknop)</span>)}
            {step(5, <span>Klik op <strong>"Uitgepakte extensie laden"</strong> en selecteer de zojuist uitgepakte map</span>)}
            {step(6, <span>Klaar — de extensie verschijnt als blauw <strong>V</strong>-icoon in je browser</span>)}
          </div>

          {!confirmed && (
            <button
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', padding: '10px' }}
              onClick={confirm}
            >
              ✓ Ik heb de extensie geïnstalleerd
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function VintedAccountLink({ supabaseUser }) {
  const [linked, setLinked]       = useState(null)    // null=loading, true=gekoppeld, false=niet
  const [waiting, setWaiting]     = useState(false)
  const [pendingId, setPendingId] = useState(null)
  const [error, setError]         = useState('')

  // Controleer of er al een koppeling is
  useEffect(() => {
    if (!supabaseUser) return
    supabase
      .from('vinted_account_links')
      .select('vinted_user_id')
      .eq('owner_id', supabaseUser.id)
      .maybeSingle()
      .then(({ data }) => setLinked(!!data?.vinted_user_id))
  }, [supabaseUser?.id])

  // Poll pending_links elke 2s zolang we wachten
  useEffect(() => {
    if (!waiting || !pendingId) return
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('pending_links')
        .select('linked')
        .eq('id', pendingId)
        .maybeSingle()
      if (data?.linked) {
        setLinked(true)
        setWaiting(false)
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [waiting, pendingId])

  const handleStartLink = async () => {
    setError('')
    const { data, error: e } = await supabase
      .from('pending_links')
      .insert({ owner_id: supabaseUser.id })
      .select('id')
      .single()
    if (e) { setError(e.message); return }
    setPendingId(data.id)
    setWaiting(true)
    window.open(`https://www.vinted.be/my_orders?vault_link=${data.id}`, '_blank')
  }

  const handleUnlink = async () => {
    await supabase.from('vinted_account_links').delete().eq('owner_id', supabaseUser.id)
    setLinked(false)
    setWaiting(false)
    setPendingId(null)
  }

  const iconColor = linked ? 'rgba(0,255,136,0.1)' : waiting ? 'rgba(99,102,241,0.1)' : 'var(--bg-2)'
  const iconBorder = linked ? 'rgba(0,255,136,0.3)' : waiting ? 'rgba(99,102,241,0.3)' : 'var(--border)'

  return (
    <div className="glass-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 12, flexShrink: 0,
          background: iconColor, border: `1px solid ${iconBorder}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
        }}>🔗</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Vinted-account (voor automatische synchronisatie)</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
            {linked === null ? 'Laden…'
              : linked        ? 'Gekoppeld — extensie sync werkt'
              : waiting       ? 'Wachten op koppeling…'
              :                 'Niet gekoppeld — sync werkt pas na koppeling'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>Nodig zodat de extensie weet welke aankopen/verkopen van jou zijn.</div>
        </div>

        {linked && (
          <button className="btn btn-secondary btn-sm" onClick={handleUnlink}>Ontkoppel</button>
        )}
        {!linked && !waiting && linked !== null && (
          <button className="btn btn-primary btn-sm" onClick={handleStartLink}>
            Koppel mijn Vinted account
          </button>
        )}
      </div>

      {waiting && (
        <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 8, background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.18)' }}>
          <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.65 }}>
            <strong>Ga naar het geopende Vinted-tabblad</strong> en klik op de
            {' '}<span style={{ display: 'inline-block', width: 18, height: 18, borderRadius: 4, background: '#6366f1', color: '#fff', fontWeight: 800, fontSize: 11, textAlign: 'center', lineHeight: '18px', verticalAlign: 'middle' }}>V</span>{' '}
            knop van de extensie om het paneel te openen.
            De koppeling wordt dan automatisch voltooid.
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span>
            Wachten op bevestiging…
          </div>
        </div>
      )}

      {linked && (
        <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(0,255,136,0.05)', border: '1px solid rgba(0,255,136,0.18)' }}>
          <span style={{ fontSize: 13, color: 'var(--green)', fontWeight: 600 }}>
            ✓ Gekoppeld — de extensie gebruikt jouw Vault account voor sync
          </span>
        </div>
      )}

      {error && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--red)' }}>{error}</div>}
    </div>
  )
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

const PLATFORMS_KEY = 'vault-platforms'

function PlatformsSection() {
  const load = () => { try { return JSON.parse(localStorage.getItem(PLATFORMS_KEY) || '[]') } catch { return [] } }
  const [platforms, setPlatforms] = useState(load)
  const [newName, setNewName]     = useState('')
  const [newUrl,  setNewUrl]      = useState('')

  const save = (list) => {
    setPlatforms(list)
    localStorage.setItem(PLATFORMS_KEY, JSON.stringify(list))
  }

  const add = () => {
    const name = newName.trim()
    if (!name) return
    if (platforms.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      alert(`Platform "${name}" bestaat al.`); return
    }
    save([...platforms, { id: Date.now().toString(), name, url: newUrl.trim() }])
    setNewName(''); setNewUrl('')
  }

  const remove = (id) => save(platforms.filter(p => p.id !== id))

  return (
    <div className="glass-card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Verkoopplatforms</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Verschijnen in het platformfilter op de Verkopen pagina</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {platforms.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center', padding: '12px 0' }}>Nog geen platforms toegevoegd</div>
        )}
        {platforms.map(p => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '10px 14px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
              {p.url && <div style={{ fontSize: 11, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.url}</div>}
            </div>
            <button className="btn btn-danger btn-sm" onClick={() => remove(p.id)}>Verwijder</button>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="Naam (bv. Vinted, Depop)"
          style={{ flex: '1 1 120px', minWidth: 0 }}
        />
        <input
          value={newUrl}
          onChange={e => setNewUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="URL (optioneel)"
          style={{ flex: '2 1 180px', minWidth: 0 }}
        />
        <button className="btn btn-primary btn-sm" onClick={add} disabled={!newName.trim()} style={{ whiteSpace: 'nowrap' }}>
          + Toevoegen
        </button>
      </div>
    </div>
  )
}

// ── Inkoop & synchronisatie — zelfde keuzes/teksten als de onboarding-flow
// (Onboarding.jsx STAP 1+2, PurchaseMethodPicker/AutoSyncToggleRow gedeeld),
// hier achteraf aanpasbaar. Lokale state initialiseert 1x uit de props; de
// pagina remount (key={page} in App.jsx) telkens je hierheen navigeert, dus
// dat blijft altijd de actuele waarde — TENZIJ de 3 sync-toggles hierna
// gewijzigd worden zonder dat deze pagina remount, bv. door het extensiepaneel
// (⚙ Live synchronisatie in content.js), dat rechtstreeks naar Supabase
// schrijft buiten React om. handleSave() stuurt daarom ENKEL de velden mee
// die in DEZE sessie daadwerkelijk aangepast zijn (per-veld dirty-check),
// i.p.v. altijd alle 4 velden — anders zou op te slaan bv. een niet-
// aangeraakte auto_sync_purchases teruggezet worden naar de verouderde
// waarde van bij het mounten, en een toggle die net via de extensie aanstond
// leek dan na een handmatige save in de webapp "spontaan" weer uit te vallen.
function PurchaseSettingsSection({ activeUserId, purchaseMethod, autoSyncSales, autoSyncPurchases, autoSyncLabels, onUserSettingsChange }) {
  const [method, setMethod] = useState(purchaseMethod || 'both')
  const [syncSales, setSyncSales] = useState(autoSyncSales ?? true)
  const [syncPurchases, setSyncPurchases] = useState(autoSyncPurchases ?? false)
  const [syncLabels, setSyncLabels] = useState(autoSyncLabels ?? false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const methodDirty = method !== (purchaseMethod || 'both')
  const syncSalesDirty = syncSales !== (autoSyncSales ?? true)
  const syncPurchasesDirty = syncPurchases !== (autoSyncPurchases ?? false)
  const syncLabelsDirty = syncLabels !== (autoSyncLabels ?? false)
  const dirty = methodDirty || syncSalesDirty || syncPurchasesDirty || syncLabelsDirty

  const handleSave = async () => {
    if (!dirty || saving) return
    setSaving(true)
    try {
      const payload = { user_id: activeUserId }
      const changed = {}
      if (methodDirty)         { payload.purchase_method     = method;        changed.purchaseMethod     = method }
      if (syncSalesDirty)      { payload.auto_sync_sales      = syncSales;     changed.autoSyncSales      = syncSales }
      if (syncPurchasesDirty)  { payload.auto_sync_purchases  = syncPurchases; changed.autoSyncPurchases  = syncPurchases }
      if (syncLabelsDirty)     { payload.auto_sync_labels     = syncLabels;    changed.autoSyncLabels     = syncLabels }
      const { error } = await supabase.from('user_settings').upsert(payload, { onConflict: 'user_id' })
      if (error) throw error
      onUserSettingsChange?.(changed)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      alert(`Opslaan mislukt: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="glass-card">
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Inkoop & synchronisatie</div>
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 18 }}>
        Dezelfde keuzes als bij het opstarten — pas ze hier aan wanneer je situatie verandert.
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
        Hoe koop je meestal in?
      </div>
      <PurchaseMethodPicker value={method} onChange={setMethod} />

      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '20px 0 8px' }}>
        Automatisch synchroniseren
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <AutoSyncToggleRow
          label="Verkopen automatisch synchroniseren"
          checked={syncSales}
          onChange={setSyncSales}
          desc="Nieuwe verkopen worden automatisch opgehaald en de status van bestaande verkopen wordt bijgewerkt, zonder dat je zelf iets hoeft aan te vinken."
        />
        {/* Enkel relevant als er ook via Vinted wordt ingekocht — bij
            uitsluitend leveranciers is de Aankopen-pagina zelf al verborgen
            (zie Nav.jsx VINTED_ONLY_PAGES), dus deze toggle heeft dan geen
            zichtbaar effect meer. */}
        {method !== 'suppliers' && (
          <AutoSyncToggleRow
            label="Aankopen automatisch synchroniseren"
            checked={syncPurchases}
            onChange={setSyncPurchases}
            desc="Nieuwe aankopen komen alleen binnen als je ze zelf handmatig selecteert via de extensie. Zet dit aan als je wil dat ook nieuwe aankopen automatisch worden opgehaald."
          />
        )}
        <AutoSyncToggleRow
          label="Labels automatisch synchroniseren"
          checked={syncLabels}
          onChange={setSyncLabels}
          desc="Verzendlabels worden automatisch geverifieerd en klaargezet, zonder dat je zelf het Labels-tabblad in de extensie hoeft te openen."
        />
      </div>

      <button
        className="btn btn-primary btn-sm"
        style={{ marginTop: 16 }}
        onClick={handleSave}
        disabled={!dirty || saving}
      >
        {saving ? 'Bezig…' : saved ? '✓ Opgeslagen' : 'Opslaan'}
      </button>
    </div>
  )
}

export default function Settings({ data, updateData, onExport, onClearData, activeUserId, vintedCookie, onVintedCookieChange, supabaseUser, onSignOut, purchaseMethod, autoSyncSales, autoSyncPurchases, autoSyncLabels, onUserSettingsChange, onNavigate }) {
  const { suppliers, batches, sales } = data
  const documents = data.documents || []

  const [editSupplier, setEditSupplier] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmDeleteSup, setConfirmDeleteSup] = useState(null)
  const [extInstalled, setExtInstalled] = useState(() => !!localStorage.getItem(EXT_INSTALLED_KEY))
  const docRef = useRef()

  const handleAdd = (s) => {
    if (suppliers.some((x) => x.prefix === s.prefix)) {
      alert(`Prefix "${s.prefix}" bestaat al.`); return
    }
    updateData({ suppliers: [...suppliers, { id: genId(), ...s }] })
  }

  const handleEdit = (id, updates) => {
    const oldSup = suppliers.find((s) => s.id === id)
    const oldPrefix = oldSup?.prefix
    const newPrefix = updates.prefix

    let updatedBatches = batches
    let updatedSkuPhotos = data.skuPhotos || {}

    if (newPrefix && newPrefix !== oldPrefix) {
      if (suppliers.some((s) => s.id !== id && s.prefix === newPrefix)) {
        alert(`Prefix "${newPrefix}" is al in gebruik.`); return
      }
      updatedBatches = batches.map((b) =>
        b.supplierPrefix === oldPrefix ? { ...b, supplierPrefix: newPrefix } : b
      )
      const newSkuPhotos = {}
      Object.entries(updatedSkuPhotos).forEach(([key, val]) => {
        const newKey = key.startsWith(oldPrefix)
          ? newPrefix + key.slice(oldPrefix.length)
          : key
        newSkuPhotos[newKey] = val
      })
      updatedSkuPhotos = newSkuPhotos
    }

    updateData({
      suppliers: suppliers.map((x) => (x.id === id ? { ...x, ...updates } : x)),
      batches: updatedBatches,
      skuPhotos: updatedSkuPhotos,
    })
  }

  const handleDeleteSup = (id) => {
    const sup = suppliers.find((s) => s.id === id)
    updateData({
      suppliers: suppliers.filter((s) => s.id !== id),
      batches: batches.filter((b) => b.supplierPrefix !== sup?.prefix),
      sales: sales.filter((s) => {
        const b = batches.find((x) => x.id === s.batchId)
        return b?.supplierPrefix !== sup?.prefix
      }),
    })
    setConfirmDeleteSup(null)
  }

  const importData = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result)
        if (parsed.batches && parsed.suppliers) { updateData(parsed); alert('Data geïmporteerd!') }
        else alert('Ongeldig bestandsformaat.')
      } catch { alert('Fout bij het inlezen van het bestand.') }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const uploadDocument = (e) => {
    const files = Array.from(e.target.files)
    files.forEach((file) => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const doc = {
          id: genId(),
          name: file.name,
          date: new Date().toISOString().split('T')[0],
          size: file.size,
          type: file.type,
          data: ev.target.result,
        }
        updateData({ documents: [...(data.documents || []), doc] })
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  const downloadDocument = (doc) => {
    const a = document.createElement('a')
    a.href = doc.data
    a.download = doc.name
    a.click()
  }

  const deleteDocument = (id) => {
    updateData({ documents: documents.filter((d) => d.id !== id) })
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Instellingen</h1>
          <div className="page-subtitle">Beheer leveranciers, documenten en app data</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 760 }}>
        {/* Op mobiel zit Stats niet in de bottom-nav (zie BOTTOM_TABS in
            Nav.jsx) — enkel via deze link binnenin Instellingen bereikbaar.
            Op desktop staat Stats al in de sidebar, dus deze kaart blijft
            daar verborgen (.mobile-only-link, zie index.css). */}
        {onNavigate && (
          <button
            className="glass-card mobile-only-link"
            onClick={() => onNavigate('stats')}
            style={{ alignItems: 'center', justifyContent: 'space-between', width: '100%', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 20 }}>📊</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>Stats</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>Winst over tijd, omzet per merk/kleur en meer</div>
              </div>
            </div>
            <span style={{ color: 'var(--text-3)', fontSize: 18 }}>›</span>
          </button>
        )}

        {/* Suppliers */}
        <div className="glass-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Leveranciers</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{suppliers.length} leveranciers geconfigureerd</div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setAddOpen(true)}>+ Toevoegen</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {suppliers.map((s) => {
              const sBatches = batches.filter((b) => b.supplierPrefix === s.prefix)
              const bCount = sBatches.length
              const maxEnd = sBatches.reduce((m, b) => Math.max(m, b.endNum || 0), 0)
              const lastSku = maxEnd > 0 ? formatSku(s.prefix, maxEnd) : null
              const nextSku = getNextSkuLabel(batches, s.prefix)
              return (
                <div
                  key={s.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    background: 'var(--bg-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-lg)',
                    padding: '12px 16px',
                  }}
                >
                  <div
                    style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: s.color + '18', border: `1px solid ${s.color}30`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}
                  >
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, display: 'block' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 800, color: s.color, fontSize: 14 }}>{s.prefix}</span>
                      <span style={{ fontWeight: 500, fontSize: 14 }}>{s.name}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span>{bCount} batch{bCount !== 1 ? 'es' : ''}</span>
                      {lastSku && (
                        <>
                          <span>·</span>
                          <span>Laatste: <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--text-2)' }}>{lastSku}</span></span>
                          <span>·</span>
                          <span style={{ color: s.color, fontWeight: 600 }}>
                            Volgende: <span style={{ fontFamily: 'monospace', fontWeight: 800 }}>{nextSku}</span>
                          </span>
                        </>
                      )}
                      {!lastSku && (
                        <span style={{ color: s.color, fontWeight: 600 }}>
                          Eerste SKU: <span style={{ fontFamily: 'monospace', fontWeight: 800 }}>{nextSku}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditSupplier(s)}>Bewerk</button>
                    <button className="btn btn-danger btn-sm" onClick={() => setConfirmDeleteSup(s.id)}>Verwijder</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Documents */}
        <div className="glass-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Documenten</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                Facturen, bonnen en leverancierscontracten
              </div>
            </div>
            <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>
              + Upload
              <input ref={docRef} type="file" accept=".pdf,image/*" multiple onChange={uploadDocument} style={{ display: 'none' }} />
            </label>
          </div>

          {documents.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--text-3)', fontSize: 13 }}>
              Geen documenten. Upload facturen, bonnen of contracten.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px',
                    background: 'var(--bg-2)',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ fontSize: 20, flexShrink: 0 }}>
                    {doc.type?.includes('pdf') ? '📄' : '🖼'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {doc.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                      {formatDate(doc.date)}{doc.size ? ` · ${formatSize(doc.size)}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => downloadDocument(doc)}>
                      ↓ Download
                    </button>
                    <button
                      className="btn btn-danger btn-sm btn-icon"
                      onClick={() => deleteDocument(doc.id)}
                      style={{ fontSize: 14 }}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Inkoop & synchronisatie — zelfde keuzes als de onboarding-flow */}
        <PurchaseSettingsSection
          activeUserId={activeUserId}
          purchaseMethod={purchaseMethod}
          autoSyncSales={autoSyncSales}
          autoSyncPurchases={autoSyncPurchases}
          autoSyncLabels={autoSyncLabels}
          onUserSettingsChange={onUserSettingsChange}
        />

        {/* Verzendlabels — onafhankelijk van de extensie-koppeling hieronder:
            deze sessie-cookie wordt enkel gebruikt om labels rechtstreeks bij
            Vinted op te halen (Labels.jsx/Verkopen.jsx/api/label.js). */}
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '8px 2px' }}>
          Verzendlabels
        </div>
        <VintedKoppeling
          vintedCookie={vintedCookie}
          onSave={onVintedCookieChange}
          activeUserId={activeUserId}
        />

        {/* Synchronisatie met de extensie — Stap 1 (installatie) + Stap 2
            (account koppelen) horen samen: de account-koppeling bepaalt aan
            welk Vault-account de extensie gesyncte orders toewijst. */}
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '20px 2px 8px' }}>
          Synchronisatie met de extensie
        </div>
        <ExtensionInstall onConfirm={() => setExtInstalled(true)} />

        {extInstalled && (
          <VintedAccountLink supabaseUser={supabaseUser} />
        )}

        {/* Platforms */}
        <PlatformsSection />

        {/* Data management */}
        <div className="glass-card">
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 20 }}>Data beheer</div>
          {[
            {
              title: 'Exporteer data',
              desc: 'Download alle data als JSON bestand',
              action: <button className="btn btn-secondary btn-sm" onClick={onExport}>Exporteer</button>,
            },
            {
              title: 'Importeer data',
              desc: 'Laad een eerder geëxporteerd JSON bestand',
              action: (
                <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                  Importeer
                  <input type="file" accept=".json" onChange={importData} style={{ display: 'none' }} />
                </label>
              ),
            },
            {
              title: 'Reset naar begindata',
              desc: 'Verwijdert alles en herstelt de originele startdata',
              danger: true,
              action: <button className="btn btn-danger btn-sm" onClick={() => setConfirmReset(true)}>Reset</button>,
            },
          ].map((item, i, arr) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 0',
                borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 500, color: item.danger ? 'var(--red)' : 'var(--text)' }}>{item.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{item.desc}</div>
              </div>
              {item.action}
            </div>
          ))}
        </div>

        {/* Account */}
        {supabaseUser && (
          <div className="glass-card">
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Account</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{supabaseUser.email}</div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3, fontFamily: 'monospace' }}>{supabaseUser.id}</div>
              </div>
              <button
                className="btn btn-danger btn-sm"
                onClick={onSignOut}
              >Uitloggen</button>
            </div>
          </div>
        )}

        {/* Info */}
        <div className="glass-card">
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>Info</div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.8 }}>
            <div>Vault Resell — lokale resell tracker</div>
            <div>Data opgeslagen in localStorage · geen externe server nodig</div>
            <div style={{ marginTop: 10, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <span>Batches: <strong style={{ color: 'var(--text-2)' }}>{batches.length}</strong></span>
              <span>Verkopen: <strong style={{ color: 'var(--text-2)' }}>{sales.length}</strong></span>
              <span>Leveranciers: <strong style={{ color: 'var(--text-2)' }}>{suppliers.length}</strong></span>
              <span>Documenten: <strong style={{ color: 'var(--text-2)' }}>{documents.length}</strong></span>
            </div>
          </div>
        </div>
      </div>

      {addOpen && <SupplierModal onClose={() => setAddOpen(false)} onSave={handleAdd} />}
      {editSupplier && (
        <SupplierModal
          supplier={editSupplier}
          onClose={() => setEditSupplier(null)}
          onSave={(s) => { handleEdit(editSupplier.id, s); setEditSupplier(null) }}
        />
      )}
      {confirmDeleteSup && (
        <ConfirmModal
          title="Leverancier verwijderen?"
          message="Dit verwijdert ook alle batches en verkopen van deze leverancier. Niet ongedaan te maken."
          onCancel={() => setConfirmDeleteSup(null)}
          onConfirm={() => handleDeleteSup(confirmDeleteSup)}
          danger
        />
      )}
      {confirmReset && (
        <ConfirmModal
          title="Alles resetten?"
          message="Alle batches, verkopen en leveranciers worden verwijderd en teruggezet naar de begindata. Dit kan niet ongedaan worden gemaakt."
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => { onClearData() }}
          danger
        />
      )}
    </div>
  )
}
