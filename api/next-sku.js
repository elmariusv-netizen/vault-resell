// Geeft de volgende-SKU-suggestie per leverancier terug voor de Chrome-
// extensie (vault-extension/content.js, tabSku()) — zodat de gebruiker die
// bij het aanmaken van een Vinted-listing in de titel/beschrijving kan
// zetten, wat de bestaande SKU-detectie (extractSkuCandidate) pas iets geeft
// om te herkennen. Draait met de service-rolekey (zelfde patroon als
// api/save-vinted-cookie.js): de extensie heeft enkel de anon-key en geen
// ingelogde Supabase-sessie, dus owner_id wordt hier server-side herleid uit
// vinted_account_links i.p.v. door de client meegegeven te worden.
//
// formatSku()/getNextSkuNum() hier gedupliceerd i.p.v. geïmporteerd uit
// src/utils/skuUtils.js — dat bestand is onderdeel van de webapp-bundel
// (importeert supabase-client/JSX-buren), niet herbruikbaar in een losse
// Vercel-functie zonder de hele build-keten mee te slepen voor 2 regels logica.
function formatSku(prefix, num) {
  return `${prefix}${num}`
}
function getNextSkuNum(batches, prefix) {
  const maxEnd = batches
    .filter((b) => b.supplierPrefix === prefix)
    .reduce((m, b) => Math.max(m, b.endNum || 0), 0)
  return maxEnd + 1
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' })

  const vintedUserId = req.query.vinted_user_id
  if (!vintedUserId) return res.status(400).json({ error: 'vinted_user_id vereist' })

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
      `${SUPABASE_URL}/rest/v1/vinted_account_links?vinted_user_id=eq.${encodeURIComponent(vintedUserId)}&select=owner_id&limit=1`,
      { headers: hdrs }
    )
    if (!linkRes.ok) return res.status(500).json({ error: 'link-lookup mislukt' })
    const [link] = await linkRes.json()
    if (!link?.owner_id) {
      return res.status(404).json({ error: 'geen Vault-koppeling voor dit Vinted-account' })
    }

    const dataRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_data?owner_id=eq.${encodeURIComponent(link.owner_id)}&select=payload&limit=1`,
      { headers: hdrs }
    )
    if (!dataRes.ok) return res.status(500).json({ error: 'data ophalen mislukt' })
    const [row] = await dataRes.json()
    const batches = row?.payload?.batches || []
    const suppliers = row?.payload?.suppliers || []

    const result = suppliers.map((s) => ({
      prefix: s.prefix,
      name: s.name,
      color: s.color,
      nextSku: formatSku(s.prefix, getNextSkuNum(batches, s.prefix)),
    }))

    return res.status(200).json({ suppliers: result })
  } catch (e) {
    console.error('[next-sku] exception:', e.message)
    return res.status(500).json({ error: 'exception', message: e.message })
  }
}
