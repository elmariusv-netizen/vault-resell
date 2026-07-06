import { useState } from 'react'
import { supabase } from '../utils/supabase'

export default function ResetPassword({ onDone }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [done, setDone]         = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('Wachtwoord moet minstens 6 tekens zijn.'); return }
    if (password !== confirm) { setError('Wachtwoorden komen niet overeen.'); return }
    setLoading(true)
    try {
      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) throw err
      setDone(true)
      setTimeout(() => onDone?.(), 1800)
    } catch (err) {
      setError(err.message || 'Wachtwoord wijzigen mislukt.')
    }
    setLoading(false)
  }

  const inputStyle = {
    width: '100%', padding: '11px 14px', borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)',
    color: '#f1f5f9', fontSize: 14, outline: 'none', boxSizing: 'border-box',
    fontFamily: 'inherit', transition: 'border-color 0.15s',
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
      fontFamily: '-apple-system,"SF Pro Display","Inter","Segoe UI",sans-serif',
      padding: 16,
    }}>
      <div style={{
        width: '100%', maxWidth: 380,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 20, padding: '36px 32px',
        backdropFilter: 'blur(20px)',
        boxShadow: '0 32px 80px rgba(0,0,0,0.5)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 52, height: 52, borderRadius: 14,
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: 1,
            marginBottom: 12, boxShadow: '0 8px 24px rgba(99,102,241,0.4)',
          }}>V</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', letterSpacing: '0.12em' }}>VAULT</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Nieuw wachtwoord instellen</div>
        </div>

        {done ? (
          <div style={{
            padding: '14px 16px', borderRadius: 10, textAlign: 'center',
            background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)',
            color: '#86efac', fontSize: 14,
          }}>
            ✓ Wachtwoord gewijzigd. Je wordt doorgestuurd…
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 6 }}>
                Nieuw wachtwoord
              </label>
              <input
                type="password" required minLength={6} autoFocus
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimaal 6 tekens"
                style={inputStyle}
                onFocus={(e) => e.target.style.borderColor = 'rgba(99,102,241,0.6)'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.12)'}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 6 }}>
                Bevestig wachtwoord
              </label>
              <input
                type="password" required minLength={6}
                value={confirm} onChange={(e) => setConfirm(e.target.value)}
                placeholder="Herhaal je nieuwe wachtwoord"
                style={inputStyle}
                onFocus={(e) => e.target.style.borderColor = 'rgba(99,102,241,0.6)'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.12)'}
              />
            </div>

            {error && (
              <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5', fontSize: 13 }}>
                {error}
              </div>
            )}

            <button
              type="submit" disabled={loading}
              style={{
                width: '100%', padding: '12px', borderRadius: 10, border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                background: loading ? 'rgba(99,102,241,0.4)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: '#fff', fontSize: 15, fontWeight: 700, fontFamily: 'inherit',
                boxShadow: loading ? 'none' : '0 4px 16px rgba(99,102,241,0.4)',
                transition: 'all 0.15s',
              }}
            >
              {loading ? '⏳ Even geduld…' : 'Wachtwoord instellen'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
