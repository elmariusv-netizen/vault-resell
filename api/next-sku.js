// Geeft de volgende-SKU-suggestie per leverancier terug voor de Chrome-
// extensie (vault-extension/content.js, tabSku()) — zodat de gebruiker die
// bij het aanmaken van een Vinted-listing in de titel/beschrijving kan
// zetten, wat de bestaande SKU-detectie (extractSkuCandidate) pas iets geeft
// om te herkennen. Draait met de service-rolekey (zelfde patroon als
// api/save-vinted-cookie.js): de extensie heeft enkel de anon-key en geen
// ingelogde Supabase-sessie, dus owner_id wordt hier server-side herleid uit
// vinted_account_links i.p.v. door de client meegegeven te worden.
//
// formatSku()/getFreeSkusForBatch()/getNextSkuNum() hier gedupliceerd i.p.v.
// geïmporteerd uit src/utils/skuUtils.js — dat bestand is onderdeel van de
// webapp-bundel (importeert supabase-client/JSX-buren), niet herbruikbaar in
// een losse Vercel-functie zonder de hele build-keten mee te slepen.
function formatSku(prefix, num) {
  return `${prefix}${num}`
}
// Was ooit gewoon maxEnd+1 (start van een NIEUWE, nog niet aangemaakte
// batch) — maar dat sloeg een individueel SKU voor dat helemaal geen
// bestaand voorraad-item is: als de gebruiker die tekst in een listing zet
// en het item verkoopt, vindt findBatchForSku() (skuUtils.js) geen batch die
// dat nummer bevat, dus blijft de verkoop voor altijd "SKU niet gevonden".
// Correct is de eerste nog vrije (niet aan een vinted_order gekoppelde) SKU
// binnen de BESTAANDE batches van die leverancier — dezelfde bron van
// waarheid als getFreeSkusForBatch/getUsedSkus die de webapp zelf gebruikt
// (SkuPickerModal/BulkSkuModal/AankoopSkuModal). Enkel als alle bestaande
// batches van die leverancier volledig geclaimd zijn, valt dit terug op
// maxEnd+1 (start van een hypothetische nieuwe batch).
function getNextSkuNum(batches, prefix, usedSkus) {
  const supplierBatches = batches
    .filter((b) => b.supplierPrefix === prefix)
    .sort((a, b) => (a.startNum || 0) - (b.startNum || 0))
  for (const b of supplierBatches) {
    for (let n = b.startNum; n <= b.endNum; n++) {
      if (!usedSkus.has(formatSku(prefix, n))) return n
    }
  }
  const maxEnd = supplierBatches.reduce((m, b) => Math.max(m, b.endNum || 0), 0)
  return maxEnd + 1
}
// Zelfde normalisatie als skuUtils.js se normalizeSku(): SKU-tekst uit
// vinted_orders.sku_ref kan hoofdletterongevoelig en met/zonder voorloopnullen
// voorkomen ("ria056", "RIA56") — allebei moeten hetzelfde SKU claimen.
function normalizeSku(text) {
  const m = String(text).trim().match(/^([A-Za-z]{2,4})[\s-]?0*(\d+)$/)
  return m ? `${m[1].toUpperCase()}${m[2]}` : String(text).trim().toUpperCase()
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

    const [dataRes, ordersRes] = await Promise.all([
      fetch(
        `${SUPABASE_URL}/rest/v1/user_data?owner_id=eq.${encodeURIComponent(link.owner_id)}&select=payload&limit=1`,
        { headers: hdrs }
      ),
      fetch(
        `${SUPABASE_URL}/rest/v1/vinted_orders?owner_id=eq.${encodeURIComponent(link.owner_id)}&select=sku_ref&sku_ref=not.is.null`,
        { headers: hdrs }
      ),
    ])
    if (!dataRes.ok) return res.status(500).json({ error: 'data ophalen mislukt' })
    if (!ordersRes.ok) return res.status(500).json({ error: 'orders ophalen mislukt' })
    const [row] = await dataRes.json()
    const batches = row?.payload?.batches || []
    const suppliers = row?.payload?.suppliers || []

    const orderRows = await ordersRes.json()
    const usedSkus = new Set()
    orderRows.forEach((o) => {
      (o.sku_ref || '').split(',').forEach((s) => {
        const t = normalizeSku(s)
        if (t) usedSkus.add(t)
      })
    })

    const result = suppliers.map((s) => ({
      prefix: s.prefix,
      name: s.name,
      color: s.color,
      nextSku: formatSku(s.prefix, getNextSkuNum(batches, s.prefix, usedSkus)),
    }))

    return res.status(200).json({ suppliers: result })
  } catch (e) {
    console.error('[next-sku] exception:', e.message)
    return res.status(500).json({ error: 'exception', message: e.message })
  }
}
