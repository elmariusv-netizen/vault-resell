import { fetchWhopMembershipsByEmail, isEntitledStatus } from './_lib/whop.js'
import { verifySupabaseUser } from './_lib/verifyUser.js'

const CACHE_TTL_MS = 24 * 60 * 60 * 1000

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

  const user = await verifySupabaseUser(SUPABASE_URL, ANON_KEY, accessToken).catch(() => null)
  if (!user?.id || !user?.email) return res.status(401).json({ error: 'invalid session' })

  const sbHeaders = { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
  const now = new Date().toISOString()

  const settingsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${encodeURIComponent(user.id)}&select=is_admin,whop_status,whop_checked_at,whop_email_override&limit=1`,
    { headers: sbHeaders }
  )
  if (!settingsRes.ok) {
    console.error('[whop-status] user_settings ophalen mislukt:', settingsRes.status)
    // Fail-open: een probleem aan onze kant mag nooit een betalende (of
    // niet-geconfigureerde) gebruiker blokkeren.
    return res.status(200).json({ hasAccess: true, status: 'unknown', checkedAt: now })
  }
  const [settingsRow] = await settingsRes.json()

  if (settingsRow?.is_admin) {
    return res.status(200).json({ hasAccess: true, status: 'admin', checkedAt: now })
  }

  const WHOP_API_KEY     = process.env.WHOP_API_KEY
  const WHOP_PRODUCT_ID  = process.env.WHOP_PRODUCT_ID
  if (!WHOP_API_KEY || !WHOP_PRODUCT_ID) {
    // Gefaseerde uitrol: zolang deze env-vars niet gezet zijn blijft de app
    // volledig open, precies zoals vandaag.
    return res.status(200).json({ hasAccess: true, status: 'unconfigured', checkedAt: now })
  }

  const forceRefresh = !!req.body?.forceRefresh
  const checkedAt = settingsRow?.whop_checked_at ? new Date(settingsRow.whop_checked_at).getTime() : 0
  const cacheValid = checkedAt && (Date.now() - checkedAt) < CACHE_TTL_MS

  if (cacheValid && !forceRefresh) {
    return res.status(200).json({
      hasAccess: isEntitledStatus(settingsRow.whop_status),
      status: settingsRow.whop_status || 'none',
      checkedAt: settingsRow.whop_checked_at,
      cached: true,
    })
  }

  let status
  try {
    const byEmail = await fetchWhopMembershipsByEmail({ apiKey: WHOP_API_KEY, productId: WHOP_PRODUCT_ID })
    const lookupEmail = (settingsRow?.whop_email_override || user.email).toLowerCase()
    status = byEmail.get(lookupEmail)?.status || 'none'
  } catch (e) {
    console.error('[whop-status] Whop API fout:', e.message)
    // Fail-open bij een Whop-storing: bestaande (ook verlopen) cache
    // teruggeven i.p.v. hard falen. Zonder ENIGE eerdere cache (bv. iemands
    // allereerste login valt samen met een Whop-storing) toch toegang geven
    // i.p.v. een mogelijk betalende klant buiten te sluiten.
    if (settingsRow?.whop_status) {
      return res.status(200).json({
        hasAccess: isEntitledStatus(settingsRow.whop_status),
        status: settingsRow.whop_status,
        checkedAt: settingsRow.whop_checked_at,
        stale: true,
      })
    }
    return res.status(200).json({ hasAccess: true, status: 'unknown', checkedAt: now })
  }

  const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/user_settings?on_conflict=user_id`, {
    method: 'POST',
    headers: { ...sbHeaders, Prefer: 'return=minimal,resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: user.id, whop_status: status, whop_checked_at: now }),
  })
  if (!upsertRes.ok) {
    console.warn('[whop-status] cache wegschrijven mislukt:', upsertRes.status, await upsertRes.text().catch(() => ''))
  }

  return res.status(200).json({ hasAccess: isEntitledStatus(status), status, checkedAt: now })
}
