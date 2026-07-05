// Ontvangt de Vinted-sessiecookie van de Chrome-extensie (die 'm zelf via
// chrome.cookies uitleest op vinted.be, zie uploadVintedCookie() in
// background.js) en slaat 'm op als user_settings.vinted_cookie — dit is de
// ENIGE schrijfplek voor dit veld sinds het handmatige plak-veld in
// Instellingen naar een verborgen fallback verhuisde. Draait met de
// service-rolekey (zoals api/sync-order.js), nooit de anon-key: user_settings
// heeft enkel een "authenticated" RLS-policy en de extensie heeft geen
// ingelogde Supabase-sessie.
//
// Beveiliging: de cookie is een login-sessie. Nooit in een response of log
// terugsturen (enkel een succes-boolean + timestamp), en de owner-koppeling
// wordt hier server-side herleid uit vinted_account_links (net als
// lookupOwnerId() in background.js) i.p.v. een door de client meegegeven
// owner_id te vertrouwen.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  const { vinted_user_id, cookie, vinted_login, vinted_photo } = req.body || {}
  if (!vinted_user_id || !cookie) {
    return res.status(400).json({ error: 'vinted_user_id en cookie vereist' })
  }

  // De cookie wordt later als x-vinted-cookie HTTP-header meegestuurd naar
  // Vinted (zie api/label.js) — headers mogen enkel Latin-1-tekens (code
  // point ≤ 255) bevatten. Nu server-side gevalideerd omdat dit endpoint de
  // enige schrijfplek is (het handmatige-plak-pad dat dit voorheen al
  // afving is nu een fallback die dezelfde check hergebruikt).
  const invalidChar = [...cookie].find((ch) => ch.charCodeAt(0) > 255)
  if (invalidChar) {
    return res.status(400).json({ error: 'cookie bevat ongeldige tekens' })
  }

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'server misconfigured' })
  }

  const hdrs = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  }

  try {
    const linkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/vinted_account_links?vinted_user_id=eq.${encodeURIComponent(vinted_user_id)}&select=owner_id&limit=1`,
      { headers: hdrs }
    )
    if (!linkRes.ok) return res.status(500).json({ error: 'link-lookup mislukt' })
    const [link] = await linkRes.json()
    if (!link?.owner_id) {
      return res.status(404).json({ error: 'geen Vault-koppeling voor dit Vinted-account' })
    }

    const updatedAt = new Date().toISOString()
    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/user_settings`, {
      method: 'POST',
      headers: { ...hdrs, 'Prefer': 'return=minimal,resolution=merge-duplicates' },
      body: JSON.stringify({
        user_id: link.owner_id,
        vinted_cookie: cookie,
        vinted_cookie_updated_at: updatedAt,
      }),
    })
    if (!upsertRes.ok) {
      const err = await upsertRes.text()
      console.error('[save-vinted-cookie] upsert fout:', upsertRes.status, err.slice(0, 200))
      return res.status(500).json({ error: 'opslaan mislukt' })
    }

    // Best-effort profiel-backfill (login + avatar) op vinted_account_links —
    // vooral relevant voor accounts die al vóór deze feature gekoppeld
    // waren (handleVaultLink in background.js zet dit enkel bij een NIEUWE
    // koppeling). Nooit de cookie-save laten falen op een probleem hier.
    if (vinted_login || vinted_photo) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/vinted_account_links?vinted_user_id=eq.${encodeURIComponent(vinted_user_id)}`, {
          method: 'PATCH',
          headers: { ...hdrs, 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            ...(vinted_login ? { vinted_login } : {}),
            ...(vinted_photo ? { vinted_photo } : {}),
          }),
        })
      } catch (e) {
        console.warn('[save-vinted-cookie] profiel-backfill mislukt:', e.message)
      }
    }

    return res.status(200).json({ success: true, updated_at: updatedAt })
  } catch (e) {
    console.error('[save-vinted-cookie] exception:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
