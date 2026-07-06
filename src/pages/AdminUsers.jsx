import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../utils/supabase'
import { formatCurrency } from '../utils/skuUtils'
import Modal from '../components/Modal'
import { fetchUserDetail, sendResetPassword, generateImpersonationLink, deactivateUser, setUserIsAdmin } from '../utils/adminActions'

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

function ConfirmModal({ title, message, onCancel, onConfirm, busy }) {
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onCancel}>×</button>
        </div>
        <p style={{ color: 'var(--text-2)', fontSize: 14, lineHeight: 1.7 }}>{message}</p>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>Annuleer</button>
          <button className="btn btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Bezig…' : 'Bevestig'}
          </button>
        </div>
      </div>
    </div>
  )
}

function UserDetailModal({ userId, callerIsSuperAdmin, onClose, onChanged }) {
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(null) // 'reset' | 'impersonate' | 'admin' | null
  const [impersonateLink, setImpersonateLink] = useState('')
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)
  const [deactivating, setDeactivating] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      setDetail(await fetchUserDetail(userId))
    } catch (e) {
      setError(e.message || 'Laden mislukt.')
    }
  }, [userId])

  useEffect(() => { load() }, [load])

  const handleReset = async () => {
    setBusy('reset'); setMessage(''); setError('')
    try {
      const result = await sendResetPassword(userId)
      setMessage(`Reset-e-mail verstuurd naar ${result.email}.`)
    } catch (e) {
      setError(e.message || 'Versturen mislukt.')
    }
    setBusy(null)
  }

  const handleImpersonate = async () => {
    setBusy('impersonate'); setMessage(''); setError(''); setImpersonateLink('')
    try {
      const result = await generateImpersonationLink(userId)
      setImpersonateLink(result.link)
    } catch (e) {
      setError(e.message || 'Genereren mislukt.')
    }
    setBusy(null)
  }

  const handleToggleAdmin = async () => {
    if (!detail) return
    setBusy('admin'); setError('')
    try {
      const result = await setUserIsAdmin(userId, !detail.isAdmin)
      setDetail((prev) => prev ? { ...prev, isAdmin: result.isAdmin } : prev)
      onChanged?.()
    } catch (e) {
      setError(e.message || 'Bijwerken mislukt.')
    }
    setBusy(null)
  }

  const handleDeactivate = async () => {
    setDeactivating(true); setError('')
    try {
      await deactivateUser(userId)
      onChanged?.()
      onClose()
    } catch (e) {
      setError(e.message || 'Deactiveren mislukt.')
      setDeactivating(false)
      setConfirmDeactivate(false)
    }
  }

  const badge = statusBadge(detail?.whopStatus)

  return (
    <>
      <Modal title="Gebruiker" onClose={onClose}>
        {!detail && !error && <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-3)' }}>Laden…</div>}
        {error && !detail && (
          <div className="empty-state">
            <div className="empty-icon">⚠</div>
            <p>{error}</p>
          </div>
        )}
        {detail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{detail.email}</div>
              {detail.whopEmailOverride && (
                <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Whop: {detail.whopEmailOverride}</div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className={`badge ${badge.cls}`}>{badge.label}</span>
              {detail.isAdmin && <span className="badge badge-blue">Beheerder</span>}
              {detail.isSuperAdmin && <span className="badge badge-blue">Super-admin</span>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 13 }}>
              <div>
                <div style={{ color: 'var(--text-3)', fontSize: 11, textTransform: 'uppercase' }}>Aangemaakt op</div>
                <div>{formatDateTime(detail.createdAt)}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-3)', fontSize: 11, textTransform: 'uppercase' }}>Laatste activiteit</div>
                <div>{formatDateTime(detail.lastSignInAt)}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-3)', fontSize: 11, textTransform: 'uppercase' }}>Verkopen</div>
                <div>{detail.salesCount}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-3)', fontSize: 11, textTransform: 'uppercase' }}>Omzet</div>
                <div>{formatCurrency(detail.totalRevenue)}</div>
              </div>
            </div>

            {callerIsSuperAdmin && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={detail.isAdmin} disabled={busy === 'admin'} onChange={handleToggleAdmin} />
                Beheerder-rechten
              </label>
            )}

            {message && (
              <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--green-dim)', color: 'var(--green)', fontSize: 13 }}>
                {message}
              </div>
            )}
            {error && (
              <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--red-dim)', color: 'var(--red)', fontSize: 13 }}>
                {error}
              </div>
            )}

            {impersonateLink && (
              <div style={{ padding: 12, borderRadius: 8, border: '1px solid var(--border-strong)', background: 'var(--bg-2)' }}>
                <div style={{ fontSize: 12, color: 'var(--yellow)', fontWeight: 600, marginBottom: 8 }}>
                  ⚠ Je wordt uitgelogd van je eigen account als je deze link volgt.
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    readOnly value={impersonateLink} onFocus={(e) => e.target.select()}
                    style={{ flex: 1, fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-strong)', background: 'var(--bg-1)', color: 'var(--text-2)' }}
                  />
                  <button className="btn btn-secondary" onClick={() => navigator.clipboard.writeText(impersonateLink)}>Kopieer</button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" onClick={handleReset} disabled={busy === 'reset'}>
                {busy === 'reset' ? 'Bezig…' : '✉ Stuur reset-e-mail'}
              </button>
              <button className="btn btn-secondary" onClick={handleImpersonate} disabled={busy === 'impersonate'}>
                {busy === 'impersonate' ? 'Bezig…' : '🔑 Login als gebruiker'}
              </button>
              <button className="btn btn-danger" onClick={() => setConfirmDeactivate(true)}>
                Deactiveer account
              </button>
            </div>
          </div>
        )}
      </Modal>

      {confirmDeactivate && (
        <ConfirmModal
          title="Account deactiveren?"
          message={`${detail?.email} kan hierna niet meer inloggen. Dit is onomkeerbaar.`}
          busy={deactivating}
          onCancel={() => setConfirmDeactivate(false)}
          onConfirm={handleDeactivate}
        />
      )}
    </>
  )
}

export default function AdminUsers() {
  const [users, setUsers] = useState(null)
  const [callerIsSuperAdmin, setCallerIsSuperAdmin] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState(null)

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
      const json = await res.json()
      setUsers(json.rows || [])
      setCallerIsSuperAdmin(!!json.callerIsSuperAdmin)
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
                  <tr key={u.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedUserId(u.id)}>
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

      {selectedUserId && (
        <UserDetailModal
          userId={selectedUserId}
          callerIsSuperAdmin={callerIsSuperAdmin}
          onClose={() => setSelectedUserId(null)}
          onChanged={load}
        />
      )}
    </div>
  )
}
