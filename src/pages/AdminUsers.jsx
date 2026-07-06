import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../utils/supabase'

const STATUS_BADGE = {
  active:       { label: 'Actief',              cls: 'badge-green' },
  trialing:     { label: 'Proefperiode',        cls: 'badge-blue' },
  expired:      { label: 'Verlopen',            cls: 'badge-red' },
  canceled:     { label: 'Verlopen',            cls: 'badge-red' },
  none:         { label: 'Nooit betaald',       cls: 'badge-gray' },
  unconfigured: { label: 'Niet geconfigureerd', cls: 'badge-gray' },
}

function statusBadge(status) {
  return STATUS_BADGE[status] || STATUS_BADGE.none
}

function formatDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-BE', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function AdminUsers() {
  const [users, setUsers] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Geen actieve sessie.')
      const res = await fetch('/api/admin-users', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) throw new Error(`Ophalen mislukt (${res.status})`)
      setUsers(await res.json())
    } catch (e) {
      setError(e.message || 'Ophalen mislukt.')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Gebruikers</h1>
          <div className="page-subtitle">{users ? `${users.length} geregistreerde accounts` : '…'}</div>
        </div>
        <button className="btn btn-secondary" onClick={load} disabled={loading}>
          {loading ? '⏳ Bezig…' : '↻ Vernieuwen'}
        </button>
      </div>

      {error && (
        <div className="empty-state">
          <div className="empty-icon">⚠</div>
          <h3>Kon gebruikers niet laden</h3>
          <p>{error}</p>
        </div>
      )}

      {!error && users === null && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>Laden…</div>
      )}

      {!error && users && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>E-mail</th>
                <th>Whop-status</th>
                <th>Beheerder</th>
                <th>Laatste activiteit</th>
                <th>Aangemaakt op</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const badge = statusBadge(u.whopStatus)
                return (
                  <tr key={u.id}>
                    <td>
                      {u.email}
                      {u.whopEmailOverride && (
                        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>Whop: {u.whopEmailOverride}</div>
                      )}
                    </td>
                    <td><span className={`badge ${badge.cls}`}>{badge.label}</span></td>
                    <td>{u.isAdmin ? <span className="badge badge-blue">Beheerder</span> : '—'}</td>
                    <td>{formatDateTime(u.lastSignInAt)}</td>
                    <td>{formatDateTime(u.createdAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
