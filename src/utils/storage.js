import { SEED_DATA } from '../data/seedData'

const KEY = 'vault-resell-v1'

export function loadData() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
    saveData(SEED_DATA)
    return structuredClone(SEED_DATA)
  } catch {
    return structuredClone(SEED_DATA)
  }
}

export function saveData(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch (e) {
    console.error('Storage write failed:', e)
  }
}

export function clearData() {
  localStorage.removeItem(KEY)
}
