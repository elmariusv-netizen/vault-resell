import { useState } from 'react'
import { supabase } from '../utils/supabase'

// Gedeeld met de "Inkoop & synchronisatie"-sectie in Settings.jsx, zodat de
// gebruiker deze keuzes later kan wijzigen zonder de onboarding opnieuw te
// doorlopen — zelfde opties/teksten, dus als bron van waarheid hier.
export const PURCHASE_METHODS = [
  { value: 'vinted', title: 'Ik koop alleen in via Vinted', desc: 'Je koopt zelf artikelen op Vinted om door te verkopen.' },
  { value: 'suppliers', title: 'Ik koop alleen in bij leveranciers', desc: 'Je werkt met externe leveranciers/batches (SKU-systeem).' },
  { value: 'both', title: 'Beide', desc: 'Je doet allebei.' },
]

export function PurchaseMethodPicker({ value, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {PURCHASE_METHODS.map(m => (
        <label
          key={m.value}
          style={{
            display: 'flex', gap: 12, alignItems: 'flex-start', padding: 14, borderRadius: 12,
            border: `1px solid ${value === m.value ? 'var(--green-border)' : 'var(--border)'}`,
            background: value === m.value ? 'var(--green-dim)' : 'transparent',
            cursor: 'pointer', transition: 'all 0.13s',
          }}
        >
          <input
            type="radio"
            name="purchase_method"
            value={m.value}
            checked={value === m.value}
            onChange={() => onChange(m.value)}
            style={{ marginTop: 3, width: 16, height: 16, accentColor: 'var(--green)', cursor: 'pointer', flexShrink: 0 }}
          />
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{m.title}</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2, lineHeight: 1.5 }}>{m.desc}</div>
          </div>
        </label>
      ))}
    </div>
  )
}

export function AutoSyncToggleRow({ label, checked, onChange, desc }) {
  return (
    <div style={{ padding: 14, borderRadius: 12, border: '1px solid var(--border)' }}>
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: 'pointer' }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{label}</span>
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          style={{ width: 18, height: 18, accentColor: 'var(--green)', cursor: 'pointer', flexShrink: 0 }}
        />
      </label>
      <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 8, lineHeight: 1.5 }}>{desc}</div>
    </div>
  )
}

// ── Onboarding-flow — verschijnt éénmalig na registratie (user_settings.
// onboarding_completed=false), 3 stappen: inkoopmethode → auto-sync-
// voorkeuren → bevestigen. Dezelfde keuzes blijven achteraf aanpasbaar via
// Instellingen (PurchaseMethodPicker/AutoSyncToggleRow hierboven, gedeeld).
export default function Onboarding({ activeUserId, onComplete }) {
  const [step, setStep] = useState(1)
  const [purchaseMethod, setPurchaseMethod] = useState('both')
  const [autoSyncSales, setAutoSyncSales] = useState(true)
  const [autoSyncPurchases, setAutoSyncPurchases] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleFinish = async () => {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const { error: e } = await supabase.from('user_settings').upsert({
        user_id: activeUserId,
        purchase_method: purchaseMethod,
        auto_sync_sales: autoSyncSales,
        auto_sync_purchases: autoSyncPurchases,
        onboarding_completed: true,
      }, { onConflict: 'user_id' })
      if (e) throw e
      onComplete({ purchaseMethod, autoSyncSales, autoSyncPurchases })
    } catch (e) {
      setError(e.message || 'Opslaan mislukt. Probeer het opnieuw.')
      setSaving(false)
    }
  }

  const purchaseMethodLabel = PURCHASE_METHODS.find(m => m.value === purchaseMethod)?.title

  return (
    <div className="onboarding-screen">
      <div className="onboarding-card" style={{ maxWidth: 480 }}>
        <div className="onboarding-brand">
          <span className="brand-mark" />
          VAULT
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
          {[1, 2, 3].map(n => (
            <div key={n} style={{ flex: 1, height: 4, borderRadius: 2, background: n <= step ? 'var(--green)' : 'var(--border)' }} />
          ))}
        </div>

        {step === 1 && (
          <>
            <h1 className="onboarding-title">Hoe koop je meestal in?</h1>
            <p className="onboarding-sub">
              Dit bepaalt welke onderdelen van Vault je te zien krijgt — je kan dit later altijd wijzigen via Instellingen.
            </p>
            <PurchaseMethodPicker value={purchaseMethod} onChange={setPurchaseMethod} />
            <button
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', padding: 12, marginTop: 20 }}
              onClick={() => setStep(2)}
            >
              Verder →
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className="onboarding-title">Automatisch synchroniseren</h1>
            <p className="onboarding-sub">
              Kies wat de "🔄 Synchroniseren"-knop op je dashboard automatisch mag doen — dit kun je later altijd aanpassen via Instellingen.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <AutoSyncToggleRow
                label="Verkopen automatisch synchroniseren"
                checked={autoSyncSales}
                onChange={setAutoSyncSales}
                desc="Nieuwe verkopen worden automatisch opgehaald en de status van bestaande verkopen wordt bijgewerkt, zonder dat je zelf iets hoeft aan te vinken."
              />
              <AutoSyncToggleRow
                label="Aankopen automatisch synchroniseren"
                checked={autoSyncPurchases}
                onChange={setAutoSyncPurchases}
                desc="Nieuwe aankopen komen alleen binnen als je ze zelf handmatig selecteert via de extensie. Zet dit aan als je wil dat ook nieuwe aankopen automatisch worden opgehaald."
              />
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setStep(1)}>← Terug</button>
              <button className="btn btn-primary" style={{ flex: 2, justifyContent: 'center' }} onClick={() => setStep(3)}>Verder →</button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="onboarding-title">Klaar om te beginnen</h1>
            <p className="onboarding-sub">Even controleren voor je start:</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, color: 'var(--text-2)', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 4 }}>
              <div><strong style={{ color: 'var(--text)' }}>Inkoopmethode:</strong> {purchaseMethodLabel}</div>
              <div><strong style={{ color: 'var(--text)' }}>Verkopen auto-sync:</strong> {autoSyncSales ? 'Aan' : 'Uit'}</div>
              <div><strong style={{ color: 'var(--text)' }}>Aankopen auto-sync:</strong> {autoSyncPurchases ? 'Aan' : 'Uit'}</div>
            </div>
            {error && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 10 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setStep(2)} disabled={saving}>← Terug</button>
              <button
                className="btn btn-primary"
                style={{ flex: 2, justifyContent: 'center' }}
                onClick={handleFinish}
                disabled={saving}
              >
                {saving ? 'Bezig…' : '✓ Beginnen'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
