(function () {
  'use strict';

  // ── Debug: runs synchronously the moment the script is injected ───────────
  console.log('[Vault] content script injected on:', location.href);

  const PANEL_ID  = 'vault-resell-panel';
  const DOT_ID    = 'vault-debug-dot';
  const INDIGO    = '#4f46e5';
  const GREEN     = '#16a34a';
  const RED       = '#dc2626';
  const DARK      = '#0f172a';
  const SURFACE   = '#1e293b';
  const BORDER    = '#334155';

  // ── Red dot: proof the script is running (visible on every Vinted page) ──
  function injectDebugDot() {
    if (document.getElementById(DOT_ID)) return;
    const dot = document.createElement('div');
    dot.id = DOT_ID;
    dot.title = 'Vault Resell Sync – actief';
    Object.assign(dot.style, {
      position:     'fixed',
      bottom:       '8px',
      right:        '8px',
      width:        '12px',
      height:       '12px',
      borderRadius: '50%',
      background:   RED,
      zIndex:       '2147483647',
      pointerEvents:'none',
      boxShadow:    '0 0 0 2px #fff',
    });
    (document.body || document.documentElement).appendChild(dot);
    console.log('[Vault] debug dot injected');
  }

  // ── Page detection ────────────────────────────────────────────────────────
  function isOrdersPage(url) {
    // Matches any URL that contains order/bestelling/purchase/sale/transaction
    return /\/(my[-_\/]?(orders?|purchases?|sales?|transactions?|bestellingen?))/i.test(url);
  }

  function isLabelPage(url) {
    return /\/(label|print[-_]label|shipment|verzending|verzendbewijs)/i.test(url);
  }

  // ── Floating panel ────────────────────────────────────────────────────────
  function createPanel() {
    if (document.getElementById(PANEL_ID)) {
      console.log('[Vault] panel already exists, skipping');
      return;
    }
    console.log('[Vault] creating panel');

    const panel = document.createElement('div');
    panel.id = PANEL_ID;

    Object.assign(panel.style, {
      position:   'fixed',
      top:        '50%',
      right:      '0',
      transform:  'translateY(-50%)',
      zIndex:     '2147483646',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize:   '13px',
      display:    'flex',
      alignItems: 'center',
    });

    panel.innerHTML = `
      <div id="vault-tab" title="Vault Resell Sync openen">🏠</div>
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

    stylePanel(panel);
    document.body.appendChild(panel);

    let open = false;
    const body  = panel.querySelector('#vault-body');
    const toggle = () => {
      open = !open;
      body.style.display = open ? 'flex' : 'none';
      console.log('[Vault] panel', open ? 'opened' : 'closed');
    };
    panel.querySelector('#vault-tab').addEventListener('click', toggle);
    panel.querySelector('#vault-close').addEventListener('click', toggle);

    panel.querySelector('#vault-scan-btn').addEventListener('click', () => {
      const status  = panel.querySelector('#vault-status');
      const results = panel.querySelector('#vault-results');
      status.textContent  = '⏳ Bezig met scannen…';
      results.innerHTML   = '';
      console.log('[Vault] scan started');

      // Give the browser a tick to repaint the status text first
      requestAnimationFrame(() => {
        const orders = extractOrdersFromPage();
        console.log('[Vault] scan found', orders.length, 'orders:', orders);
        status.textContent = orders.length
          ? `${orders.length} bestelling(en) gevonden`
          : 'Geen bestellingen gevonden – scroll de pagina en scan opnieuw.';
        renderResults(orders, results);
      });
    });
  }

  function stylePanel(panel) {
    const tab = panel.querySelector('#vault-tab');
    Object.assign(tab.style, {
      background:   INDIGO,
      color:        '#fff',
      writingMode:  'vertical-rl',
      padding:      '14px 8px',
      borderRadius: '8px 0 0 8px',
      cursor:       'pointer',
      fontSize:     '18px',
      userSelect:   'none',
      boxShadow:    '-2px 0 8px rgba(0,0,0,0.4)',
      flexShrink:   '0',
    });

    const body = panel.querySelector('#vault-body');
    Object.assign(body.style, {
      width:        '300px',
      maxHeight:    '80vh',
      background:   DARK,
      borderRadius: '12px 0 0 12px',
      boxShadow:    '-4px 0 24px rgba(0,0,0,0.5)',
      border:       `1px solid ${BORDER}`,
      borderRight:  'none',
      display:      'none',
      flexDirection:'column',
    });

    const header = panel.querySelector('#vault-header');
    Object.assign(header.style, {
      background:   INDIGO,
      color:        '#fff',
      padding:      '12px 14px',
      fontWeight:   '700',
      fontSize:     '13px',
      display:      'flex',
      justifyContent:'space-between',
      alignItems:   'center',
      borderRadius: '12px 0 0 0',
      flexShrink:   '0',
    });

    const closeBtn = panel.querySelector('#vault-close');
    Object.assign(closeBtn.style, {
      background:  'transparent',
      border:      'none',
      color:       '#fff',
      cursor:      'pointer',
      fontSize:    '14px',
      padding:     '0 2px',
      lineHeight:  '1',
    });

    const content = panel.querySelector('#vault-content');
    Object.assign(content.style, {
      padding:    '12px',
      overflowY:  'auto',
      maxHeight:  'calc(80vh - 44px)',
    });

    const scanBtn = panel.querySelector('#vault-scan-btn');
    Object.assign(scanBtn.style, {
      width:        '100%',
      background:   INDIGO,
      color:        '#fff',
      border:       'none',
      borderRadius: '8px',
      padding:      '9px 0',
      fontSize:     '13px',
      fontWeight:   '600',
      cursor:       'pointer',
      marginBottom: '10px',
    });

    Object.assign(panel.querySelector('#vault-status').style, {
      fontSize:     '11px',
      color:        '#64748b',
      marginBottom: '8px',
      minHeight:    '16px',
    });
  }

  // ── Order extraction ──────────────────────────────────────────────────────
  function extractOrdersFromPage() {
    const seen   = new Set();
    const orders = [];

    // Strategy 1 – transaction / item anchor links
    const links = [
      ...document.querySelectorAll(
        'a[href*="/transaction"], a[href*="/transactions/"], a[href*="/items/"]'
      ),
    ];
    console.log('[Vault] strategy-1 links found:', links.length);

    links.forEach((link) => {
      const href    = link.href;
      const idMatch = href.match(/\/(?:transactions?|items)\/(\d+)/);
      const key     = idMatch ? idMatch[1] : href;
      if (seen.has(key)) return;
      seen.add(key);
      const card  = getCardContainer(link);
      const order = parseCard(card, href, idMatch?.[1] ?? null);
      if (order) orders.push(order);
    });

    // Strategy 2 – data-testid blocks
    if (orders.length === 0) {
      const candidates = new Set();
      document.querySelectorAll('[data-testid]').forEach((el) => {
        if (/transaction|order|purchase|sale|item/i.test(el.dataset.testid || '')) {
          candidates.add(el);
        }
      });
      console.log('[Vault] strategy-2 testid candidates:', candidates.size);
      candidates.forEach((card) => {
        const link    = card.querySelector('a[href]');
        const href    = link?.href || location.href;
        const idMatch = href.match(/\/(?:transactions?|items)\/(\d+)/);
        const key     = idMatch ? idMatch[1] : card.textContent.slice(0, 40);
        if (seen.has(key)) return;
        seen.add(key);
        const order = parseCard(card, href, idMatch?.[1] ?? null);
        if (order) orders.push(order);
      });
    }

    // Strategy 3 – any leaf element containing a € price
    if (orders.length === 0) {
      const priceEls = [...document.querySelectorAll('*')].filter((el) => {
        if (el.children.length > 8) return false;
        const t = el.textContent.trim();
        return /€\s*\d/.test(t) && t.length < 400;
      });
      console.log('[Vault] strategy-3 price elements found:', priceEls.length);
      priceEls.forEach((el) => {
        const card  = getCardContainer(el);
        const link  = card.querySelector('a[href]');
        const href  = link?.href || location.href;
        const key   = href + '|' + card.textContent.slice(0, 30);
        if (seen.has(key)) return;
        seen.add(key);
        const order = parseCard(card, href, null);
        if (order) orders.push(order);
      });
    }

    return orders.slice(0, 50);
  }

  function getCardContainer(el) {
    let node = el;
    for (let i = 0; i < 8; i++) {
      if (!node.parentElement || node.parentElement === document.body) break;
      node = node.parentElement;
      const tag = node.tagName?.toLowerCase();
      if (['li', 'article', 'section'].includes(tag)) break;
      if (/item|card|row|transaction|order|purchase|sale|cell/i.test(node.className || '')) break;
    }
    return node;
  }

  function parseCard(card, href, transactionId) {
    if (!card) return null;
    const text = (card.innerText || card.textContent || '').trim();
    if (!text) return null;

    const priceMatch = text.match(/€\s*(\d+[,\.]\d{1,2})|(\d+[,\.]\d{1,2})\s*€/);
    const rawPrice   = priceMatch ? (priceMatch[1] || priceMatch[2]) : null;
    const price      = rawPrice ? parseFloat(rawPrice.replace(',', '.')) : null;

    const dateMatch = text.match(
      /\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{1,2}\s+(?:jan|feb|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec)[a-z]*\.?\s*\d{0,4})\b/i
    );
    const date = dateMatch ? dateMatch[0].trim() : null;

    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(
        (l) =>
          l.length > 3 &&
          l.length < 120 &&
          !/^€|^\d+[,\.]\d+\s*€?$|^(betaald|verzonden|nieuw|verkocht|te koop|geleverd|geannuleerd|afgerond|pending)/i.test(l)
      );
    const title = lines[0] || 'Onbekend item';

    if (!price && !transactionId) return null;

    return {
      transactionId,
      title,
      price:  price || 0,
      date:   date || new Date().toLocaleDateString('nl-BE'),
      url:    href,
    };
  }

  // ── Render results inside panel ───────────────────────────────────────────
  function renderResults(orders, container) {
    orders.forEach((order) => {
      const card = document.createElement('div');
      Object.assign(card.style, {
        background:   SURFACE,
        borderRadius: '8px',
        padding:      '10px',
        marginBottom: '8px',
        border:       `1px solid ${BORDER}`,
      });

      const titleEl = document.createElement('div');
      titleEl.textContent = order.title;
      Object.assign(titleEl.style, {
        fontWeight:    '600',
        color:         '#f1f5f9',
        fontSize:      '12px',
        marginBottom:  '3px',
        whiteSpace:    'nowrap',
        overflow:      'hidden',
        textOverflow:  'ellipsis',
        cursor:        order.url !== location.href ? 'pointer' : 'default',
      });
      if (order.url && order.url !== location.href) {
        titleEl.title = 'Openen in nieuw tabblad';
        titleEl.addEventListener('click', () => window.open(order.url, '_blank'));
      }

      const meta = document.createElement('div');
      meta.textContent = [
        order.price ? `€${order.price.toFixed(2).replace('.', ',')}` : null,
        order.date,
        order.transactionId ? `#${order.transactionId}` : null,
      ].filter(Boolean).join(' · ');
      Object.assign(meta.style, {
        fontSize:     '11px',
        color:        '#64748b',
        marginBottom: '8px',
      });

      const btn = document.createElement('button');
      btn.textContent = '🏠 Sync naar Vault';
      Object.assign(btn.style, {
        width:        '100%',
        background:   INDIGO,
        color:        '#fff',
        border:       'none',
        borderRadius: '6px',
        padding:      '6px 0',
        fontSize:     '12px',
        fontWeight:   '600',
        cursor:       'pointer',
      });
      btn.addEventListener('click', () => {
        btn.textContent = '⏳ Bezig…';
        btn.disabled = true;
        chrome.runtime.sendMessage({ type: 'SYNC_ORDER', order }, (res) => {
          if (res?.success) {
            btn.textContent    = res.duplicate ? '✅ Al opgeslagen' : '✅ Gesynchroniseerd';
            btn.style.background = GREEN;
          } else {
            btn.textContent    = '❌ Mislukt';
            btn.style.background = RED;
            setTimeout(() => {
              btn.textContent    = '🏠 Sync naar Vault';
              btn.style.background = INDIGO;
              btn.disabled = false;
            }, 2500);
          }
        });
      });

      card.appendChild(titleEl);
      card.appendChild(meta);
      card.appendChild(btn);
      container.appendChild(card);
    });
  }

  // ── Label page: floating download button ──────────────────────────────────
  function addLabelButton() {
    if (document.getElementById('vault-label-btn')) return;
    console.log('[Vault] adding label download button');

    const btn = document.createElement('button');
    btn.id = 'vault-label-btn';
    btn.textContent = '📥 Download 4x6';
    Object.assign(btn.style, {
      position:     'fixed',
      bottom:       '30px',
      right:        '30px',
      zIndex:       '2147483647',
      background:   INDIGO,
      color:        '#fff',
      border:       'none',
      borderRadius: '10px',
      padding:      '12px 22px',
      fontSize:     '14px',
      fontWeight:   '700',
      cursor:       'pointer',
      boxShadow:    '0 4px 16px rgba(79,70,229,0.5)',
      fontFamily:   'inherit',
    });

    btn.addEventListener('click', () => {
      const url = findLabelUrl();
      console.log('[Vault] label URL found:', url);
      if (url) {
        chrome.runtime.sendMessage({
          type: 'DOWNLOAD_LABEL',
          url,
          filename: `label-vinted-${Date.now()}.pdf`,
        });
        btn.textContent    = '✅ Downloaden…';
        btn.style.background = GREEN;
      } else {
        btn.textContent    = '❌ PDF niet gevonden';
        btn.style.background = RED;
        setTimeout(() => {
          btn.textContent    = '📥 Download 4x6';
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
    console.log('[Vault] init() called for:', url);

    // Red dot on every Vinted page
    injectDebugDot();

    if (isOrdersPage(url) && !panelCreated) {
      panelCreated = true;
      console.log('[Vault] orders page detected, creating panel');
      createPanel();
    }

    if (isLabelPage(url) && !labelCreated) {
      labelCreated = true;
      addLabelButton();
    }
  }

  // SPA navigation watcher – runs immediately, no delay
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      console.log('[Vault] URL changed:', lastUrl, '→', url);
      lastUrl      = url;
      panelCreated = false;
      labelCreated = false;
      // Small delay only to let the SPA render the new page skeleton
      setTimeout(init, 300);
    }
  }).observe(document, { subtree: true, childList: true });

  // Run immediately — document_idle means DOM is already ready
  init();
})();
