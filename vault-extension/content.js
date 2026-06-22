(function () {
  'use strict';

  console.log('[Vault] content script loaded on', location.href);

  const PANEL_ID = 'vault-label-panel';
  const TOG_ID   = 'vault-panel-toggle';
  const INDIGO   = '#4f46e5';
  const GREEN    = '#16a34a';
  const RED      = '#dc2626';

  let syncedIds     = new Set();
  let allOrders     = [];
  let downloadedIds = new Set();
  let scanActive    = false;
  let panelOpen     = false;

  function apiLabelUrl(id) {
    return `https://www.vinted.be/api/v2/transactions/${id}/shipment/pdf_label`;
  }

  // ── Page detection ────────────────────────────────────────────────────────
  function isOrdersPage(url) {
    return /\/(my[-_\/]?(orders?|purchases?|sales?|transactions?|bestellingen?|sold[-_]items?|items?))/i.test(url)
        || /\/transactions?\/\d+/i.test(url)
        || /\/my_orders/i.test(url);
  }

  function isActiveItemsPage(url) {
    return /\/my[-_\/]?items/i.test(url);
  }

  // ── Storage helpers ───────────────────────────────────────────────────────
  async function loadSyncedIds() {
    const { syncedOrders = [] } = await chrome.storage.local.get(['syncedOrders']);
    syncedIds = new Set(syncedOrders.map((o) => o.transactionId).filter(Boolean));
  }

  async function loadDownloadedIds() {
    const { interceptedLabels = [] } = await chrome.storage.local.get(['interceptedLabels']);
    downloadedIds = new Set(interceptedLabels.map((l) => l.orderId).filter(Boolean));
  }

  // ── Vinted API: sold orders ───────────────────────────────────────────────
  async function fetchOrdersFromApi(page = 1) {
    try {
      const url = `https://www.vinted.be/api/v2/my_orders?order_type=sold&page=${page}&per_page=50`;
      const res = await fetch(url, {
        credentials: 'include',
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!res.ok) { console.warn('[Vault] orders API', res.status); return []; }
      const data = await res.json();
      const raw = data.orders || data.transactions || data.my_orders || [];
      console.log('[Vault] orders API page', page, '→', raw.length);
      if (raw.length && page === 1) console.log('[Vault] order sample:', JSON.stringify(raw[0]).slice(0, 400));
      return raw.map(parseApiOrder).filter((o) => o.transactionId);
    } catch (e) { console.error('[Vault] orders API error:', e); return []; }
  }

  function parseApiOrder(o) {
    const transactionId = String(o.transaction_id || o.transaction?.id || o.id || '');
    const title  = o.item?.title || o.item_title || o.title || 'Onbekend item';
    const photo  = o.item?.photos?.[0]?.url || o.item?.photo?.url
                || o.photo?.url || o.photos?.[0]?.url || null;
    const price  = parseFloat(o.total_price || o.item?.price || o.price || 0);
    const buyer  = o.buyer?.login || o.user?.login || o.buyer_login || '';
    const country = o.buyer?.country_iso_code || o.country_iso_code
                 || o.country?.iso_code || '';
    const date   = (o.created_at || o.updated_at || '').slice(0, 10)
                || new Date().toISOString().slice(0, 10);
    return {
      transactionId, title, price, date, buyer, country,
      sku: null, photo, status: 'sold',
      labelUrl: transactionId ? apiLabelUrl(transactionId) : null,
      url: transactionId ? `https://www.vinted.be/transactions/${transactionId}` : location.href,
    };
  }

  // ── Vinted API: active listings ───────────────────────────────────────────
  async function getCurrentUserId() {
    const m = document.cookie.match(/user_id=(\d+)/);
    if (m) return m[1];
    try {
      const res = await fetch('https://www.vinted.be/api/v2/users/current', {
        credentials: 'include',
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (res.ok) {
        const d = await res.json();
        return String(d.user?.id || d.id || '');
      }
    } catch {}
    return null;
  }

  async function fetchActiveItems() {
    try {
      const userId = await getCurrentUserId();
      if (!userId) { console.warn('[Vault] no user ID for active items'); return []; }
      const url = `https://www.vinted.be/api/v2/users/${userId}/items?page=1&per_page=50`;
      const res = await fetch(url, {
        credentials: 'include',
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!res.ok) { console.warn('[Vault] items API', res.status); return []; }
      const data = await res.json();
      const items = data.items || [];
      console.log('[Vault] active items:', items.length);
      if (items.length) console.log('[Vault] item sample:', JSON.stringify(items[0]).slice(0, 300));
      return items.map(parseActiveItem);
    } catch (e) { console.error('[Vault] items API error:', e); return []; }
  }

  function parseActiveItem(o) {
    return {
      transactionId: null,
      itemId: String(o.id || ''),
      title: o.title || 'Onbekend item',
      price: parseFloat(o.price || o.price_numeric || 0),
      date: (o.created_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
      buyer: '', country: '', sku: null,
      photo: o.photos?.[0]?.url || o.photo?.url || null,
      status: 'active',
      labelUrl: null,
      url: `https://www.vinted.be/items/${o.id}`,
    };
  }

  // ── DOM helpers (fallback scraping) ───────────────────────────────────────
  function getCardContainer(el) {
    let node = el;
    for (let i = 0; i < 8; i++) {
      if (!node.parentElement || node.parentElement === document.body) break;
      node = node.parentElement;
      const tag = node.tagName?.toLowerCase();
      if (['li', 'article'].includes(tag)) break;
      if (/item|card|row|transaction|order|purchase|sale|cell/i.test(node.className || '')) break;
    }
    return node;
  }

  function findOrderRows() {
    const explicit = [
      '[data-testid="my-orders-item"]', '[data-testid*="my-orders-item"]',
      '[data-testid*="sold-item"]', '[data-testid*="transaction-item"]',
      '[data-testid*="transaction"]', '[data-testid*="order-item"]',
      '[class*="transaction--item"]', '[class*="transaction-item"]',
      '[class*="order-item"]', '[class*="order-card"]',
      '[class*="sale-item"]', '[class*="sold-item"]',
    ];
    for (const sel of explicit) {
      const els = [...document.querySelectorAll(sel)];
      if (els.length > 0) { console.log('[Vault] rows via', sel, '→', els.length); return els; }
    }
    const seen = new Set(), rows = [];
    document.querySelectorAll('a[href*="/transaction"]').forEach((a) => {
      const c = getCardContainer(a);
      if (!seen.has(c)) { seen.add(c); rows.push(c); }
    });
    if (!rows.length) {
      document.querySelectorAll('li, article').forEach((el) => {
        if (el.querySelector('a[href]') && !seen.has(el)) { seen.add(el); rows.push(el); }
      });
    }
    if (!rows.length) {
      const testIds = [...new Set([...document.querySelectorAll('[data-testid]')]
        .map((e) => e.dataset.testid))].slice(0, 20);
      console.warn('[Vault] 0 rows found. data-testids:', testIds);
    }
    return rows;
  }

  function extractAllTransactionIds() {
    const ids = new Set();
    document.querySelectorAll('a[href*="/transactions/"]').forEach((a) => {
      const m = a.href.match(/\/transactions\/(\d+)/); if (m) ids.add(m[1]);
    });
    document.querySelectorAll('a[href*="/transaction/"]').forEach((a) => {
      const m = a.href.match(/\/transaction\/(\d+)/); if (m) ids.add(m[1]);
    });
    document.querySelectorAll('a[href*="transaction_id="]').forEach((a) => {
      try { const v = new URL(a.href).searchParams.get('transaction_id'); if (v) ids.add(v); } catch {}
    });
    document.querySelectorAll('[data-transaction-id]').forEach((el) => {
      if (el.dataset.transactionId) ids.add(el.dataset.transactionId);
    });
    if (!ids.size) {
      const sample = [...document.querySelectorAll('main a[href], [role="main"] a[href]')]
        .slice(0, 8).map((a) => a.getAttribute('href'));
      console.warn('[Vault] 0 tx IDs. Sample hrefs:', sample);
    }
    return [...ids];
  }

  const FLAG_MAP = {
    '🇧🇪': 'BE', '🇳🇱': 'NL', '🇫🇷': 'FR', '🇩🇪': 'DE',
    '🇬🇧': 'GB', '🇪🇸': 'ES', '🇮🇹': 'IT', '🇵🇱': 'PL',
  };
  const STATUS_RE = /^(alles|in behandeling|voltooid|geannuleerd|verzendlabel|de bestelling|betaald|verzonden|nieuw|verkocht|te koop|geleverd|afgerond|pending|bekijk|contact|meer laden|filters)/i;

  function extractOrder(row) {
    const text     = row.innerText || row.textContent || '';
    const txLink   = row.querySelector('a[href*="/transactions/"]');
    const itemLink = row.querySelector('a[href*="/items/"]');
    const anyLink  = txLink || itemLink;
    const transactionId = txLink?.href.match(/\/transactions?\/(\d+)/)?.[1]
      || row.dataset.transactionId
      || row.querySelector('[data-transaction-id]')?.dataset.transactionId
      || null;
    const pm    = text.match(/€\s*(\d+[,\.]\d{1,2})|(\d+[,\.]\d{1,2})\s*€/);
    const price = pm ? parseFloat((pm[1] || pm[2]).replace(',', '.')) : 0;
    const dm    = text.match(/\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{1,2}\s+(?:jan|feb|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec)[a-z]*\.?\s*\d{0,4})\b/i);
    const date  = dm ? dm[0].trim() : new Date().toLocaleDateString('nl-BE');
    const titleEl = row.querySelector('[data-testid="my-orders-item--title"]');
    const title = titleEl?.textContent?.trim() || (() => {
      const lines = text.split('\n').map((l) => l.trim()).filter(
        (l) => l.length > 10 && l.length < 120 && !/^€|\d+[,\.]\d+\s*€?$/.test(l) && !STATUS_RE.test(l)
      );
      return lines[0] || 'Onbekend item';
    })();
    const buyerEl = row.querySelector('[class*="user"], [class*="buyer"], [class*="username"]');
    const buyer   = buyerEl?.textContent?.trim() || '';
    const flagMatch = text.match(/[\u{1F1E0}-\u{1F1FF}]{2}/u);
    const country   = flagMatch ? (FLAG_MAP[flagMatch[0]] || '') : '';
    const imgEl = row.querySelector('[data-testid="my-orders-item-image--img"]')
      || row.querySelector('img[src*="freetls.fastly.net"], img[src*="vinted-static"], img[src*="cloudfront"], img[src*="vinted.com"]');
    const photo = imgEl?.src || null;
    return {
      transactionId, title, price, date, buyer, country,
      sku: null, photo, status: 'sold',
      labelUrl: transactionId ? apiLabelUrl(transactionId) : null,
      url: anyLink?.href || location.href,
    };
  }

  // ── Safe message helper ───────────────────────────────────────────────────
  function sendMsg(message, ms = 8000) {
    return Promise.race([
      new Promise((resolve) => {
        chrome.runtime.sendMessage(message, (res) => {
          if (chrome.runtime.lastError) { console.warn('[Vault]', chrome.runtime.lastError.message); resolve({ success: false }); }
          else resolve(res || { success: false });
        });
      }),
      new Promise((resolve) => setTimeout(() => resolve({ success: false, timeout: true }), ms)),
    ]);
  }

  // ── Scan & sync ───────────────────────────────────────────────────────────
  async function scanAndSync() {
    if (scanActive) return;
    scanActive = true;
    try {
      if (isActiveItemsPage(location.href)) {
        const items = await fetchActiveItems();
        if (items.length) { allOrders = items; }
        // active items: no Supabase sync (no transaction)
      } else {
        // Sold orders: API first, DOM fallback
        const apiOrders = await fetchOrdersFromApi();
        if (apiOrders.length > 0) {
          for (const o of apiOrders) {
            const idx = allOrders.findIndex((x) => x.transactionId === o.transactionId);
            if (idx === -1) allOrders.push(o);
            else allOrders[idx] = { ...allOrders[idx], ...o };
          }
        } else {
          console.warn('[Vault] API 0 orders — DOM fallback');
          extractAllTransactionIds().forEach((id) => {
            if (!allOrders.some((o) => o.transactionId === id)) {
              allOrders.push({ transactionId: id, title: 'Bestelling #' + id, price: 0,
                date: new Date().toLocaleDateString('nl-BE'), buyer: '', country: '',
                sku: null, photo: null, status: 'sold',
                labelUrl: apiLabelUrl(id), url: `https://www.vinted.be/transactions/${id}` });
            }
          });
          for (const row of findOrderRows()) {
            const o = extractOrder(row);
            if (!o.transactionId) continue;
            const idx = allOrders.findIndex((x) => x.transactionId === o.transactionId);
            if (idx === -1) allOrders.push(o);
            else allOrders[idx] = { ...allOrders[idx], ...o };
          }
        }
        // Sync new orders to Supabase
        for (const o of [...allOrders]) {
          if (!o.transactionId || syncedIds.has(o.transactionId)) continue;
          const res = await sendMsg({ type: 'SYNC_ORDER', order: o });
          if (res?.success && !res.duplicate) {
            syncedIds.add(o.transactionId);
            console.log('[Vault] synced', o.transactionId, o.title);
          }
        }
      }
      if (panelOpen) renderPanel();
    } finally {
      scanActive = false;
    }
  }

  // ── Toast notification ────────────────────────────────────────────────────
  function showToast(message) {
    document.getElementById('vault-toast')?.remove();
    const t = document.createElement('div');
    t.id = 'vault-toast';
    t.textContent = message;
    Object.assign(t.style, {
      position: 'fixed', bottom: '80px', right: '24px', zIndex: '2147483647',
      background: '#0f172a', color: '#f8fafc', padding: '10px 16px',
      borderRadius: '10px', fontSize: '13px', fontWeight: '600',
      boxShadow: '0 4px 20px rgba(0,0,0,0.25)', opacity: '1',
      transition: 'opacity 0.3s', pointerEvents: 'none',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    });
    (document.body || document.documentElement).appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
  }

  // ── Floating toggle button ────────────────────────────────────────────────
  function resetSyncBtn(btn) {
    if (!btn) return;
    btn.innerHTML = '<span style="font-size:13px;font-weight:800;letter-spacing:1.5px;font-family:inherit">V</span>';
    btn.title = 'Vault Seller Tools';
    btn.style.background = INDIGO;
    btn.style.cursor = 'pointer';
    btn.dataset.syncing = 'false';
  }

  async function handleSyncButtonClick() {
    const btn = document.getElementById(TOG_ID);
    if (!btn) return;
    if (panelOpen) { togglePanel(false); return; }
    if (btn.dataset.syncing === 'true') return;

    btn.dataset.syncing = 'true';
    btn.innerHTML = '<span style="font-size:16px">⏳</span>';
    btn.title = 'Bezig met scannen…';
    btn.style.background = '#3730a3';
    btn.style.cursor = 'default';

    const failsafe = setTimeout(() => {
      resetSyncBtn(btn);
      scanActive = false;
      showToast('Scan time-out — probeer opnieuw.');
    }, 30000);

    try {
      await loadSyncedIds();
      const before = syncedIds.size;
      await scanAndSync();
      const added = syncedIds.size - before;
      btn.innerHTML = '<span style="font-size:16px">✓</span>';
      btn.style.background = GREEN;
      showToast(added > 0
        ? `✓ ${added} order${added !== 1 ? 's' : ''} gesynchroniseerd`
        : allOrders.length > 0 ? `${allOrders.length} items geladen` : 'Geen items gevonden');
      togglePanel(true);
      setTimeout(() => resetSyncBtn(btn), 3000);
    } catch (err) {
      console.error('[Vault] sync error:', err);
      showToast('Fout: ' + err.message);
      resetSyncBtn(btn);
    } finally {
      clearTimeout(failsafe);
      btn.dataset.syncing = 'false';
    }
  }

  function injectToggleButton() {
    if (document.getElementById(TOG_ID)) return;
    const btn = document.createElement('button');
    btn.id = TOG_ID;
    btn.innerHTML = '<span style="font-size:13px;font-weight:800;letter-spacing:1.5px;font-family:inherit">V</span>';
    btn.title = 'Vault Seller Tools';
    Object.assign(btn.style, {
      position: 'fixed', bottom: '24px', right: '24px', zIndex: '2147483647',
      background: INDIGO, color: '#fff', border: 'none', borderRadius: '50%',
      width: '48px', height: '48px', cursor: 'pointer',
      boxShadow: '0 4px 20px rgba(79,70,229,0.45)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'background 0.2s, transform 0.15s',
    });
    btn.addEventListener('mouseenter', () => { if (btn.dataset.syncing !== 'true') btn.style.transform = 'scale(1.08)'; });
    btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; });
    btn.addEventListener('click', handleSyncButtonClick);
    (document.body || document.documentElement).appendChild(btn);
  }

  // ── Panel ─────────────────────────────────────────────────────────────────
  function buildPanel() {
    if (document.getElementById(PANEL_ID)) return;
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    Object.assign(panel.style, {
      position: 'fixed', top: '0', right: '0', width: '360px', height: '100vh',
      background: '#ffffff', borderLeft: '1px solid #e2e8f0',
      boxShadow: '-8px 0 40px rgba(0,0,0,0.12)',
      zIndex: '2147483646', display: 'flex', flexDirection: 'column',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
      transform: 'translateX(100%)', transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
      boxSizing: 'border-box',
    });
    panel.innerHTML = `
      <div style="padding:16px 20px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
        <div>
          <div style="font-size:18px;font-weight:800;letter-spacing:3px;color:${INDIGO}">VAULT</div>
          <div style="font-size:11px;color:#94a3b8;margin-top:1px;letter-spacing:0.5px">Seller Tools</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <button id="vault-panel-scan" style="background:#f8fafc;border:1px solid #e2e8f0;color:#374151;font-size:11px;font-weight:500;cursor:pointer;padding:6px 10px;border-radius:6px;font-family:inherit;white-space:nowrap">🔄 Scan</button>
          <button id="vault-panel-close" style="background:none;border:none;color:#94a3b8;font-size:20px;cursor:pointer;padding:4px 6px;line-height:1;border-radius:4px">✕</button>
        </div>
      </div>
      <div id="vault-panel-list" style="flex:1;overflow-y:auto;background:#ffffff"></div>
      <div style="padding:14px 16px;border-top:1px solid #f1f5f9;display:flex;flex-direction:column;gap:8px;flex-shrink:0;background:#ffffff">
        <button id="vault-sync-selected" style="background:${INDIGO};color:#fff;border:none;border-radius:8px;padding:11px 14px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;letter-spacing:0.2px">
          ☁ Sync geselecteerde (0)
        </button>
        <button id="vault-print-selected" style="background:#fff;color:#374151;border:1px solid #e2e8f0;border-radius:8px;padding:11px 14px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">
          🖨 Print labels geselecteerde (0)
        </button>
      </div>
    `;
    (document.body || document.documentElement).appendChild(panel);

    panel.querySelector('#vault-panel-close').addEventListener('click', () => togglePanel(false));

    panel.querySelector('#vault-panel-scan').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.textContent = '⏳ Bezig…';
      btn.disabled = true;
      await loadSyncedIds();
      const before = syncedIds.size;
      await scanAndSync();
      const added = syncedIds.size - before;
      btn.textContent = added > 0 ? `✓ ${added} gesync'd` : '✓ Klaar';
      showToast(added > 0
        ? `✓ ${added} order${added !== 1 ? 's' : ''} gesynchroniseerd`
        : allOrders.length > 0 ? `${allOrders.length} items geladen` : 'Geen items gevonden');
      setTimeout(() => { btn.textContent = '🔄 Scan'; btn.disabled = false; }, 2500);
    });

    panel.querySelector('#vault-sync-selected').addEventListener('click', syncSelected);
    panel.querySelector('#vault-print-selected').addEventListener('click', printSelected);
  }

  function togglePanel(force) {
    buildPanel();
    panelOpen = force !== undefined ? force : !panelOpen;
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.style.transform = panelOpen ? 'translateX(0)' : 'translateX(100%)';
    if (panelOpen) renderPanel();
  }

  // ── Render item list ──────────────────────────────────────────────────────
  function escHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderPanel() {
    const list = document.getElementById('vault-panel-list');
    if (!list) return;

    if (!allOrders.length) {
      list.innerHTML = `
        <div style="padding:48px 20px;text-align:center;color:#94a3b8">
          <div style="font-size:36px;margin-bottom:12px">📦</div>
          <div style="font-size:14px;font-weight:600;color:#475569">Geen items gevonden</div>
          <div style="font-size:12px;margin-top:6px;line-height:1.5">Klik <strong>🔄 Scan</strong> om orders<br>op te halen via de Vinted API</div>
        </div>`;
      updateFooterCounts();
      return;
    }

    list.innerHTML = allOrders.map((o, i) => {
      const isSold    = o.status === 'sold' || !!o.transactionId;
      const price     = o.price > 0 ? `€${Number(o.price).toFixed(2).replace('.', ',')}` : '—';
      const title     = (o.title || '?').length > 34 ? o.title.slice(0, 34) + '…' : o.title;
      const badgeBg   = isSold ? '#dcfce7' : '#dbeafe';
      const badgeClr  = isSold ? '#15803d' : '#1d4ed8';
      const badgeTxt  = isSold ? 'Verkocht' : 'Actief';
      const downloaded = downloadedIds.has(o.transactionId);
      const photoHtml = o.photo
        ? `<img src="${escHtml(o.photo)}" alt="" style="width:48px;height:48px;border-radius:8px;object-fit:cover;flex-shrink:0;border:1px solid #f1f5f9" loading="lazy">`
        : `<div style="width:48px;height:48px;border-radius:8px;background:#f8fafc;border:1px solid #f1f5f9;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:22px">📦</div>`;
      return `
        <label style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #f8fafc;cursor:pointer;box-sizing:border-box">
          <input type="checkbox" data-idx="${i}" style="cursor:pointer;accent-color:${INDIGO};flex-shrink:0;width:15px;height:15px;margin:0">
          ${photoHtml}
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:500;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3">${escHtml(title)}</div>
            <div style="display:flex;align-items:center;gap:5px;margin-top:4px;flex-wrap:wrap">
              <span style="font-size:13px;font-weight:700;color:${INDIGO}">${price}</span>
              <span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;background:${badgeBg};color:${badgeClr}">${badgeTxt}</span>
              ${downloaded ? `<span style="font-size:10px;color:#16a34a;font-weight:600">✓ label</span>` : ''}
            </div>
            ${o.buyer ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(o.buyer)}${o.country ? ' · ' + o.country : ''}</div>` : ''}
          </div>
          ${isSold ? `<button data-sync-idx="${i}" title="Sync naar Supabase" style="background:none;border:none;color:#cbd5e1;cursor:pointer;padding:4px;font-size:16px;flex-shrink:0;line-height:1;border-radius:4px">☁</button>` : ''}
        </label>`;
    }).join('');

    list.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.addEventListener('change', updateFooterCounts);
    });

    list.querySelectorAll('button[data-sync-idx]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const o = allOrders[parseInt(btn.dataset.syncIdx, 10)];
        if (!o) return;
        btn.textContent = '⏳';
        sendMsg({ type: 'SYNC_TO_SUPABASE', order: o }).then((res) => {
          btn.textContent = res?.success ? '✓' : '!';
          btn.style.color = res?.success ? GREEN : RED;
          setTimeout(() => { btn.textContent = '☁'; btn.style.color = '#cbd5e1'; }, 2500);
        });
      });
    });

    updateFooterCounts();
  }

  function updateFooterCounts() {
    const list     = document.getElementById('vault-panel-list');
    const syncBtn  = document.getElementById('vault-sync-selected');
    const printBtn = document.getElementById('vault-print-selected');
    if (!list) return;
    const n = list.querySelectorAll('input[type=checkbox]:checked').length;
    if (syncBtn)  syncBtn.textContent  = `☁ Sync geselecteerde (${n})`;
    if (printBtn) printBtn.textContent = `🖨 Print labels geselecteerde (${n})`;
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  function getCheckedOrders() {
    const list = document.getElementById('vault-panel-list');
    if (!list) return [];
    return [...list.querySelectorAll('input[type=checkbox]:checked')]
      .map((cb) => allOrders[parseInt(cb.dataset.idx, 10)])
      .filter(Boolean);
  }

  function syncSelected() {
    const orders = getCheckedOrders().filter((o) => o.transactionId);
    if (!orders.length) { showToast('Selecteer verkochte orders om te synchroniseren.'); return; }
    const btn = document.getElementById('vault-sync-selected');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Syncing…'; }
    Promise.all(orders.map((o) => sendMsg({ type: 'SYNC_TO_SUPABASE', order: o }))).then((results) => {
      const ok = results.filter((r) => r?.success).length;
      showToast(`✓ ${ok}/${orders.length} orders gesynchroniseerd naar Vault`);
      if (btn) { btn.disabled = false; updateFooterCounts(); }
    });
  }

  function printSelected() {
    const orders = getCheckedOrders().filter((o) => o.transactionId);
    if (!orders.length) { showToast('Selecteer verkochte orders voor labels.'); return; }
    doPrintLabels(orders);
  }

  function doPrintLabels(orders) {
    const printBtn = document.getElementById('vault-print-selected');
    if (printBtn) { printBtn.disabled = true; printBtn.textContent = '⏳ Labels ophalen…'; }
    chrome.runtime.sendMessage(
      { type: 'PRINT_LABELS', labelUrls: orders.map((o) => apiLabelUrl(o.transactionId)), transactionIds: orders.map((o) => o.transactionId) },
      (res) => {
        if (res?.success) {
          (res.downloadedIds || orders.map((o) => o.transactionId)).forEach((id) => downloadedIds.add(id));
          renderPanel();
          showToast('✅ Labels gedownload!');
        } else {
          showToast('PDF mislukt: ' + (res?.error || 'onbekende fout'));
        }
        if (printBtn) { printBtn.disabled = false; updateFooterCounts(); }
      }
    );
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  let panelDone = false;

  async function init() {
    const url = location.href;
    console.log('[Vault] init:', url);
    if (isOrdersPage(url) && !panelDone) {
      panelDone = true;
      allOrders = [];
      await loadSyncedIds();
      await loadDownloadedIds();
      buildPanel();
      injectToggleButton();
      setTimeout(() => scanAndSync(), 800);
      setTimeout(() => scanAndSync(), 3500);
      const mo = new MutationObserver(() => scanAndSync());
      mo.observe(document.body, { subtree: true, childList: true });
      setTimeout(() => mo.disconnect(), 20000);
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.interceptedLabels) {
      const labels = changes.interceptedLabels.newValue || [];
      downloadedIds = new Set(labels.map((l) => l.orderId).filter(Boolean));
      if (panelOpen) renderPanel();
    }
  });

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      console.log('[Vault] URL →', location.href);
      lastUrl = location.href;
      panelDone = false; panelOpen = false; allOrders = [];
      document.getElementById(PANEL_ID)?.remove();
      document.getElementById(TOG_ID)?.remove();
      setTimeout(init, 300);
    }
  }).observe(document, { subtree: true, childList: true });

  init();
})();
