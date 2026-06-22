importScripts('pdf-lib.min.js');

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SYNC_ORDER') {
    syncOrder(message.order).then(sendResponse);
    return true;
  }
  if (message.type === 'PRINT_LABELS') {
    mergeAndDownloadLabels(message.labelUrls).then(sendResponse);
    return true;
  }
  if (message.type === 'DOWNLOAD_LABEL') {
    chrome.downloads.download({ url: message.url, filename: message.filename, saveAs: false });
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
  const keys = Object.keys(dailyStats).sort().reverse();
  keys.slice(30).forEach((k) => delete dailyStats[k]);
  await chrome.storage.local.set({ dailyStats });
}

async function mergeAndDownloadLabels(labelUrls) {
  try {
    const { PDFDocument } = PDFLib;
    const merged = await PDFDocument.create();
    // 4×6 inches in PDF points (72 pt/inch)
    const PW = 288, PH = 432;

    for (const url of labelUrls) {
      try {
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) { console.warn('[Vault] label fetch failed:', url, resp.status); continue; }
        const bytes = new Uint8Array(await resp.arrayBuffer());
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const srcPages = src.getPages();
        if (!srcPages.length) continue;

        const [embedded] = await merged.embedPages([srcPages[0]]);
        const { width: sw, height: sh } = embedded.size();
        const scale = Math.min(PW / sw, PH / sh);
        const x = (PW - sw * scale) / 2;
        const y = (PH - sh * scale) / 2;

        const page = merged.addPage([PW, PH]);
        page.drawPage(embedded, { x, y, width: sw * scale, height: sh * scale });
      } catch (e) {
        console.error('[Vault] error processing label:', url, e);
      }
    }

    const pdfBytes = await merged.save();
    // Convert to base64 data URL for chrome.downloads
    let binary = '';
    for (let i = 0; i < pdfBytes.length; i++) binary += String.fromCharCode(pdfBytes[i]);
    const dataUrl = 'data:application/pdf;base64,' + btoa(binary);

    await chrome.downloads.download({
      url: dataUrl,
      filename: `vault-labels-${Date.now()}.pdf`,
      saveAs: false,
    });
    return { success: true };
  } catch (e) {
    console.error('[Vault] PDF merge error:', e);
    return { success: false, error: e.message };
  }
}
