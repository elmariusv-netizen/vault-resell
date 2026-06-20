import { useState } from 'react'
import { genId } from '../utils/skuUtils'

export default function Onboarding({ onComplete, hasLegacy }) {
  const [name, setName] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    onComplete({
      id: `u-${genId()}`,
      name: name.trim(),
      createdAt: new Date().toISOString(),
    })
  }

  return (
    <div className="onboarding-screen">
      <div className="onboarding-card">
        <div className="onboarding-brand">
          <span className="brand-mark" />
          VAULT
        </div>
        <h1 className="onboarding-title">Welkom</h1>
        <p className="onboarding-sub">
          Voer je naam of bedrijfsnaam in om te beginnen.
        </p>
        {hasLegacy && (
          <div className="onboarding-notice">
            Bestaande data wordt automatisch geïmporteerd.
          </div>
        )}
        <form onSubmit={handleSubmit} className="onboarding-form">
          <div className="form-group">
            <label>Naam / Bedrijfsnaam</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="bv. Marius Vintage"
              autoFocus
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
            disabled={!name.trim()}
          >
            Beginnen →
          </button>
        </form>
      </div>
    </div>
  )
}
