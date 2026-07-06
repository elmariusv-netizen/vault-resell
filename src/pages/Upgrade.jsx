import { useState } from 'react'

// Eén gedeelde checkout-pagina waar het plan gekozen wordt — Whop biedt
// (voor zover bekend) geen aparte per-plan-URL voor dit product. Pas beide
// links aan als dat wél zo blijkt te zijn.
const CHECKOUT_URL = 'https://whop.com/vault-resell/'

const STATUS_COPY = {
  expired: 'Je abonnement is verlopen.',
  none: 'Je hebt nog geen actief abonnement.',
}

export default function Upgrade({ supabaseUser, status, onSignOut, onRecheck }) {
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('')

  const handleRecheck = async () => {
    setChecking(true)
    setMessage('')
    try {
      const result = await onRecheck()
      if (!result?.hasAccess) {
        setMessage('Nog geen actief abonnement gevonden. Net betaald? Dat kan enkele minuten duren — probeer straks opnieuw.')
      }
    } catch {
      setMessage('Controleren mislukt. Probeer het straks opnieuw.')
    }
    setChecking(false)
  }

  const linkStyle = {
    flex: 1, textAlign: 'center', padding: '13px 16px', borderRadius: 10,
    fontSize: 14, fontWeight: 700, fontFamily: 'inherit', textDecoration: 'none',
    transition: 'all 0.15s', display: 'block', boxSizing: 'border-box',
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
      fontFamily: '-apple-system,"SF Pro Display","Inter","Segoe UI",sans-serif',
      padding: 16,
    }}>
      <div style={{
        width: '100%', maxWidth: 440,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 20, padding: '36px 32px',
        backdropFilter: 'blur(20px)',
        boxShadow: '0 32px 80px rgba(0,0,0,0.5)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 52, height: 52, borderRadius: 14,
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: 1,
            marginBottom: 12, boxShadow: '0 8px 24px rgba(99,102,241,0.4)',
          }}>V</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', letterSpacing: '0.12em' }}>VAULT</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Resell tracker</div>
        </div>

        <h1 style={{ fontSize: 19, fontWeight: 800, color: '#f1f5f9', textAlign: 'center', margin: '0 0 8px' }}>
          Upgrade nodig
        </h1>
        <p style={{ fontSize: 14, color: '#94a3b8', textAlign: 'center', lineHeight: 1.6, margin: '0 0 24px' }}>
          {STATUS_COPY[status] || STATUS_COPY.none} 3 dagen gratis proberen, daarna €9,99/maand of €94,99/jaar.
        </p>

        <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
          <a
            href={CHECKOUT_URL} target="_blank" rel="noreferrer"
            style={{ ...linkStyle, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff', boxShadow: '0 4px 16px rgba(99,102,241,0.4)' }}
          >
            Maandelijks<br /><span style={{ fontWeight: 500, opacity: 0.85 }}>€9,99/mnd</span>
          </a>
          <a
            href={CHECKOUT_URL} target="_blank" rel="noreferrer"
            style={{ ...linkStyle, background: 'rgba(255,255,255,0.06)', color: '#f1f5f9', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            Jaarlijks<br /><span style={{ fontWeight: 500, opacity: 0.85 }}>€94,99/jr</span>
          </a>
        </div>

        <div style={{
          marginBottom: 18, padding: '10px 14px', borderRadius: 8,
          background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)',
          color: '#c7d2fe', fontSize: 12.5, lineHeight: 1.6,
        }}>
          Betaal op Whop met hetzelfde e-mailadres als je Vault Resell-account
          (<strong>{supabaseUser?.email}</strong>) — anders herkennen we je abonnement niet automatisch.
        </div>

        {message && (
          <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5', fontSize: 13 }}>
            {message}
          </div>
        )}

        <button
          type="button" disabled={checking} onClick={handleRecheck}
          style={{
            width: '100%', padding: '12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)',
            cursor: checking ? 'not-allowed' : 'pointer', background: 'rgba(255,255,255,0.06)',
            color: '#f1f5f9', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', marginBottom: 12,
          }}
        >
          {checking ? '⏳ Even geduld…' : 'Ik heb net betaald — controleer opnieuw'}
        </button>

        <button
          type="button" onClick={onSignOut}
          style={{ width: '100%', padding: '10px', border: 'none', background: 'transparent', color: '#64748b', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}
        >
          Uitloggen
        </button>
      </div>
    </div>
  )
}
