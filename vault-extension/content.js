(function () {
  'use strict';

  const OVERLAY_ID = 'vault-overlay';
  const TOG_ID     = 'vault-panel-toggle';
  const INDIGO     = '#4f46e5';
  const GREEN      = '#16a34a';
  const RED        = '#dc2626';

  // ── State ─────────────────────────────────────────────────────────────────
  let overlayOpen   = false;
  let activeTab     = 'verkopen';
  let scanActive    = false;
  let syncedIds     = new Set();
  let downloadedIds = new Set();

  const tabData = { verkopen: null, aankopen: null }; // null = not yet loaded

  // ── Helpers ───────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtPrice(v) {
    const n = parseFloat(v || 0);
    return n > 0 ? `€${n.toFixed(2).replace('.', ',')}` : '—';
  }

  function fmtDate(s) {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d)) return s.slice(0, 10);
    return d.toLocaleDateString('nl-BE', { day: '2-digit', month: 'short', year: '2-digit' });
  }

  function apiLabelUrl(id) {
    return `https://www.vinted.be/api/v2/transactions/${id}/shipment/pdf_label`;
  }

  // ── Page detection ────────────────────────────────────────────────────────
  function isOrdersPage(url) {
    return /\/(my[-_\/]?(orders?|purchases?|sales?|transactions?|bestellingen?|sold[-_]items?|items?))/i.test(url)
        || /\/transactions?\/\d+/i.test(url)
        || /\/my_orders/i.test(url);
  }

  // ── Storage ───────────────────────────────────────────────────────────────
  async function loadSyncedIds() {
    const { syncedOrders = [] } = await chrome.storage.local.get(['syncedOrders']);
    syncedIds = new Set(syncedOrders.map((o) => o.transactionId).filter(Boolean));
  }

  async function loadDownloadedIds() {
    const { interceptedLabels = [] } = await chrome.storage.local.get(['interceptedLabels']);
    downloadedIds = new Set(interceptedLabels.map((l) => l.orderId).filter(Boolean));
  }

  // ── Message helper (MV3 timeout guard) ───────────────────────────────────
  function sendMsg(msg, ms = 10000) {
    return Promise.race([
      new Promise((resolve) => {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) resolve({ success: false });
          else resolve(res || { success: false });
        });
      }),
      new Promise((resolve) => setTimeout(() => resolve({ success: false, timeout: true }), ms)),
    ]);
  }

  // ── Vinted API ────────────────────────────────────────────────────────────
  async function vintedFetch(path) {
    const res = await fetch(`https://www.vinted.be${path}`, {
      credentials: 'include',
      headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }

  async function fetchSoldOrders() {
    try {
      const data = await vintedFetch('/api/v2/my_orders?order_type=sold&page=1&per_page=80');
      const raw  = data.orders || data.transactions || data.my_orders || [];
      console.log('[Vault] sold orders:', raw.length);
      if (raw[0]) console.log('[Vault] sold sample fields:', Object.keys(raw[0]));
      return raw.map(parseOrder('sold'));
    } catch (e) { console.error('[Vault] sold API:', e); return []; }
  }

  async function fetchPurchasedOrders() {
    try {
      const data = await vintedFetch('/api/v2/my_orders?order_type=purchased&page=1&per_page=80');
      const raw  = data.orders || data.transactions || data.my_orders || [];
      console.log('[Vault] purchased orders:', raw.length);
      return raw.map(parseOrder('purchased'));
    } catch (e) { console.error('[Vault] purchased API:', e); return []; }
  }

  function parseOrder(type) {
    return (o) => ({
      transactionId: String(o.transaction_id || o.transaction?.id || o.id || ''),
      title:   o.item?.title || o.item_title || o.title || 'Onbekend item',
      photo:   o.item?.photos?.[0]?.url || o.item?.photo?.url || o.photo?.url || o.photos?.[0]?.url || null,
      price:   parseFloat(o.total_price || o.item?.price || o.price || 0),
      buyer:   type === 'sold'      ? (o.buyer?.login  || o.user?.login  || '') : '',
      seller:  type === 'purchased' ? (o.seller?.login || o.user?.login || '') : '',
      country: o.buyer?.country_iso_code || o.country_iso_code || o.country?.iso_code || '',
      date:    (o.created_at || o.updated_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
      status:  type,
      labelUrl: null, // filled below for sold orders
    });
  }

  // ── Auto-sync sold orders to Supabase ─────────────────────────────────────
  async function autoSync(orders) {
    for (const o of orders) {
      if (!o.transactionId || syncedIds.has(o.transactionId)) continue;
      o.labelUrl = apiLabelUrl(o.transactionId);
      const res = await sendMsg({ type: 'SYNC_ORDER', order: o });
      if (res?.success && !res.duplicate) {
        syncedIds.add(o.transactionId);
        console.log('[Vault] auto-synced', o.transactionId);
      }
    }
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  function toast(msg) {
    document.getElementById('vault-toast')?.remove();
    const t = Object.assign(document.createElement('div'), { id: 'vault-toast', textContent: msg });
    Object.assign(t.style, {
      position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '2147483647', background: '#0f172a', color: '#f8fafc',
      padding: '10px 20px', borderRadius: '10px', fontSize: '13px', fontWeight: '600',
      boxShadow: '0 4px 24px rgba(0,0,0,0.3)', opacity: '1', transition: 'opacity 0.3s',
      fontFamily: 'system-ui, sans-serif', whiteSpace: 'nowrap',
    });
    (document.body || document.documentElement).appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
  }

  // ── Overlay shell ─────────────────────────────────────────────────────────
  function buildOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;

    const ov = document.createElement('div');
    ov.id = OVERLAY_ID;
    Object.assign(ov.style, {
      position: 'fixed', inset: '0', zIndex: '2147483646',
      background: '#f8fafc', display: 'flex', flexDirection: 'column',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      opacity: '0', transition: 'opacity 0.18s ease',
    });

    ov.innerHTML = `
      <!-- top bar -->
      <div style="background:#fff;border-bottom:1px solid #e2e8f0;padding:0 28px;height:58px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;gap:16px">
        <span style="font-size:20px;font-weight:900;letter-spacing:3px;color:${INDIGO}">VAULT</span>
        <div id="vault-tabs" style="display:flex;height:100%;gap:0">
          ${['verkopen','aankopen','labels'].map((t, i) => `
            <button data-tab="${t}" style="
              display:flex;align-items:center;gap:6px;padding:0 22px;height:100%;
              border:none;border-bottom:3px solid transparent;background:none;
              cursor:pointer;font-size:13px;font-weight:600;color:#94a3b8;
              font-family:inherit;white-space:nowrap;transition:all 0.15s;
            ">${['📦 Verkopen','🛍 Aankopen','🏷 Labels'][i]}</button>
          `).join('')}
        </div>
        <button id="vault-ov-close" style="background:none;border:none;color:#94a3b8;font-size:22px;cursor:pointer;padding:6px;line-height:1;border-radius:6px;flex-shrink:0">✕</button>
      </div>
      <!-- content -->
      <div id="vault-ov-content" style="flex:1;overflow-y:auto;padding:24px 28px"></div>
      <!-- footer -->
      <div id="vault-ov-footer" style="background:#fff;border-top:1px solid #e2e8f0;padding:14px 28px;display:flex;gap:10px;flex-shrink:0"></div>
    `;

    (document.body || document.documentElement).appendChild(ov);

    ov.querySelector('#vault-ov-close').addEventListener('click', () => toggleOverlay(false));
    ov.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
  }

  function toggleOverlay(force) {
    buildOverlay();
    overlayOpen = force !== undefined ? force : !overlayOpen;
    const ov = document.getElementById(OVERLAY_ID);
    if (!ov) return;
    if (overlayOpen) {
      ov.style.display = 'flex';
      requestAnimationFrame(() => { ov.style.opacity = '1'; });
      switchTab(activeTab);
    } else {
      ov.style.opacity = '0';
      setTimeout(() => { ov.style.display = 'none'; }, 180);
    }
  }

  // ── Tab switching ─────────────────────────────────────────────────────────
  function setActiveTabStyle(tab) {
    document.querySelectorAll('#vault-tabs [data-tab]').forEach((btn) => {
      const on = btn.dataset.tab === tab;
      btn.style.color            = on ? INDIGO : '#94a3b8';
      btn.style.borderBottomColor = on ? INDIGO : 'transparent';
    });
  }

  async function switchTab(tab) {
    activeTab = tab;
    setActiveTabStyle(tab);
    const content = document.getElementById('vault-ov-content');
    const footer  = document.getElementById('vault-ov-footer');
    if (!content || !footer) return;

    content.innerHTML = loadingHTML();
    footer.innerHTML  = '';

    if (tab === 'verkopen') await renderVerkopen(content, footer);
    if (tab === 'aankopen') await renderAankopen(content, footer);
    if (tab === 'labels')   await renderLabels(content, footer);
  }

  function loadingHTML() {
    return `<div style="display:flex;align-items:center;justify-content:center;height:200px;color:#94a3b8;font-size:13px;gap:8px">
      <span style="font-size:20px">⏳</span> Laden…</div>`;
  }

  function emptyHTML(icon, title, sub) {
    return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:240px;color:#94a3b8;text-align:center;gap:8px">
      <div style="font-size:40px">${icon}</div>
      <div style="font-size:14px;font-weight:600;color:#475569">${title}</div>
      <div style="font-size:12px;line-height:1.6">${sub}</div></div>`;
  }

  // ── Tab 1 — Verkopen ──────────────────────────────────────────────────────
  async function renderVerkopen(content, footer) {
    if (!tabData.verkopen) {
      await loadSyncedIds();
      tabData.verkopen = await fetchSoldOrders();
      await autoSync(tabData.verkopen);
    }
    const orders = tabData.verkopen;

    if (!orders.length) {
      content.innerHTML = emptyHTML('📦', 'Geen verkopen gevonden', 'De API gaf geen resultaten terug.<br>Zorg dat je bent ingelogd op Vinted.');
      return;
    }

    content.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div>
          <h2 style="margin:0;font-size:16px;font-weight:700;color:#0f172a">Verkochte orders</h2>
          <div style="font-size:12px;color:#94a3b8;margin-top:2px">${orders.length} orders gevonden</div>
        </div>
        <button id="vault-refresh-verkopen" style="${btnStyle('#f8fafc','#374151','#e2e8f0')}">🔄 Verversen</button>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
        <div style="${rowHeaderStyle()}">
          <div style="width:15px"></div>
          <div style="width:52px"></div>
          <div style="flex:1;min-width:0">ITEM</div>
          <div style="width:130px">KOPER</div>
          <div style="width:90px;text-align:right">PRIJS</div>
          <div style="width:90px">DATUM</div>
          <div style="width:44px">LAND</div>
          <div style="width:28px"></div>
        </div>
        ${orders.map((o, i) => orderRowHTML(o, i, true)).join('')}
      </div>`;

    content.querySelector('#vault-refresh-verkopen')?.addEventListener('click', async (e) => {
      e.currentTarget.textContent = '⏳'; e.currentTarget.disabled = true;
      tabData.verkopen = null; await renderVerkopen(content, footer);
    });
    wireCheckboxes(content, footer, 'verkopen');
    wireRowSyncBtns(content);
    renderVerkopenFooter(footer, orders);
  }

  function renderVerkopenFooter(footer, orders) {
    footer.innerHTML = `
      <button id="vault-sel-all" style="${btnStyle('#f8fafc','#374151','#e2e8f0')}">☑ Alles selecteren</button>
      <button id="vault-sync-sel" style="${btnStyle(INDIGO,'#fff','transparent')} flex:1">☁ Sync geselecteerde (0)</button>`;
    footer.querySelector('#vault-sel-all').addEventListener('click', () => {
      document.querySelectorAll('#vault-ov-content input[type=checkbox]').forEach((cb) => { cb.checked = true; });
      updateSelCount(footer, orders);
    });
    footer.querySelector('#vault-sync-sel').addEventListener('click', () => syncSelected(footer));
  }

  // ── Tab 2 — Aankopen ─────────────────────────────────────────────────────
  async function renderAankopen(content, footer) {
    if (!tabData.aankopen) tabData.aankopen = await fetchPurchasedOrders();
    const orders = tabData.aankopen;

    if (!orders.length) {
      content.innerHTML = emptyHTML('🛍', 'Geen aankopen gevonden', 'Je hebt nog geen aankopen gedaan<br>of de API gaf geen resultaten terug.');
      return;
    }

    content.innerHTML = `
      <div style="margin-bottom:16px">
        <h2 style="margin:0;font-size:16px;font-weight:700;color:#0f172a">Aankopen</h2>
        <div style="font-size:12px;color:#94a3b8;margin-top:2px">${orders.length} aankopen gevonden</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
        <div style="${rowHeaderStyle()}">
          <div style="width:52px"></div>
          <div style="flex:1;min-width:0">ITEM</div>
          <div style="width:130px">VERKOPER</div>
          <div style="width:90px;text-align:right">PRIJS</div>
          <div style="width:90px">DATUM</div>
          <div style="width:44px">LAND</div>
        </div>
        ${orders.map((o) => orderRowHTML(o, -1, false)).join('')}
      </div>`;
  }

  // ── Tab 3 — Labels ────────────────────────────────────────────────────────
  async function renderLabels(content, footer) {
    await loadDownloadedIds();
    if (!tabData.verkopen) {
      await loadSyncedIds();
      tabData.verkopen = await fetchSoldOrders();
    }
    const pending = (tabData.verkopen || []).filter((o) => o.transactionId && !downloadedIds.has(o.transactionId));

    if (!pending.length) {
      content.innerHTML = emptyHTML('✅', 'Alle labels al geprint', 'Er zijn geen openstaande labels.<br>Nieuwe verkopen verschijnen hier automatisch.');
      return;
    }

    content.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div>
          <h2 style="margin:0;font-size:16px;font-weight:700;color:#0f172a">Openstaande labels</h2>
          <div style="font-size:12px;color:#94a3b8;margin-top:2px">${pending.length} labels nog niet geprint</div>
        </div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
        ${pending.map((o) => labelRowHTML(o)).join('')}
      </div>`;

    content.querySelectorAll('[data-dl-id]').forEach((btn) => {
      btn.addEventListener('click', () => downloadLabel(btn, btn.dataset.dlId));
    });

    footer.innerHTML = `<button id="vault-print-all-labels" style="${btnStyle(INDIGO,'#fff','transparent')} flex:1">🖨 Print alle ${pending.length} labels</button>`;
    footer.querySelector('#vault-print-all-labels').addEventListener('click', () => printAllLabels(pending, footer));
  }

  function labelRowHTML(o) {
    const photoHtml = o.photo
      ? `<img src="${esc(o.photo)}" alt="" style="${thumbStyle()}" loading="lazy">`
      : `<div style="${thumbStyle()} background:#f8fafc;display:flex;align-items:center;justify-content:center;font-size:22px">📦</div>`;
    return `
      <div style="${rowStyle()}">
        ${photoHtml}
        <div style="flex:1;min-width:0">
          <div style="${titleStyle()}">${esc(o.title)}</div>
          <div style="${subStyle()}">#${o.transactionId} · ${fmtDate(o.date)}</div>
        </div>
        <div style="font-size:14px;font-weight:700;color:${INDIGO};width:80px;text-align:right">${fmtPrice(o.price)}</div>
        <button data-dl-id="${esc(o.transactionId)}" style="${btnStyle('#f8fafc','#374151','#e2e8f0')} white-space:nowrap">⬇ Label</button>
      </div>`;
  }

  async function downloadLabel(btn, transactionId) {
    btn.textContent = '⏳'; btn.disabled = true;
    const res = await sendMsg({ type: 'PRINT_LABELS', labelUrls: [apiLabelUrl(transactionId)], transactionIds: [transactionId] }, 30000);
    if (res?.success) {
      downloadedIds.add(transactionId);
      btn.textContent = '✓ Klaar'; btn.style.color = GREEN;
      setTimeout(() => { btn.textContent = '⬇ Label'; btn.style.color = '#374151'; btn.disabled = false; }, 2000);
    } else {
      btn.textContent = '✗ Fout'; btn.style.color = RED;
      setTimeout(() => { btn.textContent = '⬇ Label'; btn.style.color = '#374151'; btn.disabled = false; }, 2000);
    }
  }

  async function printAllLabels(orders, footer) {
    const btn = footer.querySelector('#vault-print-all-labels');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Bezig…'; }
    const res = await sendMsg({
      type: 'PRINT_LABELS',
      labelUrls: orders.map((o) => apiLabelUrl(o.transactionId)),
      transactionIds: orders.map((o) => o.transactionId),
    }, 60000);
    if (res?.success) {
      (res.downloadedIds || orders.map((o) => o.transactionId)).forEach((id) => downloadedIds.add(id));
      toast(`✅ ${orders.length} labels gedownload!`);
      tabData.verkopen = null;
      await renderLabels(document.getElementById('vault-ov-content'), footer);
    } else {
      toast('PDF mislukt: ' + (res?.error || 'onbekende fout'));
      if (btn) { btn.disabled = false; btn.textContent = `🖨 Print alle ${orders.length} labels`; }
    }
  }

  // ── Shared row HTML ───────────────────────────────────────────────────────
  function orderRowHTML(o, idx, withCheckbox) {
    const person = o.buyer || o.seller || '';
    const photoHtml = o.photo
      ? `<img src="${esc(o.photo)}" alt="" style="${thumbStyle()}" loading="lazy">`
      : `<div style="${thumbStyle()} background:#f8fafc;display:flex;align-items:center;justify-content:center;font-size:20px">📦</div>`;

    return `
      <label style="${rowStyle()} cursor:pointer">
        ${withCheckbox && idx >= 0
          ? `<input type="checkbox" data-idx="${idx}" style="cursor:pointer;accent-color:${INDIGO};flex-shrink:0;width:15px;height:15px;margin:0">`
          : ''}
        ${photoHtml}
        <div style="flex:1;min-width:0">
          <div style="${titleStyle()}">${esc(o.title)}</div>
          ${person ? `<div style="${subStyle()}">@${esc(person)}</div>` : ''}
        </div>
        <div style="width:130px;font-size:12px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0">${person ? `@${esc(person)}` : '—'}</div>
        <div style="width:90px;text-align:right;font-size:14px;font-weight:700;color:${INDIGO};flex-shrink:0">${fmtPrice(o.price)}</div>
        <div style="width:90px;font-size:12px;color:#64748b;flex-shrink:0">${fmtDate(o.date)}</div>
        <div style="width:44px;font-size:13px;flex-shrink:0">${o.country || '—'}</div>
        ${withCheckbox && o.transactionId
          ? `<button data-sync-idx="${idx}" title="Sync" style="${btnStyle('#f8fafc','#64748b','#e2e8f0')} padding:4px 8px;font-size:13px">☁</button>`
          : '<div style="width:28px"></div>'}
      </label>`;
  }

  function rowHeaderStyle() {
    return `display:flex;align-items:center;gap:12px;padding:8px 16px;
      background:#f8fafc;border-bottom:1px solid #e2e8f0;
      font-size:10px;font-weight:700;color:#94a3b8;letter-spacing:0.8px;flex-shrink:0`;
  }

  function rowStyle() {
    return `display:flex;align-items:center;gap:12px;padding:10px 16px;
      border-bottom:1px solid #f8fafc;box-sizing:border-box;
      transition:background 0.1s`;
  }

  function thumbStyle() {
    return `width:52px;height:52px;border-radius:8px;object-fit:cover;
      flex-shrink:0;border:1px solid #f1f5f9`;
  }

  function titleStyle() {
    return `font-size:13px;font-weight:500;color:#0f172a;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3`;
  }

  function subStyle() {
    return `font-size:11px;color:#94a3b8;margin-top:2px;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis`;
  }

  function btnStyle(bg, color, border) {
    return `background:${bg};color:${color};border:1px solid ${border};
      border-radius:7px;padding:7px 13px;font-size:12px;font-weight:600;
      cursor:pointer;font-family:inherit;flex-shrink:0;line-height:1.2`;
  }

  // ── Checkbox + selection ──────────────────────────────────────────────────
  function wireCheckboxes(content, footer, tab) {
    content.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.addEventListener('change', () => updateSelCount(footer, tabData[tab]));
    });
  }

  function wireRowSyncBtns(content) {
    content.querySelectorAll('[data-sync-idx]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const o = tabData.verkopen?.[parseInt(btn.dataset.syncIdx, 10)];
        if (!o) return;
        btn.textContent = '⏳';
        sendMsg({ type: 'SYNC_TO_SUPABASE', order: o }).then((res) => {
          btn.textContent = res?.success ? '✓' : '!';
          btn.style.color = res?.success ? GREEN : RED;
          setTimeout(() => { btn.textContent = '☁'; btn.style.color = '#64748b'; }, 2500);
        });
      });
    });
  }

  function getCheckedOrders(tab) {
    return [...document.querySelectorAll('#vault-ov-content input[type=checkbox]:checked')]
      .map((cb) => (tabData[tab] || [])[parseInt(cb.dataset.idx, 10)])
      .filter((o) => o?.transactionId);
  }

  function updateSelCount(footer, orders) {
    const n   = document.querySelectorAll('#vault-ov-content input[type=checkbox]:checked').length;
    const btn = footer.querySelector('#vault-sync-sel');
    if (btn) btn.textContent = `☁ Sync geselecteerde (${n})`;
  }

  function syncSelected(footer) {
    const orders = getCheckedOrders('verkopen');
    if (!orders.length) { toast('Selecteer eerst orders om te synchroniseren.'); return; }
    const btn = footer.querySelector('#vault-sync-sel');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Syncing…'; }
    Promise.all(orders.map((o) => sendMsg({ type: 'SYNC_TO_SUPABASE', order: o }))).then((results) => {
      const ok = results.filter((r) => r?.success).length;
      toast(`✓ ${ok}/${orders.length} orders gesynchroniseerd`);
      if (btn) { btn.disabled = false; updateSelCount(footer, tabData.verkopen); }
    });
  }

  // ── Floating V button ─────────────────────────────────────────────────────
  function injectToggleButton() {
    if (document.getElementById(TOG_ID)) return;
    const btn = document.createElement('button');
    btn.id = TOG_ID;
    btn.innerHTML = `<span style="font-size:13px;font-weight:900;letter-spacing:1px;font-family:system-ui,sans-serif">V</span>`;
    btn.title = 'Vault Seller Tools';
    Object.assign(btn.style, {
      position: 'fixed', bottom: '24px', right: '24px', zIndex: '2147483647',
      background: INDIGO, color: '#fff', border: 'none', borderRadius: '50%',
      width: '48px', height: '48px', cursor: 'pointer',
      boxShadow: '0 4px 20px rgba(79,70,229,0.45)',
      fontFamily: 'system-ui, sans-serif',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'transform 0.15s, background 0.15s',
    });
    btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.1)'; });
    btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; });
    btn.addEventListener('click', () => toggleOverlay());
    (document.body || document.documentElement).appendChild(btn);
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  let panelDone = false;

  async function init() {
    if (isOrdersPage(location.href) && !panelDone) {
      panelDone = true;
      buildOverlay();
      injectToggleButton();
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.interceptedLabels) {
      const labels = changes.interceptedLabels.newValue || [];
      downloadedIds = new Set(labels.map((l) => l.orderId).filter(Boolean));
    }
  });

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      panelDone = false;
      overlayOpen = false;
      tabData.verkopen = null;
      tabData.aankopen = null;
      document.getElementById(OVERLAY_ID)?.remove();
      document.getElementById(TOG_ID)?.remove();
      document.getElementById('vault-toast')?.remove();
      setTimeout(init, 300);
    }
  }).observe(document, { subtree: true, childList: true });

  init();
})();
