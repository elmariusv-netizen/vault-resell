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
  let overlayCloseTimer = null;
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

  // Vinted's wardrobe-item `status` veld is bij dit endpoint altijd een lege
  // string ("") — geen bruikbaar signaal. De échte online/actief-staat zit in
  // de losse boolean-velden hieronder (bevestigd via live wardrobe-response):
  // is_draft (nog niet gepubliceerd), is_closed (verkocht/afgesloten, met
  // item_closing_action zoals "sold" erbij) en is_hidden (door de gebruiker
  // verborgen). Enkel wanneer geen van deze drie true is, staat een listing
  // écht online op Vinted.
  function wardrobeItemStatus(o) {
    if (o.is_draft)  return 'draft';
    if (o.is_closed) return o.item_closing_action || 'closed';
    if (o.is_hidden) return 'hidden';
    return 'active';
  }

  function mapWardrobeItem(o) {
    return {
      itemId: String(o.id || ''),
      title:  o.title || '?',
      photo:  hiPhoto(o.photos?.[0]?.url || o.photo?.url || null),
      price:  parseFloat(o.price?.amount || o.price || 0),
      views:  o.view_count || 0,
      status: wardrobeItemStatus(o),
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
          // Volledige fotogalerij van elke listing vastleggen zolang die nog
          // ophaalbaar is (zie fotocache hierboven) — ongeacht status, want
          // ook een concept/verborgen item kan later alsnog verkocht worden.
          raw.forEach(o => {
            const photos = (o.photos || []).map(p => hiPhoto(p.url)).filter(Boolean);
            if (photos.length > 1) cacheItemPhotos(String(o.id), photos);
          });
          totalPages = d.pagination?.total_pages || 1;
          if (page >= totalPages) break;
          page++;
        }
        console.log('[Vault] wardrobe total:', items.length, 'items');
        // Enkel écht online listings tonen in de Listings-tab — draft/
        // verkocht/verborgen items horen daar niet in (zie wardrobeItemStatus
        // hierboven), anders staan bv. verkochte artikelen nog als "Actief"
        // tussen de rest.
        const beforeFilter = items.length;
        items = items.filter(it => it.status === 'active');
        console.log('[Vault] wardrobe na actief-filter:', items.length, '/', beforeFilter);
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

  async function getSold(force = false) {
    const c = force ? null : await cGet('v_sold_v2');
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
        orderId:               String(o.id || ''),
        itemId:                String(o.item?.id || ''),
        title:                 o.item?.title || o.title || '?',
        photo,
        price:                 parseFloat(o.price?.amount || o.total_price || o.item?.price_numeric || 0),
        buyer:                 o.buyer?.login || o.user?.login || '',
        buyer_name:            o.buyer?.real_name || o.buyer?.display_name || o.buyer?.name || o.user?.real_name || o.user?.display_name || '',
        country:               o.buyer?.country_iso_code || o.country_iso_code || '',
        date:                  (resolvedDate || '').slice(0, 10),
        // resolvedDate is doorgaans een volledige ISO-timestamp (met tijd) —
        // sale_date/DB-kolom "date" hierboven blijft bewust enkel de datum
        // (bestaand contract voor sortering/andere pagina's), maar soldAt
        // bewaart de volledige timestamp erbij zodat de Verkopen-kaart ook
        // het exacte verkooptijdstip kan tonen.
        soldAt:                resolvedDate || null,
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

  // ── Fotocache voor (nog) actieve listings ───────────────────────────────
  // Vinted's item-detail endpoint (/api/v2/items/{id}) geeft een "niet
  // gevonden"-pagina terug zodra een item verkocht is (bevestigd: al 404 op
  // de dag zelf van verkoop) — na verkoop is er dus geen enkele Vinted-API
  // meer die de VOLLEDIGE fotogalerij van dat item teruggeeft, enkel nog de
  // ene foto die ook in /api/v2/my_orders zit. De enige betrouwbare manier
  // om toch alle foto's te kunnen tonen in de Verkopen-detailmodal is ze
  // VOORAF vastleggen, terwijl het item nog gewoon te koop staat: elke keer
  // de Listings-tab ververst wordt (getListings hieronder), slaan we de
  // volledige fotolijst van elke listing op in chrome.storage.local (dus
  // persistent tussen sessies — een verkoop kan dagen na het laatst bekijken
  // van de Listings-tab gebeuren). Zodra zo'n item nadien verkocht wordt,
  // wordt deze cache opgezocht via het item_id uit
  // /api/v2/transactions/{id} — die blijft, in tegenstelling tot
  // /items/{id}, wél gewoon bereikbaar na verkoop (bevestigd).
  const ITEM_PHOTO_CACHE_MAX = 300;

  async function cacheItemPhotos(itemId, photos) {
    if (!itemId || !photos?.length) return;
    try {
      const { itemPhotoCache = {} } = await chrome.storage.local.get(['itemPhotoCache']);
      itemPhotoCache[itemId] = photos;
      const keys = Object.keys(itemPhotoCache);
      if (keys.length > ITEM_PHOTO_CACHE_MAX) {
        keys.slice(0, keys.length - ITEM_PHOTO_CACHE_MAX).forEach(k => delete itemPhotoCache[k]);
      }
      await chrome.storage.local.set({ itemPhotoCache });
    } catch (e) { console.warn('[Vault] cacheItemPhotos mislukt:', e.message); }
  }

  async function getCachedItemPhotos(itemId) {
    if (!itemId) return null;
    try {
      const { itemPhotoCache = {} } = await chrome.storage.local.get(['itemPhotoCache']);
      return itemPhotoCache[itemId] || null;
    } catch { return null; }
  }

  // item_id opzoeken via de transactie — blijft (bevestigd) bereikbaar nadat
  // /api/v2/items/{id} al 404 geeft.
  async function fetchTransactionItemId(transactionId) {
    if (!transactionId) return null;
    try {
      const d = await vGet(`/api/v2/transactions/${transactionId}`);
      return d.transaction?.item_id ? String(d.transaction.item_id) : null;
    } catch (e) {
      console.warn(`[Vault] fetchTransactionItemId ${transactionId} mislukt:`, e.message);
      return null;
    }
  }

  // Bundle-orders: probeer alle items + foto's van een bundel-verkoop op te halen
  // via /api/v2/orders/{orderId}. Het per-item endpoint (/api/v2/items/{id})
  // bestaat niet meer zodra een item verkocht/verwijderd is (bevestigd: geeft een
  // HTML "niet gevonden"-pagina terug i.p.v. JSON), dus dat pad werkt niet meer
  // na verkoop. De structuur van deze response is niet 100% bevestigd — meerdere
  // waarschijnlijke veldnamen worden geprobeerd; als geen enkele matcht komt er
  // gewoon een lege array terug en valt de aanroeper terug op de bestaande
  // single-photo flow (geen crash, geen foutieve data).
  async function fetchOrderItemPhotos(orderId) {
    if (!orderId) return { photos: [], titles: [] };
    try {
      const r = await vGet(`/api/v2/orders/${orderId}`);
      const ord = r.order || r;
      const rawItems = ord.items || ord.line_items || ord.order_items || ord.contents || [];
      const photos = [];
      const titles = [];
      for (const it of rawItems) {
        const p = it.photos?.[0]?.url || it.photo?.url || it.item_photo?.url ||
          it.item?.photos?.[0]?.url || it.item?.photo?.url || null;
        const t = it.title || it.item?.title || null;
        if (p) photos.push(p);
        if (t) titles.push(t);
      }
      console.log(`[Vault] fetchOrderItemPhotos ${orderId}: ${photos.length} foto's / ${titles.length} titels (${rawItems.length} items in response)`);
      return { photos, titles };
    } catch (e) {
      console.warn(`[Vault] fetchOrderItemPhotos ${orderId} mislukt:`, e.message);
      return { photos: [], titles: [] };
    }
  }

  // ── SKU-detectie ────────────────────────────────────────────────────────
  // De titel is altijd beschikbaar (ook na verkoop, via /api/v2/my_orders).
  // De beschrijving is dat NIET: /api/v2/items/{id} (waar description
  // vandaan komt) geeft na verkoop een "niet gevonden"-pagina terug (zie
  // fetchOrderItemPhotos hierboven) — best-effort dus, met stille fallback
  // i.p.v. een crash als de beschrijving niet (meer) opgehaald kan worden.
  async function fetchItemDescription(itemId) {
    if (!itemId) return null;
    try {
      const d = await vGet(`/api/v2/items/${itemId}`);
      return d.item?.description || d.description || null;
    } catch (e) {
      console.log(`[Vault] fetchItemDescription ${itemId}: niet beschikbaar (${e.message}) — waarschijnlijk al verkocht/verwijderd`);
      return null;
    }
  }

  // Bekende SKU-prefixen (zie de leveranciers in seedData.js/webapp-
  // Instellingen) — hardcoded omdat dit content-script geen toegang heeft tot
  // de leveranciers-tabel. Nieuwe leverancier met een ander prefix? Hier
  // toevoegen.
  const SKU_PREFIXES = ['IND', 'RIA', 'IMV', 'MAU'];

  // Kandidaat-SKU uit vrije tekst: één van de bekende prefixen gevolgd door
  // 1-4 cijfers, met optioneel een spatie/koppelteken ertussen —
  // hoofdletterongevoelig, dekt "RIA056", "RIA 056", "ria-056" en "RIA56"
  // (zonder voorloop-nullen). Zoekt gericht op de 4 bekende prefixen i.p.v.
  // een generiek "2-4 letters + cijfers"-patroon — anders zou een eerder
  // toevallig treffer in de tekst (bv. "Air Max 90" → "Max90") de match
  // winnen vóór de echte SKU later in dezelfde titel/beschrijving.
  const SKU_CANDIDATE_RE = new RegExp(`\\b(${SKU_PREFIXES.join('|')})[\\s-]?(\\d{1,4})\\b`, 'i');
  function extractSkuCandidate(text) {
    if (!text) return null;
    const m = String(text).match(SKU_CANDIDATE_RE);
    if (!m) return null;
    return `${m[1].toUpperCase()}${m[2].padStart(3, '0')}`;
  }

  // Detecteert een kandidaat-SKU voor een order, op basis van de
  // SKU-detectie-instelling (zie getSkuDetectionMode hierboven). Haalt de
  // beschrijving enkel op als de instelling dat vereist (en enkel als de
  // titel bij "titel dan beschrijving" niets opleverde) — geen onnodige
  // extra netwerkaanvraag als de titel al volstaat.
  async function detectSkuForOrder(order) {
    const mode = await getSkuDetectionMode();
    if (mode === 'title') return extractSkuCandidate(order.title);

    if (mode === 'title_then_description') {
      const fromTitle = extractSkuCandidate(order.title);
      if (fromTitle) return fromTitle;
    }
    const description = await fetchItemDescription(order.itemId);
    return extractSkuCandidate(description);
  }

  // Haal foto + buyer info op via conversation detail
  async function fetchConvDetail(convId, debug = false) {
    try {
      const d = await vGet(`/api/v2/conversations/${convId}`);
      const conv = d.conversation || d;
      const opp  = conv.opposite_user || {};
      const t    = conv.transaction || {};
      const photoUrl = t.item_photo?.full_size_url || t.item_photo?.url || null;
      const itemIds  = t.item_ids || [];

      // TIJDELIJK: volledige raw response voor de 2 gemelde probleem-orders —
      // om te bevestigen of current_user_side echt ontbreekt in Vinted's
      // eigen respons, of dat de call zelf al faalt (zie catch-blok).
      if (debug) {
        console.log(`[Vault] DEBUG conv ${convId} — transaction keys:`, Object.keys(t).join(', '));
        console.log(`[Vault] DEBUG conv ${convId} — transaction.current_user_side (raw):`, JSON.stringify(t.current_user_side));
        console.log(`[Vault] DEBUG conv ${convId} — volledige transaction:`, JSON.stringify(t));
      }

      // Vinted's numerieke transaction/shipment-statuscodes — taalonafhankelijk
      // en dus betrouwbaarder dan tekst-matching. Primaire bron voor
      // classifyOrderStage() (skuUtils.js), dat de Home-dashboard-
      // statuskaarten voedt; tekst-matching blijft enkel fallback voor orders
      // die nog niet opnieuw gesynct zijn sinds deze velden bestaan. Mapping
      // bevestigd via live data (80+ orders): 230=onderweg (verzonden of bij
      // afhaalpunt), 430=gepauzeerd, 450/460+is_completed=voltooid, 510=
      // geannuleerd/terugbetaald.
      const transactionStatus = t.status ?? null;
      const shipmentStatus    = t.shipment_status ?? t.shipment?.status ?? null;
      const isCompleted       = t.is_completed ?? d.is_completed ?? null;

      // Vinted geeft geen los payout/cashout-veld op transaction terug — de
      // uitbetalingsdatum zit verstopt in conversation.messages: het bericht
      // met event_type "completed" ("Je verkoop is afgerond!") heeft een
      // created_at_ts die functioneel de uitbetalingsdatum is (moment waarop
      // het bedrag naar de Vinted Portemonnee overgemaakt wordt). Niet elke
      // (oudere) conversation heeft dit bericht — dan blijft het null.
      const completionMsg = (conv.messages || []).find(
        m => m.event_type === 'completed' || m.event_group === 'completion'
      );
      const payoutDate = completionMsg?.created_at_ts || null;

      return {
        photo:           photoUrl,
        buyer:           opp.login || '',
        buyerName:       opp.login || '',
        country:         opp.country_code || '',
        currentUserSide: t.current_user_side || '',
        itemIds,
        transactionStatus,
        shipmentStatus,
        isCompleted,
        payoutDate,
      };
    } catch (e) {
      if (debug) console.error(`[Vault] DEBUG conv ${convId} — fetchConvDetail FAALDE:`, e.message);
      console.warn(`[Vault] conv detail mislukt ${convId}:`, e.message);
      return { photo: null, buyer: '', buyerName: '', country: '', currentUserSide: '', itemIds: [], transactionStatus: null, shipmentStatus: null, isCompleted: null, payoutDate: null };
    }
  }

  // Enrich orders: foto + tegenpartij info + currentUserSide ophalen via
  // conversationId, voor ALLE orders die dit nog missen — in opeenvolgende
  // batches van 20 (niet enkel de eerste 20, en dan stoppen). currentUserSide
  // hoort expliciet bij de "mist nog info"-check: een order kan al een foto/
  // buyer hebben (bv. uit een eerdere gedeeltelijke sync) maar toch nog geen
  // currentUserSide — zonder die check zou zo'n order nooit meer verrijkt
  // worden en permanent als "onbekend" (== als verkoop getoond) blijven staan.
  // `onProgress(done, total)` laat de aanroeper een voortgangsindicator tonen.
  // TIJDELIJK: gerichte debug voor 2 orders die na "Alles synchroniseren"
  // consequent als 'sale' i.p.v. 'purchase' blijven staan, ondanks de
  // currentUserSide-fix in refreshKnownOrders(). Wordt verwijderd zodra de root cause
  // bevestigd is — niet nog een keer blind "fixen".
  const DEBUG_TXN_IDS = new Set(['20624965062', '20621465098']);

  async function enrichOrders(orders, onProgress) {
    // transactionStatus === undefined betekent "nog nooit verrijkt met de
    // nieuwe numerieke status-velden" — forceert precies 1x een herhaalde
    // fetchConvDetail-ronde voor reeds volledig verrijkte orders (die anders
    // hierna nooit meer aangeraakt worden), zodat bestaande orders alsnog
    // met transactionStatus/shipmentStatus/isCompleted worden aangevuld.
    const needsDetail = orders.filter(o =>
      ((!o.photo || !o.buyer || !o.currentUserSide || o.transactionStatus === undefined || o.payoutDate === undefined) && (o.conversationId || o.convId))
      || (o.photo_urls === undefined && o.transactionId)
    );

    // Log VOOR de needsDetail-filter of deze 2 orders er überhaupt inzitten,
    // en met welke conversationId/convId — als die leeg is, wordt
    // fetchConvDetail voor deze order NOOIT aangeroepen, ongeacht hoe vaak
    // enrichOrders draait, en blijft currentUserSide voorgoed onbekend.
    for (const o of orders) {
      if (!DEBUG_TXN_IDS.has(o.transactionId)) continue;
      const willFetch = needsDetail.includes(o);
      console.log(`[Vault] DEBUG txn ${o.transactionId} vóór enrichment: title="${o.title}" conversationId="${o.conversationId}" convId="${o.convId}" photo=${!!o.photo} buyer="${o.buyer}" currentUserSide="${o.currentUserSide}" → wordt ${willFetch ? 'WEL' : 'NIET'} opgehaald deze ronde`);
    }

    if (!needsDetail.length) return;

    const BATCH_SIZE = 20;
    console.log(`[Vault] enrichOrders: detail ophalen voor ${needsDetail.length} orders (batches van ${BATCH_SIZE})`);
    let changed = false;
    let done = 0;

    for (let start = 0; start < needsDetail.length; start += BATCH_SIZE) {
      const batch = needsDetail.slice(start, start + BATCH_SIZE);
      await Promise.all(batch.map(async o => {
        const id = o.conversationId || o.convId;
        const isDebugTxn = DEBUG_TXN_IDS.has(o.transactionId);
        if (id) {
          if (isDebugTxn) console.log(`[Vault] DEBUG txn ${o.transactionId}: fetchConvDetail(${id}) start`);
          const { photo, buyer, buyerName, country, currentUserSide, itemIds, transactionStatus, shipmentStatus, isCompleted, payoutDate } = await fetchConvDetail(id, isDebugTxn);
          console.log(`[Vault] conv detail txn ${o.transactionId}: opp="${buyer}" country="${country}" side="${currentUserSide}"`);
          if (isDebugTxn) console.log(`[Vault] DEBUG txn ${o.transactionId}: fetchConvDetail resultaat →`, JSON.stringify({ photo, buyer, buyerName, country, currentUserSide, itemIds, transactionStatus, shipmentStatus, isCompleted, payoutDate }));
          o.transactionStatus = transactionStatus;
          o.shipmentStatus    = shipmentStatus;
          o.isCompleted       = isCompleted;
          o.payoutDate        = payoutDate;
          changed = true;
          if (photo)           { o.photo           = photo;           changed = true; }
          if (country)         { o.country         = country;         changed = true; }
          if (currentUserSide) { o.currentUserSide = currentUserSide; changed = true; }
          if (buyer)           { o.buyer           = buyer;           changed = true; }
          if (buyerName)       { o.buyerName       = buyerName;       changed = true; }

          // Bundle-order (meerdere item_ids): probeer alle foto's/titels te
          // verzamelen. Lukt dat niet (items al verwijderd na verkoop), val terug
          // op de ene bestaande foto — de UI toont dan een "Bundel van N
          // artikelen"-label op basis van de titel i.p.v. losse thumbnails.
          if (itemIds.length > 1) {
            const { photos, titles } = await fetchOrderItemPhotos(o.orderId);
            if (photos.length > 1) {
              o.photo_urls  = JSON.stringify(photos);
              o.item_titles = titles.length ? JSON.stringify(titles) : null;
              changed = true;
              console.log(`[Vault] bundle txn ${o.transactionId}: ${photos.length} foto's verzameld`);
            } else {
              console.log(`[Vault] bundle txn ${o.transactionId}: geen losse foto's beschikbaar — fallback op 1 foto (${itemIds.length} items)`);
            }
          }
        }

        // Volledige fotogalerij backfillen uit de listing-fotocache (zie
        // hierboven) — onafhankelijk van conversationId, dus dit loopt ook
        // voor orders waar de rest van deze ronde niets te doen had. Eenmalig
        // per sessie geprobeerd (photo_urls wordt hierna altijd op zijn minst
        // `null` gezet, nooit meer `undefined`), zodat een item zonder cache-
        // hit niet elke enrichment-ronde opnieuw de transactie-lookup doet.
        if (o.photo_urls === undefined && o.transactionId) {
          const itemId = await fetchTransactionItemId(o.transactionId);
          const cached = itemId ? await getCachedItemPhotos(itemId) : null;
          if (cached && cached.length > 1) {
            o.photo_urls = JSON.stringify(cached);
            console.log(`[Vault] txn ${o.transactionId}: ${cached.length} foto's uit listing-cache gehaald (item ${itemId})`);
          } else {
            o.photo_urls = null;
          }
          changed = true;
        }
      }));
      done += batch.length;
      console.log(`[Vault] enrichOrders: batch klaar — ${done}/${needsDetail.length}`);
      onProgress?.(done, needsDetail.length);
      if (changed) await cSet('v_sold_v2', orders);
    }
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

  // Een order is "afgerond" als de Vinted-statustekst dat aangeeft — alles
  // daarbuiten (label klaar, verzonden, onderweg, …) komt in aanmerking voor
  // een status-refresh, ook als hij al eerder gesynct is.
  function isOrderCompleted(o) {
    return /voltooid|afgerond|afgesloten/i.test(o.status || '');
  }

  // ── Achtergrond sync — voor de Home "🔄 Synchroniseren"-knop (via FORCE_SYNC
  // hieronder) ─────────────────────────────────────────────────────────────
  // Of nieuwe VERKOPEN/AANKOPEN hier automatisch meesyncen is instelbaar via
  // Onboarding.jsx STAP 2 / Instellingen → "Inkoop & synchronisatie"
  // (user_settings.auto_sync_sales/auto_sync_purchases, doorgegeven via
  // FORCE_SYNC — zie background.js checkAndSync()). Defaults (sales=true,
  // purchases=false) matchen de kolom-DEFAULTs in supabase-setup.sql en het
  // oorspronkelijke hardcoded gedrag, voor het geval de instelling niet kon
  // worden opgehaald. Wat niet automatisch meesynct wordt enkel geteld
  // (newFoundCount) voor gebruikersfeedback — blijft beschikbaar via de
  // handmatige paneel-flow (checkboxes + "Sync geselecteerde" in
  // drawVerkopenFooter/drawAankopenFooter hieronder, die rechtstreeks
  // SYNC_TO_SUPABASE/SYNC_ORDER aanroepen en altijd werken, ongeacht deze
  // instelling — dat is een expliciete gebruikersactie, geen "auto"-sync).
  //
  // Voor orders die al eerder gesynct zijn (verkoop of aankoop, maakt niet uit):
  //  - status verversen zolang de order nog niet "voltooid" is;
  //  - bij al VOLTOOIDE orders, order_direction alsnog corrigeren zodra
  //    currentUserSide deze ronde bekend is (zie teCorrigeren) — dit is de
  //    fix voor oude, ooit fout als 'sale' weggeschreven aankopen (bv. een
  //    lang geleden gekochte printer) die anders nooit meer aangeraakt worden.
  //
  // userId (optioneel) laat voortgang terugmelden aan de webapp via
  // REPORT_SYNC_PROGRESS.
  async function refreshKnownOrders(orders, userId, autoSyncSales = true, autoSyncPurchases = false) {
    const { syncedOrders = [] } = await chrome.storage.local.get(['syncedOrders']);
    syncedIds = new Set(syncedOrders.map(o => o.transactionId).filter(Boolean));

    const shouldAutoSync = (o) => o.currentUserSide === 'buyer' ? autoSyncPurchases : autoSyncSales;

    const nieuw = orders.filter(o =>
      o.transactionId && !syncedIds.has(o.transactionId) && shouldAutoSync(o)
    );
    const nieuwOvergeslagen = orders.filter(o =>
      o.transactionId && !syncedIds.has(o.transactionId) && !shouldAutoSync(o)
    );

    const teVerversen = orders.filter(o => o.transactionId && syncedIds.has(o.transactionId) && !isOrderCompleted(o));

    // "Voltooid"-orders worden normaal NOOIT meer ververst (zie isOrderCompleted
    // hierboven) — maar dat betekent ook dat een oude rij die ooit fout als
    // order_direction='sale' is weggeschreven (terwijl currentUserSide eigenlijk
    // 'buyer' is) NOOIT meer gecorrigeerd wordt, want hij komt in geen enkele
    // bucket meer terecht zodra hij "voltooid" is.
    //
    // We sturen ALLEEN een correctie als currentUserSide deze ronde
    // daadwerkelijk bekend is (dus enrichOrders/fetchConvDetail is voor deze
    // order gelukt) — bij onbekende/ontbrekende currentUserSide raken we
    // order_direction niet aan, om een reeds correcte databasewaarde niet
    // per ongeluk te overschrijven met de 'sale'-default.
    const teCorrigeren = orders.filter(o =>
      o.transactionId && syncedIds.has(o.transactionId) && isOrderCompleted(o) && !!o.currentUserSide
    );

    const targets = [
      ...nieuw.map(o => ({ order: o, kind: 'nieuw' })),
      ...teVerversen.map(o => ({ order: o, kind: 'refresh' })),
      ...teCorrigeren.map(o => ({ order: o, kind: 'direction-check' })),
    ];
    console.log(`[Vault] refreshKnownOrders: ${orders.length} orders — ${nieuw.length} nieuw (wordt automatisch gesynct, autoSyncSales=${autoSyncSales}/autoSyncPurchases=${autoSyncPurchases}), ${nieuwOvergeslagen.length} nieuw overgeslagen (enkel via het extensiepaneel), ${teVerversen.length} te verversen, ${teCorrigeren.length} voltooid+richting-check`);

    const reportProgress = async (progress) => {
      if (!userId) return;
      await sendMsg({ type: 'REPORT_SYNC_PROGRESS', userId, progress });
    };

    let newCount = 0, updatedCount = 0, fail = 0;
    for (let i = 0; i < targets.length; i++) {
      const { order: o, kind } = targets[i];
      // Zelfde onderscheid als tabVerkopen/tabAankopen: currentUserSide === 'buyer'
      // betekent dat DIT account de koper was in de transactie, dus een aankoop —
      // die hoort met order_direction 'purchase' gesynct te worden, anders duikt
      // hij als "verkoop" op in de Verkopen-lijst.
      const orderDirection = o.currentUserSide === 'buyer' ? 'purchase' : 'sale';
      if (DEBUG_TXN_IDS.has(o.transactionId)) {
        console.log(`[Vault] DEBUG txn ${o.transactionId} in refreshKnownOrders (kind=${kind}): currentUserSide="${o.currentUserSide}" (type=${typeof o.currentUserSide}) → orderDirection="${orderDirection}"`);
      }
      // syncToSupabase()/syncOrder() zoeken de owner_id op via
      // order.vintedUserId (zie background.js lookupOwnerId()); zonder dit
      // veld faalt de lookup altijd met "no_link", ook al bestaat de
      // koppeling wel degelijk.
      const vId = await getVintedUserId();
      if (kind === 'nieuw') {
        // SKU-detectie enkel bij een écht nieuwe verkoop (kind === 'nieuw') —
        // dit is de enige plek waar de order gegarandeerd nog geen sku_ref
        // heeft, dus geen risico dat een eerder handmatig gecorrigeerde
        // koppeling hier overschreven wordt (background.js's syncToSupabase
        // laat sku_ref bovendien alsnog met rust als de rij al bestaat).
        let skuRef = null;
        if (orderDirection === 'sale') {
          try { skuRef = await detectSkuForOrder(o); } catch (e) { console.warn(`[Vault] SKU-detectie mislukt voor txn ${o.transactionId}:`, e.message); }
        }
        const res = await sendMsg({ type: 'SYNC_ORDER', order: { ...o, orderDirection, labelUrl: labelUrl(o.transactionId), vintedUserId: vId, skuRef } });
        if (res?.success && !res.duplicate) {
          syncedIds.add(o.transactionId);
          newCount++;
          console.log(`[Vault] refreshKnownOrders ✓ nieuw txn ${o.transactionId} (${orderDirection})`);
        } else {
          fail++;
          console.warn(`[Vault] refreshKnownOrders ✗ nieuw txn ${o.transactionId}`, res);
        }
      } else {
        const res = await sendMsg({ type: 'SYNC_TO_SUPABASE', order: { ...o, orderDirection, vintedUserId: vId } });
        if (res?.success) {
          updatedCount++;
          if (kind === 'direction-check') {
            console.log(`[Vault] refreshKnownOrders ✓ richting gecontroleerd/gecorrigeerd txn ${o.transactionId} (voltooid, currentUserSide="${o.currentUserSide}" → ${orderDirection})`);
          } else {
            console.log(`[Vault] refreshKnownOrders ✓ status ververst txn ${o.transactionId} ("${o.status}", ${orderDirection})`);
          }
        } else {
          fail++;
          console.warn(`[Vault] refreshKnownOrders ✗ txn ${o.transactionId}`, res);
        }
      }
      await reportProgress({ status: 'running', done: i + 1, total: targets.length, newCount, updatedCount, newFoundCount: nieuwOvergeslagen.length });
    }

    console.log(`[Vault] refreshKnownOrders klaar: ${newCount} nieuw automatisch gesynct, ${updatedCount} bijgewerkt, ${fail} mislukt, ${nieuwOvergeslagen.length} nieuw overgeslagen (niet automatisch gesynct)`);
    await reportProgress({
      status: 'done', done: targets.length, total: targets.length,
      newCount, updatedCount, newFoundCount: nieuwOvergeslagen.length, finishedAt: new Date().toISOString(),
    });
    return { newCount, updatedCount, newFoundCount: nieuwOvergeslagen.length, fail };
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

    // display:none vanaf de start — anders blokkeert deze position:fixed;inset:0
    // laag (ondanks opacity:0) alle clicks op de onderliggende Vinted-pagina
    // zodra hij gebouwd is, ook vóórdat het paneel ooit geopend is. Enkel
    // toggleOverlay(true) hieronder zet hem op display:flex.
    const ov = el('div', `position:fixed;inset:0;z-index:2147483646;background:${D.bg};display:none;flex-direction:column;font-family:${D.font};opacity:0;transition:opacity 0.2s ease;pointer-events:none`);
    ov.id = OV_ID;

    // Header
    const hdr = el('div', `background:${D.card};padding:0 28px;height:58px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;box-shadow:0 1px 0 #f3f4f6`);
    hdr.innerHTML = `<span style="font-size:18px;font-weight:700;letter-spacing:0.15em;color:${D.text}">VAULT</span>`;
    const hdrRight = el('div', 'display:flex;align-items:center;gap:2px');
    const settingsBtn = btn('⚙', `background:none;color:${D.sub};font-size:17px;padding:6px 8px;border-radius:8px`);
    settingsBtn.title = 'Instellingen';
    settingsBtn.addEventListener('click', () => showSettingsScreen());
    const closeBtn = btn('✕', `background:none;color:${D.sub};font-size:20px;padding:6px 8px;border-radius:8px`);
    closeBtn.addEventListener('click', () => toggleOverlay(false));
    hdrRight.append(settingsBtn, closeBtn);
    hdr.appendChild(hdrRight);

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
    // Voorkomt een race: als er nog een hide-timeout van een vorige sluit-actie
    // hangt (bv. snel dicht → weer open binnen de 200ms fade-out), zou die
    // straks alsnog display:none zetten op het net heropende paneel.
    if (overlayCloseTimer) { clearTimeout(overlayCloseTimer); overlayCloseTimer = null; }
    if (overlayOpen) {
      ov.style.display = 'flex';
      ov.style.pointerEvents = 'auto';
      requestAnimationFrame(() => { ov.style.opacity = '1'; });
      switchTab(activeTab);
    } else {
      ov.style.opacity = '0';
      ov.style.pointerEvents = 'none';
      overlayCloseTimer = setTimeout(() => { ov.style.display = 'none'; overlayCloseTimer = null; }, 200);
    }
  }

  // ── Instellingen (⚙) — Live synchronisatie ─────────────────────────────────
  // Aan/uit-schakelaar per databron. AAN: background.js's chrome.alarms-timer
  // (runLiveSync(), elke ~4 min) ververst deze bron automatisch zolang Chrome
  // open is, ook als deze Vinted-tab niet actief is. UIT: enkel handmatig via
  // de bestaande paneel-checkboxes of de webapp-synchroniseer-knop.
  function toggleSwitch(checked, onChange) {
    const wrap = el('label', 'position:relative;display:inline-block;width:40px;height:22px;flex-shrink:0;cursor:pointer');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.style.cssText = 'opacity:0;width:0;height:0';
    const slider = el('span', `position:absolute;inset:0;background:${checked ? D.accent : '#d1d5db'};border-radius:22px;transition:background 0.15s`);
    const knob = el('span', `position:absolute;top:2px;left:${checked ? '20px' : '2px'};width:18px;height:18px;background:#fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3);transition:left 0.15s`);
    slider.appendChild(knob);
    input.addEventListener('change', () => {
      slider.style.background = input.checked ? D.accent : '#d1d5db';
      knob.style.left = input.checked ? '20px' : '2px';
      onChange(input.checked);
    });
    wrap.append(input, slider);
    return wrap;
  }

  function settingsRow(title, sub, checked, onChange, borderBottom = true) {
    const row = el('div', `display:flex;align-items:center;gap:14px;padding:14px 0;${borderBottom ? 'border-bottom:1px solid #f3f4f6' : ''}`);
    row.appendChild(textStack(title, sub));
    row.appendChild(toggleSwitch(checked, onChange));
    return row;
  }

  // Radiogroep voor een instelling met >2 opties (bv. SKU-detectiebron) —
  // settingsRow hierboven is aan/uit-only, dat past niet op een 3-wegkeuze.
  function radioGroup(name, options, current, onChange) {
    const wrap = el('div', 'display:flex;flex-direction:column');
    options.forEach((opt, i) => {
      const row = el('label', `display:flex;align-items:center;gap:12px;padding:12px 0;cursor:pointer;${i < options.length - 1 ? 'border-bottom:1px solid #f3f4f6' : ''}`);
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = name;
      input.value = opt.value;
      input.checked = current === opt.value;
      input.style.cssText = `width:17px;height:17px;accent-color:${D.accent};flex-shrink:0;cursor:pointer`;
      input.addEventListener('change', () => { if (input.checked) onChange(opt.value); });
      row.append(input, textStack(opt.label, opt.sub));
      wrap.appendChild(row);
    });
    return wrap;
  }

  // Supabase-veldnaam → cache-sleutel, gedeeld tussen showSettingsScreen()'s
  // write() en background.js's setLiveSyncSetting() (die exact dezelfde
  // mapping heeft — hou ze in sync als er ooit een 5e toggle bijkomt).
  const LIVE_SYNC_FIELD_TO_KEY = {
    auto_sync_sales: 'sales', auto_sync_purchases: 'purchases',
    auto_sync_labels: 'labels', auto_create_labels: 'createLabels',
  };

  function normalizeLiveSyncSettings(raw) {
    return {
      sales: raw?.sales ?? true,
      purchases: raw?.purchases ?? false,
      labels: raw?.labels ?? false,
      createLabels: raw?.createLabels ?? false,
    };
  }

  // ── SKU-detectie — instelbaar waar de extensie naar een SKU (bv. RIA056)
  // zoekt bij het synchroniseren van een verkoop: enkel de titel van de
  // advertentie (standaard, altijd beschikbaar), enkel de beschrijving, of
  // titel-eerst-dan-beschrijving. Puur extensie-lokaal (geen webapp-
  // tegenhanger zoals liveSyncSettings), dus geen synchrone cross-writer-
  // cache nodig — een simpele chrome.storage.local-lezing per gebruik volstaat.
  const SKU_DETECTION_MODES = [
    { value: 'title',                  label: 'Titel',               sub: 'Zoek de SKU enkel in de titel van de advertentie (standaard)' },
    { value: 'description',            label: 'Beschrijving',        sub: 'Zoek enkel in de beschrijving' },
    { value: 'title_then_description', label: 'Titel dan beschrijving', sub: 'Zoek eerst in de titel, val terug op de beschrijving als niets gevonden wordt' },
  ];
  async function getSkuDetectionMode() {
    const { skuDetectionMode } = await chrome.storage.local.get(['skuDetectionMode']);
    return SKU_DETECTION_MODES.some(m => m.value === skuDetectionMode) ? skuDetectionMode : 'title';
  }
  async function setSkuDetectionMode(value) {
    await chrome.storage.local.set({ skuDetectionMode: value });
  }

  // ── ENIGE canonieke leesplek voor de 4 live-sync/auto-create-toggles —
  // zowel de ⚙-instellingenscherm-weergave (showSettingsScreen) als de
  // scan-logica (refreshLabels) roepen UITSLUITEND deze functie aan, zodat
  // ze nooit meer een ander antwoord kunnen geven dan elkaar.
  //
  // Synchroon in-memory gecachet (liveSyncSettingsMem) — een testrun bewees
  // dat zelfs een "optimistische" chrome.storage.local.set() vóór de
  // netwerk-roundtrip niet genoeg is: write() zelf begint met een `await
  // chrome.storage.local.get(...)`, dus een read die in dezelfde microtask
  // volgt (bv. direct een andere tab aanklikken) kan de set() nog vóór zijn.
  // writeToggle() hieronder werkt liveSyncSettingsMem daarom SYNCHROON bij,
  // vóór enige await — dat kan een JS-thread nooit interleaven.
  //
  // chrome.storage.onChanged houdt de cache ook actueel voor wijzigingen van
  // BUITEN deze content-script-instantie (bv. checkAndSync()'s periodieke
  // Supabase-refresh in background.js, of de 3 sync-toggles die ook vanuit
  // de webapp-Instellingen-pagina aanpasbaar zijn).
  let liveSyncSettingsMem = null;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.liveSyncSettings) {
      liveSyncSettingsMem = normalizeLiveSyncSettings(changes.liveSyncSettings.newValue);
    }
  });

  async function getLiveSyncSettings() {
    if (liveSyncSettingsMem) return liveSyncSettingsMem;
    const { liveSyncSettings } = await chrome.storage.local.get(['liveSyncSettings']);
    liveSyncSettingsMem = normalizeLiveSyncSettings(liveSyncSettings);
    return liveSyncSettingsMem;
  }

  // Werkt de in-memory cache SYNCHROON bij (geen enkele await ervoor) zodat
  // een getLiveSyncSettings()-aanroep die in dezelfde tick volgt op een
  // toggle-klik altijd de nieuwe waarde ziet — ongeacht hoe traag de
  // achterliggende chrome.storage.local/Supabase-schrijfacties zijn.
  function writeToggleSync(field, value) {
    const key = LIVE_SYNC_FIELD_TO_KEY[field] || field;
    liveSyncSettingsMem = { ...normalizeLiveSyncSettings(liveSyncSettingsMem), [key]: value };
    return key;
  }

  async function showSettingsScreen() {
    const content = document.getElementById('vlt-content');
    const footer  = document.getElementById('vlt-footer');
    if (!content || !footer) return;
    setTabStyle(null);
    footer.innerHTML = '';
    content.innerHTML = '';

    const backBtn = btn('← Terug', `background:none;color:${D.sub};padding:6px 4px;margin-bottom:6px`);
    backBtn.addEventListener('click', () => switchTab(activeTab));
    content.appendChild(backBtn);
    content.appendChild(sectionHead('Live synchronisatie', null));
    content.appendChild(el('div', `font-size:12px;color:${D.sub};line-height:1.6;margin:-8px 0 16px`,
      'Synct automatisch elke ~4 minuten op de achtergrond, zolang Chrome open is — ook als je niet op deze tab zit. Staat een schakelaar uit, dan synct die bron enkel handmatig (paneel-checkboxes of de webapp-synchroniseer-knop).'));

    const liveSyncSettings = await getLiveSyncSettings();
    const card = el('div', `background:${D.card};border-radius:16px;padding:0 16px;box-shadow:0 1px 4px rgba(0,0,0,0.07)`);

    const write = async (field, value) => {
      // Bewust GEEN await vóór writeToggleSync() hieronder — showSettingsScreen()
      // heeft liveSyncSettingsMem al gevuld vóórdat deze knoppen ooit klikbaar
      // werden (regel hierboven, await getLiveSyncSettings()), dus een directe
      // (synchrone) lezing hier is altijd veilig én voorkomt dat write() zelf
      // een microtask-yield introduceert vóór de cache-mutatie — anders zou
      // een getLiveSyncSettings()-aanroep die in dezelfde tick volgt (bv. een
      // scan die meteen na het klikken start) writeToggleSync() nog vóór
      // kunnen zijn.
      const key = LIVE_SYNC_FIELD_TO_KEY[field] || field;
      const prevValue = normalizeLiveSyncSettings(liveSyncSettingsMem)[key];
      writeToggleSync(field, value);

      const { liveSyncSettings: prev = {} } = await chrome.storage.local.get(['liveSyncSettings']);
      await chrome.storage.local.set({ liveSyncSettings: { ...prev, [key]: value, writtenAt: Date.now() } });

      const vintedUserId = await getVintedUserId();
      const res = await sendMsg({ type: 'SET_LIVE_SYNC_SETTING', vintedUserId, field, value });
      if (!res?.success) {
        toast(`Instelling opslaan mislukt: ${res?.error || 'onbekende fout'}`, false);
        // Rollback: Supabase-write mislukt, dus noch de in-memory cache noch
        // chrome.storage.local mogen blijven beweren dat de instelling aan
        // staat terwijl ze nergens persistent is opgeslagen.
        liveSyncSettingsMem = { ...normalizeLiveSyncSettings(liveSyncSettingsMem), [key]: prevValue };
        const { liveSyncSettings: cur = {} } = await chrome.storage.local.get(['liveSyncSettings']);
        await chrome.storage.local.set({ liveSyncSettings: { ...cur, [key]: prevValue, writtenAt: Date.now() } });
      }
    };

    card.appendChild(settingsRow('Verkopen', 'Commandes vendues, montants, acheteurs',
      liveSyncSettings.sales, v => write('auto_sync_sales', v)));
    card.appendChild(settingsRow('Aankopen', 'Commandes achetées sur Vinted',
      liveSyncSettings.purchases, v => write('auto_sync_purchases', v)));
    card.appendChild(settingsRow('Labels', 'Verzendlabels automatisch verifiëren en klaarzetten',
      liveSyncSettings.labels, v => write('auto_sync_labels', v), false));

    content.appendChild(card);

    // Losse sectie: dit is GEEN sync-instelling maar een echte schrijfactie
    // bij Vinted (klikt zelf een knop in je chat aan) — bewust visueel
    // gescheiden en met expliciete waarschuwing, vandaar ook de aparte
    // default-uit kolom in Supabase (auto_create_labels).
    content.appendChild(el('div', `font-size:11px;font-weight:700;color:${D.sub};text-transform:uppercase;letter-spacing:0.05em;margin:20px 0 8px`, 'Automatische acties'));
    content.appendChild(el('div', `font-size:12px;color:${D.sub};line-height:1.6;margin:-4px 0 14px`,
      '⚠️ Dit voert zelf een actie uit bij Vinted (klikt de "Verzendlabel aanmaken"-knop in je conversatie aan) — ongeverifieerd tegen een officiële API, dus enkel gebruiken als je dit bewust wil.'));
    const actionCard = el('div', `background:${D.card};border-radius:16px;padding:0 16px;box-shadow:0 1px 4px rgba(0,0,0,0.07)`);
    actionCard.appendChild(settingsRow('Labels automatisch aanmaken', 'Klikt "Verzendlabel aanmaken" in de chat als een label needs_action staat maar nog niet ophaalbaar is',
      liveSyncSettings.createLabels, v => write('auto_create_labels', v), false));
    content.appendChild(actionCard);

    // ── SKU-detectie — waar de extensie naar een SKU (bv. RIA056) zoekt bij
    // het automatisch registreren van een verkoop tijdens sync (zie
    // detectSkuForOrder/SKU_DETECTION_MODES hierboven).
    content.appendChild(el('div', `font-size:11px;font-weight:700;color:${D.sub};text-transform:uppercase;letter-spacing:0.05em;margin:20px 0 8px`, 'SKU-detectie'));
    content.appendChild(el('div', `font-size:12px;color:${D.sub};line-height:1.6;margin:-4px 0 14px`,
      'Waar de extensie naar een SKU (bv. RIA056) zoekt bij het automatisch registreren van een nieuwe verkoop.'));
    const skuCard = el('div', `background:${D.card};border-radius:16px;padding:0 16px;box-shadow:0 1px 4px rgba(0,0,0,0.07)`);
    const currentSkuMode = await getSkuDetectionMode();
    skuCard.appendChild(radioGroup('sku-detection-mode', SKU_DETECTION_MODES, currentSkuMode, (value) => setSkuDetectionMode(value)));
    content.appendChild(skuCard);
  }

  // ── Tab: Listings ──────────────────────────────────────────────────────────
  // "Heruploaden" gebruikt bewust Vinted's EIGEN "Vergelijkbaar artikel
  // plaatsen"-functie i.p.v. een zelfgebouwde item-creatie via de
  // (ongedocumenteerde) POST /api/v2/items — dat zou gokken naar verplichte
  // velden (catalog/brand/size-ids) en een foto-herupload-flow vereisen die
  // niet te verifiëren is zonder een echte advertentie te publiceren. Vinted
  // staat zelf ook geen automatische foto-duplicatie toe in die flow (bewuste
  // fraude-preventie) — de gebruiker moet de foto's zelf opnieuw intikken/
  // slepen, wat met de originele foto's bij de hand een kwestie van seconden is.
  function openRelist(o) {
    window.open(o.url, '_blank');
    toast(`Advertentie geopend — gebruik Vinted's "···"-menu → "Vergelijkbaar artikel plaatsen" om titel/prijs/categorie voor te vullen en de foto's opnieuw toe te voegen.`);
  }

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
      const relistBtn = el('button',
        'flex-shrink:0;border:none;background:none;font-size:16px;padding:4px 6px;cursor:pointer;line-height:1;border-radius:8px',
        '🔁');
      relistBtn.title = 'Heruploaden — dezelfde titel/prijs/foto’s opnieuw plaatsen via Vinted';
      relistBtn.addEventListener('click', (e) => { e.stopPropagation(); openRelist(o); });
      const r = rowDiv([photoThumb(o.photo), textStack(o.title, fmtD(o.date)), views, priceTag(o.price), statusBadge, relistBtn], i < items.length - 1);
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

    enrichOrders(orders, (done, total) => {
      if (activeTab !== 'verkopen') return;
      toast(`Details ophalen: ${done}/${total}…`);
    }).then(() => {
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
  // Bepaalt of een order "needs_action" is — "Verzendlabel is naar de
  // verkoper gestuurd." → needs_action. Als transactionUserStatus leeg is
  // (Vinted geeft het veld niet altijd terug), val terug op de status-tekst.
  function orderNeedsLabelAction(o) {
    const hasTxStatus = !!(o.transactionUserStatus || '').trim();
    return o.transactionUserStatus === 'needs_action'
      || (!hasTxStatus && /verzendlabel/i.test(o.status || ''));
  }

  // Kernlogica van de Labels-tab, losgetrokken van de UI zodat zowel de
  // handmatige tab (tabLabels hieronder) als LIVE_SYNC (achtergrond-alarm,
  // toggle "Labels" in het ⚙-instellingenscherm) hem kunnen aanroepen zonder
  // duplicatie. Haalt sold-orders op, filtert kandidaten, en verifieert elke
  // nog-niet-eerder-verstuurde kandidaat via een echte test-fetch.
  async function refreshLabels() {
    await loadDlIds();
    const orders = await getSold();

    // needs_action = API signal (Vintedge approach), verzendlabel = Dutch status
    // string fallback. Dit is enkel een KANDIDATENLIJST — transactionUserStatus
    // bleek onbetrouwbaar (valse positieven: orders zonder écht ophaalbaar
    // label kregen dit status toch). Elke kandidaat moet daarom eerst een
    // geslaagde test-fetch van het echte label doorstaan vóór hij in de lijst
    // verschijnt of als "beschikbaar" gemarkeerd wordt.
    const candidateOrders = orders.filter(o => o.transactionId && orderNeedsLabelAction(o));
    console.log('[Vault] label kandidaten:', candidateOrders.length, 'of', orders.length,
      '— statussen:', [...new Set(orders.map(o => `${o.status}|${o.transactionUserStatus}`))].join(' · '));

    // GEEN "al bekend, sla over"-shortcut meer op basis van vlt_auto_sent_labels
    // (chrome.storage.local): dat was een write-once vlag die nooit meer
    // ongedaan gemaakt werd zodra 1 eerdere poging ooit slaagde — als Vinted
    // een label later ongeldig maakt/opnieuw laat aanmaken (bv. na een
    // retour/heruitgifte), bleef die order dan PERMANENT uitgesloten van
    // verdere pogingen, ook al stond de "Verzendlabel aanmaken"-knop
    // opnieuw in de chat (bevestigd op txn/conversatie 23538654249). Elke
    // needs_action-kandidaat doorloopt nu altijd opnieuw de echte
    // test-fetch — prefetchLabel() is idempotent, dus dit kost enkel wat
    // extra Vinted-API-calls voor reeds werkende labels, geen risico.
    const { createLabels: autoCreate } = await getLiveSyncSettings();

    const verified = [];
    let skipped = 0;
    for (const o of candidateOrders) {
      try {
        // prefetchLabel() ÍS de test-fetch: haalt het echte label op (via de
        // presigned shipment-URL), de server controleert status + content-type
        // en cropt/slaat pas op als het daadwerkelijk een PDF is. Slaagt dit,
        // dan is het label bewezen beschikbaar; anders bestaat het simpelweg
        // (nog) niet, ondanks transactionUserStatus === 'needs_action'.
        await prefetchLabel(o.transactionId);
        await addAutoSent(o.transactionId);
        verified.push(o);
        console.log(`[Vault] label geverifieerd + verstuurd — txn ${o.transactionId} "${o.title}"`);
      } catch (e) {
        // Bewust opt-in en ONGEVERIFIEERD tegen een live sessie (zie
        // projectrapportage): probeer, enkel als de gebruiker dit expliciet
        // heeft aangezet én er een conversatie bekend is, één keer de "Label
        // aanmaken"-actie in de chat te klikken, en herhaal dan de ECHTE
        // test-fetch — deze functie claimt zelf geen succes op basis van de
        // klik alleen, enkel op basis van een daadwerkelijk gelukte
        // prefetchLabel() erna.
        const convId = o.conversationId || o.convId;
        if (autoCreate && convId) {
          console.log(`[Vault] label niet ophaalbaar voor txn ${o.transactionId} — probeer automatisch aan te maken via conversatie ${convId}…`);
          const clickResult = await sendMsg({ type: 'CREATE_LABEL_VIA_CHAT', conversationId: convId, transactionId: o.transactionId }, 25000);
          if (clickResult?.clicked) {
            // TIJDELIJKE DEBUG-LOGGING — niet gepusht. Bevestigd via
            // handmatige test dat 1 klik niet genoeg is (createLabelViaTab
            // klikt nu 2x) — dit logt of de DOM tussen de 2 klikken
            // daadwerkelijk verandert (bv. een tussenliggende bevestigingsstap),
            // zodat we kunnen zien of blind 2x klikken volstaat of dat er
            // specifiek op een tussenstap gereageerd moet worden.
            if (clickResult.debugDomChangedBetweenClicks !== undefined) {
              console.log(`[Vault] DEBUG DOM tussen de 2 klikken gewijzigd: ${clickResult.debugDomChangedBetweenClicks}`);
              console.log(`[Vault] DEBUG vóór 1e klik:`, clickResult.debugBeforeFirstClick);
              console.log(`[Vault] DEBUG na 1e klik:`, clickResult.debugAfterFirstClick);
              console.log(`[Vault] DEBUG 2e klik uitgevoerd: ${clickResult.debugSecondClickPerformed}`);
            }
            try {
              await prefetchLabel(o.transactionId);
              await addAutoSent(o.transactionId);
              verified.push(o);
              console.log(`[Vault] Label automatisch aangemaakt voor txn ${o.transactionId}`);
              continue;
            } catch (e2) {
              console.log(`[Vault] "Verzendlabel aanmaken"-knop 2x geklikt voor txn ${o.transactionId}, maar label nog steeds niet ophaalbaar (${e2.message}) — later opnieuw proberen`);
            }
          } else {
            console.log(`[Vault] kon "Verzendlabel aanmaken"-knop niet vinden/klikken voor txn ${o.transactionId} (${clickResult?.reason || 'onbekend'}) — overgeslagen`);
          }
        }
        skipped++;
        console.log(`[Vault] label NIET beschikbaar (overgeslagen) — txn ${o.transactionId} "${o.title}": ${e.message}`);
      }
    }

    return { verified, skipped, candidateCount: candidateOrders.length };
  }

  async function tabLabels(content, footer) {
    content.innerHTML = '';
    footer.innerHTML  = '';
    content.appendChild(emptyState('⏳', 'Labels verifiëren…',
      'Even geduld — we controleren welke labels écht ophaalbaar zijn.'));

    const { verified, skipped, candidateCount } = await refreshLabels();

    if (!candidateCount) {
      content.innerHTML = '';
      content.appendChild(emptyState('📭', 'Geen labels beschikbaar',
        'Geen orders met "Verzendlabel is naar de verkoper gestuurd." gevonden.'));
      return;
    }

    renderLabelsList(content, footer, verified, skipped);
  }

  function renderLabelsList(content, footer, labelOrders, skippedCount) {
    content.innerHTML = '';
    footer.innerHTML  = '';

    if (!labelOrders.length) {
      content.appendChild(emptyState('📭', 'Geen labels beschikbaar',
        skippedCount > 0
          ? `${skippedCount} order(s) leken een label te hebben, maar bleken bij verificatie niet ophaalbaar.`
          : 'Geen orders met "Verzendlabel is naar de verkoper gestuurd." gevonden.'));
      return;
    }

    content.appendChild(sectionHead('Labels', `${labelOrders.length} beschikbaar`));

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

      // Elke order die hier terechtkomt is al geverifieerd (zie tabLabels) —
      // de "📤 Stuur naar app"-knop is dus enkel nog een handmatige manier om
      // een label opnieuw te (her)versturen, bv. na een tijdelijke netwerkfout.
      const sendBtn = btn('✓ Verstuurd', `background:#dcfce7;color:#15803d;flex-shrink:0`);
      sendBtn.addEventListener('click', () => sendLabelAvailable(o.transactionId, sendBtn));
      actions.appendChild(sendBtn);

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

  const PROXY_URL          = 'https://vault-resell.vercel.app/api/label';
  const PREFETCH_PROXY_URL = 'https://vault-resell.vercel.app/api/label-prefetch';

  // ── Bijhouden welke labels al automatisch verwerkt zijn (chrome.storage.local
  // i.p.v. .session, want dit moet blijven bestaan tussen browsersessies —
  // anders zou elke herstart de hele lijst opnieuw versturen).
  const AUTO_SENT_KEY = 'vlt_auto_sent_labels';
  async function getAutoSentSet() {
    const { [AUTO_SENT_KEY]: ids = [] } = await chrome.storage.local.get([AUTO_SENT_KEY]);
    return new Set(ids);
  }
  async function addAutoSent(txId) {
    const set = await getAutoSentSet();
    set.add(txId);
    await chrome.storage.local.set({ [AUTO_SENT_KEY]: [...set] });
  }

  // Haalt het label op via de presigned shipment-URL en stuurt die naar
  // api/label-prefetch, dat het meteen cropt naar 4×6 en opslaat — zowel de
  // automatische scan als de handmatige "Stuur naar app"-knop gebruiken
  // dezelfde pipeline, zodat er nooit een label "beschikbaar" staat zonder
  // dat de gecropte versie al klaarstaat.
  async function prefetchLabel(txId) {
    const presignedUrl = await fetchLabelViaShipment(txId);
    const resp = await fetch(PREFETCH_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction_id: txId, label_url: presignedUrl }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }
    return resp.json();
  }

  // Meld bij de app dat er een verzendlabel klaarstaat voor deze transactie —
  // handmatige fallback-knop, gebruikt dezelfde prefetchLabel-pipeline als de
  // automatische scan (fetch + crop + opslaan, niet enkel een vlag zetten).
  async function sendLabelAvailable(txId, sendBtn) {
    sendBtn.textContent = '⏳ Versturen…'; sendBtn.disabled = true;
    try {
      await prefetchLabel(txId);
      await addAutoSent(txId);
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
  // Guard tegen overlappende rondes: background.js polt elke 5s of er een
  // vault_sync_requested-vlag klaarstaat, en reset die pas NA een volledige
  // FORCE_SYNC-roundtrip. Als 1 ronde (78 orders × conversation-detail calls)
  // langer duurt dan 5s — vrijwel altijd het geval — komt er zonder deze
  // guard een tweede (derde, vierde, …) overlappende FORCE_SYNC binnen
  // voordat de vlag gereset is, en begint getSold()/refreshKnownOrders() gewoon
  // opnieuw vanaf 0 bovenop de al lopende ronde — de vlag wordt dan nooit
  // meer teruggezet en de webapp-knop blijft eindeloos op "bezig" staan.
  let syncInProgress = false
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'FORCE_SYNC') return
    if (syncInProgress) {
      console.log('[Vault] FORCE_SYNC genegeerd — er loopt al een synchronisatie-ronde')
      sendResponse({ success: false, error: 'already_running' })
      return
    }
    syncInProgress = true
    ;(async () => {
      try {
        // force=true: negeer de sessiecache — dit is een expliciete "haal de
        // huidige status opnieuw op"-aanvraag, een gecachte lijst zou precies
        // het probleem in stand houden dat deze knop moet oplossen.
        const orders = await getSold(true)
        const active = orders.filter(o => !isCancelled(o))
        for (const o of active) {
          if (DEBUG_TXN_IDS.has(o.transactionId)) {
            console.log(`[Vault] DEBUG txn ${o.transactionId} direct na getSold(true): title="${o.title}" status="${o.status}" transactionUserStatus="${o.transactionUserStatus}" conversationId="${o.conversationId}" convId="${o.convId}" currentUserSide="${o.currentUserSide}"`);
          }
        }
        await enrichOrders(active)
        const result = await refreshKnownOrders(active, msg.userId, msg.autoSyncSales, msg.autoSyncPurchases)
        sendResponse({ success: true, count: active.length, ...result })
      } catch (e) {
        console.warn('[Vault] FORCE_SYNC error:', e.message)
        sendResponse({ success: false, error: e.message })
      } finally {
        syncInProgress = false
      }
    })()
    return true
  })

  // ── Live synchronisatie — periodieke achtergrond-trigger vanuit
  // background.js (chrome.alarms, elke ~4 min, zie runLiveSync()) i.p.v. een
  // handmatige "Alles synchroniseren"-klik. Hergebruikt exact dezelfde
  // refreshKnownOrders()/getSold()-logica als FORCE_SYNC hierboven, en deelt
  // dezelfde syncInProgress-guard zodat een live-sync-ronde en een
  // handmatige FORCE_SYNC nooit overlappend tegen Vinted's API in lopen.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'LIVE_SYNC') return
    if (syncInProgress) {
      console.log('[Vault] LIVE_SYNC genegeerd — er loopt al een synchronisatie-ronde')
      sendResponse({ success: false, error: 'already_running' })
      return
    }
    syncInProgress = true
    ;(async () => {
      const result = {}
      try {
        if (msg.sales || msg.purchases) {
          // Fotocache vullen/verversen vóórdat we verkopen verrijken — zie
          // getListings()/cacheItemPhotos hierboven. Best-effort: als dit
          // faalt (bv. geen wardrobe-toegang), mag de rest van de sync
          // gewoon doorgaan met wat al in de cache zit.
          try { await getListings() } catch (e) { console.warn('[Vault] LIVE_SYNC getListings skip:', e.message) }
          const orders = await getSold(true)
          const active = orders.filter(o => !isCancelled(o))
          await enrichOrders(active)
          result.orders = await refreshKnownOrders(active, msg.userId, msg.sales, msg.purchases)
        }
        if (msg.labels) {
          result.labels = await refreshLabels()
        }
        sendResponse({ success: true, ...result })
      } catch (e) {
        console.warn('[Vault] LIVE_SYNC error:', e.message)
        sendResponse({ success: false, error: e.message })
      } finally {
        syncInProgress = false
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
    // Als deze tab net geopend is voor een "Alles synchroniseren"-klik vanuit
    // de webapp, hoeft niet gewacht te worden op de eerstvolgende 5s-poll in
    // background.js — meteen checken of er een vlag klaarstaat.
    sendMsg({ type: 'CHECK_SYNC_NOW' });
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
