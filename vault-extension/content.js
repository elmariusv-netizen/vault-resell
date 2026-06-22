(function () {
  'use strict';

  console.log('[Vault] content script loaded on', location.href);

  // ── Constants ─────────────────────────────────────────────────────────────
  const PANEL_ID  = 'vault-label-panel';
  const TOG_ID    = 'vault-panel-toggle';
  const INDIGO    = '#4f46e5';
  const GREEN     = '#16a34a';
  const RED       = '#dc2626';

  // ── State ─────────────────────────────────────────────────────────────────
  let syncedIds     = new Set();
  let allOrders     = [];         // { transactionId, title, price, … }
  let downloadedIds = new Set();  // transactionIds with label already in storage
  let scanActive    = false;
  let panelOpen     = false;

  // ── Real Vinted API label URL ─────────────────────────────────────────────
  function apiLabelUrl(transactionId) {
    return `https://www.vinted.be/api/v2/transactions/${transactionId}/shipment/pdf_label`;
  }

  // ── Page detection ────────────────────────────────────────────────────────
  function isOrdersPage(url) {
    return /\/(my[-_\/]?(orders?|purchases?|sales?|transactions?|bestellingen?|sold[-_]items?))/i.test(url)
        || /\/transactions?\/\d+/i.test(url);
  }

  // ── Load synced IDs from storage ──────────────────────────────────────────
  async function loadSyncedIds() {
    const { syncedOrders = [] } = await chrome.storage.local.get(['syncedOrders']);
    syncedIds = new Set(syncedOrders.map((o) => o.transactionId).filter(Boolean));
    console.log('[Vault] loaded', syncedIds.size, 'synced IDs');
  }

  // ── Load downloaded label IDs from storage ────────────────────────────────
  async function loadDownloadedIds() {
    const { interceptedLabels = [] } = await chrome.storage.local.get(['interceptedLabels']);
    downloadedIds = new Set(interceptedLabels.map((l) => l.orderId).filter(Boolean));
    console.log('[Vault] loaded', downloadedIds.size, 'downloaded label IDs');
  }

  // ── DOM helpers ───────────────────────────────────────────────────────────
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
      '[data-testid*="transaction"]', '[data-testid*="order"]', '[data-testid*="purchase"]',
      '[class*="transaction--item"]', '[class*="transaction-item"]',
      '[class*="order-item"]', '[class*="order-card"]', '[class*="sale-item"]',
    ];
    for (const sel of explicit) {
      const els = [...document.querySelectorAll(sel)];
      if (els.length > 0) { console.log('[Vault] rows via', sel, els.length); return els; }
    }
    const seen = new Set();
    const rows = [];
    document.querySelectorAll('a[href*="/transaction"], a[href*="/items/"]').forEach((a) => {
      const c = getCardContainer(a);
      if (!seen.has(c)) { seen.add(c); rows.push(c); }
    });
    console.log('[Vault] rows via link fallback:', rows.length);
    return rows;
  }

  // ── Extract transaction IDs directly from page links ──────────────────────
  function extractAllTransactionIds() {
    const ids = new Set();
    document.querySelectorAll('a[href*="/transactions/"]').forEach((a) => {
      const m = a.href.match(/\/transactions\/(\d+)/);
      if (m) ids.add(m[1]);
    });
    return [...ids];
  }

  // ── Extract order data from a row element ─────────────────────────────────
  const FLAG_MAP = {
    '🇧🇪': 'BE', '🇳🇱': 'NL', '🇫🇷': 'FR', '🇩🇪': 'DE',
    '🇬🇧': 'GB', '🇪🇸': 'ES', '🇮🇹': 'IT', '🇵🇱': 'PL',
  };
  const STATUS_RE = /^(alles|in behandeling|voltooid|geannuleerd|bestelling gepauzeerd|verzendlabel|de bestelling|betaald|verzonden|nieuw|verkocht|te koop|geleverd|afgerond|pending|bekijk|contact|meer laden|filters)/i;

  function extractOrder(row) {
    const text = row.innerText || row.textContent || '';

    const txLink   = row.querySelector('a[href*="/transaction"]');
    const itemLink = row.querySelector('a[href*="/items/"]');
    const anyLink  = txLink || itemLink;

    // Prefer /transactions/{id} over /items/{id}
    const txIdFromLink = (txLink?.href || '').match(/\/transactions\/(\d+)/)?.[1];
    const txIdFallback = (anyLink?.href || '').match(/\/(?:transaction[s]?|items)\/(\d+)/)?.[1];
    const transactionId = txIdFromLink || txIdFallback || null;

    const pm = text.match(/€\s*(\d+[,\.]\d{1,2})|(\d+[,\.]\d{1,2})\s*€/);
    const price = pm ? parseFloat((pm[1] || pm[2]).replace(',', '.')) : 0;

    const dm = text.match(/\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{1,2}\s+(?:jan|feb|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec)[a-z]*\.?\s*\d{0,4})\b/i);
    const date = dm ? dm[0].trim() : new Date().toLocaleDateString('nl-BE');

    const lines = text.split('\n').map((l) => l.trim()).filter(
      (l) => l.length > 10 && l.length < 120 &&
        !/^€|\d+[,\.]\d+\s*€?$/.test(l) && !STATUS_RE.test(l)
    );
    const title = lines[0] || 'Onbekend item';

    const buyerEl = row.querySelector('[class*="user"], [class*="buyer"], [class*="username"]');
    const buyer   = buyerEl?.textContent?.trim() || '';

    const flagMatch = text.match(/[\u{1F1E0}-\u{1F1FF}]{2}/u);
    const country   = flagMatch ? (FLAG_MAP[flagMatch[0]] || '') : '';

    const skuMatch = text.match(/\b([A-Z]{2,4}\d{3,4})\b/);
    const sku      = skuMatch ? skuMatch[1] : null;

    const imgEl = row.querySelector(
      'img[src*="freetls.fastly.net"], img[src*="vinted-static"], img[src*="cloudfront"], img[src*="vinted.com"]'
    );
    const photo = imgEl?.src || null;

    return {
      transactionId,
      title,
      price,
      date,
      buyer,
      country,
      sku,
      photo,
      labelUrl: transactionId ? apiLabelUrl(transactionId) : null,
      url: anyLink?.href || location.href,
    };
  }

  // ── Toggle button (floating, bottom-right) ────────────────────────────────
  function injectToggleButton() {
    if (document.getElementById(TOG_ID)) return;
    const btn = document.createElement('button');
    btn.id = TOG_ID;
    btn.textContent = '🏷';
    btn.title = 'Vault Labels openen';
    Object.assign(btn.style, {
      position: 'fixed', bottom: '20px', right: '20px', zIndex: '2147483647',
      background: GREEN, color: '#fff', border: 'none', borderRadius: '50%',
      width: '50px', height: '50px', fontSize: '22px', cursor: 'pointer',
      boxShadow: '0 4px 16px rgba(22,163,74,0.5)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: '1',
    });
    btn.addEventListener('click', () => togglePanel());
    (document.body || document.documentElement).appendChild(btn);
  }

  // ── Build panel (once) ────────────────────────────────────────────────────
  function buildPanel() {
    if (document.getElementById(PANEL_ID)) return;
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    Object.assign(panel.style, {
      position: 'fixed', top: '0', right: '0', width: '310px', height: '100vh',
      background: '#0f172a', borderLeft: '2px solid ' + INDIGO,
      zIndex: '2147483646', display: 'flex', flexDirection: 'column',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      transform: 'translateX(100%)', transition: 'transform 0.25s ease',
      boxShadow: '-4px 0 24px rgba(0,0,0,0.6)', boxSizing: 'border-box',
    });
    panel.innerHTML = `
      <div style="padding:13px 16px;border-bottom:1px solid #1e293b;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
        <span style="color:#e2e8f0;font-weight:700;font-size:14px">🏷 Vault Labels</span>
        <button id="vault-panel-close" style="background:none;border:none;color:#94a3b8;font-size:18px;cursor:pointer;padding:2px 6px;line-height:1;border-radius:4px">✕</button>
      </div>
      <div id="vault-panel-list" style="flex:1;overflow-y:auto;padding:4px 0"></div>
      <div style="padding:12px 16px;border-top:1px solid #1e293b;display:flex;flex-direction:column;gap:8px;flex-shrink:0">
        <button id="vault-print-selected" style="background:${INDIGO};color:#fff;border:none;border-radius:8px;padding:10px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">
          Print geselecteerde (0)
        </button>
        <button id="vault-print-all" style="background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:8px;padding:10px 14px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">
          Print alle labels (0)
        </button>
      </div>
    `;
    (document.body || document.documentElement).appendChild(panel);
    panel.querySelector('#vault-panel-close').addEventListener('click', () => togglePanel(false));
    panel.querySelector('#vault-print-selected').addEventListener('click', printSelected);
    panel.querySelector('#vault-print-all').addEventListener('click', printAll);
  }

  // ── Toggle panel ──────────────────────────────────────────────────────────
  function togglePanel(force) {
    buildPanel();
    panelOpen = force !== undefined ? force : !panelOpen;
    const panel = document.getElementById(PANEL_ID);
    const tog   = document.getElementById(TOG_ID);
    if (panel) panel.style.transform = panelOpen ? 'translateX(0)' : 'translateX(100%)';
    if (tog)   tog.style.opacity = panelOpen ? '0' : '1';
    if (tog)   tog.style.pointerEvents = panelOpen ? 'none' : 'auto';
    if (panelOpen) renderPanel();
  }

  // ── Render panel order list ───────────────────────────────────────────────
  function renderPanel() {
    const list   = document.getElementById('vault-panel-list');
    const selBtn = document.getElementById('vault-print-selected');
    const allBtn = document.getElementById('vault-print-all');
    if (!list) return;

    const withTx = allOrders.filter((o) => o.transactionId);

    if (!withTx.length) {
      list.innerHTML = '<p style="color:#64748b;font-size:12px;padding:20px 16px;text-align:center;margin:0">Geen bestellingen gevonden.<br>Wacht tot de pagina is geladen.</p>';
      if (selBtn) selBtn.textContent = 'Print geselecteerde (0)';
      if (allBtn) allBtn.textContent = 'Print alle labels (0)';
      return;
    }

    list.innerHTML = withTx.map((order, i) => {
      const done  = downloadedIds.has(order.transactionId);
      const title = order.title.length > 26 ? order.title.slice(0, 26) + '…' : order.title;
      const price = order.price ? `€${order.price.toFixed(2).replace('.', ',')}` : '';
      return `
        <label style="display:flex;align-items:center;gap:9px;padding:9px 16px;cursor:pointer;border-bottom:1px solid #1e293b;box-sizing:border-box;background:transparent">
          <input type="checkbox" data-idx="${i}" style="cursor:pointer;accent-color:${INDIGO};flex-shrink:0;width:14px;height:14px;margin:0">
          <span style="flex:1;min-width:0">
            <span style="display:block;color:#e2e8f0;font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(title)}</span>
            <span style="display:block;color:#64748b;font-size:11px;margin-top:2px">#${order.transactionId}${price ? ' · ' + price : ''}</span>
          </span>
          <span title="${done ? 'Label al gedownload' : 'Nog niet gedownload'}" style="color:${done ? GREEN : '#475569'};font-size:${done ? '17px' : '13px'};flex-shrink:0;line-height:1">${done ? '✓' : '⏳'}</span>
          <button data-sync-idx="${i}" title="Sync naar Supabase" style="background:none;border:none;color:#475569;cursor:pointer;padding:2px 4px;font-size:14px;flex-shrink:0;line-height:1;border-radius:4px">☁</button>
        </label>
      `;
    }).join('');

    list.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.addEventListener('change', updateSelectedCount);
    });

    list.querySelectorAll('button[data-sync-idx]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const idx   = parseInt(btn.dataset.syncIdx, 10);
        const order = withTx[idx];
        if (!order) return;
        btn.textContent = '⏳';
        chrome.runtime.sendMessage({ type: 'SYNC_TO_SUPABASE', order }, (res) => {
          if (res?.success) {
            btn.textContent = '✓';
            btn.style.color = GREEN;
          } else {
            btn.textContent = '!';
            btn.style.color = RED;
          }
          setTimeout(() => { btn.textContent = '☁'; btn.style.color = '#475569'; }, 2500);
        });
      });
    });

    if (allBtn) allBtn.textContent = `Print alle labels (${withTx.length})`;
    updateSelectedCount();
  }

  function escHtml(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function updateSelectedCount() {
    const list   = document.getElementById('vault-panel-list');
    const selBtn = document.getElementById('vault-print-selected');
    if (!list || !selBtn) return;
    const n = list.querySelectorAll('input[type=checkbox]:checked').length;
    selBtn.textContent = `Print geselecteerde (${n})`;
  }

  function getSelectedOrders() {
    const list  = document.getElementById('vault-panel-list');
    if (!list) return [];
    const withTx = allOrders.filter((o) => o.transactionId);
    return [...list.querySelectorAll('input[type=checkbox]:checked')]
      .map((cb) => withTx[parseInt(cb.dataset.idx, 10)])
      .filter(Boolean);
  }

  function printSelected() {
    const orders = getSelectedOrders();
    if (!orders.length) { alert('Selecteer eerst bestellingen.'); return; }
    doPrintLabels(orders);
  }

  function printAll() {
    const orders = allOrders.filter((o) => o.transactionId);
    if (!orders.length) { alert('Geen bestellingen met transactie-ID gevonden.'); return; }
    doPrintLabels(orders);
  }

  function doPrintLabels(orders) {
    const selBtn = document.getElementById('vault-print-selected');
    const allBtn = document.getElementById('vault-print-all');
    if (selBtn) { selBtn.disabled = true; selBtn.textContent = '⏳ Labels ophalen…'; }
    if (allBtn) { allBtn.disabled = true; }

    const labelUrls      = orders.map((o) => apiLabelUrl(o.transactionId));
    const transactionIds = orders.map((o) => o.transactionId);

    console.log('[Vault] printing labels for transactions:', transactionIds);

    chrome.runtime.sendMessage({ type: 'PRINT_LABELS', labelUrls, transactionIds }, (res) => {
      if (res?.success) {
        (res.downloadedIds || transactionIds).forEach((id) => downloadedIds.add(id));
        renderPanel();
        if (selBtn) selBtn.textContent = '✅ Gedownload!';
        setTimeout(() => {
          if (selBtn) { selBtn.disabled = false; updateSelectedCount(); }
          if (allBtn) { allBtn.disabled = false; renderPanel(); }
        }, 2500);
      } else {
        alert('PDF aanmaken mislukt: ' + (res?.error || 'onbekende fout'));
        if (selBtn) { selBtn.disabled = false; updateSelectedCount(); }
        if (allBtn) { allBtn.disabled = false; }
      }
    });
  }

  // ── Auto-scan & sync all orders ───────────────────────────────────────────
  async function scanAndSync() {
    if (scanActive) return;
    scanActive = true;
    try {
      // Also harvest transaction IDs directly from links (catches IDs not in card containers)
      extractAllTransactionIds().forEach((id) => {
        if (!allOrders.some((o) => o.transactionId === id)) {
          allOrders.push({
            transactionId: id,
            title: 'Bestelling #' + id,
            price: 0,
            date: new Date().toLocaleDateString('nl-BE'),
            buyer: '',
            country: '',
            sku: null,
            labelUrl: apiLabelUrl(id),
            url: `https://www.vinted.be/transactions/${id}`,
          });
        }
      });

      const rows = findOrderRows();
      console.log('[Vault] scanning', rows.length, 'order rows');
      for (const row of rows) {
        const order = extractOrder(row);
        if (order.transactionId) {
          const idx = allOrders.findIndex((o) => o.transactionId === order.transactionId);
          if (idx === -1) {
            allOrders.push(order);
          } else {
            // Enrich stub entry with full data
            allOrders[idx] = { ...allOrders[idx], ...order };
          }
        }
        if (order.transactionId && !syncedIds.has(order.transactionId)) {
          const res = await new Promise((r) =>
            chrome.runtime.sendMessage({ type: 'SYNC_ORDER', order }, r)
          );
          if (res?.success && !res.duplicate) {
            syncedIds.add(order.transactionId);
            console.log('[Vault] auto-synced', order.transactionId, order.title);
          }
        }
      }
      if (panelOpen) renderPanel();
    } finally {
      scanActive = false;
    }
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
      setTimeout(() => scanAndSync(), 3000);
      const mo = new MutationObserver(() => scanAndSync());
      mo.observe(document.body, { subtree: true, childList: true });
      setTimeout(() => mo.disconnect(), 20000);
    }
  }

  // Refresh downloaded IDs when storage changes (e.g. intercept in background)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.interceptedLabels) {
      const labels = changes.interceptedLabels.newValue || [];
      downloadedIds = new Set(labels.map((l) => l.orderId).filter(Boolean));
      if (panelOpen) renderPanel();
    }
  });

  // SPA navigation
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      console.log('[Vault] URL changed →', location.href);
      lastUrl   = location.href;
      panelDone = false;
      panelOpen = false;
      allOrders = [];
      document.getElementById(PANEL_ID)?.remove();
      document.getElementById(TOG_ID)?.remove();
      setTimeout(init, 300);
    }
  }).observe(document, { subtree: true, childList: true });

  init();
})();
