// Runs on localhost so the Vault Resell web app can read synced Vinted orders
// from chrome.storage.local via regular localStorage.
const SYNC_KEY       = 'vault-vinted-sync';
const REGISTERED_KEY = 'vault-vinted-registered';

function push() {
  chrome.storage.local.get(['syncedOrders'], (result) => {
    try {
      const orders = result.syncedOrders || [];
      // Read which orders the user has already registered as a sale
      const registered = JSON.parse(localStorage.getItem(REGISTERED_KEY) || '[]');
      const registeredSet = new Set(registered);
      // Only expose unregistered orders
      const pending = orders.filter(
        (o) => !registeredSet.has(o.syncedAt)
      );
      localStorage.setItem(SYNC_KEY, JSON.stringify(pending));
      console.log('[Vault Bridge] pushed', pending.length, 'pending orders to localStorage');
    } catch (e) {
      console.error('[Vault Bridge] write failed:', e);
    }
  });
}

push();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.syncedOrders) push();
});
