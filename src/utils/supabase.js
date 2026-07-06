import { createClient } from '@supabase/supabase-js'

// Expliciet i.p.v. op de (identieke) supabase-js-defaults te vertrouwen: een
// mobiele browser mag de JS-tab tussen bezoeken volledig verwijlen — enkel
// localStorage (persistSession) overleeft dat, dus de sessie moet daar
// betrouwbaar uit hersteld worden, en autoRefreshToken zorgt dat een
// verlopen access_token bij het heropenen automatisch via de refresh_token
// vernieuwd wordt i.p.v. de gebruiker uit te loggen.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
)

// Synchrone, best-effort lees van de sessie die supabase-js zelf al in
// localStorage persisteert. supabase.auth.getSession() is ALTIJD
// asynchroon (ook als de sessie al lokaal gecached is) — er is geen manier
// om die synchroon aan te roepen. Dit is enkel om React's initiële state
// (zie App.jsx) meteen op de vermoedelijk juiste waarde te zetten, zodat een
// teruggekeerde, al ingelogde gebruiker bij een F5 niet eerst een
// laadscherm/inlogscherm-flits ziet vóór de echte staat gekend is. De
// bestaande asynchrone getSession()/getUser()-call blijft dit gewoon
// bevestigen/corrigeren op de achtergrond (en tekent bij een ongeldige/
// ingetrokken sessie alsnog terug naar het inlogscherm) — dit is dus een
// optimistische eerste gok, geen vervanging van die validatie.
export function getCachedSupabaseUser() {
  try {
    const key = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
    if (!key) return null
    const parsed = JSON.parse(localStorage.getItem(key))
    return parsed?.user ?? null
  } catch {
    return null
  }
}
