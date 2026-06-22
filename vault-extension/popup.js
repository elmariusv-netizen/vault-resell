(async function () {
  const todayKey = new Date().toISOString().slice(0, 10);

  const { syncedOrders = [], dailyStats = {} } = await chrome.storage.local.get([
    'syncedOrders',
    'dailyStats',
  ]);

  // ── Today stats ──────────────────────────────────────────────────────────
  const todayStats = dailyStats[todayKey] || { count: 0, revenue: 0 };
  document.getElementById('today-count').textContent = todayStats.count;
  document.getElementById('today-revenue').textContent =
    '€' + todayStats.revenue.toFixed(2).replace('.', ',');

  // ── Order list ───────────────────────────────────────────────────────────
  const listEl = document.getElementById('order-list');

  if (syncedOrders.length > 0) {
    listEl.innerHTML = '';
    syncedOrders.slice(0, 30).forEach((order) => {
      const item = document.createElement('div');
      item.className = 'order-item';

      const syncDate = order.syncedAt
        ? new Date(order.syncedAt).toLocaleDateString('nl-BE', {
            day: '2-digit',
            month: '2-digit',
          })
        : order.date || '';

      item.innerHTML = `
        <div class="order-dot"></div>
        <div class="order-info">
          <div class="order-title" title="${escHtml(order.title)}">${escHtml(order.title)}</div>
          <div class="order-meta">${escHtml(order.buyer)} · ${escHtml(syncDate)}</div>
        </div>
        <div class="order-price">€${(order.price || 0).toFixed(2).replace('.', ',')}</div>
      `;

      if (order.url) {
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => chrome.tabs.create({ url: order.url }));
      }

      listEl.appendChild(item);
    });
  }

  // ── Clear button ─────────────────────────────────────────────────────────
  document.getElementById('clear-btn').addEventListener('click', async () => {
    if (!confirm('Alle gesynchroniseerde bestellingen wissen?')) return;
    await chrome.storage.local.remove(['syncedOrders', 'dailyStats']);
    location.reload();
  });

  function escHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
