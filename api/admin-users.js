import { fetchWhopMembershipsByEmail } from './_lib/whop.js'
import { verifySupabaseUser } from './_lib/verifyUser.js'

// Haalt ALLE geregistreerde accounts op via Supabase's eigen Auth Admin API
// (geeft direct email/created_at/last_sign_in_at) — geen aparte
// activity-log-tabel nodig. Gepagineerd voor >1000 gebruikers.
async function fetchAllAuthUsers(supabaseUrl, serviceKey) {
  const users = []
  let page = 1
  for (;;) {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=1000`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    })
    if (!res.ok) throw new Error(`auth admin users fetch mislukt: ${res.status}`)
    const json = await res.json()
    const batch = json.users || []
    users.push(...batch)
    if (batch.length < 1000) break
    page += 1
  }
  return users
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL
  const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    return res.status(500).json({ error: 'server misconfigured' })
  }

  const accessToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '')
  if (!accessToken) return res.status(401).json({ error: 'missing Authorization header' })

  const caller = await verifySupabaseUser(SUPABASE_URL, ANON_KEY, accessToken).catch(() => null)
  if (!caller?.id) return res.status(401).json({ error: 'invalid session' })

  const sbHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }

  // Dit is het echte afdwingpunt — niet de UI (Nav verbergt de link enkel
  // voor het gemak, een client-side vlag wordt hier nooit vertrouwd).
  const callerSettingsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${encodeURIComponent(caller.id)}&select=is_admin&limit=1`,
    { headers: sbHeaders }
  )
  if (!callerSettingsRes.ok) return res.status(500).json({ error: 'kon rechten niet verifiëren' })
  const [callerSettings] = await callerSettingsRes.json()
  if (!callerSettings?.is_admin) return res.status(403).json({ error: 'forbidden' })

  let authUsers, settingsRows
  try {
    authUsers = await fetchAllAuthUsers(SUPABASE_URL, SERVICE_KEY)
    const settingsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_settings?select=user_id,is_admin,whop_email_override`,
      { headers: sbHeaders }
    )
    if (!settingsRes.ok) throw new Error(`user_settings fetch mislukt: ${settingsRes.status}`)
    settingsRows = await settingsRes.json()
  } catch (e) {
    console.error('[admin-users] ophalen mislukt:', e.message)
    return res.status(502).json({ error: `Ophalen mislukt: ${e.message}` })
  }

  const settingsByUserId = new Map(settingsRows.map((r) => [r.user_id, r]))

  const WHOP_API_KEY    = process.env.WHOP_API_KEY
  const WHOP_PRODUCT_ID = process.env.WHOP_PRODUCT_ID
  const whopConfigured  = !!(WHOP_API_KEY && WHOP_PRODUCT_ID)

  let membershipsByEmail = new Map()
  if (whopConfigured) {
    try {
      membershipsByEmail = await fetchWhopMembershipsByEmail({ apiKey: WHOP_API_KEY, productId: WHOP_PRODUCT_ID })
    } catch (e) {
      console.error('[admin-users] Whop-memberships ophalen mislukt:', e.message)
      // Lijst blijft bruikbaar, enkel de whop-status-kolom valt terug op "unknown"
    }
  }

  const rows = authUsers.map((u) => {
    const settings = settingsByUserId.get(u.id)
    const effectiveEmail = (settings?.whop_email_override || u.email || '').toLowerCase()
    const whopStatus = !whopConfigured
      ? 'unconfigured'
      : membershipsByEmail.get(effectiveEmail)?.status || 'none'

    return {
      id: u.id,
      email: u.email,
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at || null,
      isAdmin: !!settings?.is_admin,
      whopStatus,
      whopEmailOverride: settings?.whop_email_override || null,
    }
  })

  rows.sort((a, b) => new Date(b.lastSignInAt || 0) - new Date(a.lastSignInAt || 0))

  return res.status(200).json(rows)
}
