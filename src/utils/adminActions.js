import { supabase } from './supabase'

async function callAdminAction(body) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Geen actieve sessie.')
  const res = await fetch('/api/admin-user-actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Actie mislukt (${res.status})`)
  return json
}

export const fetchUserDetail   = (targetUserId) => callAdminAction({ action: 'detail', targetUserId })
export const sendResetPassword = (targetUserId) => callAdminAction({ action: 'reset-password', targetUserId })
export const generateImpersonationLink = (targetUserId) => callAdminAction({ action: 'impersonate', targetUserId })
export const deactivateUser     = (targetUserId) => callAdminAction({ action: 'deactivate', targetUserId })
export const setUserIsAdmin     = (targetUserId, isAdmin) => callAdminAction({ action: 'set-admin', targetUserId, isAdmin })
