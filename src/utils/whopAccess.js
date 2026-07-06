const CACHE_KEY = 'vault-whop-cache'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

// Cache is user-gebonden (checkt userId mee) — voorkomt dat op een gedeeld
// apparaat de whop-status van de vorige ingelogde gebruiker hergebruikt
// wordt voor de nieuwe.
export function readWhopCache(userId) {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed.userId !== userId) return null
    if (Date.now() - new Date(parsed.result.checkedAt).getTime() > CACHE_TTL_MS) return null
    return parsed.result
  } catch {
    return null
  }
}

export function writeWhopCache(userId, result) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ userId, result }))
  } catch {
    // localStorage kan vol/geblokkeerd zijn — cache is puur een optimalisatie,
    // niet kritiek voor correctheid (server-side wordt sowieso opnieuw gecheckt).
  }
}

export async function fetchWhopStatus(accessToken, { forceRefresh = false } = {}) {
  const res = await fetch('/api/whop-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ forceRefresh }),
  })
  if (!res.ok) throw new Error(`whop-status ${res.status}`)
  return res.json()
}
