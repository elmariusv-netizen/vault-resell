// Runs on localhost so the Vault Resell web app can read synced Vinted data
// from chrome.storage.local via regular localStorage.
const SYNC_KEY       = 'vault-vinted-sync';
const REGISTERED_KEY = 'vault-vinted-registered';
const LABELS_KEY     = 'vault-vinted-labels';

function pushOrders(syncedOrders) {
  try {
    const registered    = JSON.parse(localStorage.getItem(REGISTERED_KEY) || '[]');
    const registeredSet = new Set(registered);
    const pending       = syncedOrders.filter((o) => !registeredSet.has(o.syncedAt));
    localStorage.setItem(SYNC_KEY, JSON.stringify(pending));
  } catch (e) {
    console.error('[Vault Bridge] orders write failed:', e);
  }
}

function pushLabels(interceptedLabels) {
  try {
    // Write lightweight manifest for listing
    const manifest = interceptedLabels.map(({ id, filename, capturedAt, orderId, size }) => ({
      id, filename, capturedAt, orderId, size,
    }));
    localStorage.setItem(LABELS_KEY, JSON.stringify(manifest));
    // Write full data keyed by id so Labels page can fetch bytes without hitting storage again
    interceptedLabels.forEach((label) => {
      try {
        localStorage.setItem(`vault-vinted-label-${label.id}`, label.dataUrl || '');
      } catch (_) { /* storage full - skip */ }
    });
  } catch (e) {
    console.error('[Vault Bridge] labels write failed:', e);
  }
}

function push() {
  chrome.storage.local.get(['syncedOrders', 'interceptedLabels'], (result) => {
    pushOrders(result.syncedOrders || []);
    pushLabels(result.interceptedLabels || []);
    console.log('[Vault Bridge] pushed', (result.syncedOrders || []).length, 'orders,', (result.interceptedLabels || []).length, 'labels');
  });
}

push();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.syncedOrders || changes.interceptedLabels)) push();
});
