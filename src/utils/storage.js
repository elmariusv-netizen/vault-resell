import { SEED_DATA } from '../data/seedData'

const KEY = 'vault-resell-v1'
const BACKUP_KEY = 'vault-backup-meta'

export function loadData() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const data = JSON.parse(raw)
      return { messages: [], priceResearch: [], ...data }
    }
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

export function getBackupMeta() {
  try {
    const raw = localStorage.getItem(BACKUP_KEY)
    return raw ? JSON.parse(raw) : { lastExportDate: null, salesCountAtExport: 0 }
  } catch {
    return { lastExportDate: null, salesCountAtExport: 0 }
  }
}

export function saveBackupMeta(meta) {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(meta))
  } catch {}
}
