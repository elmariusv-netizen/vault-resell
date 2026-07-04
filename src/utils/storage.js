import { SEED_DATA } from '../data/seedData'

const USERS_KEY = 'vault-users'
const ACTIVE_USER_KEY = 'vault-active-user'
const LEGACY_KEY = 'vault-resell-v1'

function dataKey(userId) {
  return `vault-resell-v1-${userId}`
}

export function getUsers() {
  try {
    const raw = localStorage.getItem(USERS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function saveUsers(users) {
  try { localStorage.setItem(USERS_KEY, JSON.stringify(users)) } catch {}
}

export function getActiveUserId() {
  return localStorage.getItem(ACTIVE_USER_KEY)
}

export function setActiveUserId(id) {
  try { localStorage.setItem(ACTIVE_USER_KEY, id) } catch {}
}

export function hasLegacyData() {
  return !!localStorage.getItem(LEGACY_KEY)
}

export function loadData(userId) {
  try {
    const raw = localStorage.getItem(dataKey(userId))
    if (raw) {
      const data = JSON.parse(raw)
      return { messages: [], priceResearch: [], skuPhotos: {}, ...data }
    }
    // Migrate existing data from legacy key on first use
    const legacyRaw = localStorage.getItem(LEGACY_KEY)
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw)
      const migrated = { messages: [], priceResearch: [], skuPhotos: {}, ...legacy }
      saveData(migrated, userId)
      return migrated
    }
    saveData(SEED_DATA, userId)
    return structuredClone(SEED_DATA)
  } catch {
    return structuredClone(SEED_DATA)
  }
}

export function saveData(data, userId) {
  try {
    localStorage.setItem(dataKey(userId), JSON.stringify(data))
  } catch (e) {
    console.error('Storage write failed:', e)
  }
}

export function clearData(userId) {
  localStorage.removeItem(dataKey(userId))
}
