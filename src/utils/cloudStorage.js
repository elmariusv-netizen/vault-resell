import { supabase } from './supabase'
import { SEED_DATA } from '../data/seedData'

export async function loadCloudData(userId) {
  const { data, error } = await supabase.from('user_data').select('payload').maybeSingle()
  if (error) throw error

  if (data?.payload) {
    return { messages: [], priceResearch: [], skuPhotos: {}, ...data.payload }
  }

  // First login: auto-migrate any existing localStorage data
  const migratedPayload = (() => {
    try {
      const oldKey = Object.keys(localStorage).find(
        k => k.startsWith('vault-resell-v1-') && !k.endsWith(userId)
      )
      if (!oldKey) return null
      const raw = localStorage.getItem(oldKey)
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  })()

  const payload = migratedPayload
    ? { messages: [], priceResearch: [], skuPhotos: {}, ...migratedPayload }
    : structuredClone(SEED_DATA)

  await saveCloudData(userId, payload)
  return payload
}

export async function saveCloudData(userId, payload) {
  const { error } = await supabase
    .from('user_data')
    .upsert(
      { owner_id: userId, payload, updated_at: new Date().toISOString() },
      { onConflict: 'owner_id' }
    )
  if (error) {
    const err = new Error(error.message)
    err.status = error.status ?? error.statusCode
    err.code   = error.code
    throw err
  }
}
