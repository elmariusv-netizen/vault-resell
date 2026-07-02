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
  // Upgrade low-res Vinted thumbnail to 310px wide version
  const hiPhoto = url => url ? url.replace(/\/\d+x\d+\//g, '/310x/').replace(/\/\d+x\//g, '/310x/') : null;
  const fmtD = s => {
    if (!s) return '';
    const d = new Date(s);
    return isNaN(d) ? s.slice(0,10) : d.toLocaleDateString('nl-BE', { day:'2-digit', month:'short', year:'2-digit' });
  };

  // ── API ────────────────────────────────────────────────────────────────────
  function getVintedHeaders() {
    const csrf = document.querySelector('meta[name="csrf-token"]')?.content
      || document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]+)/)?.[1]
      || document.cookie.match(/(?:^|;\s*)_vinted_csrf_token=([^;]+)/)?.[1]
      || '';
    const anonId = document.cookie.match(/(?:^|;\s*)anon_id=([^;]+)/)?.[1]
      || document.cookie.match(/(?:^|;\s*)_vinted_anon_id=([^;]+)/)?.[1]
      || '';
    return {
      'accept':            'application/json, text/plain, */*',
      'x-csrf-token':      csrf,
      'x-anon-id':         anonId,
      'x-requested-with':  'XMLHttpRequest',
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

  // ── Vinted userId (dynamisch, gecached) ───────────────────────────────────
  let _cachedVintedUserId = null;
  async function getVintedUserId() {
    if (_cachedVintedUserId) return _cachedVintedUserId;
    try {
      const d = await vGet('/api/v2/users/current');
      _cachedVintedUserId = d.user?.id ? String(d.user.id) : null;
    } catch (e) {
      console.warn('[Vault] getVintedUserId mislukt:', e.message);
    }
    return _cachedVintedUserId;
  }

  // Parse items from a document — tries __NEXT_DATA__ JSON first, then DOM cards
  function parseItemsDoc(doc) {
    // 1. Try embedded Next.js JSON (most reliable)
    try {
      const nd = doc.getElementById('__NEXT_DATA__');
      if (nd) {
        const json = JSON.parse(nd.textContent);
        const pp   = json?.props?.pageProps || {};
        console.log('[Vault] __NEXT_DATA__ pageProps keys:', Object.keys(pp));

        // Walk all likely paths
        const raw =
          pp.items                  ||
          pp.currentUserItems       ||
          pp.wardrobe?.items        ||
          pp.catalog?.items         ||
          pp.profile?.items         ||
          pp.user?.items            ||
          pp.member?.items          ||
          pp.closet?.items          ||
          // Some versions nest under 'initialState'
          json?.props?.initialState?.catalog?.items ||
          json?.props?.initialState?.wardrobe?.items ||
          [];

        if (raw.length) {
          console.log('[Vault] listings from __NEXT_DATA__:', raw.length, 'keys:', Object.keys(raw[0] || {}));
          return raw.map(o => ({
            itemId: String(o.id || ''),
            title:  o.title || '?',
            photo:  hiPhoto(o.photos?.[0]?.url || o.photo?.url || null),
            price:  parseFloat(o.price?.amount || o.price || 0),
            views:  o.view_count || 0,
            status: o.status || 'active',
            date:   (o.created_at || '').slice(0, 10),
            url:    o.url || `https://www.vinted.be/items/${o.id}`,
          }));
        }
        console.log('[Vault] __NEXT_DATA__ found but no items array. Full dump:', JSON.stringify(pp).slice(0, 800));
      }
    } catch (e) { console.warn('[Vault] __NEXT_DATA__ error:', e.message); }

    // 2. DOM card fallback
    const cards = [...doc.querySelectorAll(
      '[data-testid="item-card"],[data-testid="ItemCard"],' +
      '[data-testid="grid-item"],[data-testid="closet-item"],' +
      '.feed-grid__item,.item-box',
    )];
    console.log('[Vault] DOM item cards found:', cards.length);
    return cards.map(card => {
      const link  = card.querySelector('a[href*="/items/"],a[href*="-"]:not([href*="//"])');
      const img   = card.querySelector('img');
      const titleEl = card.querySelector(
        '[data-testid="item-card--title"],[data-testid="ItemCardTitle"],' +
        'h3,h2,[class*="title"i]',
      );
      const priceEl = card.querySelector(
        '[data-testid="item-card--price"],[data-testid="ItemCardPrice"],[class*="price"i]',
      );
      const href   = link?.href || '';
      const itemId = href.match(/\/items?\/(\d+)/)?.[1] || href.match(/\/(\d+)-[a-z]/)?.[1] || '';
      const price  = parseFloat((priceEl?.textContent || '').replace(/[^0-9.,]/g, '').replace(',', '.')) || 0;
      return {
        itemId,
        title:  titleEl?.textContent?.trim() || '?',
        photo:  hiPhoto(img?.src || img?.dataset?.src || null),
        price,
        views:  0,
        status: 'active',
        date:   '',
        url:    href,
      };
    }).filter(o => o.itemId);
  }

  function mapWardrobeItem(o) {
    return {
      itemId: String(o.id || ''),
      title:  o.title || '?',
      photo:  hiPhoto(o.photos?.[0]?.url || o.photo?.url || null),
      price:  parseFloat(o.price?.amount || o.price || 0),
      views:  o.view_count || 0,
      status: o.status || 'active',
      date:   (o.created_at || '').slice(0, 10),
      url:    o.url || `https://www.vinted.be/items/${o.id}`,
    };
  }

  async function getListings() {
    const c = await cGet('v_list'); if (c) return c;
    let items = [];

    // 1. Wardrobe API (Vintedge approach — authenticated JSON, paginated)
    try {
      const userD  = await vGet('/api/v2/users/current');
      const userId = userD.user?.id;
      console.log('[Vault] current userId:', userId);
      if (userId) {
        let page = 1, totalPages = 1;
        while (page <= totalPages && page <= 10) {
          const d   = await vGet(`/api/v2/wardrobe/${userId}/items?page=${page}&per_page=50`);
          const raw = d.items || [];
          console.log('[Vault] wardrobe page', page, '/', totalPages, '—', raw.length, 'items');
          if (!raw.length) break;
          items.push(...raw.map(mapWardrobeItem));
          totalPages = d.pagination?.total_pages || 1;
          if (page >= totalPages) break;
          page++;
        }
        console.log('[Vault] wardrobe total:', items.length, 'items');
      }
    } catch (e) { console.warn('[Vault] wardrobe API mislukt:', e.message); }

    // 2. Tab DOM-scraping fallback (background opens member profile page)
    if (!items.length) {
      try {
        const result = await sendMsg({ type: 'FETCH_LISTINGS' }, 30000);
        console.log('[Vault] listings via tab:', result?.items?.length || 0, result?.error || '');
        const raw = result?.items || [];
        if (raw.length) {
          items = raw.map(o => ({
            itemId: String(o.id || ''),
            title:  o.title || '?',
            photo:  hiPhoto(typeof o.photo === 'string' ? o.photo : (o.photos?.[0]?.url || o.photo?.url || null)),
            price:  parseFloat(o.price?.amount || o.price || 0),
            views:  o.view_count || 0,
            status: o.status || 'active',
            date:   (o.created_at || '').slice(0, 10),
            url:    o.url || `https://www.vinted.be/items/${o.id}`,
          }));
        }
      } catch (e) { console.warn('[Vault] tab listings fallback mislukt:', e.message); }
    }

    await cSet('v_list', items);
    return items;
  }

  async function getSold() {
    const c = await cGet('v_sold_v2');
    if (c) { console.log('[Vault] getSold: cache —', c.length, 'orders'); return c; }

    console.log('[Vault] getSold: ophalen…');
    const path = '/api/v2/my_orders?order_type=sold&per_page=100&page=1';
    console.log('[Vault] getSold fetch URL:', `https://www.vinted.be${path}`);
    const d   = await vGet(path);
    const all = d.my_orders || d.orders || d.transactions || [];
    console.log('[Vault] getSold: ontvangen:', all.length, 'orders');
    if (all[0]) {
      console.log('[Vault] sold[0] keys:', Object.keys(all[0]).join(', '));
      console.log('[Vault] sold[0]:', JSON.stringify(all[0]).slice(0, 200));
      console.log('[Vault] photo object:', JSON.stringify(all[0].photo));
      console.log('[Vault] price raw:', JSON.stringify(all[0].price));
      console.log('[Vault] buyer object:', JSON.stringify(all[0].buyer));
      console.log('[Vault] user object:', JSON.stringify(all[0].user));
    }

    const MY_USER_ID = await getVintedUserId();
    const sold = all.filter(o => {
      const sellerId = o.seller_id || o.seller?.id || o.transaction?.seller_id;
      if (MY_USER_ID && sellerId && String(sellerId) !== MY_USER_ID) {
        console.log('[Vault] gefilterd (geen seller):', o.item?.title || o.title || '?', '| seller_id:', sellerId);
        return false;
      }
      return true;
    });

    const orders = sold.map(o => {
      const photo = o.photos?.[0]?.url || o.photo?.url ||
        o.item?.photos?.[0]?.url || o.item?.photo?.url ||
        o.photo_url || null;
      if (o === sold[0]) console.log(`[Vault] photo txn ${o.transaction_id || o.id}: resolved →`, photo || '(leeg)');
      const _title = o.item?.title || o.title || ''
      if (/short de bain/i.test(_title)) console.log('[Vault] DEBUG aankoop-check:', JSON.stringify(o));
      // TIJDELIJK: volledige ruwe order-JSON loggen voor bundel-transacties, om te
      // achterhalen of de Vinted-API meerdere items/foto's per bundel blootlegt
      // (bv. onder o.items[]) — content.js pakt nu overal maar 1 foto (o.photos?.[0]),
      // dus dit toont of er ELDERS in de payload meer foto's/items zitten die we
      // momenteel negeren.
      if (/bundel/i.test(_title)) {
        console.log(`[Vault] DEBUG bundel-order txn ${o.transaction_id || o.id} — volledige raw JSON:`, JSON.stringify(o));
        console.log(`[Vault] DEBUG bundel-order keys:`, Object.keys(o).join(', '));
        console.log(`[Vault] DEBUG bundel-order o.item keys:`, o.item ? Object.keys(o.item).join(', ') : '(geen o.item)');
      }

      const resolvedDate =
        o.created_at || o.updated_at || o.transaction?.created_at ||
        o.date || o.shipment?.created_at || '';
      if (o === sold[0]) {
        console.log('[Vault] datum veld:', JSON.stringify({
          created_at:              o.created_at,
          updated_at:              o.updated_at,
          'transaction.created_at': o.transaction?.created_at,
          date:                    o.date,
          'shipment.created_at':   o.shipment?.created_at,
          resolved:                resolvedDate,
        }));
      }

      return {
        transactionId:         String(o.transaction_id || o.id || ''),
        itemId:                String(o.item?.id || ''),
        title:                 o.item?.title || o.title || '?',
        photo,
        price:                 parseFloat(o.price?.amount || o.total_price || o.item?.price_numeric || 0),
        buyer:                 o.buyer?.login || o.user?.login || '',
        buyer_name:            o.buyer?.real_name || o.buyer?.display_name || o.buyer?.name || o.user?.real_name || o.user?.display_name || '',
        country:               o.buyer?.country_iso_code || o.country_iso_code || '',
        date:                  (resolvedDate || '').slice(0, 10),
        status:                o.status || '',
        transactionUserStatus: o.transaction_user_status ?? null,
        conversationId:        String(o.conversation_id || o.thread_id || ''),
        convId:                null,
      };
    });
    await cSet('v_sold_v2', orders);
    return orders;
  }

  async function getConversations() {
    const c = await cGet('v_convs'); if (c) return c;
    const endpoints = [
      '/api/v2/conversations?per_page=100',
      '/api/v2/inbox?per_page=100',
      '/api/v2/threads?per_page=100',
    ];
    for (const path of endpoints) {
      try {
        const d = await vGet(path);
        console.log('[Vault] convs via', path, 'keys:', Object.keys(d));
        const threads = d.threads || d.conversations || d.inbox || d.items || [];
        if (threads.length) {
          await cSet('v_convs', threads);
          return threads;
        }
      } catch (e) { console.warn('[Vault] convs failed', path, e.message); }
    }
    return [];
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

  // Haal foto + buyer info op via conversation detail
  async function fetchConvDetail(convId) {
    try {
      const d = await vGet(`/api/v2/conversations/${convId}`);
      const conv = d.conversation || d;
      const opp  = conv.opposite_user || {};
      const t    = conv.transaction || {};
      const photoUrl = t.item_photo?.full_size_url || t.item_photo?.url || null;
      return {
        photo:           photoUrl,
        buyer:           opp.login || '',
        buyerName:       opp.login || '',
        country:         opp.country_code || '',
        currentUserSide: t.current_user_side || '',
      };
    } catch (e) {
      console.warn(`[Vault] conv detail mislukt ${convId}:`, e.message);
      return { photo: null, buyer: '', buyerName: '', country: '', currentUserSide: '' };
    }
  }

  // Enrich orders: foto + tegenpartij info ophalen via conversationId (max 20)
  async function enrichOrders(orders) {
    const needsDetail = orders.filter(o =>
      (!o.photo || !o.buyer) && (o.conversationId || o.convId)
    ).slice(0, 20);
    if (!needsDetail.length) return;

    console.log(`[Vault] enrichOrders: detail ophalen voor ${needsDetail.length} orders`);
    let changed = false;
    await Promise.all(needsDetail.map(async o => {
      const id = o.conversationId || o.convId;
      const { photo, buyer, buyerName, country, currentUserSide } = await fetchConvDetail(id);
      console.log(`[Vault] conv detail txn ${o.transactionId}: opp="${buyer}" country="${country}" side="${currentUserSide}"`);
      if (photo)           { o.photo           = photo;           changed = true; }
      if (country)         { o.country         = country;         changed = true; }
      if (currentUserSide) { o.currentUserSide = currentUserSide; changed = true; }
      if (buyer)           { o.buyer           = buyer;           changed = true; }
      if (buyerName)       { o.buyerName       = buyerName;       changed = true; }
    }));
    if (changed) await cSet('v_sold_v2', orders);
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

    const nieuw    = orders.filter(o => o.transactionId && !syncedIds.has(o.transactionId));
    const overgeslagen = orders.length - nieuw.length;
    console.log(`[Vault] autoSync: ${orders.length} orders — ${overgeslagen} al gesync, ${nieuw.length} nieuw`);

    let ok = 0, fail = 0;
    for (const o of nieuw) {
      const vId = await getVintedUserId();
      const res = await sendMsg({ type: 'SYNC_ORDER', order: { ...o, labelUrl: labelUrl(o.transactionId), vintedUserId: vId } });
      if (res?.success && !res.duplicate) {
        syncedIds.add(o.transactionId);
        ok++;
        console.log(`[Vault] autoSync ✓ txn ${o.transactionId}`);
      } else {
        fail++;
        console.warn(`[Vault] autoSync ✗ txn ${o.transactionId}`, res);
      }
    }
    console.log(`[Vault] autoSync klaar: ${ok} gesync, ${fail} mislukt`);
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

  // ── Landesvlaggen ──────────────────────────────────────────────────────────
  const FLAGS = {
    BE:'🇧🇪',NL:'🇳🇱',FR:'🇫🇷',DE:'🇩🇪',ES:'🇪🇸',IT:'🇮🇹',PL:'🇵🇱',
    CZ:'🇨🇿',PT:'🇵🇹',SE:'🇸🇪',FI:'🇫🇮',LT:'🇱🇹',LV:'🇱🇻',EE:'🇪🇪',
    GB:'🇬🇧',AT:'🇦🇹',SK:'🇸🇰',HU:'🇭🇺',RO:'🇷🇴',HR:'🇭🇷',DK:'🇩🇰',
  };

  // ── Maat/kleur/stof uit titel ───────────────────────────────────────────────
  function extractMeta(title) {
    const t = (title || '').toLowerCase();
    const tags = [];

    const sizeM = t.match(/\b(xxxl|xxl|3xl|2xl|xl|xs|xxs|one\s*size|[3-5][0-9]|(?<![a-z])[sml](?![a-z]))\b/);
    if (sizeM) tags.push(sizeM[0].toUpperCase().replace(' ', ''));

    const COLORS = [
      ['zwart','Zwart'],['black','Zwart'],['wit','Wit'],['white','Wit'],
      ['blauw','Blauw'],['blue','Blauw'],['navy','Navy'],['rood','Rood'],['red','Rood'],
      ['roze','Roze'],['pink','Roze'],['groen','Groen'],['green','Groen'],
      ['grijs','Grijs'],['grey','Grijs'],['gray','Grijs'],['beige','Beige'],
      ['bruin','Bruin'],['brown','Bruin'],['geel','Geel'],['yellow','Geel'],
      ['oranje','Oranje'],['orange','Oranje'],['paars','Paars'],['purple','Paars'],
      ['bordeaux','Bordeaux'],['camel','Camel'],['creme','Crème'],['cream','Crème'],
      ['olijf','Olijf'],['khaki','Khaki'],['kaki','Khaki'],['ecru','Ecru'],
    ];
    for (const [w, label] of COLORS) { if (t.includes(w)) { tags.push(label); break; } }

    const FABRICS = [
      ['katoen','Katoen'],['cotton','Katoen'],['polyester','Polyester'],
      ['wol','Wol'],['wool','Wol'],['denim','Denim'],['spijkerstof','Denim'],
      ['leer','Leer'],['leather','Leer'],['velvet','Velvet'],['fluweel','Velvet'],
      ['linnen','Linnen'],['linen','Linnen'],['zijde','Zijde'],['silk','Zijde'],
      ['fleece','Fleece'],['nylon','Nylon'],['suède','Suède'],['suede','Suède'],
      ['corduroy','Corduroy'],['ribfluweel','Corduroy'],
    ];
    for (const [w, label] of FABRICS) { if (t.includes(w)) { tags.push(label); break; } }

    return tags;
  }

  const isCancelled = o => /geannuleerd|cancel/i.test(o.status || '');

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
    const allOrders = await getSold();
    const orders = allOrders.filter(o => !isCancelled(o));
    content.innerHTML = '';
    if (!orders.length) { content.appendChild(emptyState('📦', 'Geen verkopen', 'Nog geen verkopen gevonden.')); return; }

    drawVerkopen(content, orders);
    drawVerkopenFooter(footer, orders);

    enrichOrders(orders).then(() => {
      if (activeTab !== 'verkopen') return;
      const visibleOrders = orders.filter(o => {
        if (o.currentUserSide === 'buyer') {
          console.log('[Vault] gefilterd (ik was koper):', o.title);
          return false;
        }
        return true;
      });
      drawVerkopen(content, visibleOrders);
      drawVerkopenFooter(footer, visibleOrders);
    });
  }

  function updateSyncBtnLabel() {
    const n = document.querySelectorAll('#vlt-content [data-idx]:checked').length;
    const b = document.getElementById('vlt-sync');
    if (b) b.textContent = n > 0 ? `☁ Sync ${n} geselecteerde` : '☁ Sync geselecteerde';
  }

  function drawVerkopen(content, orders) {
    const prev = content.querySelector('.vlt-sell-wrap');
    if (prev) prev.remove();
    const wrap = el('div', '');
    wrap.className = 'vlt-sell-wrap';
    wrap.appendChild(sectionHead('Verkopen', `${orders.length} orders`));

    const rows = orders.map((o, i) => {
      // Foto's — o.photo is enkelvoudig; strip wordt uitgebreid als photo_urls beschikbaar komt
      const photos = [];
      if (o.photo) photos.push(o.photo);

      // Grote hoofdfoto
      const photoCol = el('div', 'flex-shrink:0');
      if (photos.length) {
        const img = document.createElement('img');
        img.src = photos[0]; img.loading = 'lazy';
        img.style.cssText = 'width:72px;height:72px;border-radius:10px;object-fit:cover;display:block';
        img.onerror = () => img.style.visibility = 'hidden';
        photoCol.appendChild(img);

        // Kleine thumbnails voor extra foto's
        if (photos.length > 1) {
          const strip = el('div', 'display:flex;gap:3px;margin-top:3px');
          photos.slice(1, 4).forEach(src => {
            const t = document.createElement('img');
            t.src = src; t.loading = 'lazy';
            t.style.cssText = 'width:21px;height:21px;border-radius:4px;object-fit:cover';
            strip.appendChild(t);
          });
          photoCol.appendChild(strip);
        }
      } else {
        photoCol.appendChild(el('div',
          'width:72px;height:72px;border-radius:10px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:24px',
          '📦'));
      }

      // Info kolom
      const tags = extractMeta(o.title);
      const subParts = [
        o.buyer ? `@${o.buyer}` : '',
        o.country || '',
        fmtD(o.date),
      ].filter(Boolean);

      const infoCol = el('div', 'flex:1;min-width:0');
      const titleDiv = el('div',
        `font-size:13px;font-weight:600;color:${D.text};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3`,
        esc(o.title));
      infoCol.appendChild(titleDiv);

      if (tags.length) {
        const chipWrap = el('div', 'display:flex;gap:4px;flex-wrap:wrap;margin-top:5px');
        tags.forEach(tag => {
          chipWrap.appendChild(el('span',
            `font-size:10px;font-weight:500;padding:2px 7px;border-radius:20px;background:#f3f4f6;color:#374151;white-space:nowrap`,
            esc(tag)));
        });
        infoCol.appendChild(chipWrap);
      }

      const subDiv = el('div',
        `font-size:11px;color:${D.sub};margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`,
        esc(subParts.join(' · ')));
      infoCol.appendChild(subDiv);

      // Checkbox — standaard NIET aangevinkt
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.dataset.idx = i; cb.checked = false;
      Object.assign(cb.style, { cursor:'pointer', accentColor:D.accent, flexShrink:'0', width:'16px', height:'16px', margin:'0' });
      cb.addEventListener('change', updateSyncBtnLabel);

      const lbl = document.createElement('label');
      lbl.style.cssText = `display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;${i < orders.length - 1 ? 'border-bottom:1px solid #f9fafb;' : ''}`;
      lbl.append(photoCol, infoCol, priceTag(o.price), cb);
      return lbl;
    });

    wrap.appendChild(cardWrap(rows));
    content.appendChild(wrap);
  }

  function drawVerkopenFooter(footer, orders) {
    footer.innerHTML = '';

    const selAll = btn('☑ Alles', `background:${D.badge};color:#374151;flex-shrink:0`);
    selAll.addEventListener('click', () => {
      document.querySelectorAll('#vlt-content [data-idx]').forEach(cb => { cb.checked = true; });
      updateSyncBtnLabel();
    });

    const deselAll = btn('☐ Geen', `background:${D.badge};color:#374151;flex-shrink:0`);
    deselAll.addEventListener('click', () => {
      document.querySelectorAll('#vlt-content [data-idx]').forEach(cb => { cb.checked = false; });
      updateSyncBtnLabel();
    });

    const syncBtn = btn('☁ Sync geselecteerde', `background:${D.accent};color:#fff;flex:1`);
    syncBtn.id = 'vlt-sync';
    syncBtn.addEventListener('click', () => {
      const targets = [...document.querySelectorAll('#vlt-content [data-idx]:checked')]
        .map(cb => orders[parseInt(cb.dataset.idx, 10)])
        .filter(o => o?.transactionId);

      if (!targets.length) {
        toast('Vink eerst orders aan om te synchroniseren', false);
        return;
      }

      console.log(`[Vault] sync-knop: ${targets.length} orders te sturen`);
      syncBtn.disabled = true;

      (async () => {
        let ok = 0, fail = 0;

        syncBtn.textContent = `⏳ Conversaties ophalen…`;
        try { await enrichOrders(targets); } catch (e) { console.warn('[Vault] enrichOrders skip:', e.message); }

        for (let i = 0; i < targets.length; i++) {
          const o = targets[i];
          syncBtn.textContent = `⏳ ${i + 1}/${targets.length} — sync…`;
          console.log(`[Vault] sync ${i + 1}/${targets.length}: txn ${o.transactionId} — "${o.title}"`);
          const res = await sendMsg({ type: 'SYNC_TO_SUPABASE', order: { ...o, vintedUserId: await getVintedUserId() } }, 20000);
          if (res?.success) {
            ok++;
            console.log(`[Vault] sync ✓ txn ${o.transactionId} (HTTP ${res.status})`);
          } else if (res?.error === 'no_link') {
            fail++;
            console.error(`[Vault] sync ✗ geen koppeling — ${res.message}`);
          } else {
            fail++;
            console.error(`[Vault] sync ✗ txn ${o.transactionId} — HTTP ${res?.status ?? 'timeout'}: ${res?.error ?? 'geen response'}`);
          }
        }
        console.log(`[Vault] sync klaar: ${ok} ok, ${fail} mislukt van ${targets.length}`);
        toast(fail === 0
          ? `✓ ${ok} orders gesynchroniseerd`
          : `✓ ${ok}/${targets.length} — ${fail} mislukt`);
        syncBtn.disabled = false;
        updateSyncBtnLabel();
      })();
    });

    footer.append(selAll, deselAll, syncBtn);
  }

  // ── Tab: Aankopen ──────────────────────────────────────────────────────────
  async function tabAankopen(content, footer) {
    const allOrders = await getSold();
    const active = allOrders.filter(o => !isCancelled(o));
    content.innerHTML = '';
    content.appendChild(emptyState('⏳', 'Aankopen laden…', 'Conversaties worden opgehaald om aankopen te identificeren…'));

    enrichOrders(active).then(() => {
      if (activeTab !== 'aankopen') return;
      const aankopen = active.filter(o => o.currentUserSide === 'buyer');
      content.innerHTML = '';
      if (!aankopen.length) { content.appendChild(emptyState('🛍', 'Geen aankopen', 'Geen aankopen gevonden in je orders.')); return; }
      drawAankopen(content, aankopen);
      drawAankopenFooter(footer, aankopen);
    });
  }

  function drawAankopen(content, orders) {
    const prev = content.querySelector('.vlt-buy-wrap');
    if (prev) prev.remove();
    const wrap = el('div', '');
    wrap.className = 'vlt-buy-wrap';
    wrap.appendChild(sectionHead('Aankopen', `${orders.length} orders`));

    const rows = orders.map((o, i) => {
      const photoCol = el('div', 'flex-shrink:0');
      if (o.photo) {
        const img = document.createElement('img');
        img.src = o.photo; img.loading = 'lazy';
        img.style.cssText = 'width:72px;height:72px;border-radius:10px;object-fit:cover;display:block';
        img.onerror = () => img.style.visibility = 'hidden';
        photoCol.appendChild(img);
      } else {
        photoCol.appendChild(el('div',
          'width:72px;height:72px;border-radius:10px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:24px',
          '🛍'));
      }

      const subParts = [
        o.buyer ? `@${o.buyer}` : '',  // bij aankopen is opposite_user de verkoper, opgeslagen als o.buyer
        o.country || '',
        fmtD(o.date),
      ].filter(Boolean);

      const infoCol = el('div', 'flex:1;min-width:0');
      infoCol.appendChild(el('div',
        `font-size:13px;font-weight:600;color:${D.text};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3`,
        esc(o.title)));
      infoCol.appendChild(el('div',
        `font-size:11px;color:${D.sub};margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`,
        esc(subParts.join(' · '))));

      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.dataset.idx = i; cb.checked = false;
      Object.assign(cb.style, { cursor:'pointer', accentColor:D.accent, flexShrink:'0', width:'16px', height:'16px', margin:'0' });
      cb.addEventListener('change', updateSyncBtnLabel);

      const lbl = document.createElement('label');
      lbl.style.cssText = `display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;${i < orders.length - 1 ? 'border-bottom:1px solid #f9fafb;' : ''}`;
      lbl.append(photoCol, infoCol, priceTag(o.price), cb);
      return lbl;
    });

    wrap.appendChild(cardWrap(rows));
    content.appendChild(wrap);
  }

  function drawAankopenFooter(footer, orders) {
    footer.innerHTML = '';

    const selAll = btn('☑ Alles', `background:${D.badge};color:#374151;flex-shrink:0`);
    selAll.addEventListener('click', () => {
      document.querySelectorAll('#vlt-content [data-idx]').forEach(cb => { cb.checked = true; });
      updateSyncBtnLabel();
    });

    const deselAll = btn('☐ Geen', `background:${D.badge};color:#374151;flex-shrink:0`);
    deselAll.addEventListener('click', () => {
      document.querySelectorAll('#vlt-content [data-idx]').forEach(cb => { cb.checked = false; });
      updateSyncBtnLabel();
    });

    const syncBtn = btn('☁ Sync geselecteerde', `background:${D.accent};color:#fff;flex:1`);
    syncBtn.id = 'vlt-sync';
    syncBtn.addEventListener('click', () => {
      const targets = [...document.querySelectorAll('#vlt-content [data-idx]:checked')]
        .map(cb => orders[parseInt(cb.dataset.idx, 10)])
        .filter(o => o?.transactionId);

      if (!targets.length) { toast('Vink eerst aankopen aan om te synchroniseren', false); return; }

      syncBtn.disabled = true;
      (async () => {
        let ok = 0, fail = 0;
        syncBtn.textContent = `⏳ Conversaties ophalen…`;
        try { await enrichOrders(targets); } catch (e) { console.warn('[Vault] enrichOrders skip:', e.message); }

        for (let i = 0; i < targets.length; i++) {
          const o = { ...targets[i], orderDirection: 'purchase', vintedUserId: await getVintedUserId() };
          syncBtn.textContent = `⏳ ${i + 1}/${targets.length} — sync…`;
          const res = await sendMsg({ type: 'SYNC_TO_SUPABASE', order: o }, 20000);
          res?.success ? ok++ : fail++;
        }
        toast(fail === 0 ? `✓ ${ok} aankopen gesynchroniseerd` : `✓ ${ok}/${targets.length} — ${fail} mislukt`);
        syncBtn.disabled = false;
        updateSyncBtnLabel();
      })();
    });

    footer.append(selAll, deselAll, syncBtn);
  }

  // ── Tab: Labels ────────────────────────────────────────────────────────────
  async function tabLabels(content, footer) {
    await loadDlIds();
    const orders = await getSold();

    // needs_action = API signal (Vintedge approach), verzendlabel = Dutch status string fallback
    const labelOrders = orders.filter(o =>
      o.transactionId && (
        o.transactionUserStatus === 'needs_action' ||
        /verzendlabel/i.test(o.status || '')
      )
    );
    console.log('[Vault] label orders:', labelOrders.length, 'of', orders.length,
      '— statussen:', [...new Set(orders.map(o => `${o.status}|${o.transactionUserStatus}`))].join(' · '));

    content.innerHTML = '';
    footer.innerHTML  = '';

    if (!labelOrders.length) {
      content.appendChild(emptyState('📭', 'Geen labels beschikbaar',
        'Geen orders met "Verzendlabel is naar de verkoper gestuurd." gevonden.'));
      return;
    }

    content.appendChild(sectionHead('Labels', `${labelOrders.length} beschikbaar`));

    // Debug: log het transactionUserStatus-veld per order zodat we kunnen zien
    // of Vinted dat veld daadwerkelijk teruggeeft voor deze orders
    labelOrders.forEach(o => {
      console.log(`[Vault] label order txn ${o.transactionId}: status="${o.status}" transactionUserStatus="${o.transactionUserStatus}"`);
    });

    const dlBtns = new Map();
    const rows = labelOrders.map((o, i) => {
      const printed = dlIds.has(o.transactionId);
      const dlBtn = btn(
        printed ? '✓ Geprint' : '⬇ 4×6',
        printed
          ? `background:#dcfce7;color:#15803d;flex-shrink:0`
          : `background:${D.badge};color:#374151;flex-shrink:0`,
      );
      dlBtn.addEventListener('click', () => doDownloadLabel(dlBtn, o, null));
      dlBtns.set(o.transactionId, dlBtn);

      const actions = el('div', 'display:flex;gap:6px;flex-shrink:0');
      actions.appendChild(dlBtn);

      // "Verzendlabel is naar de verkoper gestuurd." → needs_action.
      // Als transactionUserStatus leeg is (Vinted geeft het veld niet altijd terug),
      // val terug op de status-tekst.
      const hasTxStatus = !!(o.transactionUserStatus || '').trim();
      const needsAction = o.transactionUserStatus === 'needs_action'
        || (!hasTxStatus && /verzendlabel/i.test(o.status || ''));
      if (needsAction) {
        const sendBtn = btn('📤 Stuur naar app', `background:${D.badge};color:#374151;flex-shrink:0`);
        sendBtn.addEventListener('click', () => sendLabelAvailable(o.transactionId, sendBtn));
        actions.appendChild(sendBtn);
      }

      const sub = [o.buyer ? `@${o.buyer}` : '', fmtD(o.date)].filter(Boolean).join(' · ');
      return rowDiv(
        [photoThumb(o.photo), textStack(o.title, sub), priceTag(o.price), actions],
        i < labelOrders.length - 1,
      );
    });
    content.appendChild(cardWrap(rows));

    const printAll = btn(`🖨 Print alle ${labelOrders.length} labels`, `background:${D.accent};color:#fff;flex:1`);
    printAll.addEventListener('click', () => batchPrint(labelOrders, printAll, dlBtns));
    footer.appendChild(printAll);
  }

  const PROXY_URL      = 'https://vault-resell.vercel.app/api/label';
  const SYNC_PROXY_URL = 'https://vault-resell.vercel.app/api/sync-order';

  // Meld bij de app dat er een verzendlabel klaarstaat voor deze transactie
  async function sendLabelAvailable(txId, sendBtn) {
    sendBtn.textContent = '⏳ Versturen…'; sendBtn.disabled = true;
    try {
      const resp = await fetch(SYNC_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: txId, transaction_id: txId, label_available: true }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      sendBtn.textContent = '✓ Verstuurd';
      sendBtn.style.background = '#dcfce7'; sendBtn.style.color = '#15803d';
    } catch (e) {
      console.warn('[Vault] sendLabelAvailable mislukt:', e.message);
      sendBtn.textContent = '✗ Opnieuw'; sendBtn.disabled = false;
      sendBtn.style.background = '#fee2e2'; sendBtn.style.color = '#dc2626';
    }
  }

  // Vintedge approach: transaction → shipment ID → presigned label URL
  async function fetchLabelViaShipment(txId) {
    const h = { ...getVintedHeaders() };

    // Step 1: get shipment ID from transaction
    const txResp = await fetch(`https://www.vinted.be/api/v2/transactions/${txId}`, {
      credentials: 'include', headers: h,
    });
    if (!txResp.ok) throw new Error(`transaction ${txResp.status}`);
    const tx = await txResp.json();
    const shipmentId = tx.transaction?.shipment?.id;
    if (!shipmentId) throw new Error(`geen shipmentId in transaction ${txId}`);
    console.log('[Vault] shipmentId:', shipmentId, 'for txn', txId);

    // Step 2: get presigned label URL from shipment
    const lblResp = await fetch(`https://www.vinted.be/api/v2/shipments/${shipmentId}/label_url`, {
      credentials: 'include', headers: h,
    });
    if (!lblResp.ok) throw new Error(`label_url ${lblResp.status}`);
    const { label_url } = await lblResp.json();
    if (!label_url) throw new Error(`geen label_url voor shipment ${shipmentId}`);
    console.log('[Vault] presigned label URL:', label_url.slice(0, 80));
    return label_url;
  }

  async function fetchLabelFromProxy(txId) {
    // Primary: get presigned URL via shipment API (no cookie needed for presigned URLs)
    let body    = { transaction_id: txId };
    let headers = { 'Content-Type': 'application/json', 'x-vinted-cookie': document.cookie };

    try {
      const labelUrl = await fetchLabelViaShipment(txId);
      body    = { label_url: labelUrl };
      headers = { 'Content-Type': 'application/json' }; // presigned = no auth needed
      console.log('[Vault] proxy: using presigned URL path');
    } catch (e) {
      console.warn('[Vault] shipment API mislukt, cookie fallback:', e.message);
    }

    const resp = await fetch(PROXY_URL, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    console.log('[Vault] proxy status:', resp.status, 'txn:', txId);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`proxy ${resp.status}: ${err.error || resp.statusText}`);
    }
    const buf   = await resp.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary  = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return 'data:application/pdf;base64,' + btoa(binary);
  }

  async function doDownloadLabel(dlBtn, order, url) {
    dlBtn.textContent = '⏳ Ophalen…'; dlBtn.disabled = true;
    try {
      const dataUrl = await fetchLabelFromProxy(order.transactionId);
      await sendMsg({ type: 'DOWNLOAD_LABEL', url: dataUrl, filename: `label-${order.transactionId}-4x6.pdf` });
      dlIds.add(order.transactionId);
      dlBtn.textContent = '✓ Klaar';
      dlBtn.style.background = '#dcfce7'; dlBtn.style.color = '#15803d';
    } catch (e) {
      console.warn('[Vault] proxy mislukt, fallback naar background:', e.message);
      dlBtn.textContent = '⏳ Fallback…';
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
  }

  async function batchPrint(orders, printBtn, dlBtns) {
    printBtn.disabled = true;
    printBtn.textContent = `⏳ 0/${orders.length} verwerkt…`;
    let done = 0;
    for (const o of orders) {
      const b = dlBtns.get(o.transactionId);
      if (b) await doDownloadLabel(b, o, null);
      done++;
      printBtn.textContent = `⏳ ${done}/${orders.length} verwerkt…`;
    }
    printBtn.disabled = false;
    printBtn.style.background = '#dcfce7';
    printBtn.style.color = '#15803d';
    printBtn.textContent = `✅ ${orders.length} labels verwerkt`;
    toast(`✅ ${orders.length} labels gedownload als 4×6 PDF`);
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

  // ── Remote sync trigger (vanuit background.js) ────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'FORCE_SYNC') return
    ;(async () => {
      try {
        const orders = await getSold()
        const active = orders.filter(o => !isCancelled(o))
        await enrichOrders(active)
        await autoSync(active)
        sendResponse({ success: true, count: active.length })
      } catch (e) {
        console.warn('[Vault] FORCE_SYNC error:', e.message)
        sendResponse({ success: false, error: e.message })
      }
    })()
    return true
  })

  // ── Auto-koppeling via vault_link query param ─────────────────────────────
  async function tryAutoLink() {
    const linkId = new URLSearchParams(window.location.search).get('vault_link');
    if (!linkId) return;
    console.log('[Vault] vault_link gevonden:', linkId);

    const userId = await getVintedUserId();
    if (!userId) { console.warn('[Vault] vault_link: kon Vinted userId niet ophalen'); return; }

    const result = await sendMsg({ type: 'VAULT_LINK', linkId, vintedUserId: userId }, 10000);
    if (result?.success) {
      console.log('[Vault] vault_link: koppeling voltooid voor userId', userId);
      toast('✓ Vinted account gekoppeld aan Vault');
    } else {
      console.error('[Vault] vault_link mislukt:', result?.error);
    }
  }

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  let booted = false;

  function boot() {
    if (booted) return;
    booted = true;
    buildOverlay();
    injectFab();
    console.log('[Vault] booted on', location.href);
    tryAutoLink();
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

// ── Label bytes fetcher — called by background via FETCH_LABEL_BYTES ──────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'FETCH_LABEL_BYTES') {
    fetch(msg.url, { credentials: 'include' })
      .then(r => {
        if (!r.ok) { sendResponse({ ok: false, status: r.status }); return null; }
        return r.arrayBuffer();
      })
      .then(buf => {
        if (!buf) return;
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        sendResponse({ ok: true, data: btoa(binary) });
      })
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});
