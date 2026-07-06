// Gedeeld door admin-users.js en admin-user-actions.js — beide moeten
// server-side weten of de aanroeper is_admin/is_super_admin is, ongeacht wat
// de client zelf beweert.

export function serviceHeaders(serviceKey) {
  return { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
}

export async function fetchCallerFlags(supabaseUrl, serviceKey, userId) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/user_settings?user_id=eq.${encodeURIComponent(userId)}&select=is_admin,is_super_admin&limit=1`,
    { headers: serviceHeaders(serviceKey) }
  )
  if (!res.ok) return { isAdmin: false, isSuperAdmin: false }
  const [row] = await res.json()
  return { isAdmin: !!row?.is_admin, isSuperAdmin: !!row?.is_super_admin }
}

// Haalt één auth-gebruiker op via Supabase's Admin API (service-role) —
// nodig om o.a. het e-mailadres server-side te resolven i.p.v. een
// client-aangeleverd e-mailadres te vertrouwen bij reset/impersonate/detail.
export async function fetchAuthUserById(supabaseUrl, serviceKey, userId) {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    headers: serviceHeaders(serviceKey),
  })
  if (!res.ok) return null
  const json = await res.json()
  // Sommige GoTrue-versies wikkelen de user in { user: {...} }, andere geven
  // 'm plat terug — defensief allebei afvangen.
  return json.user || json
}
