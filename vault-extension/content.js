(function () {
  'use strict';

  // ── Design tokens ──────────────────────────────────────────────────────────
  const D = {
    bg:     '#f9fafb',
    card:   '#ffffff',
    text:   '#111111',
    sub:    '#9ca3af',
    accent: '#6366f1',
    badge:  '#f3f4f6',
    font:   '-apple-system,"SF Pro Display","Inter","Segoe UI",sans-serif',
  };

  // ── Constants ──────────────────────────────────────────────────────────────
  const OV_ID  = 'vault-overlay';
  const BTN_ID = 'vault-fab';

  // ── Runtime state ──────────────────────────────────────────────────────────
  let overlayOpen = false;
  let activeTab   = 'zoekertjes';
  let syncedIds = new Set();
  let dlIds     = new Set();

  // In-memory cache (backed by chrome.storage.session where available)
  const mem = {};

  // ── Cache helpers ──────────────────────────────────────────────────────────
  async function cGet(k) {
    if (k in mem) return mem[k];
    try {
      const d = await chrome.storage.session.get([k]);
      return (mem[k] = d[k] ?? null);
    } catch { return null; }
  }
  async function cSet(k, v) {
    mem[k] = v;
    try { await chrome.storage.session.set({ [k]: v }); } catch {}
  }
  function cClear() {
    Object.keys(mem).forEach(k => delete mem[k]);
    try { chrome.storage.session.clear(); } catch {}
  }

  // ── Formatters ─────────────────────────────────────────────────────────────
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const fmt$ = v => { const n = parseFloat(v || 0); return n > 0 ? `€${n.toFixed(2).replace('.', ',')}` : '—'; };
  const fmtD = s => {
    if (!s) return '';
    const d = new Date(s);
    return isNaN(d) ? s.slice(0,10) : d.toLocaleDateString('nl-BE', { day:'2-digit', month:'short', year:'2-digit' });
  };

  // ── API ────────────────────────────────────────────────────────────────────
  function getVintedHeaders() {
    const csrf = document.cookie.match(/(?:^|;\s*)_vinted_csrf_token=([^;]+)/)?.[1]
      || document.querySelector('meta[name="csrf-token"]')?.content
      || '';
    const anonId = document.cookie.match(/(?:^|;\s*)_vinted_anon_id=([^;]+)/)?.[1] || '';
    return {
      'accept':        'application/json,text/plain,*/*,image/webp',
      'locale':        'nl-BE',
      'x-csrf-token':  csrf,
      'x-anon-id':     anonId,
    };
  }

  async function vGet(path) {
    const r = await fetch(`https://www.vinted.be${path}`, {
      credentials: 'include',
      headers: getVintedHeaders(),
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${path}`);
    return r.json();
  }

  async function getListings() {
    const c = await cGet('v_list'); if (c) return c;

    const endpoints = [
      '/api/v2/catalog/items?user_id=48695306&page=1&per_page=50',
      '/api/v2/my/items?per_page=50',
      '/api/v2/users/48695306/items?per_page=50',
    ];

    let raw = [];
    for (const path of endpoints) {
      try {
        const d = await vGet(path);
        raw = d.items || d.wardrobe_items || d.catalog_items || [];
        console.log(`[Vault] listings via ${path}: ${raw.length} items`, Object.keys(d));
        if (raw.length) break;
      } catch (e) {
        console.warn(`[Vault] listings failed (${path}):`, e.message);
      }
    }

    const items = raw.map(o => ({
      itemId: String(o.id || ''),
      title:  o.title || '?',
      photo:  o.photos?.[0]?.url || o.photo?.url || null,
      price:  parseFloat(o.price?.amount || o.price || 0),
      views:  o.view_count || o.stats?.views || 0,
      status: o.status || 'active',
      date:   (o.created_at || '').slice(0, 10),
      url:    o.url || `https://www.vinted.be/items/${o.id}`,
    }));

    await cSet('v_list', items);
    return items;
  }

  async function getSold() {
    const c = await cGet('v_sold'); if (c) return c;
    const d = await vGet('/api/v2/my_orders?order_type=sold&per_page=50');
    console.log('[Vault] sold sample:', JSON.stringify((d.orders || d.transactions || [])[0] || {}).slice(0, 400));
    const orders = (d.orders || d.transactions || []).map(o => ({
      transactionId: String(o.transaction_id || o.id || ''),
      itemId:  String(o.item?.id || ''),
      title:   o.item?.title || o.title || '?',
      photo:   o.item?.photos?.[0]?.url || o.item?.photo?.url || null,
      price:   parseFloat(o.total_price || o.price || 0),
      buyer:   o.buyer?.login  || o.user?.login  || '',
      country: o.buyer?.country_iso_code || o.country_iso_code || '',
      date:    (o.created_at || '').slice(0, 10),
      convId:  null,
    }));
    await cSet('v_sold', orders);
    return orders;
  }

  async function getPurchased() {
    const c = await cGet('v_buy'); if (c) return c;
    const d = await vGet('/api/v2/my_orders?order_type=purchased&per_page=50');
    const orders = (d.orders || d.transactions || []).map(o => ({
      transactionId: String(o.transaction_id || o.id || ''),
      title:  o.item?.title || o.title || '?',
      photo:  o.item?.photos?.[0]?.url || o.item?.photo?.url || null,
      price:  parseFloat(o.total_price || o.price || 0),
      seller: o.seller?.login || o.user?.login || '',
      date:   (o.created_at || '').slice(0, 10),
    }));
    await cSet('v_buy', orders);
    return orders;
  }

  async function getConversations() {
    const c = await cGet('v_convs'); if (c) return c;
    const d = await vGet('/api/v2/conversations?per_page=100');
    const threads = d.threads || d.conversations || [];
    await cSet('v_convs', threads);
    return threads;
  }

  // ── Label discovery via conversation messages ──────────────────────────────

  // Scan a messages array for any shipping-label PDF URL
  function extractLabelUrl(messages) {
    for (const msg of messages) {
      // Explicit entity type
      if (/shipping_label|label|file|attachment/i.test(msg.entity_type || '')) {
        const u = msg.entity?.url || msg.entity?.label_url || msg.entity?.file_url;
        if (u) return u;
      }
      // Context object (system messages often carry the URL here)
      const ctx = msg.context || {};
      const ctxUrl = ctx.shipping_label_url || ctx.label_url || ctx.document_url || ctx.url;
      if (ctxUrl && /pdf_label|\.pdf|label/i.test(ctxUrl)) return ctxUrl;
      // Inline entity URL
      const eUrl = msg.entity?.url;
      if (eUrl && /pdf_label|\.pdf/i.test(eUrl)) return eUrl;
      // Attachments array
      for (const att of (msg.attachments || [])) {
        const u = att.url || att.file_url;
        if (u && /pdf_label|\.pdf/i.test(u)) return u;
      }
      // Body text — last resort, extract first PDF-looking URL
      if (msg.body) {
        const m = msg.body.match(/https?:\/\/\S+(?:pdf_label|\.pdf)\S*/i);
        if (m) return m[0];
      }
    }
    return null;
  }

  // Scan all conversations that match a sold order, return Map<transactionId, {url, convId}>
  async function scanConvsForLabels(soldOrders) {
    const found = new Map();
    let threads;
    try { threads = await getConversations(); } catch { return found; }

    // itemId → order lookup
    const byItemId = new Map(soldOrders.filter(o => o.itemId).map(o => [o.itemId, o]));

    for (const thread of threads) {
      const itemId = String(thread.item?.id || '');
      const order  = byItemId.get(itemId);
      if (!order || found.has(order.transactionId)) continue;

      try {
        const d   = await vGet(`/api/v2/conversations/${thread.id}/messages`);
        const url = extractLabelUrl(d.messages || []);
        if (url) {
          console.log('[Vault] label in chat', thread.id, '→ txn', order.transactionId, url);
          found.set(order.transactionId, { url, convId: thread.id });
        }
      } catch (e) {
        console.warn('[Vault] conv messages failed', thread.id, e.message);
      }
    }

    return found;
  }

  // Enrich sold orders with buyer + date from conversations (run async after first render)
  async function enrichSold(orders) {
    let threads;
    try { threads = await getConversations(); } catch { return; }
    const byItemId = new Map(threads.filter(t => t.item?.id).map(t => [String(t.item.id), t]));
    let changed = false;
    for (const o of orders) {
      const t = byItemId.get(o.itemId);
      if (!t) continue;
      if (!o.buyer   && t.with_user?.login) { o.buyer  = t.with_user.login; changed = true; }
      if (!o.date    && t.created_at)        { o.date   = t.created_at.slice(0, 10); changed = true; }
      if (!o.convId)                          { o.convId = t.id; changed = true; }
    }
    if (changed) await cSet('v_sold', orders);
  }

  // ── Supabase sync ──────────────────────────────────────────────────────────
  function sendMsg(msg, ms = 10000) {
    return Promise.race([
      new Promise(res => {
        chrome.runtime.sendMessage(msg, r => {
          if (chrome.runtime.lastError) res({ success: false });
          else res(r || { success: false });
        });
      }),
      new Promise(res => setTimeout(() => res({ success: false, timeout: true }), ms)),
    ]);
  }

  async function autoSync(orders) {
    const { syncedOrders = [] } = await chrome.storage.local.get(['syncedOrders']);
    syncedIds = new Set(syncedOrders.map(o => o.transactionId).filter(Boolean));
    for (const o of orders) {
      if (!o.transactionId || syncedIds.has(o.transactionId)) continue;
      const res = await sendMsg({ type: 'SYNC_ORDER', order: { ...o, labelUrl: labelUrl(o.transactionId) } });
      if (res?.success && !res.duplicate) syncedIds.add(o.transactionId);
    }
  }

  async function loadDlIds() {
    const { interceptedLabels = [] } = await chrome.storage.local.get(['interceptedLabels']);
    dlIds = new Set(interceptedLabels.map(l => l.orderId).filter(Boolean));
  }

  function labelUrl(txId) {
    return `https://www.vinted.be/api/v2/transactions/${txId}/shipment/pdf_label`;
  }

  // ── Toast ──────────────────────────────────────────────────────────────────
  function toast(msg, ok = true) {
    document.getElementById('vlt-toast')?.remove();
    const t = document.createElement('div');
    t.id = 'vlt-toast';
    t.textContent = msg;
    Object.assign(t.style, {
      position: 'fixed', bottom: '28px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '2147483647', background: ok ? '#111' : '#dc2626', color: '#fff',
      padding: '10px 22px', borderRadius: '12px', fontSize: '13px', fontWeight: '500',
      boxShadow: '0 4px 24px rgba(0,0,0,0.25)', opacity: '1', transition: 'opacity 0.3s',
      fontFamily: D.font, whiteSpace: 'nowrap', letterSpacing: '0.01em',
    });
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
  }

  // ── Inject CSS (shimmer animation + hover) ─────────────────────────────────
  function injectCSS() {
    if (document.getElementById('vlt-css')) return;
    const s = document.createElement('style');
    s.id = 'vlt-css';
    s.textContent = `
      @keyframes vlt-sh {
        0%{background-position:-400px 0}100%{background-position:400px 0}
      }
      .vlt-sk {
        background:linear-gradient(90deg,#f3f4f6 25%,#e9e9e9 50%,#f3f4f6 75%);
        background-size:400px 100%;animation:vlt-sh 1.4s ease-in-out infinite;border-radius:6px;
      }
      .vlt-row { transition: background 0.1s; }
      .vlt-row:hover { background: #fafafa !important; }
      #${OV_ID} label:hover { background: #fafafa !important; }
      .vlt-btn:hover { opacity:0.88; }
      .vlt-btn:active { transform:scale(0.97); }
    `;
    document.head.appendChild(s);
  }

  // ── UI primitives ──────────────────────────────────────────────────────────
  function el(tag, css, html) {
    const e = document.createElement(tag);
    if (css)  e.style.cssText = css;
    if (html) e.innerHTML = html;
    return e;
  }

  function photoThumb(src) {
    if (src) {
      const img = document.createElement('img');
      img.src = src; img.loading = 'lazy';
      img.style.cssText = 'width:48px;height:48px;border-radius:8px;object-fit:cover;flex-shrink:0';
      img.onerror = () => { img.replaceWith(photoThumb(null)); };
      return img;
    }
    return el('div',
      `width:48px;height:48px;border-radius:8px;background:#f3f4f6;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:20px`,
      '📦');
  }

  function textStack(title, sub) {
    const d = el('div', 'flex:1;min-width:0');
    d.innerHTML = `
      <div style="font-size:13px;font-weight:500;color:${D.text};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3">${esc(title)}</div>
      ${sub ? `<div style="font-size:11px;color:${D.sub};margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(sub)}</div>` : ''}`;
    return d;
  }

  function priceTag(v) {
    return el('div', `font-size:14px;font-weight:600;color:${D.text};flex-shrink:0;text-align:right;min-width:52px`, esc(fmt$(v)));
  }

  function pill(text, color, bg) {
    return el('span',
      `font-size:11px;font-weight:500;padding:3px 9px;border-radius:20px;background:${bg};color:${color};flex-shrink:0;white-space:nowrap`,
      esc(text));
  }

  function btn(label, style) {
    const b = document.createElement('button');
    b.textContent = label; b.className = 'vlt-btn';
    b.style.cssText = `border:none;border-radius:10px;padding:10px 18px;font-size:13px;font-weight:500;cursor:pointer;font-family:${D.font};${style}`;
    return b;
  }

  function cardWrap(rows) {
    const d = el('div', `background:${D.card};border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.07);margin-bottom:16px`);
    rows.forEach(r => d.appendChild(r));
    return d;
  }

  function sectionHead(title, count) {
    return el('div', 'margin-bottom:14px;margin-top:4px',
      `<h2 style="margin:0;font-size:16px;font-weight:600;color:${D.text};display:inline">${esc(title)}</h2>` +
      (count != null ? `<span style="margin-left:8px;font-size:12px;color:${D.sub}">${count}</span>` : ''));
  }

  function rowDiv(children, borderBottom = true) {
    const r = el('div', `display:flex;align-items:center;gap:13px;padding:12px 16px;${borderBottom ? `border-bottom:1px solid #f9fafb;` : ''}`);
    r.className = 'vlt-row';
    children.forEach(c => c && r.appendChild(c));
    return r;
  }

  function skeletonList(n = 7) {
    const wrap = el('div', `background:${D.card};border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.07)`);
    for (let i = 0; i < n; i++) {
      const r = el('div', `display:flex;align-items:center;gap:13px;padding:12px 16px;${i < n-1 ? 'border-bottom:1px solid #f9fafb;' : ''}`);
      r.innerHTML = `
        <div class="vlt-sk" style="width:48px;height:48px;border-radius:8px;flex-shrink:0"></div>
        <div style="flex:1"><div class="vlt-sk" style="height:13px;width:58%;margin-bottom:8px"></div><div class="vlt-sk" style="height:11px;width:38%"></div></div>
        <div class="vlt-sk" style="height:14px;width:48px"></div>`;
      wrap.appendChild(r);
    }
    return wrap;
  }

  function emptyState(icon, title, sub) {
    return el('div',
      `display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:260px;color:${D.sub};text-align:center;gap:8px;padding:32px`,
      `<div style="font-size:40px">${icon}</div>
       <div style="font-size:15px;font-weight:600;color:#374151">${esc(title)}</div>
       <div style="font-size:12px;line-height:1.6">${esc(sub)}</div>`);
  }

  function errorState(msg, retry) {
    const d = el('div',
      `background:${D.card};border-radius:16px;padding:32px;box-shadow:0 1px 4px rgba(0,0,0,0.07);text-align:center`,
      `<div style="font-size:32px;margin-bottom:10px">⚠️</div>
       <div style="font-size:14px;font-weight:600;color:#374151;margin-bottom:4px">API fout</div>
       <div style="font-size:12px;color:${D.sub};margin-bottom:18px">${esc(msg)}</div>`);
    const b = btn('Opnieuw proberen', `background:${D.accent};color:#fff`);
    b.addEventListener('click', retry);
    d.appendChild(b);
    return d;
  }

  // ── Overlay shell ──────────────────────────────────────────────────────────
  function buildOverlay() {
    if (document.getElementById(OV_ID)) return;
    injectCSS();

    const ov = el('div', `position:fixed;inset:0;z-index:2147483646;background:${D.bg};display:flex;flex-direction:column;font-family:${D.font};opacity:0;transition:opacity 0.2s ease`);
    ov.id = OV_ID;

    // Header
    const hdr = el('div', `background:${D.card};padding:0 28px;height:58px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;box-shadow:0 1px 0 #f3f4f6`);
    hdr.innerHTML = `<span style="font-size:18px;font-weight:700;letter-spacing:0.15em;color:${D.text}">VAULT</span>`;
    const closeBtn = btn('✕', `background:none;color:${D.sub};font-size:20px;padding:6px 8px;border-radius:8px`);
    closeBtn.addEventListener('click', () => toggleOverlay(false));
    hdr.appendChild(closeBtn);

    // Tab bar
    const tabBar = el('div', `background:${D.card};padding:10px 20px;display:flex;gap:6px;flex-shrink:0;border-bottom:1px solid #f3f4f6`);
    const TABS = [
      { id:'zoekertjes', label:'🏪 Listings'  },
      { id:'verkopen',   label:'📦 Verkopen'  },
      { id:'aankopen',   label:'🛍 Aankopen'  },
      { id:'labels',     label:'🏷 Labels'    },
    ];
    TABS.forEach(({ id, label }) => {
      const t = btn(label, `background:transparent;color:#6b7280;padding:7px 14px;border-radius:8px;transition:all 0.15s`);
      t.dataset.tab = id;
      t.addEventListener('click', () => switchTab(id));
      tabBar.appendChild(t);
    });

    // Content
    const content = el('div', `flex:1;overflow-y:auto;padding:20px 28px`);
    content.id = 'vlt-content';

    // Footer
    const footer = el('div', `background:${D.card};padding:12px 28px;display:flex;gap:10px;flex-shrink:0;box-shadow:0 -1px 0 #f3f4f6`);
    footer.id = 'vlt-footer';

    ov.append(hdr, tabBar, content, footer);
    document.body.appendChild(ov);
  }

  function setTabStyle(id) {
    document.querySelectorAll(`#${OV_ID} [data-tab]`).forEach(t => {
      const on = t.dataset.tab === id;
      t.style.background = on ? D.accent : 'transparent';
      t.style.color      = on ? '#fff'   : '#6b7280';
    });
  }

  async function switchTab(id) {
    activeTab = id;
    setTabStyle(id);
    const content = document.getElementById('vlt-content');
    const footer  = document.getElementById('vlt-footer');
    if (!content || !footer) return;
    content.innerHTML = '';
    footer.innerHTML  = '';
    content.appendChild(skeletonList());
    try {
      if (id === 'zoekertjes') await tabZoekertjes(content, footer);
      if (id === 'verkopen')   await tabVerkopen(content, footer);
      if (id === 'aankopen')   await tabAankopen(content, footer);
      if (id === 'labels')     await tabLabels(content, footer);
    } catch (err) {
      console.error('[Vault]', err);
      content.innerHTML = '';
      content.appendChild(errorState(err.message, () => switchTab(id)));
    }
  }

  function toggleOverlay(force) {
    buildOverlay();
    overlayOpen = force !== undefined ? force : !overlayOpen;
    const ov = document.getElementById(OV_ID);
    if (!ov) return;
    if (overlayOpen) {
      ov.style.display = 'flex';
      requestAnimationFrame(() => { ov.style.opacity = '1'; });
      switchTab(activeTab);
    } else {
      ov.style.opacity = '0';
      setTimeout(() => { ov.style.display = 'none'; }, 200);
    }
  }

  // ── Tab: Listings ──────────────────────────────────────────────────────────
  async function tabZoekertjes(content, footer) {
    const items = await getListings();
    content.innerHTML = '';
    if (!items.length) { content.appendChild(emptyState('🏪', 'Geen actieve listings', 'Geen actieve advertenties gevonden.')); return; }

    content.appendChild(sectionHead('Actieve listings', `${items.length} items`));
    const rows = items.map((o, i) => {
      const statusBadge = o.status === 'active'
        ? pill('Actief', '#15803d', '#dcfce7')
        : pill(o.status, '#6b7280', '#f3f4f6');
      const views = el('div', `font-size:11px;color:${D.sub};flex-shrink:0`, o.views ? `👁 ${o.views}` : '');
      const r = rowDiv([photoThumb(o.photo), textStack(o.title, fmtD(o.date)), views, priceTag(o.price), statusBadge], i < items.length - 1);
      r.style.cursor = 'pointer';
      r.addEventListener('click', () => window.open(o.url, '_blank'));
      return r;
    });
    content.appendChild(cardWrap(rows));
  }

  // ── Tab: Verkopen ──────────────────────────────────────────────────────────
  async function tabVerkopen(content, footer) {
    const orders = await getSold();
    content.innerHTML = '';
    if (!orders.length) { content.appendChild(emptyState('📦', 'Geen verkopen', 'Nog geen verkopen gevonden.')); return; }

    drawVerkopen(content, orders);
    drawVerkopenFooter(footer, orders);

    // Background: auto-sync + enrich from conversations
    autoSync(orders);
    enrichSold(orders).then(() => {
      if (activeTab === 'verkopen') drawVerkopen(content, orders);
    });
  }

  function drawVerkopen(content, orders) {
    const prev = content.querySelector('.vlt-sell-wrap');
    if (prev) prev.remove();
    const wrap = el('div', '');
    wrap.className = 'vlt-sell-wrap';
    wrap.appendChild(sectionHead('Verkopen', `${orders.length} orders`));

    const rows = orders.map((o, i) => {
      const cb = document.createElement('input');
      Object.assign(cb, { type: 'checkbox' });
      cb.dataset.idx = i;
      Object.assign(cb.style, { cursor:'pointer', accentColor: D.accent, flexShrink:'0', width:'15px', height:'15px', margin:'0' });
      cb.addEventListener('change', () => {
        const n = content.querySelectorAll('[data-idx]:checked').length;
        const b = document.getElementById('vlt-sync');
        if (b) b.textContent = n > 0 ? `☁ Sync (${n} geselecteerd)` : '☁ Sync alle naar Vault';
      });

      const sub = [o.buyer ? `@${o.buyer}` : '', o.country, fmtD(o.date)].filter(Boolean).join(' · ');
      const lbl = document.createElement('label');
      lbl.style.cssText = `display:flex;align-items:center;gap:13px;padding:12px 16px;cursor:pointer;${i < orders.length - 1 ? 'border-bottom:1px solid #f9fafb;' : ''}`;
      lbl.append(cb, photoThumb(o.photo), textStack(o.title, sub), priceTag(o.price));
      return lbl;
    });

    wrap.appendChild(cardWrap(rows));
    content.appendChild(wrap);
  }

  function drawVerkopenFooter(footer, orders) {
    footer.innerHTML = '';
    const selAll = btn('Alles', `background:${D.badge};color:#374151;flex-shrink:0`);
    selAll.addEventListener('click', () => {
      document.querySelectorAll('#vlt-content [data-idx]').forEach(cb => { cb.checked = true; });
      const b = document.getElementById('vlt-sync');
      if (b) b.textContent = `☁ Sync (${orders.length} geselecteerd)`;
    });

    const syncBtn = btn('☁ Sync alle naar Vault', `background:${D.accent};color:#fff;flex:1`);
    syncBtn.id = 'vlt-sync';
    syncBtn.addEventListener('click', () => {
      const checked = [...document.querySelectorAll('#vlt-content [data-idx]:checked')]
        .map(cb => orders[parseInt(cb.dataset.idx, 10)]).filter(o => o?.transactionId);
      const targets = checked.length ? checked : orders.filter(o => o.transactionId);
      if (!targets.length) return;
      syncBtn.disabled = true; syncBtn.textContent = `⏳ Syncing ${targets.length}…`;
      Promise.all(targets.map(o => sendMsg({ type: 'SYNC_TO_SUPABASE', order: o }))).then(rs => {
        const ok = rs.filter(r => r?.success).length;
        toast(`✓ ${ok}/${targets.length} orders gesynchroniseerd`);
        syncBtn.disabled = false; syncBtn.textContent = '☁ Sync alle naar Vault';
      });
    });

    footer.append(selAll, syncBtn);
  }

  // ── Tab: Aankopen ──────────────────────────────────────────────────────────
  async function tabAankopen(content, footer) {
    const orders = await getPurchased();
    content.innerHTML = '';
    if (!orders.length) { content.appendChild(emptyState('🛍', 'Geen aankopen', 'Nog geen aankopen gevonden.')); return; }

    content.appendChild(sectionHead('Aankopen', `${orders.length} orders`));
    const rows = orders.map((o, i) => {
      const sub = [o.seller ? `@${o.seller}` : '', fmtD(o.date)].filter(Boolean).join(' · ');
      return rowDiv([photoThumb(o.photo), textStack(o.title, sub), priceTag(o.price)], i < orders.length - 1);
    });
    content.appendChild(cardWrap(rows));
  }

  // ── Tab: Labels ────────────────────────────────────────────────────────────
  async function tabLabels(content, footer) {
    await loadDlIds();
    const orders  = await getSold();
    const pending = orders.filter(o => o.transactionId && !dlIds.has(o.transactionId));
    content.innerHTML = '';
    footer.innerHTML  = '';

    if (!pending.length) {
      content.appendChild(emptyState('✅', 'Alle labels geprint', 'Geen openstaande labels.'));
      return;
    }

    // Show skeleton + status while scanning chats
    content.appendChild(sectionHead('Labels', `${pending.length} te downloaden`));
    const scanMsg = el('div', `font-size:12px;color:${D.sub};margin-bottom:14px`,
      '🔍 Gesprekken scannen op labels…');
    content.appendChild(scanMsg);
    content.appendChild(skeletonList(Math.min(pending.length, 6)));

    // Scan all conversations for label PDFs
    const chatLabels = await scanConvsForLabels(pending);

    // Build final label map: prefer chat URL, fall back to direct API endpoint
    const labelMap = new Map();
    for (const o of pending) {
      const chat = chatLabels.get(o.transactionId);
      labelMap.set(o.transactionId, chat
        ? { url: chat.url,               source: 'chat' }
        : { url: labelUrl(o.transactionId), source: 'api'  });
    }

    const chatCount = [...labelMap.values()].filter(v => v.source === 'chat').length;

    // Re-render with results
    content.innerHTML = '';
    content.appendChild(sectionHead('Labels', `${pending.length} te downloaden`));

    if (chatCount > 0) {
      content.appendChild(el('div',
        `font-size:12px;color:#15803d;background:#f0fdf4;padding:8px 12px;border-radius:8px;margin-bottom:14px`,
        `✓ ${chatCount} label${chatCount > 1 ? 's' : ''} gevonden in chat gesprekken`));
    }

    const rows = pending.map((o, i) => {
      const info    = labelMap.get(o.transactionId);
      const srcPill = info?.source === 'chat'
        ? pill('💬 chat', '#4f46e5', '#ede9fe')
        : pill('API', '#9ca3af', '#f3f4f6');
      const dlBtn = btn('⬇ 4×6', `background:${D.badge};color:#374151;flex-shrink:0`);
      dlBtn.addEventListener('click', () => doDownloadLabel(dlBtn, o, info?.url));
      const sub = [o.buyer ? `@${o.buyer}` : '', fmtD(o.date)].filter(Boolean).join(' · ');
      return rowDiv(
        [photoThumb(o.photo), textStack(o.title, sub), srcPill, priceTag(o.price), dlBtn],
        i < pending.length - 1,
      );
    });
    content.appendChild(cardWrap(rows));

    const printAll = btn(`🖨 Print alle ${pending.length} labels`, `background:${D.accent};color:#fff;flex:1`);
    printAll.addEventListener('click', () => {
      const urls = pending.map(o => labelMap.get(o.transactionId)?.url).filter(Boolean);
      const ids  = pending.map(o => o.transactionId);
      batchPrint(pending, urls, ids, printAll, content, footer);
    });
    footer.appendChild(printAll);
  }

  async function doDownloadLabel(dlBtn, order, url) {
    dlBtn.textContent = '⏳ Croppen…'; dlBtn.disabled = true;
    const res = await sendMsg({
      type: 'PRINT_LABELS',
      labelUrls: [url || labelUrl(order.transactionId)],
      transactionIds: [order.transactionId],
    }, 30000);
    if (res?.success) {
      dlIds.add(order.transactionId);
      dlBtn.textContent = '✓ Klaar';
      dlBtn.style.background = '#dcfce7'; dlBtn.style.color = '#15803d';
    } else {
      dlBtn.textContent = '✗ Opnieuw'; dlBtn.disabled = false;
      dlBtn.style.background = '#fee2e2'; dlBtn.style.color = '#dc2626';
    }
  }

  async function batchPrint(orders, urls, ids, printBtn, content, footer) {
    printBtn.disabled = true; printBtn.textContent = `⏳ Laden ${urls.length} labels…`;
    const res = await sendMsg({ type: 'PRINT_LABELS', labelUrls: urls, transactionIds: ids }, 120000);
    if (res?.success) {
      (res.downloadedIds || ids).forEach(id => dlIds.add(id));
      toast(`✅ ${orders.length} labels gedownload als 4×6 PDF`);
      mem['v_sold'] = null;
      await tabLabels(content, footer);
    } else {
      toast('Label download mislukt: ' + (res?.error || 'onbekende fout'), false);
      printBtn.disabled = false; printBtn.textContent = `🖨 Print alle ${orders.length} labels`;
    }
  }

  // ── Floating V button ──────────────────────────────────────────────────────
  function injectFab() {
    if (document.getElementById(BTN_ID)) return;
    const b = el('button',
      `position:fixed;bottom:24px;right:24px;z-index:2147483647;background:${D.accent};color:#fff;
       border:none;border-radius:50%;width:48px;height:48px;cursor:pointer;
       box-shadow:0 4px 20px rgba(99,102,241,0.45);display:flex;align-items:center;justify-content:center;
       font-family:${D.font};transition:transform 0.15s,box-shadow 0.15s`,
      `<span style="font-size:13px;font-weight:700;letter-spacing:1px">V</span>`);
    b.id = BTN_ID; b.title = 'Vault Seller Tools';
    b.addEventListener('mouseenter', () => { b.style.transform='scale(1.1)'; b.style.boxShadow='0 6px 28px rgba(99,102,241,0.55)'; });
    b.addEventListener('mouseleave', () => { b.style.transform='scale(1)';   b.style.boxShadow='0 4px 20px rgba(99,102,241,0.45)'; });
    b.addEventListener('click', () => toggleOverlay());
    document.body.appendChild(b);
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  let booted = false;

  function boot() {
    if (booted) return;
    booted = true;
    buildOverlay();
    injectFab();
    console.log('[Vault] booted on', location.href);
  }

  // SPA navigation watcher
  let lastHref = location.href;
  new MutationObserver(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    booted = false; overlayOpen = false;
    cClear();
    document.getElementById(OV_ID)?.remove();
    document.getElementById(BTN_ID)?.remove();
    document.getElementById('vlt-css')?.remove();
    document.getElementById('vlt-toast')?.remove();
    setTimeout(boot, 400);
  }).observe(document, { subtree: true, childList: true });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
