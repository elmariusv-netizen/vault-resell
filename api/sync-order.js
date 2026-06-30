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

  const response = await fetch(`${SUPABASE_URL}/rest/v1/vinted_orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Prefer': 'return=minimal,resolution=merge-duplicates',
    },
    body: JSON.stringify(order),
  })

  if (!response.ok) {
    const error = await response.text()
    console.error('[sync-order] Supabase fout:', response.status, error)
    return res.status(response.status).json({ error })
  }

  return res.status(200).json({ success: true })
}
