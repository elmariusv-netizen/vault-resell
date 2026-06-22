(function () {
  'use strict';

  console.log('[Vault] content script loaded on', location.href);

  // ── Constants ────────────────────────────────────────────────────────────
  const DONE_ATTR   = 'data-vault-done';
  const DOT_ID      = 'vault-debug-dot';
  const BAR_ID      = 'vault-label-bar';
  const BADGE_ID    = 'vault-label-badge';
  const INDIGO      = '#4f46e5';
  const GREEN       = '#16a34a';
  const RED         = '#dc2626';

  // ── State ────────────────────────────────────────────────────────────────
  let syncedIds     = new Set();    // transactionIds already in storage
  let checkedOrders = new Map();   // key → order, for label printing
  let scanActive    = false;

  // ── Debug dot ────────────────────────────────────────────────────────────
  function injectDebugDot() {
    if (document.getElementById(DOT_ID)) return;
    const dot = document.createElement('div');
    dot.id = DOT_ID;
    dot.title = 'Vault Resell actief';
    Object.assign(dot.style, {
      position: 'fixed', bottom: '6px', right: '6px',
      width: '10px', height: '10px', borderRadius: '50%',
      background: RED, zIndex: '2147483647',
      pointerEvents: 'none', boxShadow: '0 0 0 2px #fff',
    });
    (document.body || document.documentElement).appendChild(dot);
  }

  // ── Page detection ───────────────────────────────────────────────────────
  function isOrdersPage(url) {
    return /\/(my[-_\/]?(orders?|purchases?|sales?|transactions?|bestellingen?))/i.test(url);
  }
  function isLabelPage(url) {
    return /\/(label|print[-_]label|shipment|verzending|verzendbewijs)/i.test(url);
  }

  // ── Load synced IDs from storage ─────────────────────────────────────────
  async function loadSyncedIds() {
    const { syncedOrders = [] } = await chrome.storage.local.get(['syncedOrders']);
    syncedIds = new Set(syncedOrders.map((o) => o.transactionId).filter(Boolean));
    console.log('[Vault] loaded', syncedIds.size, 'synced IDs');
  }

  // ── DOM helpers ──────────────────────────────────────────────────────────
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
    // Fallback: parent containers of /transaction/ or /items/ links
    const seen = new Set();
    const rows = [];
    document.querySelectorAll('a[href*="/transaction"], a[href*="/items/"]').forEach((a) => {
      const c = getCardContainer(a);
      if (!seen.has(c)) { seen.add(c); rows.push(c); }
    });
    console.log('[Vault] rows via link fallback:', rows.length);
    return rows;
  }

  // ── Extract order data from a row element ─────────────────────────────────
  const FLAG_MAP = {
    '🇧🇪': 'BE', '🇳🇱': 'NL', '🇫🇷': 'FR', '🇩🇪': 'DE',
    '🇬🇧': 'GB', '🇪🇸': 'ES', '🇮🇹': 'IT', '🇵🇱': 'PL',
  };
  const STATUS_RE = /^(alles|in behandeling|voltooid|geannuleerd|bestelling gepauzeerd|verzendlabel|de bestelling|betaald|verzonden|nieuw|verkocht|te koop|geleverd|afgerond|pending|bekijk|contact|meer laden|filters)/i;

  function extractOrder(row) {
    const text = row.innerText || row.textContent || '';

    // Transaction link & ID
    const txLink  = row.querySelector('a[href*="/transaction"]');
    const itemLink = row.querySelector('a[href*="/items/"]');
    const anyLink  = txLink || itemLink;
    const transactionId = (anyLink?.href || '').match(/\/(?:transaction[s]?|items)\/(\d+)/)?.[1] ?? null;

    // Price
    const pm = text.match(/€\s*(\d+[,\.]\d{1,2})|(\d+[,\.]\d{1,2})\s*€/);
    const price = pm ? parseFloat((pm[1] || pm[2]).replace(',', '.')) : 0;

    // Date
    const dm = text.match(/\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{1,2}\s+(?:jan|feb|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec)[a-z]*\.?\s*\d{0,4})\b/i);
    const date = dm ? dm[0].trim() : new Date().toLocaleDateString('nl-BE');

    // Title
    const lines = text.split('\n').map((l) => l.trim()).filter(
      (l) => l.length > 10 && l.length < 120 &&
        !/^€|\d+[,\.]\d+\s*€?$/.test(l) && !STATUS_RE.test(l)
    );
    const title = lines[0] || 'Onbekend item';

    // Buyer
    const buyerEl = row.querySelector('[class*="user"], [class*="buyer"], [class*="username"]');
    const buyer   = buyerEl?.textContent?.trim() || '';

    // Country (flag emoji)
    const flagMatch = text.match(/[\u{1F1E0}-\u{1F1FF}]{2}/u);
    const country   = flagMatch ? (FLAG_MAP[flagMatch[0]] || '') : '';

    // SKU (e.g. RIA001, IND012)
    const skuMatch = text.match(/\b([A-Z]{2,4}\d{3,4})\b/);
    const sku      = skuMatch ? skuMatch[1] : null;

    // Label URL
    const labelAnchor = row.querySelector('a[href*="label"], a[href*="verzend"], a[href*="shipment"]');
    const labelUrl    = labelAnchor?.href ||
      (transactionId ? `https://www.vinted.be/transaction/${transactionId}/label` : null);

    return {
      transactionId,
      title,
      price,
      date,
      buyer,
      country,
      sku,
      labelUrl,
      url: anyLink?.href || location.href,
    };
  }

  // ── Inject per-row UI ────────────────────────────────────────────────────
  function injectRowUI(row, order) {
    if (row.getAttribute(DONE_ATTR)) return;
    row.setAttribute(DONE_ATTR, '1');

    const isSynced = order.transactionId && syncedIds.has(order.transactionId);
    const key      = order.transactionId || (order.title + order.date);

    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      margin: '4px 2px', position: 'relative', zIndex: '9998',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    });

    // Checkbox for label printing
    const cb = document.createElement('input');
    cb.type  = 'checkbox';
    cb.title = 'Selecteer voor labels';
    Object.assign(cb.style, { cursor: 'pointer', width: '14px', height: '14px', accentColor: INDIGO });
    cb.addEventListener('change', () => {
      cb.checked ? checkedOrders.set(key, order) : checkedOrders.delete(key);
      updateLabelBar();
    });

    // Sync button or ✓ badge
    let syncEl;
    if (isSynced) {
      syncEl = document.createElement('span');
      syncEl.textContent = '✓';
      syncEl.title = 'Al gesynchroniseerd met Vault';
      Object.assign(syncEl.style, { color: GREEN, fontWeight: '700', fontSize: '14px' });
    } else {
      syncEl = document.createElement('button');
      syncEl.textContent = 'Sync';
      Object.assign(syncEl.style, {
        background: INDIGO, color: '#fff', border: 'none', borderRadius: '5px',
        padding: '3px 8px', fontSize: '11px', fontWeight: '600', cursor: 'pointer',
      });
      syncEl.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        syncEl.textContent = '…'; syncEl.disabled = true;
        const res = await new Promise((r) => chrome.runtime.sendMessage({ type: 'SYNC_ORDER', order }, r));
        if (res?.success) {
          syncEl.outerHTML = '<span style="color:' + GREEN + ';font-weight:700;font-size:14px" title="Gesynchroniseerd">✓</span>';
          syncedIds.add(order.transactionId);
        } else {
          syncEl.textContent = '!'; syncEl.style.background = RED;
          setTimeout(() => { syncEl.textContent = 'Sync'; syncEl.style.background = INDIGO; syncEl.disabled = false; }, 2000);
        }
      });
    }

    wrap.appendChild(cb);
    wrap.appendChild(syncEl);

    // Insert near action area or at end of row
    const actions = row.querySelector('[class*="action"], [class*="button"], [class*="btn"]');
    (actions || row).appendChild(wrap);
  }

  // ── Auto-scan & sync all orders ──────────────────────────────────────────
  async function scanAndSync() {
    if (scanActive) return;
    scanActive = true;
    try {
      const rows = findOrderRows();
      console.log('[Vault] scanning', rows.length, 'order rows');
      for (const row of rows) {
        const order = extractOrder(row);
        // Auto-sync new orders silently
        if (order.transactionId && !syncedIds.has(order.transactionId)) {
          const res = await new Promise((r) =>
            chrome.runtime.sendMessage({ type: 'SYNC_ORDER', order }, r)
          );
          if (res?.success && !res.duplicate) {
            syncedIds.add(order.transactionId);
            console.log('[Vault] auto-synced', order.transactionId, order.title);
          }
        }
        injectRowUI(row, order);
      }
    } finally {
      scanActive = false;
    }
  }

  // ── Floating label-print bar ──────────────────────────────────────────────
  function updateLabelBar() {
    let bar = document.getElementById(BAR_ID);
    const n = checkedOrders.size;
    if (n === 0) { if (bar) bar.style.display = 'none'; return; }

    if (!bar) {
      bar = document.createElement('div');
      bar.id = BAR_ID;
      Object.assign(bar.style, {
        position: 'fixed', bottom: '0', left: '0', right: '0',
        background: '#0f172a', borderTop: `2px solid ${INDIGO}`,
        padding: '10px 20px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', zIndex: '2147483646',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        boxShadow: '0 -4px 20px rgba(0,0,0,0.5)',
      });
      document.body.appendChild(bar);
    }
    bar.style.display = 'flex';
    bar.innerHTML = `
      <span style="color:#e2e8f0;font-size:13px;font-weight:600">${n} label${n > 1 ? 's' : ''} geselecteerd</span>
      <button id="vault-print-btn" style="background:${INDIGO};color:#fff;border:none;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">
        📥 Print labels (4×6)
      </button>
    `;
    document.getElementById('vault-print-btn').addEventListener('click', printLabels);
  }

  async function printLabels() {
    const btn = document.getElementById('vault-print-btn');
    if (btn) { btn.textContent = '⏳ Bezig…'; btn.disabled = true; }

    const orders    = [...checkedOrders.values()];
    const labelUrls = orders.map((o) => o.labelUrl).filter(Boolean);
    console.log('[Vault] printing labels:', labelUrls);

    if (!labelUrls.length) {
      alert('Geen label-URLs gevonden. Open elke bestelling om het label op te halen.');
      if (btn) { btn.textContent = '📥 Print labels (4×6)'; btn.disabled = false; }
      return;
    }

    chrome.runtime.sendMessage({ type: 'PRINT_LABELS', labelUrls }, (res) => {
      if (res?.success) {
        if (btn) btn.textContent = '✅ Gedownload!';
        setTimeout(() => { if (btn) { btn.textContent = '📥 Print labels (4×6)'; btn.disabled = false; } }, 2500);
      } else {
        alert('PDF aanmaken mislukt: ' + (res?.error || 'onbekende fout'));
        if (btn) { btn.textContent = '📥 Print labels (4×6)'; btn.disabled = false; }
      }
    });
  }

  // ── Label page: floating download button ──────────────────────────────────
  function addLabelButton() {
    if (document.getElementById('vault-label-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'vault-label-btn';
    btn.textContent = '📥 Download 4×6';
    Object.assign(btn.style, {
      position: 'fixed', bottom: '28px', right: '28px', zIndex: '2147483647',
      background: INDIGO, color: '#fff', border: 'none', borderRadius: '10px',
      padding: '12px 22px', fontSize: '14px', fontWeight: '700', cursor: 'pointer',
      boxShadow: '0 4px 16px rgba(79,70,229,0.5)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    });
    btn.addEventListener('click', () => {
      const url = findLabelUrl();
      if (url) {
        chrome.runtime.sendMessage({ type: 'DOWNLOAD_LABEL', url, filename: `label-${Date.now()}.pdf` });
        btn.textContent = '✅ Downloaden…'; btn.style.background = GREEN;
      } else {
        btn.textContent = '❌ PDF niet gevonden'; btn.style.background = RED;
        setTimeout(() => { btn.textContent = '📥 Download 4×6'; btn.style.background = INDIGO; }, 2500);
      }
    });
    document.body.appendChild(btn);
  }

  function findLabelUrl() {
    for (const el of document.querySelectorAll('iframe')) {
      if (/pdf|label/i.test(el.src)) return el.src;
    }
    for (const el of document.querySelectorAll('a')) {
      if (/\.pdf|label/i.test(el.href)) return el.href;
    }
    try {
      const data = window.__NEXT_DATA__ || window.__INITIAL_STATE__;
      if (data) {
        const m = JSON.stringify(data).match(/"(https?:[^"]+\.pdf[^"]*)"/);
        if (m) return m[1];
      }
    } catch (_) { /* ignore */ }
    return null;
  }

  // ── Intercepted-labels counter badge ────────────────────────────────────
  async function refreshLabelBadge() {
    const { interceptedLabels = [] } = await chrome.storage.local.get(['interceptedLabels']);
    const n = interceptedLabels.length;
    let badge = document.getElementById(BADGE_ID);
    if (n === 0) { if (badge) badge.remove(); return; }
    if (!badge) {
      badge = document.createElement('div');
      badge.id = BADGE_ID;
      Object.assign(badge.style, {
        position: 'fixed', top: '12px', right: '12px', zIndex: '2147483647',
        background: '#0f172a', border: `2px solid ${INDIGO}`, borderRadius: '10px',
        padding: '6px 14px', display: 'flex', alignItems: 'center', gap: '7px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: '12px', fontWeight: '700', color: '#e2e8f0',
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)', cursor: 'default',
      });
      document.body.appendChild(badge);
    }
    badge.textContent = `🏷 ${n} label${n !== 1 ? 's' : ''} klaar om te printen`;
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  let panelDone = false;
  let labelDone = false;

  async function init() {
    const url = location.href;
    console.log('[Vault] init:', url);
    injectDebugDot();

    if (isOrdersPage(url) && !panelDone) {
      panelDone = true;
      await loadSyncedIds();
      refreshLabelBadge();
      // Wait for page content then scan; retry after 3 s for slow SPAs
      setTimeout(() => scanAndSync(), 800);
      setTimeout(() => scanAndSync(), 3000);
      // Keep watching for lazy-loaded rows
      const mo = new MutationObserver(() => scanAndSync());
      mo.observe(document.body, { subtree: true, childList: true });
      setTimeout(() => mo.disconnect(), 20000);
    }

    if (isLabelPage(url) && !labelDone) {
      labelDone = true;
      setTimeout(addLabelButton, 800);
    }
  }

  // Refresh badge when storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.interceptedLabels && isOrdersPage(location.href)) {
      refreshLabelBadge();
    }
  });

  // SPA navigation
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      console.log('[Vault] URL changed →', location.href);
      lastUrl    = location.href;
      panelDone  = false;
      labelDone  = false;
      checkedOrders.clear();
      const bar = document.getElementById(BAR_ID);
      if (bar) bar.style.display = 'none';
      setTimeout(init, 300);
    }
  }).observe(document, { subtree: true, childList: true });

  init();
})();
