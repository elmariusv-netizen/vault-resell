export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  const order = req.body
  if (!order?.transaction_id) return res.status(400).json({ error: 'missing transaction_id' })

  const SUPABASE_URL = process.env.VITE_SUPABASE_URL
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'server misconfigured' })
  }

  const sbHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey': SERVICE_KEY,
  }

  // Orders die de gebruiker bewust verwijderd heeft (zie ignored_orders,
  // gevuld door de ✕/bulk-verwijderknoppen in Verkopen.jsx/Aankopen.jsx) mogen
  // nooit via een sync terugkomen. Dit endpoint is de enige gegarandeerde
  // chokepoint voor alle sync-paden (Home-knop, extensie-checkbox-flows,
  // achtergrond-refresh) — daarom hier checken, niet client-side.
  if (order.owner_id) {
    const ignoredRes = await fetch(
      `${SUPABASE_URL}/rest/v1/ignored_orders?owner_id=eq.${encodeURIComponent(order.owner_id)}&transaction_id=eq.${encodeURIComponent(order.transaction_id)}&select=transaction_id&limit=1`,
      { headers: sbHeaders }
    )
    if (ignoredRes.ok) {
      const ignoredRows = await ignoredRes.json()
      if (ignoredRows?.length) {
        return res.status(200).json({ success: true, skipped: true, reason: 'ignored' })
      }
    }
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/vinted_orders`, {
    method: 'POST',
    headers: { ...sbHeaders, 'Prefer': 'return=minimal,resolution=merge-duplicates' },
    body: JSON.stringify(order),
  })

  if (!response.ok) {
    const error = await response.text()
    console.error('[sync-order] Supabase fout:', response.status, error)
    return res.status(response.status).json({ error })
  }

  return res.status(200).json({ success: true })
}
