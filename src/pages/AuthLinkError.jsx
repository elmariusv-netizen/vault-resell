// error_code-waarden die Supabase in de #error-hash meestuurt — zie
// https://supabase.com/docs/guides/auth voor de volledige lijst. Enkel de
// twee die deze app daadwerkelijk kan tegenkomen (verlopen/al-gebruikte
// reset- of magic-link) krijgen een specifieke, begrijpelijke tekst; overige
// (nog onbekende) codes vallen terug op Supabase's eigen error_description.
const MESSAGES = {
  otp_expired: 'Deze reset-link is verlopen. Vraag een nieuwe aan via de beheerder of via het inlogscherm.',
  access_denied: 'Deze link is niet (meer) geldig. Vraag een nieuwe aan via de beheerder of via het inlogscherm.',
}

export default function AuthLinkError({ error, onBack }) {
  const message = MESSAGES[error?.errorCode] || error?.errorDescription || 'Deze link is ongeldig of verlopen.'

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
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 52, height: 52, borderRadius: 14,
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: 1,
            marginBottom: 12, boxShadow: '0 8px 24px rgba(99,102,241,0.4)',
          }}>V</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', letterSpacing: '0.12em' }}>VAULT</div>
        </div>

        <h1 style={{ fontSize: 19, fontWeight: 800, color: '#f1f5f9', textAlign: 'center', margin: '0 0 16px' }}>
          Link verlopen
        </h1>

        <div style={{
          marginBottom: 20, padding: '12px 14px', borderRadius: 8,
          background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)',
          color: '#fca5a5', fontSize: 13.5, lineHeight: 1.6, textAlign: 'center',
        }}>
          {message}
        </div>

        <button
          type="button" onClick={onBack}
          style={{
            width: '100%', padding: '12px', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: '#fff', fontSize: 15, fontWeight: 700, fontFamily: 'inherit',
            boxShadow: '0 4px 16px rgba(99,102,241,0.4)',
          }}
        >
          Terug naar inlogscherm
        </button>
      </div>
    </div>
  )
}
