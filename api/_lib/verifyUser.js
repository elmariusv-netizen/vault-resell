// Verifieert een Supabase-sessie server-side (i.p.v. een client-aangeleverd
// user-id/e-mailadres te vertrouwen) — gedeeld door whop-status.js en
// admin-users.js, die allebei moeten weten wie de aanroeper écht is voordat
// ze iets uit user_settings prijsgeven of aanpassen.
export async function verifySupabaseUser(supabaseUrl, anonKey, accessToken) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return null
  return res.json()
}
