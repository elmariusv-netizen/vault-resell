importScripts('pdf-lib.min.js');

// ── Supabase config ───────────────────────────────────────────────────────
const SUPABASE_URL = 'https://dusffpxcheojvjwuqgwo.supabase.co';
const SUPABASE_KEY = 'sb_publishable_yQfFPaNA3hWHVWxqbagLrQ_U1oYPDxc';

async function syncToSupabase(order) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vinted_orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        id:             order.transactionId,
        transaction_id: order.transactionId,
        title:          order.title,
        price:          order.price || 0,
        buyer:          order.buyer || '',
        country:        order.country || '',
        status:         order.status || 'synced',
        item_url:       order.url || '',
        label_url:      order.labelUrl || '',
        photo_url:      order.photo || '',
        sale_date:      order.date || null,
      }),
    });
    if (!res.ok) console.warn('[Vault] Supabase sync failed:', res.status, await res.text());
    else console.log('[Vault] Supabase synced:', order.transactionId);
    return res.ok;
  } catch (e) {
    console.error('[Vault] Supabase error:', e);
    return false;
  }
}

// ── Download interception ─────────────────────────────────────────────────
chrome.downloads.onCreated.addListener((item) => {
  if (isVintedLabel(item)) interceptLabel(item);
});

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
    /label|bordereau|shipping|verzendbewijs|verzendlabel|pdf_label/.test(urlLower) ||
    /label|bordereau|shipping|verzendbewijs|verzendlabel/.test(base);

  return isVinted && looksLikeLabel && (url.includes('.pdf') || /pdf|label|shipment/.test(urlLower));
}

async function interceptLabel(item) {
  try {
    const { interceptedLabels = [] } = await chrome.storage.local.get(['interceptedLabels']);

    const orderId = (item.url.match(/\/transactions?\/(\d+)/) || [])[1] || null;

    // Deduplicate by URL or orderId
    if (interceptedLabels.some((l) => l.url === item.url || (orderId && l.orderId === orderId))) return;

    console.log('[Vault] intercepting label:', item.url);

    const resp = await fetch(item.url, { credentials: 'include' });
    if (!resp.ok) {
      console.warn('[Vault] label fetch failed:', resp.status);
      return;
    }
    const bytes = new Uint8Array(await resp.arrayBuffer());

    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const dataUrl = 'data:application/pdf;base64,' + btoa(binary);

    const base = (item.filename || '').split(/[/\\]/).pop() || `label-${Date.now()}.pdf`;

    interceptedLabels.unshift({
      id:         Date.now().toString() + Math.random().toString(36).slice(2, 6),
      filename:   base,
      url:        item.url,
      orderId,
      capturedAt: new Date().toISOString(),
      dataUrl,
      size:       bytes.length,
    });
    if (interceptedLabels.length > 30) interceptedLabels.splice(30);

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
  if (message.type === 'SYNC_TO_SUPABASE') {
    syncToSupabase(message.order).then((ok) => sendResponse({ success: ok }));
    return true;
  }
  if (message.type === 'PRINT_LABELS') {
    mergeAndDownloadLabels(message.labelUrls, message.transactionIds || []).then(sendResponse);
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
    await syncToSupabase(order);
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

// ── PDF merge via real Vinted API ─────────────────────────────────────────
// Fetches each label from https://www.vinted.be/api/v2/transactions/{id}/shipment/pdf_label
// using the user's session cookie (credentials: 'include'), merges into one 4×6 thermal PDF.
async function mergeAndDownloadLabels(labelUrls, transactionIds) {
  try {
    const { PDFDocument } = PDFLib;
    const merged = await PDFDocument.create();
    const PW = 288, PH = 432; // 4×6 inches at 72 dpi

    const { interceptedLabels = [] } = await chrome.storage.local.get(['interceptedLabels']);
    const existingIds = new Set(interceptedLabels.map((l) => l.orderId).filter(Boolean));

    const successIds  = [];
    const newLabels   = [];

    for (let i = 0; i < labelUrls.length; i++) {
      const url  = labelUrls[i];
      const txId = transactionIds[i] || null;
      try {
        console.log('[Vault] fetching label for transaction', txId, url);
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) {
          console.warn('[Vault] label fetch failed:', url, resp.status, resp.statusText);
          continue;
        }

        const bytes = new Uint8Array(await resp.arrayBuffer());
        if (bytes.length < 100) {
          console.warn('[Vault] label response too small, likely not a PDF:', url);
          continue;
        }

        // Embed page into merged PDF
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        if (!src.getPageCount()) continue;

        const [embedded] = await merged.embedPages([src.getPages()[0]]);
        const { width: sw, height: sh } = embedded.size();
        const scale = Math.min(PW / sw, PH / sh);
        const page  = merged.addPage([PW, PH]);
        page.drawPage(embedded, {
          x: (PW - sw * scale) / 2, y: (PH - sh * scale) / 2,
          width: sw * scale, height: sh * scale,
        });

        if (txId) successIds.push(txId);

        // Save to interceptedLabels if not already stored
        if (txId && !existingIds.has(txId)) {
          let binary = '';
          for (let j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j]);
          newLabels.push({
            id:         Date.now().toString() + Math.random().toString(36).slice(2, 6),
            filename:   `label-${txId}.pdf`,
            url,
            orderId:    txId,
            capturedAt: new Date().toISOString(),
            dataUrl:    'data:application/pdf;base64,' + btoa(binary),
            size:       bytes.length,
          });
          existingIds.add(txId);
        }
      } catch (e) {
        console.error('[Vault] error processing label:', url, e);
      }
    }

    if (!merged.getPageCount()) {
      return {
        success: false,
        error: 'Geen labels konden worden opgehaald. Controleer of je bent ingelogd op Vinted.',
      };
    }

    // Persist newly fetched labels
    if (newLabels.length) {
      for (const lbl of newLabels) interceptedLabels.unshift(lbl);
      if (interceptedLabels.length > 30) interceptedLabels.splice(30);
      await chrome.storage.local.set({ interceptedLabels });
      console.log('[Vault] saved', newLabels.length, 'new labels to storage');
    }

    // Download merged PDF
    const pdfBytes = await merged.save();
    let binary = '';
    for (let i = 0; i < pdfBytes.length; i++) binary += String.fromCharCode(pdfBytes[i]);
    const dataUrl = 'data:application/pdf;base64,' + btoa(binary);

    await chrome.downloads.download({
      url: dataUrl,
      filename: `vault-labels-${Date.now()}.pdf`,
      saveAs: false,
    });

    return { success: true, downloadedIds: successIds };
  } catch (e) {
    console.error('[Vault] PDF merge error:', e);
    return { success: false, error: e.message };
  }
}
