import { useState } from 'react'
import { supabase } from '../utils/supabase'

export default function Auth() {
  const [tab, setTab]         = useState('login')   // 'login' | 'register'
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [info, setInfo]       = useState('')

  const reset = () => { setError(''); setInfo('') }

  const handleSubmit = async (e) => {
    e.preventDefault()
    reset()
    setLoading(true)
    try {
      if (tab === 'login') {
        const { error: e } = await supabase.auth.signInWithPassword({ email, password })
        if (e) throw e
        // onAuthStateChange in App.jsx handelt de redirect af
      } else {
        const { error: e } = await supabase.auth.signUp({ email, password })
        if (e) throw e
        setInfo('Controleer je e-mail voor een bevestigingslink. Daarna kun je inloggen.')
      }
    } catch (e) {
      setError(e.message || 'Er ging iets mis.')
    }
    setLoading(false)
  }

  const inputStyle = {
    width: '100%', padding: '11px 14px', borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)',
    color: '#f1f5f9', fontSize: 14, outline: 'none', boxSizing: 'border-box',
    fontFamily: 'inherit', transition: 'border-color 0.15s',
  }

  const tabStyle = (active) => ({
    flex: 1, padding: '8px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
    fontWeight: 600, fontSize: 14, fontFamily: 'inherit', transition: 'all 0.15s',
    background: active ? 'rgba(99,102,241,0.25)' : 'transparent',
    color: active ? '#a5b4fc' : '#64748b',
  })

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
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
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

        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: 4, marginBottom: 24 }}>
          <button style={tabStyle(tab === 'login')}    onClick={() => { setTab('login');    reset() }}>Inloggen</button>
          <button style={tabStyle(tab === 'register')} onClick={() => { setTab('register'); reset() }}>Registreren</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 6 }}>
              E-mailadres
            </label>
            <input
              type="email" required autoFocus
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="jouw@email.com"
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = 'rgba(99,102,241,0.6)'}
              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.12)'}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 6 }}>
              Wachtwoord
            </label>
            <input
              type="password" required minLength={6}
              value={password} onChange={e => setPassword(e.target.value)}
              placeholder={tab === 'register' ? 'Minimaal 6 tekens' : '••••••••'}
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = 'rgba(99,102,241,0.6)'}
              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.12)'}
            />
          </div>

          {error && (
            <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5', fontSize: 13 }}>
              {error}
            </div>
          )}
          {info && (
            <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#86efac', fontSize: 13 }}>
              {info}
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
            {loading ? '⏳ Even geduld…' : tab === 'login' ? 'Inloggen' : 'Account aanmaken'}
          </button>
        </form>

        {tab === 'register' && !info && (
          <div style={{ marginTop: 20, fontSize: 12, color: '#475569', textAlign: 'center', lineHeight: 1.6 }}>
            Na registratie ontvang je een bevestigingsmail.<br />
            Je leveranciers en voorraad stel je daarna in via Instellingen.
          </div>
        )}
      </div>
    </div>
  )
}
