(function () {
  'use strict';

  const SYNC_BTN_CLASS = 'vault-sync-btn';
  const LABEL_BTN_CLASS = 'vault-label-btn';
  const INDIGO = '#4f46e5';
  const GREEN = '#16a34a';
  const RED = '#dc2626';

  // ── SPA navigation watcher ───────────────────────────────────────────────
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(init, 600);
    }
  }).observe(document, { subtree: true, childList: true });

  // ── Page detection ───────────────────────────────────────────────────────
  function isOrdersPage(url) {
    return /\/my\/(sales|orders|transactions|sold)/.test(url);
  }

  function isLabelPage(url) {
    return /\/(label|shipment|print-label|verzending)/.test(url);
  }

  // ── Orders page ──────────────────────────────────────────────────────────
  function observeOrders() {
    scanOrders();
    // Keep scanning for 15 s to catch lazy-loaded cards
    const mo = new MutationObserver(scanOrders);
    mo.observe(document.body, { subtree: true, childList: true });
    setTimeout(() => mo.disconnect(), 15000);
  }

  function scanOrders() {
    const cards = findOrderCards();
    cards.forEach((card) => {
      if (!card.querySelector(`.${SYNC_BTN_CLASS}`)) injectSyncButton(card);
    });
  }

  function findOrderCards() {
    // Try known Vinted selectors first, fall back to anchor-based discovery
    const explicit = [
      '[data-testid="transaction-item"]',
      '[class*="transaction--item"]',
      '[class*="transaction-item"]',
      '[class*="order-item"]',
      '[class*="sale-item"]',
      '[class*="feed-grid__item"]',
    ];
    for (const sel of explicit) {
      const els = [...document.querySelectorAll(sel)];
      if (els.length) return els;
    }
    // Fallback: find parent containers of /transaction/ links
    const parents = new Set();
    document.querySelectorAll('a[href*="/transaction"]').forEach((a) => {
      const parent =
        a.closest('li, article, [class*="item"], [class*="cell"]') ||
        a.parentElement;
      if (parent) parents.add(parent);
    });
    return [...parents];
  }

  function extractOrderData(card) {
    const pick = (...selectors) => {
      for (const sel of selectors) {
        const el = card.querySelector(sel);
        if (el?.textContent.trim()) return el.textContent.trim();
      }
      return null;
    };

    const link =
      card.querySelector('a[href*="/transaction"]') ||
      card.closest('a[href*="/transaction"]');
    const transactionId =
      link ? (link.href.match(/\/transactions?\/(\d+)/) || [])[1] : null;

    const rawPrice = pick(
      '[data-testid*="price"]',
      '[class*="price"]',
      '[class*="amount"]',
      '[class*="total"]'
    );
    const price = rawPrice
      ? parseFloat(rawPrice.replace(/[^0-9,\.]/g, '').replace(',', '.')) || 0
      : 0;

    return {
      transactionId,
      title: pick(
        '[data-testid*="title"]',
        '[class*="title"]',
        '[class*="item-name"]',
        'h3',
        'h4'
      ) || 'Onbekend item',
      buyer: pick(
        '[data-testid*="user"]',
        '[class*="buyer"]',
        '[class*="username"]',
        '[class*="member"]'
      ) || 'Onbekende koper',
      price,
      date: pick('[datetime]', 'time', '[class*="date"]', '[class*="time"]') ||
        new Date().toLocaleDateString('nl-BE'),
      url: link?.href || location.href,
    };
  }

  function injectSyncButton(card) {
    const btn = document.createElement('button');
    btn.className = SYNC_BTN_CLASS;
    btn.textContent = '🏠 Sync naar Vault';
    applyStyle(btn, {
      background: INDIGO,
      color: '#fff',
      border: 'none',
      borderRadius: '6px',
      padding: '5px 11px',
      fontSize: '12px',
      fontWeight: '600',
      cursor: 'pointer',
      margin: '4px 2px',
      whiteSpace: 'nowrap',
      zIndex: '9999',
      position: 'relative',
      fontFamily: 'inherit',
    });

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const order = extractOrderData(card);
      btn.textContent = '⏳ Bezig…';
      btn.disabled = true;

      chrome.runtime.sendMessage({ type: 'SYNC_ORDER', order }, (res) => {
        if (res?.success) {
          btn.textContent = res.duplicate ? '✅ Al gesynchroniseerd' : '✅ Gesynchroniseerd';
          btn.style.background = GREEN;
        } else {
          btn.textContent = '❌ Mislukt';
          btn.style.background = RED;
          setTimeout(() => {
            btn.textContent = '🏠 Sync naar Vault';
            btn.style.background = INDIGO;
            btn.disabled = false;
          }, 2500);
        }
      });
    });

    const target =
      card.querySelector('[class*="action"]') ||
      card.querySelector('[class*="button"]') ||
      card;
    target.appendChild(btn);
  }

  // ── Label page ───────────────────────────────────────────────────────────
  function addLabelButton() {
    if (document.querySelector(`.${LABEL_BTN_CLASS}`)) return;

    const btn = document.createElement('button');
    btn.className = LABEL_BTN_CLASS;
    btn.textContent = '📥 Download 4x6';
    applyStyle(btn, {
      background: INDIGO,
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      padding: '10px 20px',
      fontSize: '14px',
      fontWeight: '700',
      cursor: 'pointer',
      margin: '12px 0',
      display: 'block',
      fontFamily: 'inherit',
    });

    btn.addEventListener('click', () => {
      const pdfUrl = findLabelUrl();
      if (pdfUrl) {
        chrome.runtime.sendMessage({
          type: 'DOWNLOAD_LABEL',
          url: pdfUrl,
          filename: `label-vinted-${Date.now()}.pdf`,
        });
      } else {
        alert('Label PDF niet gevonden. Herlaad de pagina en probeer opnieuw.');
      }
    });

    const anchor =
      document.querySelector('main') ||
      document.querySelector('[role="main"]') ||
      document.querySelector('[class*="container"]') ||
      document.body;
    anchor.insertBefore(btn, anchor.firstChild);
  }

  function findLabelUrl() {
    for (const el of document.querySelectorAll('iframe')) {
      if (/pdf|label/i.test(el.src)) return el.src;
    }
    for (const el of document.querySelectorAll('a')) {
      if (/\.pdf|label/i.test(el.href)) return el.href;
    }
    // Look inside React props / __NEXT_DATA__ for a label URL
    try {
      const data = window.__NEXT_DATA__ || window.__INITIAL_STATE__;
      if (data) {
        const str = JSON.stringify(data);
        const m = str.match(/"(https?:[^"]+\.pdf[^"]*)"/);
        if (m) return m[1];
      }
    } catch (_) { /* ignore */ }
    return null;
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────
  function init() {
    const url = location.href;
    if (isOrdersPage(url)) observeOrders();
    else if (isLabelPage(url)) setTimeout(addLabelButton, 1000);
  }

  function applyStyle(el, styles) {
    Object.assign(el.style, styles);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
