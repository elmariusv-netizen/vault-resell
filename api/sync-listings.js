// Ontvangt de actieve Vinted-listings van de Chrome-extensie (content.js's
// getListings(), met sku_ref al client-side gedetecteerd via
// extractSkuCandidate — zelfde regex als bij SKU-detectie voor verkopen) en
// slaat ze op in active_listings, zodat de "Live"-badge op Voorraad/
// Inventory.jsx kan doorklikken naar de échte actieve artikelen i.p.v. enkel
// een handmatige teller. Draait met de service-rolekey (zelfde patroon als
// api/save-vinted-cookie.js): de extensie heeft enkel de anon-key, owner_id
// wordt server-side herleid uit vinted_account_links.
//
// Bij elke sync worden ALLE rijen van deze owner eerst verwijderd en dan de
// huidige actieve set opnieuw ingevoegd (i.p.v. enkel upserten) — dat is de
// enige manier om verkochte/verwijderde listings ook weer uit de tabel te
// laten verdwijnen, aangezien de extensie enkel de *huidige* actieve lijst
// doorstuurt, nooit een expliciete "dit item is niet meer actief"-melding.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  const { vinted_user_id, listings } = req.body || {}
  if (!vinted_user_id || !Array.isArray(listings)) {
    return res.status(400).json({ error: 'vinted_user_id en listings vereist' })
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

    const delRes = await fetch(
      `${SUPABASE_URL}/rest/v1/active_listings?owner_id=eq.${encodeURIComponent(link.owner_id)}`,
      { method: 'DELETE', headers: { ...hdrs, Prefer: 'return=minimal' } }
    )
    if (!delRes.ok) return res.status(500).json({ error: 'opschonen mislukt' })

    if (listings.length) {
      const rows = listings.slice(0, 500).map((l) => ({
        id: l.id, owner_id: link.owner_id, title: l.title || null,
        photo_url: l.photo || null, price: l.price ?? null,
        sku_ref: l.sku || null, url: l.url || null,
        synced_at: new Date().toISOString(),
      }))
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/active_listings`, {
        method: 'POST',
        headers: { ...hdrs, Prefer: 'return=minimal' },
        body: JSON.stringify(rows),
      })
      if (!insRes.ok) {
        const err = await insRes.text()
        console.error('[sync-listings] insert fout:', insRes.status, err.slice(0, 200))
        return res.status(500).json({ error: 'opslaan mislukt' })
      }
    }

    return res.status(200).json({ success: true, count: listings.length })
  } catch (e) {
    console.error('[sync-listings] exception:', e.message)
    return res.status(500).json({ error: 'exception', message: e.message })
  }
}
