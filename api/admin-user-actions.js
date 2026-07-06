import { fetchWhopMembershipsByEmail } from './_lib/whop.js'
import { verifySupabaseUser } from './_lib/verifyUser.js'
import { fetchCallerFlags, fetchAuthUserById, serviceHeaders } from './_lib/adminAuth.js'

// Genereert een Supabase auth-link (recovery/magiclink) via de Admin API.
// Dit endpoint verstuurt ZELF geen e-mail — het geeft enkel de link/token
// terug (bedoeld om je eigen e-mail-template mee te bouwen, of — zoals bij
// impersonate hieronder — om de link rechtstreeks aan de admin te tonen).
async function generateAuthLink(supabaseUrl, serviceKey, { type, email }) {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: serviceHeaders(serviceKey),
    body: JSON.stringify({ type, email }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`generate_link (${type}) mislukt: ${res.status} ${body.slice(0, 300)}`)
  }
  const json = await res.json()
  // Vlak (action_link) of genest (properties.action_link) — API-versie-afhankelijk.
  return json.action_link || json.properties?.action_link || null
}

async function handleDetail(ctx, targetUserId) {
  const { supabaseUrl, serviceKey, whopApiKey, whopProductId } = ctx

  const authUser = await fetchAuthUserById(supabaseUrl, serviceKey, targetUserId)
  if (!authUser?.id) return { status: 404, body: { error: 'gebruiker niet gevonden' } }

  const settingsRes = await fetch(
    `${supabaseUrl}/rest/v1/user_settings?user_id=eq.${encodeURIComponent(targetUserId)}&select=is_admin,is_super_admin,whop_email_override&limit=1`,
    { headers: serviceHeaders(serviceKey) }
  )
  const [settingsRow] = settingsRes.ok ? await settingsRes.json() : [null]

  // Vault-activiteit: batches/sales zitten als 1 JSONB-blob in user_data
  // (zie cloudStorage.js) — geen aparte sales-tabel om te joinen.
  const dataRes = await fetch(
    `${supabaseUrl}/rest/v1/user_data?owner_id=eq.${encodeURIComponent(targetUserId)}&select=payload&limit=1`,
    { headers: serviceHeaders(serviceKey) }
  )
  const [dataRow] = dataRes.ok ? await dataRes.json() : [null]
  const sales = dataRow?.payload?.sales || []
  // !isFree spiegelt de "paid"-filter die Home.jsx elders al gebruikt voor omzet.
  const paidSales = sales.filter((s) => !s.isFree)
  const salesCount = paidSales.length
  const totalRevenue = paidSales.reduce((sum, s) => sum + (s.salePrice || 0) * (s.quantity || 1), 0)

  let whopStatus = 'unconfigured'
  if (whopApiKey && whopProductId) {
    try {
      const byEmail = await fetchWhopMembershipsByEmail({ apiKey: whopApiKey, productId: whopProductId })
      const effectiveEmail = (settingsRow?.whop_email_override || authUser.email || '').toLowerCase()
      whopStatus = byEmail.get(effectiveEmail)?.status || 'none'
    } catch (e) {
      console.error('[admin-user-actions] whop-lookup mislukt:', e.message)
      whopStatus = 'unknown'
    }
  }

  return {
    status: 200,
    body: {
      id: targetUserId,
      email: authUser.email,
      createdAt: authUser.created_at,
      lastSignInAt: authUser.last_sign_in_at || null,
      isAdmin: !!settingsRow?.is_admin,
      isSuperAdmin: !!settingsRow?.is_super_admin,
      whopStatus,
      whopEmailOverride: settingsRow?.whop_email_override || null,
      salesCount,
      totalRevenue,
    },
  }
}

async function handleResetPassword(ctx, targetUserId) {
  const { supabaseUrl, anonKey, serviceKey } = ctx
  const authUser = await fetchAuthUserById(supabaseUrl, serviceKey, targetUserId)
  if (!authUser?.email) return { status: 404, body: { error: 'gebruiker niet gevonden' } }

  // Bewust NIET via admin/generate_link: dat endpoint verstuurt zelf géén
  // e-mail (enkel een link/token teruggeven, bedoeld voor een eigen
  // e-mail-provider — zie generateAuthLink hierboven). Om de knop echt een
  // reset-mail te laten versturen (zoals gevraagd) gebruiken we hetzelfde
  // publieke /recover-endpoint dat supabase.auth.resetPasswordForEmail()
  // clientside ook aanroept — dat triggert wél Supabase's eigen
  // auth-mailtemplate. De anon-key volstaat hiervoor (geen service-key
  // nodig), maar toegang blijft server-side achter de is_admin-check hierboven.
  const res = await fetch(`${supabaseUrl}/auth/v1/recover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey },
    body: JSON.stringify({ email: authUser.email }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { status: 502, body: { error: `Reset-mail versturen mislukt: ${res.status} ${body.slice(0, 300)}` } }
  }
  return { status: 200, body: { success: true, email: authUser.email } }
}

async function handleImpersonate(ctx, targetUserId) {
  const { supabaseUrl, serviceKey } = ctx
  const authUser = await fetchAuthUserById(supabaseUrl, serviceKey, targetUserId)
  if (!authUser?.email) return { status: 404, body: { error: 'gebruiker niet gevonden' } }

  let link
  try {
    link = await generateAuthLink(supabaseUrl, serviceKey, { type: 'magiclink', email: authUser.email })
  } catch (e) {
    console.error('[admin-user-actions] impersonate mislukt:', e.message)
    return { status: 502, body: { error: e.message } }
  }
  if (!link) return { status: 502, body: { error: 'geen link ontvangen van Supabase' } }
  return { status: 200, body: { link } }
}

async function handleDeactivate(ctx, targetUserId, callerId) {
  const { supabaseUrl, serviceKey } = ctx
  if (targetUserId === callerId) {
    return { status: 400, body: { error: 'je kan je eigen account niet deactiveren' } }
  }

  // should_soft_delete: bewust GEEN hard delete. Meerdere tabellen
  // (vinted_orders, business_costs, ...) verwijzen naar auth.users(id) ZONDER
  // ON DELETE CASCADE (enkel user_data heeft die) — een hard delete zou op
  // elk account met bestaande orders/kosten op een foreign-key-violation
  // botsen. Soft-delete voorkomt dat en past ook beter bij de knoptekst
  // "Deactiveer" (niet "Verwijder"): het account kan niet meer inloggen,
  // maar de rij (en dus alle gekoppelde data) blijft intact.
  const deleteRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(targetUserId)}`, {
    method: 'DELETE',
    headers: serviceHeaders(serviceKey),
    body: JSON.stringify({ should_soft_delete: true }),
  })
  if (!deleteRes.ok) {
    const body = await deleteRes.text().catch(() => '')
    return { status: 502, body: { error: `Deactiveren mislukt: ${deleteRes.status} ${body.slice(0, 300)}` } }
  }

  const settingsDeleteRes = await fetch(
    `${supabaseUrl}/rest/v1/user_settings?user_id=eq.${encodeURIComponent(targetUserId)}`,
    { method: 'DELETE', headers: serviceHeaders(serviceKey) }
  )
  if (!settingsDeleteRes.ok) {
    console.warn('[admin-user-actions] user_settings-rij verwijderen mislukt:', settingsDeleteRes.status)
    // Account is al gedeactiveerd (kan niet meer inloggen) — een achtergebleven
    // user_settings-rij is geen kritiek probleem, enkel loggen.
  }

  return { status: 200, body: { success: true } }
}

async function handleSetAdmin(ctx, targetUserId, callerId, desiredIsAdmin) {
  const { supabaseUrl, serviceKey } = ctx
  if (targetUserId === callerId) {
    // Voorkomt dat een super-admin zichzelf per ongeluk demote en zo de
    // laatste beheerder-toegang verliest.
    return { status: 400, body: { error: 'je kan je eigen beheerder-status niet wijzigen' } }
  }

  const patchRes = await fetch(
    `${supabaseUrl}/rest/v1/user_settings?user_id=eq.${encodeURIComponent(targetUserId)}&on_conflict=user_id`,
    {
      method: 'POST',
      headers: { ...serviceHeaders(serviceKey), Prefer: 'return=minimal,resolution=merge-duplicates' },
      body: JSON.stringify({ user_id: targetUserId, is_admin: !!desiredIsAdmin }),
    }
  )
  if (!patchRes.ok) {
    const body = await patchRes.text().catch(() => '')
    return { status: 502, body: { error: `Bijwerken mislukt: ${patchRes.status} ${body.slice(0, 300)}` } }
  }
  return { status: 200, body: { success: true, isAdmin: !!desiredIsAdmin } }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  const supabaseUrl    = process.env.VITE_SUPABASE_URL
  const anonKey        = process.env.VITE_SUPABASE_ANON_KEY
  const serviceKey     = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return res.status(500).json({ error: 'server misconfigured' })
  }

  const accessToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '')
  if (!accessToken) return res.status(401).json({ error: 'missing Authorization header' })

  const caller = await verifySupabaseUser(supabaseUrl, anonKey, accessToken).catch(() => null)
  if (!caller?.id) return res.status(401).json({ error: 'invalid session' })

  // Het echte afdwingpunt voor alle acties hieronder — server-side, ongeacht
  // wat de client stuurt.
  const callerFlags = await fetchCallerFlags(supabaseUrl, serviceKey, caller.id)
  if (!callerFlags.isAdmin) return res.status(403).json({ error: 'forbidden' })

  const { action, targetUserId, isAdmin: desiredIsAdmin } = req.body || {}
  if (!targetUserId) return res.status(400).json({ error: 'targetUserId vereist' })

  const ctx = {
    supabaseUrl, anonKey, serviceKey,
    whopApiKey: process.env.WHOP_API_KEY,
    whopProductId: process.env.WHOP_PRODUCT_ID,
  }

  let result
  try {
    switch (action) {
      case 'detail':
        result = await handleDetail(ctx, targetUserId)
        break
      case 'reset-password':
        result = await handleResetPassword(ctx, targetUserId)
        break
      case 'impersonate':
        result = await handleImpersonate(ctx, targetUserId)
        break
      case 'deactivate':
        result = await handleDeactivate(ctx, targetUserId, caller.id)
        break
      case 'set-admin':
        // Enkel super-admins mogen andermans is_admin-vlag wijzigen — dit is
        // het echte afdwingpunt, niet de toggle die de UI al verbergt.
        if (!callerFlags.isSuperAdmin) return res.status(403).json({ error: 'enkel super-admin' })
        result = await handleSetAdmin(ctx, targetUserId, caller.id, desiredIsAdmin)
        break
      default:
        return res.status(400).json({ error: 'onbekende actie' })
    }
  } catch (e) {
    console.error(`[admin-user-actions] actie "${action}" mislukt:`, e.message)
    return res.status(502).json({ error: e.message })
  }

  return res.status(result.status).json(result.body)
}
