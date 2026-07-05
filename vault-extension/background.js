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
    // sku_ref ALLEEN meesturen als content.js 'm daadwerkelijk detecteerde
    // (enkel bij kind==='nieuw' sale-orders, zie detectSkuForOrder). Bij elke
    // andere sync (bestaande order, aankoop, periodieke refresh) blijft dit
    // veld uit de payload — de upsert hieronder gebruikt Prefer:
    // resolution=merge-duplicates, dat raakt enkel kolommen aan die in de
    // payload zitten, dus een weggelaten sku_ref laat een reeds opgeslagen
    // (of handmatig gecorrigeerde) waarde met rust i.p.v. 'm te overschrijven
    // met null.
    ...(order.skuRef ? { sku_ref: order.skuRef } : {}),
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

// ── "Verzendlabel aanmaken" automatisch aanklikken in de Vinted-conversatie ──────
// ONGEVERIFIEERD tegen een live sessie (zie projectrapportage) — er bestaat
// geen publieke documentatie voor deze interne Vinted-actie, dus dit is
// bewust gebouwd als DOM-klik i.p.v. een aanroepbare API, en bewust zo strikt
// mogelijk: enkel een knop met een EXACTE (niet fuzzy) tekst-match uit een
// vaste taal-whitelist wordt aangeklikt — geen enkele andere knop, geen
// eventuele bevestigingsdialoog erna (de opdracht is expliciet "1 simpele
// klik, geen opties"). Wordt niets gevonden, dan gebeurt er niets — de
// aanroeper (refreshLabels() in content.js) verifieert nadien zelf via een
// echte prefetchLabel()-aanroep of het daadwerkelijk gelukt is; deze functie
// claimt zelf geen succes, enkel of de knop gevonden/geklikt is.
async function createLabelViaTab(conversationId, txId) {
  return new Promise((resolve) => {
    const url = `https://www.vinted.be/inbox/${conversationId}`;
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
        // De conversatie-inhoud (met de actieknop, in een system-message-kaart)
        // rendert client-side ná de initiële page-load — even wachten voordat
        // we de DOM doorzoeken, anders vinden we de knop nog niet.
        setTimeout(() => {
          chrome.scripting.executeScript({
            target: { tabId },
            func: (txIdForLog) => {
              // NL bevestigd via live test (txn 20348276871/20348... via
              // conversatie 23115683032 en 23538654249). FR/EN blijven
              // voorlopig ongeverifieerde educated guesses.
              const LABEL_BUTTON_TEXTS = [
                'verzendlabel aanmaken',
                "créer l'étiquette", "créer l'étiquette d'expédition",
                'create shipping label', 'create label',
              ];
              const findButton = () => {
                const buttons = [...document.querySelectorAll('button')];
                return buttons.find(b => LABEL_BUTTON_TEXTS.includes((b.textContent || '').trim().toLowerCase()));
              };

              const match = findButton();
              if (!match) {
                console.log('[Vault-tab] geen "Verzendlabel aanmaken"-knop gevonden voor txn', txIdForLog);
                return { clicked: false, reason: 'button_not_found' };
              }

              // Bevestigd via handmatige test: 1 klik is niet genoeg, er is
              // een TWEEDE klik nodig vóór het label écht aangemaakt wordt
              // (reden nog onbekend — mogelijk een tussenliggende
              // bevestigingsstap). We loggen daarom de DOM-toestand vóór en
              // na de eerste klik (button-count + of het element zelf nog
              // bestaat/dezelfde tekst/disabled-state heeft) zodat een
              // toekomstige ronde kan tonen of er een specifieke
              // tussenstap is om op te reageren, i.p.v. blind 2x dezelfde
              // knop te raken.
              const snapshot = () => ({
                buttonCount: document.querySelectorAll('button').length,
                matchInDom: document.body.contains(match),
                matchText: document.body.contains(match) ? match.textContent.trim() : null,
                matchDisabled: document.body.contains(match) ? match.disabled : null,
              });

              const before = snapshot();
              console.log('[Vault-tab] "Verzendlabel aanmaken"-knop gevonden, eerste klik voor txn', txIdForLog, '—', match.textContent.trim());
              match.click();

              return new Promise(resolve => {
                setTimeout(() => {
                  const after = snapshot();
                  const domChanged = JSON.stringify(before) !== JSON.stringify(after);
                  console.log('[Vault-tab] DOM ná eerste klik — voor:', JSON.stringify(before), 'na:', JSON.stringify(after), 'gewijzigd:', domChanged);

                  // Tweede klik: als het oorspronkelijke element nog in de DOM
                  // zit, klik dat opnieuw; anders opnieuw zoeken (bv. als
                  // Vinted een nieuw element met dezelfde tekst gerenderd
                  // heeft i.p.v. hetzelfde element hergebruikt).
                  const secondTarget = after.matchInDom ? match : findButton();
                  if (secondTarget) {
                    console.log('[Vault-tab] tweede klik voor txn', txIdForLog, '—', secondTarget.textContent.trim());
                    secondTarget.click();
                  } else {
                    console.log('[Vault-tab] geen knop meer gevonden voor tweede klik (txn', txIdForLog, ') — mogelijk al voltooid na de eerste klik');
                  }

                  resolve({
                    clicked: true,
                    buttonText: match.textContent.trim(),
                    debugDomChangedBetweenClicks: domChanged,
                    debugBeforeFirstClick: before,
                    debugAfterFirstClick: after,
                    debugSecondClickPerformed: !!secondTarget,
                  });
                }, 800);
              });
            },
            args: [txId],
          }, (results) => {
            const data = results?.[0]?.result || { clicked: false, reason: 'no_result' };
            done(data);
          });
        }, 2500);
      }

      chrome.tabs.onUpdated.addListener(onUpdated);
      setTimeout(() => done({ clicked: false, reason: 'timeout' }), 20000);
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
  // Toggle in het extensiepaneel (⚙ Live synchronisatie) — schrijft direct
  // naar user_settings (via dezelfde anon-toegankelijke user_sync_status-VIEW
  // als hierboven) zodat de webapp-Instellingen-pagina dezelfde waarde ziet,
  // en ververst meteen de lokale cache zodat runLiveSync() niet op de
  // eerstvolgende 5s-tick van checkAndSync() hoeft te wachten.
  if (message.type === 'SET_LIVE_SYNC_SETTING') {
    setLiveSyncSetting(message.vintedUserId, message.field, message.value).then(sendResponse);
    return true;
  }
  if (message.type === 'CREATE_LABEL_VIA_CHAT') {
    createLabelViaTab(message.conversationId, message.transactionId).then(sendResponse);
    return true;
  }
});

async function setLiveSyncSetting(vintedUserId, field, value) {
  try {
    const ownerId = await lookupOwnerId(vintedUserId);
    if (!ownerId) return { success: false, error: 'owner_not_found' };
    const res = await fetch(`${SYNC_STATUS_URL}?user_id=eq.${encodeURIComponent(ownerId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({ [field]: value }),
    });
    if (!res.ok) return { success: false, error: `PATCH ${res.status}` };

    const { liveSyncSettings = {} } = await chrome.storage.local.get(['liveSyncSettings']);
    const FIELD_TO_KEY = {
      auto_sync_sales: 'sales', auto_sync_purchases: 'purchases',
      auto_sync_labels: 'labels', auto_create_labels: 'createLabels',
    };
    const key = FIELD_TO_KEY[field] || field;
    await chrome.storage.local.set({
      // writtenAt: zie checkAndSync() — voorkomt dat een al lopende, tragere
      // poll-tick deze net gezette waarde meteen weer overschrijft met zijn
      // eigen (dan verouderde) snapshot.
      liveSyncSettings: { ...liveSyncSettings, userId: ownerId, [key]: value, writtenAt: Date.now() },
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

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
  // Vastgelegd VÓÓR de Supabase-fetch hieronder start — gebruikt verderop om
  // te detecteren of een toggle-klik (setLiveSyncSetting) de cache al heeft
  // bijgewerkt ná het moment dat DEZE fetch zijn (dan inmiddels verouderde)
  // snapshot ophaalde. Zonder deze guard kan een trage/al lopende poll-tick
  // een net gezette togglewaarde in chrome.storage.local terugzetten naar de
  // oude waarde, ook al staat Supabase zelf al wel correct — de toggle lijkt
  // dan "niet bewaard" terwijl hij dat eigenlijk wel is.
  const fetchStartedAt = Date.now();
  try {
    // Geen vault_sync_requested-filter meer op deze fetch: we lezen nu élke
    // tick de volledige rij, zodat we meteen ook de 3 live-sync-toggles
    // (auto_sync_sales/purchases/labels) kunnen cachen in chrome.storage.local
    // voor runLiveSync() (chrome.alarms) hieronder — dat scheelt een tweede,
    // losse poll-loop tegen Supabase (zie rapportage vóór deze uitbreiding).
    const checkRes = await fetch(
      `${SYNC_STATUS_URL}?select=user_id,vault_sync_requested,auto_sync_sales,auto_sync_purchases,auto_sync_labels,auto_create_labels&limit=1`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    )
    if (!checkRes.ok) return
    const rows = await checkRes.json()
    if (!rows?.length) return

    const userId = rows[0].user_id
    // Defaults matchen de kolom-DEFAULTs in supabase-setup.sql (sales aan,
    // aankopen/labels/label-aanmaken uit) — relevant voor rijen van vóór deze
    // onboarding-migratie, waar deze kolommen nog niet bestaan/null zijn.
    const autoSyncSales = rows[0].auto_sync_sales ?? true
    const autoSyncPurchases = rows[0].auto_sync_purchases ?? false
    const autoSyncLabels = rows[0].auto_sync_labels ?? false
    const autoCreateLabels = rows[0].auto_create_labels ?? false

    const { liveSyncSettings: prevCached = {} } = await chrome.storage.local.get(['liveSyncSettings'])
    if (prevCached.writtenAt && prevCached.writtenAt > fetchStartedAt) {
      console.log('[Vault] checkAndSync: lokale toggle-write is recenter dan deze fetch — cache-overschrijving overgeslagen')
    } else {
      await chrome.storage.local.set({
        liveSyncSettings: { userId, sales: autoSyncSales, purchases: autoSyncPurchases, labels: autoSyncLabels, createLabels: autoCreateLabels }
      })
    }

    if (!rows[0].vault_sync_requested) return
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

// ── Live synchronisatie — periodieke achtergrond-sync via het extensiepaneel
// (⚙-instellingen: Verkopen/Aankopen/Labels) ───────────────────────────────
// Losstaand van checkAndSync() hierboven (die blijft de handmatige
// "Alles synchroniseren"-trigger afhandelen): dit is een chrome.alarms-timer
// i.p.v. setInterval, want een MV3 service worker kan na ~30s inactiviteit
// stilgelegd worden — een setInterval van enkele minuten zou dan gewoon
// stoppen. chrome.alarms overleeft dat (en browser-herstarts) wél.
//
// Leest UITSLUITEND chrome.storage.local (geen eigen Supabase-poll — die
// cache wordt al elke 5s ververst door checkAndSync() hierboven, zie
// liveSyncSettings daar) en zoekt een reeds open Vinted-tab, exact zoals
// checkAndSync() dat ook doet. Geen tab open → deze ronde wordt overgeslagen
// (bewuste keuze: geen tabs automatisch openen, zie projectnotities).
const LIVE_SYNC_ALARM = 'vault-live-sync'
chrome.alarms.create(LIVE_SYNC_ALARM, { periodInMinutes: 4 })
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === LIVE_SYNC_ALARM) runLiveSync()
})

async function runLiveSync() {
  try {
    const { liveSyncSettings } = await chrome.storage.local.get(['liveSyncSettings'])
    if (!liveSyncSettings?.userId) return
    const { userId, sales, purchases, labels } = liveSyncSettings
    if (!sales && !purchases && !labels) return

    const tabs = await new Promise(resolve =>
      chrome.tabs.query({ url: '*://*.vinted.be/*' }, resolve)
    )
    if (!tabs.length) {
      console.log('[Vault] live-sync: geen Vinted-tab open — ronde overgeslagen')
      return
    }

    await Promise.all(tabs.map(tab =>
      new Promise(resolve =>
        chrome.tabs.sendMessage(tab.id, { type: 'LIVE_SYNC', userId, sales, purchases, labels }, r => {
          if (chrome.runtime.lastError) resolve(null)
          else { console.log('[Vault] live-sync result tab', tab.id, ':', r); resolve(r) }
        })
      )
    ))
  } catch (e) {
    console.warn('[Vault] runLiveSync error:', e.message)
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
