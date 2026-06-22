chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SYNC_ORDER') {
    syncOrder(message.order).then(sendResponse);
    return true;
  }
  if (message.type === 'DOWNLOAD_LABEL') {
    downloadLabel(message.url, message.filename);
    sendResponse({ success: true });
    return true;
  }
});

async function syncOrder(order) {
  try {
    const { syncedOrders = [] } = await chrome.storage.local.get(['syncedOrders']);

    const isDuplicate =
      order.transactionId &&
      syncedOrders.some((o) => o.transactionId === order.transactionId);
    if (isDuplicate) return { success: true, duplicate: true };

    syncedOrders.unshift({ ...order, syncedAt: new Date().toISOString() });
    if (syncedOrders.length > 200) syncedOrders.splice(200);

    await chrome.storage.local.set({ syncedOrders });
    await updateDailyStats(order);

    return { success: true };
  } catch (err) {
    console.error('[Vault] sync error', err);
    return { success: false, error: err.message };
  }
}

async function updateDailyStats(order) {
  const today = new Date().toISOString().slice(0, 10);
  const { dailyStats = {} } = await chrome.storage.local.get(['dailyStats']);

  if (!dailyStats[today]) dailyStats[today] = { count: 0, revenue: 0 };
  dailyStats[today].count += 1;
  dailyStats[today].revenue += order.price || 0;

  // Prune to last 30 days
  const keys = Object.keys(dailyStats).sort().reverse();
  keys.slice(30).forEach((k) => delete dailyStats[k]);

  await chrome.storage.local.set({ dailyStats });
}

function downloadLabel(url, filename) {
  chrome.downloads.download({ url, filename, saveAs: false });
}
