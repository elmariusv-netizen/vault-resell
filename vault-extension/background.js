importScripts('pdf-lib.min.js');

// ── Vercel proxy voor label fetch + crop ──────────────────────────────────
const LABEL_PROXY = 'https://vault-resell.vercel.app/api/label';

async function fetchLabelViaProxy(txId) {
  const cookies = await new Promise(resolve =>
    chrome.cookies.getAll({ domain: 'vinted.be' }, resolve)
  );
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  console.log('[Vault] proxy fetch txn', txId, '— cookies:', cookies.length);

  const resp = await fetch(`${LABEL_PROXY}?transaction_id=${txId}`, {
    method: 'POST',
    headers: { 'x-vinted-cookie': cookieStr },
  });
  console.log('[Vault] proxy response:', resp.status, resp.statusText, 'txn:', txId);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`proxy ${resp.status}: ${err.error || resp.statusText}`);
  }
  const buf   = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary  = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary); // base64 van reeds gecropte 4×6 PDF
}

// ── Vinted headers (service worker reads cookies via chrome.cookies) ───────
async function getVintedHeaders() {
  const getCookie = (name) => new Promise(resolve => {
    chrome.cookies.get({ url: 'https://www.vinted.be', name }, c => {
      resolve(c?.value || '');
    });
  });
  const [csrf, anonId] = await Promise.all([
    getCookie('_vinted_csrf_token'),
    getCookie('_vinted_anon_id'),
  ]);
  console.log('[Vault] headers — csrf:', csrf ? csrf.slice(0, 12) + '…' : '(none)', 'anonId:', anonId ? anonId.slice(0, 8) + '…' : '(none)');
  return {
    'accept':       'application/json,text/plain,*/*,image/webp',
    'locale':       'nl-BE',
    'x-csrf-token': csrf,
    'x-anon-id':    anonId,
  };
}

// ── Supabase config ───────────────────────────────────────────────────────
const SUPABASE_URL = 'https://dusffpxcheojvjwuqgwo.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR1c2ZmcHhjaGVvanZqd3VxZ3dvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMjE0MjIsImV4cCI6MjA5NzY5NzQyMn0.C3pG5eqOBzusDzkCMA-oI4IGPdbaIpfX-fkycGv5ud8';

async function handleVaultLink(linkId, vintedUserId) {
  try {
    const hdrs = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };

    // 1. Haal pending_link op om owner_id te krijgen
    const linkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pending_links?id=eq.${encodeURIComponent(linkId)}&select=owner_id,linked&limit=1`,
      { headers: hdrs }
    );
    if (!linkRes.ok) return { success: false, error: `pending_links fetch ${linkRes.status}` };
    const rows = await linkRes.json();
    if (!rows?.length) return { success: false, error: 'not_found' };
    const { owner_id, linked } = rows[0];
    if (linked) { console.log('[Vault] VAULT_LINK: al eerder gekoppeld'); return { success: true, already: true }; }

    // 2. Upsert vinted_account_links
    const linkOk = await fetch(`${SUPABASE_URL}/rest/v1/vinted_account_links`, {
      method: 'POST',
      headers: { ...hdrs, 'Content-Type': 'application/json', 'Prefer': 'return=minimal,resolution=merge-duplicates' },
      body: JSON.stringify({ vinted_user_id: vintedUserId, owner_id }),
    });
    if (!linkOk.ok) {
      const err = await linkOk.text();
      return { success: false, error: `vinted_account_links: ${err.slice(0, 100)}` };
    }

    // 3. Markeer pending_link als linked
    await fetch(`${SUPABASE_URL}/rest/v1/pending_links?id=eq.${encodeURIComponent(linkId)}`, {
      method: 'PATCH',
      headers: { ...hdrs, 'Content-Type': 'application/json' },
      body: JSON.stringify({ vinted_user_id: vintedUserId, linked: true }),
    });

    console.log('[Vault] VAULT_LINK: gekoppeld', vintedUserId, '->', owner_id);
    return { success: true };
  } catch (e) {
    console.error('[Vault] VAULT_LINK error:', e.message);
    return { success: false, error: e.message };
  }
}

async function lookupOwnerId(vintedUserId) {
  if (!vintedUserId) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/vinted_account_links?vinted_user_id=eq.${encodeURIComponent(vintedUserId)}&select=owner_id&limit=1`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0]?.owner_id ?? null;
  } catch { return null; }
}

async function syncToSupabase(order) {
  const endpoint = `${SUPABASE_URL}/rest/v1/vinted_orders`;

  // Zoek owner_id op via Vinted userId koppeling
  const ownerId = await lookupOwnerId(order.vintedUserId);
  if (!ownerId) {
    console.warn(`[Vault] geen vinted_account_links koppeling voor userId ${order.vintedUserId} — sync geblokkeerd`);
    return {
      success: false,
      error: 'no_link',
      message: 'Koppel eerst je Vault account aan je Vinted account via Instellingen → Vinted account ID',
    };
  }

  // Geannuleerde orders verwijderen uit Supabase
  if (/geannuleerd|cancel/i.test(order.status || '')) {
    console.log(`[Vault] geannuleerd — verwijder txn ${order.transactionId} uit Supabase`);
    try {
      const res = await fetch(`${endpoint}?id=eq.${encodeURIComponent(order.transactionId)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY },
      });
      console.log(`[Vault] DELETE ${res.status} txn ${order.transactionId}`);
      return { success: true, deleted: true, status: res.status };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  const payload = {
    id:              order.transactionId,
    transaction_id:  order.transactionId,
    owner_id:        ownerId,
    title:           order.title,
    price:           order.price || 0,
    buyer:           order.buyer || '',
    country:         order.country || '',
    status:          order.status || '',
    item_url:        order.item_url || order.url || '',
    label_url:       order.labelUrl || '',
    photo_url:       order.photo || order.photo_url || order.photo_uri || null,
    photo_urls:      order.photo_urls || (order.photo ? JSON.stringify([order.photo]) : (order.photo_url ? JSON.stringify([order.photo_url]) : null)),
    item_titles:     order.item_titles || null,
    description:     order.description  || null,
    shipping_method: order.shipping_method || null,
    tracking_code:   order.tracking_code   || null,
    buyer_name:      order.buyerName || order.buyer_name || null,
    sale_date:       order.date || null,
    // Volledige verkoop-timestamp (met tijd) — sale_date hierboven blijft
    // bewust datum-only (bestaand contract), sold_at is een aparte kolom
    // voor het exacte tijdstip op de Verkopen-kaart.
    sold_at:         order.soldAt || null,
    // label_available wordt bewust NIET hier gezet — de oude
    // transactionUserStatus==='needs_action'/"verzendlabel"-tekst-heuristiek
    // bleek onbetrouwbaar (zie de PDF-verificatiefix op de Labels-pagina) en
    // elke sync/refresh overschreef zo een correct geverifieerde status weer
    // met een gok. api/label-prefetch.js is nu de ENIGE plek die
    // label_available op true zet, en enkel na een geslaagde PDF-check. Door
    // dit veld hier weg te laten, laat de upsert (Prefer:
    // resolution=merge-duplicates) de bestaande waarde met rust bij een
    // update — een nieuwe rij krijgt gewoon de kolom-default (false).
    conversation_id: order.conversationId  || null,
    order_direction: order.orderDirection  || 'sale',
    seller_name:     order.sellerName      || null,
    // Vinted's numerieke transaction/shipment-statuscodes — primaire bron
    // voor classifyOrderStage() (skuUtils.js), taalonafhankelijk en dus
    // betrouwbaarder dan tekst-matching op status.
    transaction_status: order.transactionStatus ?? null,
    shipment_status:    order.shipmentStatus    ?? null,
    is_completed:       order.isCompleted       ?? null,
    // Uitbetalingsdatum — afgeleid uit het "completed"-bericht in
    // conversation.messages (zie fetchConvDetail() in content.js), niet elke
    // (oudere) order heeft dit bericht, dan blijft dit null.
    payout_date:        order.payoutDate        ?? null,
  };

  console.log('[Vault] price:', order.price);
  console.log('[Vault] buyer raw:', order.buyer, '| country raw:', order.country, '| conversationId:', order.conversationId);
  console.log(`[Vault] syncToSupabase → txn ${order.transactionId}`);
  console.log(`[Vault] payload txn=${order.transactionId} buyer="${payload.buyer}" country="${payload.country}" conv="${payload.conversation_id}"`);
  console.log(`[Vault] sync photo — order.photo: ${order.photo?.slice(0,60) || '(leeg)'} | order.photo_url: ${order.photo_url?.slice(0,60) || '(leeg)'}`);
  console.log(`[Vault] sync photo_url:`, payload.photo_url?.slice(0, 60) || '(leeg)');

  console.log('[Vault] DEBUG payload owner_id:', payload.owner_id);
  console.log('[Vault] DEBUG payload (volledig):', JSON.stringify(payload));

  try {
    const res = await fetch('https://vault-resell.vercel.app/api/sync-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const body = await res.text();
    if (!res.ok) {
      console.error(`[Vault] sync-order FOUT ${res.status} voor txn ${order.transactionId}:`, body);
      return { success: false, status: res.status, error: body.slice(0, 300) };
    }
    console.log(`[Vault] sync-order OK ${res.status} — txn ${order.transactionId}`);
    return { success: true, status: res.status };
  } catch (e) {
    console.error(`[Vault] sync-order exception voor txn ${order.transactionId}:`, e.message);
    return { success: false, error: e.message };
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

// ── Listings via temporary tab (DOM scraping) ─────────────────────────────
async function fetchListingsViaTab() {
  return new Promise((resolve) => {
    const url = 'https://www.vinted.be/member/48695306/items#vault-headless';
    chrome.tabs.create({ url, active: false }, (tab) => {
      const tabId = tab.id;
      let resolved = false;

      function done(data) {
        if (resolved) return;
        resolved = true;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.remove(tabId, () => {});
        resolve(data);
      }

      function onUpdated(id, info) {
        if (id !== tabId || info.status !== 'complete') return;
        chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const cards = [...document.querySelectorAll('[data-testid="item-card"]')];
            console.log('[Vault-tab] item-card elements found:', cards.length);
            const items = cards.map(card => {
              const link     = card.querySelector('a[href]');
              const img      = card.querySelector('img');
              const titleEl  = card.querySelector('[data-testid="item-card--title"]')
                            || card.querySelector('h3, h2');
              const priceEl  = card.querySelector('[data-testid="item-card--price"]')
                            || card.querySelector('[class*="price" i]');
              const href     = link?.href || '';
              const itemId   = href.match(/\/(\d+)-/)?.[1]
                            || href.match(/items\/(\d+)/)?.[1]
                            || '';
              const title    = titleEl?.textContent?.trim() || '?';
              const price    = parseFloat(
                (priceEl?.textContent || '').replace(/[^0-9.,]/g, '').replace(',', '.')
              ) || 0;
              const photo    = img?.src || img?.dataset?.src || null;
              return { id: itemId, title, price, photo, url: href };
            }).filter(o => o.id || o.title !== '?');
            console.log('[Vault-tab] scraped', items.length, 'items:', items.map(o => o.title).join(', '));
            return { items };
          },
        }, (results) => {
          const data = results?.[0]?.result || { items: [], error: 'no result' };
          console.log('[Vault] tab listings scraped:', data.items?.length || 0, 'items', data.error || '');
          done(data);
        });
      }

      chrome.tabs.onUpdated.addListener(onUpdated);
      setTimeout(() => done({ items: [], error: 'timeout' }), 15000);
    });
  });
}

// ── Fetch label bytes via content script in an existing Vinted tab ────────
function fetchBytesViaTab(tabId, url) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'FETCH_LABEL_BYTES', url }, (resp) => {
      if (chrome.runtime.lastError || !resp?.ok) {
        resolve(null);
      } else {
        resolve(resp.data);
      }
    });
  });
}

// ── Message handlers ──────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_LISTINGS') {
    fetchListingsViaTab().then(sendResponse);
    return true;
  }
  if (message.type === 'VAULT_LINK') {
    handleVaultLink(message.linkId, message.vintedUserId).then(sendResponse);
    return true;
  }
  if (message.type === 'SYNC_ORDER') {
    const txn = message.order?.transactionId || '?';
    console.log(`[Vault] SYNC_ORDER ontvangen: txn ${txn}`);
    syncOrder(message.order).then((result) => {
      console.log(`[Vault] SYNC_ORDER klaar txn ${txn}:`, JSON.stringify(result).slice(0, 120));
      sendResponse(result);
    });
    return true;
  }
  if (message.type === 'SYNC_TO_SUPABASE') {
    const txn = message.order?.transactionId || '?';
    console.log(`[Vault] SYNC_TO_SUPABASE ontvangen: txn ${txn}`);
    syncToSupabase(message.order).then((result) => {
      console.log(`[Vault] SYNC_TO_SUPABASE klaar txn ${txn}:`, JSON.stringify(result).slice(0, 120));
      sendResponse(result);
    });
    return true;
  }
  if (message.type === 'PRINT_LABELS') {
    const tabId = sender.tab?.id || null;
    mergeAndDownloadLabels(message.labelUrls, message.transactionIds || [], tabId).then(sendResponse);
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
  // Content script vraagt om meteen (i.p.v. te wachten op de volgende 5s-poll)
  // te checken of er een vault_sync_requested-vlag klaarstaat — gebruikt bij
  // het laden van een verse tab (bv. net geopend vanuit de webapp's "Alles
  // synchroniseren"-knop), zodat die niet op de eerstvolgende poll hoeft te
  // wachten.
  if (message.type === 'CHECK_SYNC_NOW') {
    checkAndSync().then(() => sendResponse({ success: true }));
    return true;
  }
  if (message.type === 'REPORT_SYNC_PROGRESS') {
    reportSyncProgress(message.userId, message.progress).then(() => sendResponse({ success: true }));
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
    const sbResult = await syncToSupabase(order);
    if (!sbResult.success) {
      console.error(`[Vault] syncOrder: Supabase mislukt voor txn ${order.transactionId}:`, sbResult.error);
    }
    return { success: true, supabase: sbResult };
  } catch (err) {
    console.error('[Vault] sync error', err);
    return { success: false, error: err.message };
  }
}

// ── Auto-sync via vault-sync-requested flag in Supabase ───────────────────
// Leest/schrijft via de user_sync_status VIEW, niet de user_settings-tabel
// zelf: die heeft enkel een "authenticated" RLS-policy, en deze extensie
// gebruikt de anon-key (geen auth-sessie) — rechtstreeks tegen de tabel
// query'en gaf dus altijd 0 rijen terug, deze polling deed dus nooit iets.
const SYNC_STATUS_URL = `${SUPABASE_URL}/rest/v1/user_sync_status`;

// Voorkomt overlappende rondes: de 5s-interval hieronder roept checkAndSync()
// aan zonder te wachten tot een vorige ronde klaar is. Eén ronde kan (bij
// bv. 78 orders) makkelijk langer dan 5s duren — zonder deze guard stuurt
// elke volgende tick een NIEUWE FORCE_SYNC naar dezelfde tab terwijl de vlag
// nog niet gereset is (die reset gebeurt pas ná de volledige roundtrip),
// wat de content-script-kant liet lijken op een oneindige, steeds
// herstartende sync (zie ook de syncInProgress-guard in content.js).
let checkAndSyncRunning = false;

async function checkAndSync() {
  if (checkAndSyncRunning) return;
  checkAndSyncRunning = true;
  try {
    const checkRes = await fetch(
      `${SYNC_STATUS_URL}?vault_sync_requested=eq.true&select=user_id,auto_sync_sales,auto_sync_purchases&limit=1`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    )
    if (!checkRes.ok) return
    const rows = await checkRes.json()
    if (!rows?.length) return

    const userId = rows[0].user_id
    // Defaults matchen de kolom-DEFAULTs in supabase-setup.sql (sales aan,
    // aankopen uit) — relevant voor rijen van vóór deze onboarding-migratie,
    // waar deze kolommen nog niet bestaan/null zijn.
    const autoSyncSales = rows[0].auto_sync_sales ?? true
    const autoSyncPurchases = rows[0].auto_sync_purchases ?? false
    console.log('[Vault] vault-sync-requested gevonden, user:', userId, 'autoSyncSales:', autoSyncSales, 'autoSyncPurchases:', autoSyncPurchases)

    // Stuur FORCE_SYNC naar elke open Vinted tab
    const tabs = await new Promise(resolve =>
      chrome.tabs.query({ url: '*://*.vinted.be/*' }, resolve)
    )

    if (tabs.length) {
      await Promise.all(tabs.map(tab =>
        new Promise(resolve =>
          chrome.tabs.sendMessage(tab.id, { type: 'FORCE_SYNC', userId, autoSyncSales, autoSyncPurchases }, r => {
            if (chrome.runtime.lastError) resolve(null)
            else { console.log('[Vault] FORCE_SYNC result tab', tab.id, ':', r); resolve(r) }
          })
        )
      ))
    } else {
      console.log('[Vault] Geen Vinted tab open — sync overgeslagen');
      await reportSyncProgress(userId, { status: 'no_tab', finishedAt: new Date().toISOString() });
    }

    // Reset vlag
    await fetch(
      `${SYNC_STATUS_URL}?user_id=eq.${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({ vault_sync_requested: false }),
      }
    )
    console.log('[Vault] vault-sync-requested reset naar false')
  } catch (e) {
    console.warn('[Vault] checkAndSync error:', e.message)
  } finally {
    checkAndSyncRunning = false;
  }
}

// Schrijft voortgang terug (zelfde view als hierboven) zodat de webapp kan
// pollen en "Orders bijwerken: X/Y…" kan tonen tijdens een lopende sync.
async function reportSyncProgress(userId, progress) {
  if (!userId) return;
  try {
    await fetch(`${SYNC_STATUS_URL}?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({ vault_sync_progress: progress }),
    });
  } catch (e) {
    console.warn('[Vault] reportSyncProgress error:', e.message);
  }
}

// Elke 5s i.p.v. 30s — een expliciete "Alles synchroniseren"-klik op de
// webapp moet snel opgepikt worden door een Vinted-tab die al open staat
// (een NIEUWE tab triggert bovendien meteen CHECK_SYNC_NOW bij het laden,
// zie content.js boot()).
setInterval(checkAndSync, 5000)

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

// ── PDF merge — proxy (1) → content script (2) → direct fetch (3) ────────
async function mergeAndDownloadLabels(labelUrls, transactionIds, tabId) {
  try {
    const { PDFDocument } = PDFLib;
    const merged  = await PDFDocument.create();
    const PW = 288, PH = 432;
    const headers = await getVintedHeaders();

    const { interceptedLabels = [] } = await chrome.storage.local.get(['interceptedLabels']);
    const existingIds = new Set(interceptedLabels.map((l) => l.orderId).filter(Boolean));

    const successIds = [];
    const newLabels  = [];

    for (let i = 0; i < labelUrls.length; i++) {
      const url  = labelUrls[i];
      const txId = transactionIds[i] || null;
      try {
        let b64        = null;
        let alreadyCropped = false;

        // 1. Vercel proxy — stuurt cookies mee, retourneert al gecropte 4×6 PDF
        if (txId) {
          try {
            b64 = await fetchLabelViaProxy(txId);
            alreadyCropped = true;
          } catch (e) {
            console.warn('[Vault] proxy mislukt, fallback voor txn', txId, '—', e.message);
          }
        }

        // 2. Content script in zendende tab (heeft sessie-cookies)
        if (!b64 && tabId) {
          b64 = await fetchBytesViaTab(tabId, url);
          if (b64) console.log('[Vault] label via content script, txn', txId);
        }

        // 3. Directe fetch (service worker, beperkte cookie-toegang)
        if (!b64) {
          console.log('[Vault] directe fetch fallback txn', txId);
          const resp = await fetch(url, { credentials: 'include', headers });
          console.log('[Vault] directe fetch response:', resp.status, resp.statusText);
          if (!resp.ok) { console.warn('[Vault] directe fetch FAILED:', resp.status, url); continue; }
          const raw = new Uint8Array(await resp.arrayBuffer());
          let bin = '';
          for (let j = 0; j < raw.length; j++) bin += String.fromCharCode(raw[j]);
          b64 = btoa(bin);
        }

        if (!b64) continue;

        const binary = atob(b64);
        const bytes  = new Uint8Array(binary.length);
        for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);

        if (bytes.length < 100) { console.warn('[Vault] label te klein, skip txn:', txId); continue; }

        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        if (!src.getPageCount()) continue;

        const srcPage = src.getPages()[0];
        const { width: sw, height: sh } = srcPage.getSize();
        console.log('[Vault] label size:', Math.round(sw), 'x', Math.round(sh), alreadyCropped ? '(pre-cropped)' : '(A4)', 'txn:', txId);

        // Proxy retourneert al gecropte 4×6 — embed volledig. Anders crop top-helft van A4.
        const embedded = alreadyCropped
          ? await merged.embedPage(srcPage)
          : await merged.embedPage(srcPage, { left: 0, bottom: sh * 0.5, right: sw, top: sh });
        const page = merged.addPage([PW, PH]);
        page.drawPage(embedded, { x: 0, y: 0, width: PW, height: PH });
        console.log('[Vault] label page', txId, '→ 4×6, ok');

        if (txId) successIds.push(txId);

        if (txId && !existingIds.has(txId)) {
          newLabels.push({
            id:         Date.now().toString() + Math.random().toString(36).slice(2, 6),
            filename:   `label-${txId}.pdf`,
            url,
            orderId:    txId,
            capturedAt: new Date().toISOString(),
            dataUrl:    'data:application/pdf;base64,' + b64,
            size:       bytes.length,
          });
          existingIds.add(txId);
        }
      } catch (e) {
        console.error('[Vault] error processing label txn:', txId, e);
      }
    }

    if (!merged.getPageCount()) {
      return { success: false, error: 'Geen labels konden worden opgehaald. Controleer of je bent ingelogd op Vinted.' };
    }

    if (newLabels.length) {
      for (const lbl of newLabels) interceptedLabels.unshift(lbl);
      if (interceptedLabels.length > 30) interceptedLabels.splice(30);
      await chrome.storage.local.set({ interceptedLabels });
      console.log('[Vault] saved', newLabels.length, 'new labels to storage');
    }

    const pdfBytes = await merged.save();
    let bin = '';
    for (let i = 0; i < pdfBytes.length; i++) bin += String.fromCharCode(pdfBytes[i]);
    await chrome.downloads.download({
      url:      'data:application/pdf;base64,' + btoa(bin),
      filename: `vault-labels-${Date.now()}.pdf`,
      saveAs:   false,
    });

    return { success: true, downloadedIds: successIds };
  } catch (e) {
    console.error('[Vault] PDF merge error:', e);
    return { success: false, error: e.message };
  }
}
