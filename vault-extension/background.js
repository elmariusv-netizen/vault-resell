importScripts('pdf-lib.min.js');

// ── Download interception ─────────────────────────────────────────────────
chrome.downloads.onCreated.addListener((item) => {
  if (isVintedLabel(item)) interceptLabel(item);
});

// Also catch filename when it resolves (onCreated may have empty filename)
chrome.downloads.onChanged.addListener((delta) => {
  if (!delta.filename?.current) return;
  chrome.downloads.search({ id: delta.id }, ([item]) => {
    if (item && isVintedLabel(item)) interceptLabel(item);
  });
});

function isVintedLabel(item) {
  const url      = item.url      || '';
  const filename = item.filename || '';
  const base     = filename.split(/[/\\]/).pop().toLowerCase();
  const urlLower = url.toLowerCase();

  const isVinted = /vinted\.(be|com|nl|fr|de|es|it|pl|cz|sk|lt|lv|ee|pt|se|fi|nl)/.test(url);
  const looksLikeLabel =
    /label|bordereau|shipping|verzendbewijs|verzendlabel/.test(urlLower) ||
    /label|bordereau|shipping|verzendbewijs|verzendlabel/.test(base);

  return isVinted && looksLikeLabel && (url.endsWith('.pdf') || /pdf|label/.test(urlLower));
}

async function interceptLabel(item) {
  try {
    const { interceptedLabels = [] } = await chrome.storage.local.get(['interceptedLabels']);

    // Deduplicate by URL
    if (interceptedLabels.some((l) => l.url === item.url)) return;

    console.log('[Vault] intercepting label:', item.url);

    // Fetch the PDF bytes while the URL is still valid
    const resp = await fetch(item.url, { credentials: 'include' });
    if (!resp.ok) {
      console.warn('[Vault] label fetch failed:', resp.status);
      return;
    }
    const bytes = new Uint8Array(await resp.arrayBuffer());

    // Convert to base64
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const dataUrl = 'data:application/pdf;base64,' + btoa(binary);

    const base = (item.filename || '').split(/[/\\]/).pop() || `label-${Date.now()}.pdf`;
    const orderId = (item.url.match(/\/transactions?\/(\d+)/) || [])[1] || null;

    const label = {
      id:          Date.now().toString() + Math.random().toString(36).slice(2, 6),
      filename:    base || `vinted-label-${Date.now()}.pdf`,
      url:         item.url,
      orderId,
      capturedAt:  new Date().toISOString(),
      dataUrl,
      size:        bytes.length,
    };

    interceptedLabels.unshift(label);
    // Keep max 15 labels (each ~200 KB → ~3 MB total base64, safe within 10 MB limit)
    if (interceptedLabels.length > 15) interceptedLabels.splice(15);

    await chrome.storage.local.set({ interceptedLabels });
    console.log('[Vault] label saved, total:', interceptedLabels.length);
  } catch (e) {
    console.error('[Vault] intercept error:', e);
  }
}

// ── Message handlers ──────────────────────────────────────────────────────
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
  if (message.type === 'GET_LABEL_COUNT') {
    chrome.storage.local.get(['interceptedLabels'], ({ interceptedLabels = [] }) => {
      sendResponse({ count: interceptedLabels.length });
    });
    return true;
  }
  if (message.type === 'CLEAR_INTERCEPTED_LABEL') {
    chrome.storage.local.get(['interceptedLabels'], ({ interceptedLabels = [] }) => {
      chrome.storage.local.set({
        interceptedLabels: interceptedLabels.filter((l) => l.id !== message.id),
      });
      sendResponse({ success: true });
    });
    return true;
  }
});

// ── Order sync ────────────────────────────────────────────────────────────
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

// ── PDF merge (from extension panel print-labels button) ──────────────────
async function mergeAndDownloadLabels(labelUrls) {
  try {
    const { PDFDocument } = PDFLib;
    const merged = await PDFDocument.create();
    const PW = 288, PH = 432;

    for (const url of labelUrls) {
      try {
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) { console.warn('[Vault] label fetch failed:', url, resp.status); continue; }
        const bytes = new Uint8Array(await resp.arrayBuffer());
        const src   = await PDFDocument.load(bytes, { ignoreEncryption: true });
        if (!src.getPageCount()) continue;

        const [embedded] = await merged.embedPages([src.getPages()[0]]);
        const { width: sw, height: sh } = embedded.size();
        const scale = Math.min(PW / sw, PH / sh);
        const page  = merged.addPage([PW, PH]);
        page.drawPage(embedded, {
          x: (PW - sw * scale) / 2, y: (PH - sh * scale) / 2,
          width: sw * scale, height: sh * scale,
        });
      } catch (e) { console.error('[Vault] error processing label:', url, e); }
    }

    const pdfBytes = await merged.save();
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
