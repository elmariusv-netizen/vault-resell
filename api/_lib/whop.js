// Whop business-ID voor "Vault Resell" — niet geheim (zichtbaar in elke
// dashboard-URL), dus hardcoded i.p.v. een aparte env var.
export const WHOP_COMPANY_ID = 'biz_WjFIzMlKwEmeI3'

const ENTITLED_STATUSES = new Set(['active', 'trialing'])

export function isEntitledStatus(status) {
  return ENTITLED_STATUSES.has(String(status || '').toLowerCase())
}

// Haalt ALLE memberships voor het geconfigureerde product op (gepagineerd)
// en bouwt een Map: lowercased e-mail → { status, renewalPeriodEnd,
// membershipId }. Vraagt bewust geen statuses[]-filter op (alle statussen),
// zodat zowel de losse status-check als de admin-lijst onderscheid kunnen
// maken tussen "expired" en "nooit betaald" (afwezig in de Map).
// Bij meerdere memberships voor hetzelfde e-mailadres wint de meest
// "entitled" (active/trialing boven expired/canceled).
export async function fetchWhopMembershipsByEmail({ apiKey, productId }) {
  const byEmail = new Map()
  let after = null

  do {
    const url = new URL('https://api.whop.com/api/v1/memberships')
    url.searchParams.set('company_id', WHOP_COMPANY_ID)
    url.searchParams.append('product_ids[]', productId)
    url.searchParams.set('first', '50')
    if (after) url.searchParams.set('after', after)

    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`whop memberships fetch mislukt: ${res.status} ${body.slice(0, 300)}`)
    }
    const json = await res.json()

    for (const m of json.data || []) {
      const email = m.user?.email?.toLowerCase()
      if (!email) continue
      const existing = byEmail.get(email)
      if (!existing || (isEntitledStatus(m.status) && !isEntitledStatus(existing.status))) {
        byEmail.set(email, { status: m.status, renewalPeriodEnd: m.renewal_period_end, membershipId: m.id })
      }
    }

    after = json.page_info?.has_next_page ? json.page_info?.after : null
  } while (after)

  return byEmail
}
