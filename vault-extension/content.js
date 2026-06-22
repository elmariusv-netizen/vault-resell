(function () {
  'use strict';

  const PANEL_ID = 'vault-resell-panel';
  const INDIGO = '#4f46e5';
  const GREEN = '#16a34a';
  const RED = '#dc2626';
  const DARK = '#0f172a';
  const SURFACE = '#1e293b';
  const BORDER = '#334155';

  // ── Page detection ───────────────────────────────────────────────────────
  function isTargetPage(url) {
    return /\/(my-purchases|my-sales|my\/sales|my\/purchases|my\/orders|my\/transactions|my-orders)/.test(url);
  }

  function isLabelPage(url) {
    return /\/(label|print-label|shipment|verzending|verzendbewijs)/.test(url);
  }

  // ── Floating panel ───────────────────────────────────────────────────────
  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div id="vault-tab" title="Vault Resell Sync">🏠</div>
      <div id="vault-body">
        <div id="vault-header">
          <span>🏠 Vault Resell Sync</span>
          <button id="vault-close" title="Sluiten">✕</button>
        </div>
        <div id="vault-content">
          <button id="vault-scan-btn">🔍 Scan bestellingen</button>
          <div id="vault-status"></div>
          <div id="vault-results"></div>
        </div>
      </div>
    `;

    // Panel wrapper styles
    Object.assign(panel.style, {
      position: 'fixed',
      top: '50%',
      right: '0',
      transform: 'translateY(-50%)',
      zIndex: '2147483647',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize: '13px',
      display: 'flex',
      alignItems: 'center',
    });

    const tab = panel.querySelector('#vault-tab');
    Object.assign(tab.style, {
      background: INDIGO,
      color: '#fff',
      writingMode: 'vertical-rl',
      padding: '14px 8px',
      borderRadius: '8px 0 0 8px',
      cursor: 'pointer',
      fontSize: '18px',
      userSelect: 'none',
      boxShadow: '-2px 0 8px rgba(0,0,0,0.4)',
    });

    const body = panel.querySelector('#vault-body');
    Object.assign(body.style, {
      width: '300px',
      maxHeight: '80vh',
      background: DARK,
      borderRadius: '12px 0 0 12px',
      boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
      border: `1px solid ${BORDER}`,
      borderRight: 'none',
      display: 'none',
      flexDirection: 'column',
    });

    const header = panel.querySelector('#vault-header');
    Object.assign(header.style, {
      background: INDIGO,
      color: '#fff',
      padding: '12px 14px',
      fontWeight: '700',
      fontSize: '13px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderRadius: '12px 0 0 0',
      flexShrink: '0',
    });

    const closeBtn = panel.querySelector('#vault-close');
    Object.assign(closeBtn.style, {
      background: 'transparent',
      border: 'none',
      color: '#fff',
      cursor: 'pointer',
      fontSize: '14px',
      padding: '0 2px',
      lineHeight: '1',
    });

    const content = panel.querySelector('#vault-content');
    Object.assign(content.style, {
      padding: '12px',
      overflowY: 'auto',
      maxHeight: 'calc(80vh - 44px)',
    });

    const scanBtn = panel.querySelector('#vault-scan-btn');
    Object.assign(scanBtn.style, {
      width: '100%',
      background: INDIGO,
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      padding: '9px 0',
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
      marginBottom: '10px',
    });

    const status = panel.querySelector('#vault-status');
    Object.assign(status.style, {
      fontSize: '11px',
      color: '#64748b',
      marginBottom: '8px',
      minHeight: '16px',
    });

    document.body.appendChild(panel);

    // ── Toggle open/close via tab ────────────────────────────────────────
    let open = false;
    const toggle = () => {
      open = !open;
      body.style.display = open ? 'flex' : 'none';
    };
    tab.addEventListener('click', toggle);
    closeBtn.addEventListener('click', toggle);

    // ── Scan button ──────────────────────────────────────────────────────
    scanBtn.addEventListener('click', () => {
      status.textContent = '⏳ Bezig met scannen…';
      panel.querySelector('#vault-results').innerHTML = '';
      setTimeout(() => {
        const orders = extractOrdersFromPage();
        status.textContent = orders.length
          ? `${orders.length} bestelling(en) gevonden`
          : 'Geen bestellingen gevonden. Scroll eerst de pagina.';
        renderResults(orders, panel.querySelector('#vault-results'));
      }, 200);
    });
  }

  // ── Order extraction ─────────────────────────────────────────────────────
  function extractOrdersFromPage() {
    const orders = [];
    const seen = new Set();

    // Strategy 1: find all links that point to transactions or item pages
    const transactionLinks = [
      ...document.querySelectorAll(
        'a[href*="/transaction"], a[href*="/transactions/"], a[href*="/items/"]'
      ),
    ];

    transactionLinks.forEach((link) => {
      const href = link.href;
      const idMatch = href.match(/\/(?:transactions?|items)\/(\d+)/);
      const id = idMatch ? idMatch[1] : href;
      if (seen.has(id)) return;
      seen.add(id);

      // Walk up to find the card container (max 6 levels)
      const card = getCardContainer(link);
      const order = parseCard(card, href, idMatch ? idMatch[1] : null);
      if (order) orders.push(order);
    });

    // Strategy 2: data-testid blocks
    if (orders.length === 0) {
      const testidEls = document.querySelectorAll('[data-testid]');
      const cardCandidates = new Set();
      testidEls.forEach((el) => {
        const tid = el.getAttribute('data-testid') || '';
        if (/transaction|order|purchase|sale|item/.test(tid)) {
          cardCandidates.add(el);
        }
      });
      cardCandidates.forEach((card) => {
        const link = card.querySelector('a[href]');
        const href = link ? link.href : location.href;
        const idMatch = href.match(/\/(?:transactions?|items)\/(\d+)/);
        const id = idMatch ? idMatch[1] : card.textContent.slice(0, 40);
        if (seen.has(id)) return;
        seen.add(id);
        const order = parseCard(card, href, idMatch ? idMatch[1] : null);
        if (order) orders.push(order);
      });
    }

    // Strategy 3: grid/list items containing a price
    if (orders.length === 0) {
      const priceEls = [...document.querySelectorAll('*')].filter((el) => {
        if (el.children.length > 6) return false;
        const t = el.textContent.trim();
        return /€\s*\d/.test(t) && t.length < 300;
      });
      priceEls.forEach((el) => {
        const card = getCardContainer(el);
        const link = card.querySelector('a[href]');
        const href = link ? link.href : location.href;
        const id = href + card.textContent.slice(0, 30);
        if (seen.has(id)) return;
        seen.add(id);
        const order = parseCard(card, href, null);
        if (order) orders.push(order);
      });
    }

    return orders.slice(0, 50);
  }

  function getCardContainer(el) {
    let node = el;
    for (let i = 0; i < 8; i++) {
      if (!node.parentElement) break;
      node = node.parentElement;
      const tag = node.tagName?.toLowerCase();
      if (['li', 'article', 'section'].includes(tag)) break;
      const cls = node.className || '';
      if (
        /item|card|row|transaction|order|purchase|sale|cell/i.test(cls) &&
        node !== document.body
      ) break;
    }
    return node;
  }

  function parseCard(card, href, transactionId) {
    if (!card) return null;
    const text = card.innerText || card.textContent || '';
    if (!text.trim()) return null;

    // Price: match €12,50 or 12,50 € or €12.50
    const priceMatch = text.match(/€\s*(\d+[,\.]\d{1,2})|(\d+[,\.]\d{1,2})\s*€/);
    const rawPrice = priceMatch ? (priceMatch[1] || priceMatch[2]) : null;
    const price = rawPrice
      ? parseFloat(rawPrice.replace(',', '.'))
      : null;

    // Date: dd/mm/yy, dd-mm-yyyy, "12 jan", "12 januari 2024", or ISO
    const dateMatch = text.match(
      /\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{1,2}\s+(?:jan|feb|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec)[a-z]*\.?\s*\d{0,4})\b/i
    );
    const date = dateMatch ? dateMatch[0].trim() : null;

    // Title: first substantial line that is not a price/date/status word
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(
        (l) =>
          l.length > 3 &&
          l.length < 120 &&
          !/^€|^\d+[,\.]\d+$|^(betaald|verzonden|nieuw|verkocht|te koop|geleverd|geannuleerd|afgerond|pending)/i.test(l)
      );
    const title = lines[0] || 'Onbekend item';

    // Skip cards with no price and no transaction link
    if (!price && !transactionId) return null;

    return {
      transactionId,
      title,
      price: price || 0,
      date: date || new Date().toLocaleDateString('nl-BE'),
      url: href,
    };
  }

  // ── Render order results in panel ─────────────────────────────────────────
  function renderResults(orders, container) {
    if (orders.length === 0) return;

    orders.forEach((order) => {
      const card = document.createElement('div');
      Object.assign(card.style, {
        background: SURFACE,
        borderRadius: '8px',
        padding: '10px',
        marginBottom: '8px',
        border: `1px solid ${BORDER}`,
      });

      const title = document.createElement('div');
      title.textContent = order.title;
      Object.assign(title.style, {
        fontWeight: '600',
        color: '#f1f5f9',
        fontSize: '12px',
        marginBottom: '3px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      });

      const meta = document.createElement('div');
      meta.textContent = [
        order.price ? `€${order.price.toFixed(2).replace('.', ',')}` : null,
        order.date,
        order.transactionId ? `#${order.transactionId}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      Object.assign(meta.style, {
        fontSize: '11px',
        color: '#64748b',
        marginBottom: '8px',
      });

      const btn = document.createElement('button');
      btn.textContent = '🏠 Sync naar Vault';
      Object.assign(btn.style, {
        width: '100%',
        background: INDIGO,
        color: '#fff',
        border: 'none',
        borderRadius: '6px',
        padding: '6px 0',
        fontSize: '12px',
        fontWeight: '600',
        cursor: 'pointer',
      });

      btn.addEventListener('click', () => {
        btn.textContent = '⏳ Bezig…';
        btn.disabled = true;
        chrome.runtime.sendMessage({ type: 'SYNC_ORDER', order }, (res) => {
          if (res?.success) {
            btn.textContent = res.duplicate ? '✅ Al opgeslagen' : '✅ Gesynchroniseerd';
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

      if (order.url && order.url !== location.href) {
        title.style.cursor = 'pointer';
        title.title = 'Openen in nieuw tabblad';
        title.addEventListener('click', () => window.open(order.url, '_blank'));
      }

      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(btn);
      container.appendChild(card);
    });
  }

  // ── Label page: floating download button ──────────────────────────────────
  function addLabelButton() {
    if (document.getElementById('vault-label-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'vault-label-btn';
    btn.textContent = '📥 Download 4x6';
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: '2147483647',
      background: INDIGO,
      color: '#fff',
      border: 'none',
      borderRadius: '10px',
      padding: '12px 22px',
      fontSize: '14px',
      fontWeight: '700',
      cursor: 'pointer',
      boxShadow: '0 4px 16px rgba(79,70,229,0.5)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    });

    btn.addEventListener('click', () => {
      const url = findLabelUrl();
      if (url) {
        chrome.runtime.sendMessage({
          type: 'DOWNLOAD_LABEL',
          url,
          filename: `label-vinted-${Date.now()}.pdf`,
        });
        btn.textContent = '✅ Downloaden…';
        btn.style.background = GREEN;
      } else {
        btn.textContent = '❌ PDF niet gevonden';
        btn.style.background = RED;
        setTimeout(() => {
          btn.textContent = '📥 Download 4x6';
          btn.style.background = INDIGO;
        }, 2500);
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

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  let panelCreated = false;
  let labelCreated = false;

  function init() {
    const url = location.href;
    if (isTargetPage(url) && !panelCreated) {
      panelCreated = true;
      createPanel();
    }
    if (isLabelPage(url) && !labelCreated) {
      labelCreated = true;
      setTimeout(addLabelButton, 800);
    }
  }

  // Watch for SPA navigation
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      panelCreated = false;
      labelCreated = false;
      setTimeout(init, 700);
    }
  }).observe(document, { subtree: true, childList: true });

  // Wait for page to settle before first init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 500));
  } else {
    setTimeout(init, 500);
  }
})();
